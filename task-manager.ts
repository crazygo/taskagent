import crypto from 'crypto';
import { EventEmitter } from 'events';
import { query, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';
import { getTaskLogger } from './src/task-logger.js';
import { addLog } from './src/logger.js';
import { PromptAgent, DefaultAtomicAgent } from './src/agent/types.js';
import type { TaskEvent } from './src/types.js';

export interface Task {
  id: string;
  prompt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  output: string;
  exitCode?: number | null;
  error?: string | null;
}

export interface TaskExtended extends Task {
  agent?: PromptAgent;
  userPrompt: string;
  sourceTabId?: string;
  workspacePath?: string;
  events: TaskEvent[];
  timeoutSec?: number;
  session?: { id: string; initialized: boolean };
}

export interface TaskWithEmitter {
  task: TaskExtended;
  emitter: EventEmitter;
}

// Foreground streaming API Types
export type ForegroundSinks = {
  onText: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onEvent?: (e: TaskEvent) => void;
  onCompleted?: (fullText: string) => void;
  onFailed?: (error: string) => void;
  canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
};

export interface ForegroundHandle {
  cancel: () => void;
  sessionId: string;
}

export class TaskManager {
  private tasks: Map<string, TaskExtended> = new Map();
  private eventEmitters: Map<string, EventEmitter> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start a background agent run (creates a Task tab)
   */
  startBackground(
    agent: PromptAgent,
    userPrompt: string,
    context: {
      sourceTabId: string;
      workspacePath?: string;
      timeoutSec?: number;
      session?: { id: string; initialized: boolean };
    }
  ): { task: TaskExtended; emitter: EventEmitter } {
    const id = crypto.randomUUID();
    const emitter = new EventEmitter();

    addLog(`[TaskManager] startBackground agent=${agent.id}`);
    addLog(`[TaskManager] User prompt: ${userPrompt}`);
    try { addLog(`[TaskManager] Context: ${JSON.stringify(context)}`); } catch {}

    const agentContext = {
      sourceTabId: context.sourceTabId || 'unknown',
      workspacePath: context.workspacePath,
    };

    const generatedPrompt = agent.getPrompt(userPrompt, agentContext);
    addLog(`[TaskManager] Generated prompt:\n${generatedPrompt}`);

    const task: TaskExtended = {
      id,
      agent,
      userPrompt,
      prompt: generatedPrompt,
      status: 'pending',
      output: '',
      exitCode: null,
      error: null,
      sourceTabId: context.sourceTabId,
      workspacePath: context.workspacePath,
      events: [],
      timeoutSec: context.timeoutSec,
      session: context.session,
    };

    this.tasks.set(id, task);
    this.eventEmitters.set(id, emitter);

    // Set up timeout if specified
    if (context.timeoutSec && context.timeoutSec > 0) {
      const timeout = setTimeout(() => {
        this.cancelTask(id);
      }, context.timeoutSec * 1000);
      this.timeouts.set(id, timeout);
    }

    // Log task creation
    const logger = getTaskLogger();
    logger.logTaskCreated(id, 'ai', userPrompt, {
      model: process.env.ANTHROPIC_MODEL,
      agentId: agent.id,
      agentDescription: agent.description,
    });

    // Prefer agent.start if available; otherwise fallback to legacy path
    const maybeStart = (agent as unknown as { start?: (userInput: string, ctx: any, sinks: any) => { cancel: () => void; sessionId: string } }).start;
    if (typeof maybeStart === 'function') {
      addLog('[BG] Using agent.start()');

      // pending -> in_progress
      logger.logStatusChange(id, 'pending', 'in_progress');
      task.status = 'in_progress';
      this.tasks.set(id, task);

      const sinks: ForegroundSinks = {
        onText: (chunk: string) => {
          task.output = (task.output || '') + chunk;
          this.tasks.set(id, task);
          logger.logOutputChunk(id, chunk, task.output.length);
        },
        onEvent: (e: TaskEvent) => {
          task.events.push(e);
          this.tasks.set(id, task);
          const em = this.eventEmitters.get(id);
          em?.emit('event', e);
        },
        onCompleted: (fullText: string) => {
          logger.logStatusChange(id, 'in_progress', 'completed');
          logger.logTaskCompleted(id, fullText, 0);
          task.status = 'completed';
          task.exitCode = 0;
          task.output = fullText;
          this.tasks.set(id, task);
          const em = this.eventEmitters.get(id);
          em?.emit('completed');
          const timeout = this.timeouts.get(id);
          if (timeout) { clearTimeout(timeout); this.timeouts.delete(id); }
        },
        onFailed: (error: string) => {
          logger.logStatusChange(id, 'in_progress', 'failed');
          logger.logTaskFailed(id, error, -1);
          task.status = 'failed';
          task.error = error;
          task.exitCode = -1;
          this.tasks.set(id, task);
          const em = this.eventEmitters.get(id);
          em?.emit('failed', error);
          const timeout = this.timeouts.get(id);
          if (timeout) { clearTimeout(timeout); this.timeouts.delete(id); }
        },
        onReasoning: undefined,
        canUseTool: async (toolName: string) => {
          addLog(`[BG] Auto-approve tool: ${toolName}`);
          return undefined;
        },
      };

      void maybeStart.call(
        agent,
        userPrompt,
        { sourceTabId: context.sourceTabId, workspacePath: context.workspacePath, session: context.session },
        sinks,
      );
      return { task, emitter };
    }

    addLog('[TaskManager] Starting runTaskWithAgent (fallback)');
    this.runTaskWithAgent(task);
    return { task, emitter };
  }

  /**
   * Start a foreground agent run with streaming into provided sinks (no Task tab)
   * Does not register a Task in the internal map; lifecycle handled by the caller via the returned handle.
   */
  startForeground(
    agent: PromptAgent,
    userPrompt: string,
    context: {
      sourceTabId: string;
      workspacePath?: string;
      session?: { id: string; initialized: boolean };
    },
    sinks: ForegroundSinks,
  ): ForegroundHandle {
    const maybeStart = (agent as unknown as { start?: (userInput: string, ctx: any, sinks: any) => { cancel: () => void; sessionId: string } }).start;
    if (typeof maybeStart !== 'function') {
      throw new Error('[FG] agent.start() is required for foreground runs');
    }
    addLog('[FG] Using agent.start()');
    return maybeStart.call(
      agent,
      userPrompt,
      { sourceTabId: context.sourceTabId, workspacePath: context.workspacePath, session: context.session },
      sinks,
    );
  }

  /**
   * Legacy method for backward compatibility
   */
  createTask(prompt: string, queryOptions?: { agents?: Record<string, any> }): Task {
    const id = crypto.randomUUID();
    
    const task: TaskExtended = {
      id,
      userPrompt: prompt,
      prompt,
      status: 'pending',
      output: '',
      exitCode: null,
      error: null,
      events: [],
    };
    
    this.tasks.set(id, task);
    
    // Log task creation
    const logger = getTaskLogger();
    logger.logTaskCreated(id, 'ai', prompt, {
      model: process.env.ANTHROPIC_MODEL,
      agents: queryOptions?.agents,
    });
    
    this.runTask(task, queryOptions);
    return task;
  }

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): { ok: boolean } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { ok: false };
    }
    
    if (task.status === 'pending' || task.status === 'in_progress') {
      task.status = 'cancelled';
      this.tasks.set(taskId, task);
      
      const emitter = this.eventEmitters.get(taskId);
      if (emitter) {
        emitter.emit('cancelled');
      }
      
      const timeout = this.timeouts.get(taskId);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(taskId);
      }
      
      const logger = getTaskLogger();
      logger.logStatusChange(taskId, task.status, 'cancelled');
      
      return { ok: true };
    }
    
    return { ok: false };
  }

  // CLI task creation removed as part of cleanup (createCliTask)

  async waitTask(taskId: string): Promise<Task> {
    // Simple polling; UI already polls, this provides a programmatic await
    // to be used by flows.
    // Poll every 200ms until completed/failed.
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    // Fast path
    let t = this.tasks.get(taskId);
    while (t && (t.status === 'pending' || t.status === 'in_progress')) {
      await sleep(200);
      t = this.tasks.get(taskId);
    }
    if (!t) throw new Error(`Task not found: ${taskId}`);
    return t;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  private async runTaskWithAgent(task: TaskExtended) {
    const logger = getTaskLogger();
    const agent = task.agent || new DefaultAtomicAgent();
    
    addLog(`[TaskManager] runTaskWithAgent start task=${task.id}`);
    addLog(`[TaskManager] Agent: ${agent.id}`);
    addLog(`[TaskManager] Workspace: ${task.workspacePath ?? '(none)'}`);
    
    // 状态变更：pending → in_progress
    logger.logStatusChange(task.id, 'pending', 'in_progress');
    task.status = 'in_progress';
    this.tasks.set(task.id, task);

    try {
      const options: Record<string, unknown> = {
        model: agent.getModel?.() || process.env.ANTHROPIC_MODEL,
      };

      // Add workspace path
      if (task.workspacePath) {
        options.cwd = task.workspacePath;
        addLog(`[TaskManager] Set cwd: ${task.workspacePath}`);
      }

      // Add agent definitions if provided (feature detection, not type-based)
      try {
        const maybeGetDefs = (agent as unknown as { getAgentDefinitions?: () => Record<string, unknown> | undefined })
          .getAgentDefinitions;
        if (typeof maybeGetDefs === 'function') {
          const defs = maybeGetDefs.call(agent);
          if (defs && Object.keys(defs).length > 0) {
            (options as any).agents = defs;
            addLog('[TaskManager] Agent definitions detected, added to options');
          } else {
            addLog('[TaskManager] Agent definitions present but empty; skipping');
          }
        }
      } catch (e) {
        addLog(`[TaskManager] Failed to detect/add agent definitions: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Ensure Claude Code preset and session handling like Agent flow
      // This aligns our invocation with runClaudeStream used by Story/Agent tabs
      options.systemPrompt = { type: 'preset', preset: 'claude_code' } as any;
      
      // Use resume if session exists and is initialized, otherwise extraArgs for new session
      if (task.session) {
        if (task.session.initialized) {
          options.resume = task.session.id;
          addLog(`[TaskManager] Using resume with session: ${task.session.id}`);
        } else {
          (options as any).extraArgs = { 'session-id': task.session.id };
          addLog(`[TaskManager] Using new session: ${task.session.id}`);
        }
      } else {
        // Fallback: create ephemeral session
        (options as any).extraArgs = { 'session-id': crypto.randomUUID() };
        addLog('[TaskManager] Using ephemeral session');
      }

      // Provide canUseTool callback (match Agent flow exactly - no permissionMode, no allowedTools)
      options.canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        _opts: { signal: AbortSignal; suggestions?: unknown[] }
      ) => {
        addLog(`[TaskManager] Auto-approve tool: ${toolName} inputKeys=${Object.keys(input ?? {}).join(',')}`);
        return undefined; // Auto-approve
      };
      addLog('[TaskManager] Set canUseTool callback');

      logger.logEvent(task.id, 'Starting LLM query', { 
        model: options.model,
        agentId: agent.id,
      });

      addLog('[TaskManager] Calling SDK query');

      // Match Story/Agent flow: query returns an async iterable (do NOT await)
      const result = query({
        prompt: task.prompt,
        options: options,
      });

      addLog('[TaskManager] Query returned, processing messages');

      let fullOutput = '';
      let messageCount = 0;
      for await (const message of result) {
        messageCount++;
        addLog(`[TaskManager] Stream message #${messageCount} type=${(message as any)?.type}`);        if (message.type === 'assistant') {
          const assistantMessage = message as SDKAssistantMessage;
          for (const block of assistantMessage.message.content) {
            if (block.type === 'text') {
              fullOutput += block.text;
              
              // Log output chunk
              logger.logOutputChunk(task.id, block.text, fullOutput.length);
              
              // Update task output
              task.output = fullOutput;
              this.tasks.set(task.id, task);

              // Parse events if agent supports it
              if (agent.parseOutput) {
                const newEvents = agent.parseOutput(block.text);
                if (newEvents.length > 0) {
                  try { addLog(`[TaskManager] Parsed events: ${JSON.stringify(newEvents)}`); } catch {}
                  task.events.push(...newEvents);
                  this.tasks.set(task.id, task);
                  
                  // Emit events via EventEmitter
                  const emitter = this.eventEmitters.get(task.id);
                  if (emitter) {
                    for (const event of newEvents) {
                      emitter.emit('event', event);
                    }
                  }
                }
              }
            }
          }
        }
      }

      addLog(`[TaskManager.runTaskWithAgent] Task ${task.id.slice(0, 8)}: Completed. Messages: ${messageCount}, Output length: ${fullOutput.length}`);

      // Task completed
      logger.logStatusChange(task.id, 'in_progress', 'completed');
      logger.logTaskCompleted(task.id, fullOutput, 0);
      task.status = 'completed';
      task.exitCode = 0;
      this.tasks.set(task.id, task);

      // Emit completion event
      const emitter = this.eventEmitters.get(task.id);
      if (emitter) {
        emitter.emit('completed');
      }

      // Clear timeout
      const timeout = this.timeouts.get(task.id);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(task.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`[TaskManager] Error: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        addLog(`[TaskManager] Stack: ${error.stack}`);
      }
      
      // Task failed
      logger.logStatusChange(task.id, 'in_progress', 'failed');
      logger.logTaskFailed(task.id, errorMessage, -1);
      
      task.status = 'failed';
      task.output = errorMessage;
      task.error = errorMessage;
      task.exitCode = -1;
      this.tasks.set(task.id, task);

      // Emit failure event
      const emitter = this.eventEmitters.get(task.id);
      if (emitter) {
        emitter.emit('failed', errorMessage);
      }

      // Clear timeout
      const timeout = this.timeouts.get(task.id);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(task.id);
      }
    }
  }

  private async runTask(task: TaskExtended, queryOptions?: { agents?: Record<string, any> }) {
    const logger = getTaskLogger();
    
    // 状态变更：pending → in_progress
    logger.logStatusChange(task.id, 'pending', 'in_progress');
    task.status = 'in_progress';
    this.tasks.set(task.id, task);

    try {
      const options: Options = {
        model: process.env.ANTHROPIC_MODEL,
      };

      // Add agents configuration if provided
      if (queryOptions?.agents) {
        (options as any).agents = queryOptions.agents;
      }

      logger.logEvent(task.id, 'Starting LLM query', { 
        model: options.model,
        agents: queryOptions?.agents ? Object.keys(queryOptions.agents) : undefined
      });

      addLog(`[TaskManager.runTask] About to call query() with prompt (first 100 chars): ${task.prompt.substring(0, 100)}`);

      const result = await query({
        prompt: task.prompt,
        options: options,
      });

      addLog(`[TaskManager.runTask] Starting to process messages...`);

      let fullOutput = '';
      let messageCount = 0;
      for await (const message of result) {
        messageCount++;
        
        if (message.type === 'assistant') {
          const assistantMessage = message as SDKAssistantMessage;
          for (const block of assistantMessage.message.content) {
            if (block.type === 'text') {
              fullOutput += block.text;
              
              // 记录输出增量
              logger.logOutputChunk(task.id, block.text, fullOutput.length);
              
              task.output = fullOutput;
              this.tasks.set(task.id, task);
            }
          }
        }
      }

      addLog(`[TaskManager.runTask] All messages processed. Total: ${messageCount}, Output length: ${fullOutput.length}`);

      // 任务完成
      logger.logStatusChange(task.id, 'in_progress', 'completed');
      logger.logTaskCompleted(task.id, fullOutput, 0);
      task.status = 'completed';
      task.exitCode = 0;
      this.tasks.set(task.id, task);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 任务失败
      logger.logStatusChange(task.id, 'in_progress', 'failed');
      logger.logTaskFailed(task.id, errorMessage, -1);
      
      task.status = 'failed';
      task.output = errorMessage;
      task.error = errorMessage;
      task.exitCode = -1;
      this.tasks.set(task.id, task);
    }
  }

  // CLI task runner removed as part of cleanup (runCliTask)
}
