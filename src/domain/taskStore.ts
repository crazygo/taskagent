import { useEffect, useMemo, useState } from 'react';
import type { EventEmitter } from 'events';
import { TaskManager, type Task, type TaskWithEmitter, type ForegroundSinks, type ForegroundHandle } from '../../task-manager.js';
import type { AtomicAgent } from '../agent/types.js';

interface UseTaskStoreOptions {
  pollIntervalMs?: number;
}

export const useTaskStore = ({ pollIntervalMs = 1000 }: UseTaskStoreOptions = {}) => {
  const taskManager = useMemo(() => new TaskManager(), []);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTasks(taskManager.getAllTasks());
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, taskManager]);

  /**
   * Legacy createTask - backward compatible
   */
  const createTask = (prompt: string, queryOptions?: { agents?: Record<string, any> }): Task => {
    const newTask = taskManager.createTask(prompt, queryOptions);
    setTasks(taskManager.getAllTasks()); // Immediately update tasks state
    return newTask;
  };

  /**
   * startBackground - create a background Task with Agent instance and events
   */
  const startBackground = (
    agent: AtomicAgent,
    userPrompt: string,
    context: {
      sourceTabId?: string;
      workspacePath?: string;
      timeoutSec?: number;
      session?: { id: string; initialized: boolean };
    } = {}
  ): TaskWithEmitter => {
    const finalContext = {
      sourceTabId: context.sourceTabId || 'unknown',
      workspacePath: context.workspacePath,
      timeoutSec: context.timeoutSec,
      session: context.session,
    };
    const result = taskManager.startBackground(agent, userPrompt, finalContext);
    setTasks(taskManager.getAllTasks()); // Immediately update tasks state
    return result;
  };

  const waitTask = (taskId: string) => taskManager.waitTask(taskId);
  const cancelTask = (taskId: string) => taskManager.cancelTask(taskId);
  const startForeground = (
    agent: AtomicAgent,
    userPrompt: string,
    context: { sourceTabId: string; workspacePath?: string; session?: { id: string; initialized: boolean } },
    sinks: ForegroundSinks,
  ): ForegroundHandle => {
    return taskManager.startForeground(agent, userPrompt, context, sinks);
  };

  return {
    tasks,
    createTask,
    startBackground,
    startForeground,
    waitTask,
    cancelTask,
  };
};
