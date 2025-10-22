
import { query, createAnthropic } from '@anthropic-ai/claude-agent-sdk';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
});

export interface Task {
  id: string;
  prompt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output: string;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  createTask(prompt: string): Task {
    const id = Date.now().toString();
    const task: Task = {
      id,
      prompt,
      status: 'pending',
      output: '',
    };
    this.tasks.set(id, task);
    this.runTask(task);
    return task;
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
      // Use the Claude SDK's query function
      const result = anthropic.query(task.prompt, {
        // Configure the model and other options as needed
        // For example, to specify a model:
        // model: 'claude-3-opus-20240229',
        // You might need to pass a CancellationToken or AbortController if you want to cancel tasks
      });

      let fullOutput = '';
      for await (const message of result) {
        if (message.type === 'assistant') {
          fullOutput += message.content;
          this.tasks.set(task.id, { ...task, status: 'in_progress', output: fullOutput });
        }
      }

      this.tasks.set(task.id, { ...task, status: 'completed', output: fullOutput });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.tasks.set(task.id, { ...task, status: 'failed', output: errorMessage });
    }
  }
}
