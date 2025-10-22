
import { query, Options, SDKMessage, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

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
      const options: Options = {
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
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

      this.tasks.set(task.id, { ...task, status: 'completed', output: fullOutput });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.tasks.set(task.id, { ...task, status: 'failed', output: errorMessage });
    }
  }
}
