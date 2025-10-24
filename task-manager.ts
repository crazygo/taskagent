
import crypto from 'crypto';
import { spawn } from 'child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Options,
  SDKAssistantMessage,
} from '@anthropic-ai/claude-agent-sdk';

export interface Task {
  id: string;
  prompt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output: string;
  kind?: 'ai' | 'cli';
  command?: string;
  args?: string[];
  exitCode?: number | null;
  error?: string | null;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  createTask(prompt: string): Task {
    const id = crypto.randomUUID();
    const task: Task = {
      id,
      prompt,
      status: 'pending',
      output: '',
      kind: 'ai',
      exitCode: null,
      error: null,
    };
    this.tasks.set(id, task);
    this.runTask(task);
    return task;
  }

  createCliTask(command: string, args: string[] = [], options?: { cwd?: string; env?: Record<string, string | undefined> }): Task {
    const id = crypto.randomUUID();
    const task: Task = {
      id,
      prompt: `${command} ${args.join(' ')}`,
      status: 'pending',
      output: '',
      kind: 'cli',
      command,
      args,
      exitCode: null,
      error: null,
    };
    this.tasks.set(id, task);
    this.runCliTask(task, options);
    return task;
  }

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

  private async runTask(task: Task) {
    this.tasks.set(task.id, { ...task, status: 'in_progress' });

    try {
      const options: Options = {
        model: process.env.ANTHROPIC_MODEL,
      };

      const result = await query({
        prompt: task.prompt,
        options: options,
      });

      let fullOutput = '';
      for await (const message of result) {
        if (message.type === 'assistant') {
          const assistantMessage = message as SDKAssistantMessage;
          for (const block of assistantMessage.message.content) {
            if (block.type === 'text') {
              fullOutput += block.text;
              this.tasks.set(task.id, { ...task, status: 'in_progress', output: fullOutput });
            }
          }
        }
      }

      this.tasks.set(task.id, { ...task, status: 'completed', output: fullOutput, exitCode: 0 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.tasks.set(task.id, { ...task, status: 'failed', output: errorMessage, error: errorMessage, exitCode: -1 });
    }
  }

  private runCliTask(task: Task, options?: { cwd?: string; env?: Record<string, string | undefined> }) {
    this.tasks.set(task.id, { ...task, status: 'in_progress' });
    try {
      const child = spawn(task.command as string, task.args ?? [], {
        cwd: options?.cwd ?? process.cwd(),
        env: { ...process.env, ...(options?.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (chunk: string) => {
        const prev = this.tasks.get(task.id);
        if (!prev) return;
        const nextOut = (prev.output || '') + chunk.toString();
        this.tasks.set(task.id, { ...prev, output: nextOut });
      });
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk: string) => {
        const prev = this.tasks.get(task.id);
        if (!prev) return;
        const nextOut = (prev.output || '') + chunk.toString();
        this.tasks.set(task.id, { ...prev, output: nextOut });
      });

      child.on('close', (code: number | null) => {
        const prev = this.tasks.get(task.id);
        if (!prev) return;
        const status = code === 0 ? 'completed' : 'failed';
        this.tasks.set(task.id, { ...prev, status, exitCode: code ?? -1 });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const prev = this.tasks.get(task.id);
      if (!prev) return;
      this.tasks.set(task.id, { ...prev, status: 'failed', error: errorMessage });
    }
  }
}
