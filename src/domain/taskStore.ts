import { useEffect, useMemo, useState } from 'react';
import { TaskManager, type Task } from '../../task-manager.ts';

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

  const createTask = (prompt: string) => taskManager.createTask(prompt);
  const createCliTask = (command: string, args: string[] = [], options?: { cwd?: string; env?: Record<string, string | undefined> }) =>
    taskManager.createCliTask(command, args, options);
  const waitTask = (taskId: string) => taskManager.waitTask(taskId);

  return {
    tasks,
    createTask,
    createCliTask,
    waitTask,
  };
};
