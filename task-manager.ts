
import crypto from 'crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Options,
  SDKAssistantMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { getTaskLogger } from './src/task-logger.ts';
import { addLog } from './src/logger.ts';

export interface Task {
  id: string;
  prompt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output: string;
  exitCode?: number | null;
  error?: string | null;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  createTask(prompt: string, queryOptions?: { agents?: Record<string, any> }): Task {
    const id = crypto.randomUUID();
    
    // Log received agents config - RAW DUMP
    // console.log(`[TaskManager.createTask] Task ${id.substring(0, 8)}... queryOptions RAW:`, queryOptions);
    
    const task: Task = {
      id,
      prompt,
      status: 'pending',
      output: '',
      exitCode: null,
      error: null,
    };
    this.tasks.set(id, task);
    
    // 记录任务创建
    const logger = getTaskLogger();
    logger.logTaskCreated(id, 'ai', prompt, {
      model: process.env.ANTHROPIC_MODEL,
      agents: queryOptions?.agents
    });
    
    this.runTask(task, queryOptions);
    return task;
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

  private async runTask(task: Task, queryOptions?: { agents?: Record<string, any> }) {
    const logger = getTaskLogger();
    
    // console.log(`[TaskManager.runTask] Task ${task.id.substring(0, 8)}... queryOptions RAW:`, queryOptions);
    // if (queryOptions?.agents) {
    //   console.log(`[TaskManager.runTask] queryOptions.agents RAW:`, queryOptions.agents);
    // }
    
    // 状态变更：pending → in_progress
    logger.logStatusChange(task.id, 'pending', 'in_progress');
    this.tasks.set(task.id, { ...task, status: 'in_progress' });

    try {
      const options: Options = {
        model: process.env.ANTHROPIC_MODEL,
      };

      // console.log(`[TaskManager.runTask] options BEFORE adding agents:`, options);

      // Add agents configuration if provided
      if (queryOptions?.agents) {
        (options as any).agents = queryOptions.agents;
        // console.log(`[TaskManager.runTask] options AFTER adding agents:`, options);
        // console.log(`[TaskManager.runTask] options.agents RAW:`, (options as any).agents);
      } else {
        addLog(`[TaskManager.runTask] No agents in queryOptions`);
      }

      // addLog(`[TaskManager.runTask] Final options object to pass to query(): ${JSON.stringify(options)}`);

      logger.logEvent(task.id, 'Starting LLM query', { 
        model: options.model,
        agents: queryOptions?.agents ? Object.keys(queryOptions.agents) : undefined
      });

      addLog(`[TaskManager.runTask] About to call query() with prompt (first 100 chars): ${task.prompt.substring(0, 100)}`);
      // addLog(`  - options object: ${JSON.stringify(options)}`);

      const result = await query({
        prompt: task.prompt,
        options: options,
      });

      // addLog(`[TaskManager.runTask] query() call completed, result: ${JSON.stringify(result)}`);
      addLog(`[TaskManager.runTask] Starting to process messages...`);

      let fullOutput = '';
      let messageCount = 0;
      for await (const message of result) {
        messageCount++;
        // addLog(`[TaskManager.runTask] Message ${messageCount}: ${JSON.stringify(message)}`);
        
        if (message.type === 'assistant') {
          const assistantMessage = message as SDKAssistantMessage;
          for (const block of assistantMessage.message.content) {
            if (block.type === 'text') {
              const previousLength = fullOutput.length;
              fullOutput += block.text;
              
              // 记录输出增量
              logger.logOutputChunk(task.id, block.text, fullOutput.length);
              
              this.tasks.set(task.id, { ...task, status: 'in_progress', output: fullOutput });
            }
          }
        }
      }

      addLog(`[TaskManager.runTask] All messages processed. Total: ${messageCount}, Output length: ${fullOutput.length}`);

      // 任务完成
      logger.logStatusChange(task.id, 'in_progress', 'completed');
      logger.logTaskCompleted(task.id, fullOutput, 0);
      this.tasks.set(task.id, { ...task, status: 'completed', output: fullOutput, exitCode: 0 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 任务失败
      logger.logStatusChange(task.id, 'in_progress', 'failed');
      logger.logTaskFailed(task.id, errorMessage, -1);
      
      this.tasks.set(task.id, { ...task, status: 'failed', output: errorMessage, error: errorMessage, exitCode: -1 });
    }
  }

  // CLI task runner removed as part of cleanup (runCliTask)
}
