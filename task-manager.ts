import crypto from 'crypto';
import { EventEmitter } from 'events';
import { type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { getTaskLogger } from './src/task-logger.js';
import { addLog } from './src/logger.js';
import { PromptAgent } from './src/agent/types.js';
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

    // Always use agent.start() in background path
    const maybeStart = (agent as unknown as { start?: (userInput: string, ctx: any, sinks: any) => { cancel: () => void; sessionId: string } }).start;
    if (typeof maybeStart !== 'function') {
      throw new Error('[BG] agent.start() is required for background runs');
    }

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

  // Legacy createTask removed – use startBackground with a PromptAgent

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
    const current = this.tasks.get(taskId);
    if (!current) {
      return { id: taskId, prompt: '', status: 'failed', output: '', exitCode: -1, error: 'Task not found' };
    }
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
      const { id, prompt, status, output, exitCode, error } = current;
      return { id, prompt, status, output, exitCode, error };
    }

    return new Promise<Task>((resolve) => {
      const emitter = this.eventEmitters.get(taskId);
      const finalize = () => {
        const t = this.tasks.get(taskId)!;
        resolve({ id: t.id, prompt: t.prompt, status: t.status, output: t.output, exitCode: t.exitCode, error: t.error });
      };
      if (!emitter) {
        finalize();
        return;
      }
      const onDone = () => { cleanup(); finalize(); };
      const cleanup = () => {
        emitter.off('completed', onDone);
        emitter.off('failed', onDone);
        emitter.off('cancelled', onDone);
      };
      emitter.on('completed', onDone);
      emitter.on('failed', onDone);
      emitter.on('cancelled', onDone);
    });
  }

  // CLI task runner removed as part of cleanup (runCliTask)

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).map(t => ({ id: t.id, prompt: t.prompt, status: t.status, output: t.output, exitCode: t.exitCode ?? null, error: t.error ?? null }));
  }
}
