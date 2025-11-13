import { useEffect, useMemo, useState } from 'react';
import { TaskManager, type Task, type TaskWithEmitter } from '@taskagent/shared/task-manager';
import type { PromptAgent } from '@taskagent/agents/runtime/types.js';

interface UseTaskStoreOptions {
  pollIntervalMs?: number;
}

export const useTaskStore = ({ pollIntervalMs = 1000 }: UseTaskStoreOptions = {}) => {
  const taskManager = useMemo(() => new TaskManager(), []);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const updateTasks = () => {
      const nextTasks = taskManager.getAllTasks();
      setTasks(prev => {
        if (prev.length === nextTasks.length && prev.every((task, index) => task === nextTasks[index])) {
          return prev;
        }
        return nextTasks;
      });
    };

    updateTasks();
    const interval = setInterval(updateTasks, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, taskManager]);

  /**
   * startBackground - create a background Task with Agent instance and events
   */
  const startBackground = (
    agent: PromptAgent,
    userPrompt: string,
    context: {
      sourceTabId?: string;
      workspacePath?: string;
      timeoutSec?: number;
      session?: { id: string; initialized: boolean };
      forkSession?: boolean;
    } = {}
  ): TaskWithEmitter => {
    const finalContext = {
      sourceTabId: context.sourceTabId || 'unknown',
      workspacePath: context.workspacePath,
      timeoutSec: context.timeoutSec,
      session: context.session,
      forkSession: context.forkSession,
    };
    const result = taskManager.startBackground(agent, userPrompt, finalContext);
    setTasks(taskManager.getAllTasks()); // Immediately update tasks state
    return result;
  };

  const waitTask = (taskId: string) => taskManager.waitTask(taskId);
  const cancelTask = (taskId: string) => taskManager.cancelTask(taskId);

  return {
    tasks,
    startBackground,
    waitTask,
    cancelTask,
  };
};
