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

  const createTask = (prompt: string, queryOptions?: { agents?: Record<string, any> }): Task => {
    // console.log(`[taskStore.createTask] queryOptions RAW:`, queryOptions);
    // if (queryOptions?.agents) {
    //   console.log(`[taskStore.createTask] queryOptions.agents RAW:`, queryOptions.agents);
    // }
    const newTask = taskManager.createTask(prompt, queryOptions);
    setTasks(taskManager.getAllTasks()); // Immediately update tasks state
    return newTask;
  };
  const waitTask = (taskId: string) => taskManager.waitTask(taskId);

  return {
    tasks,
    createTask,
    waitTask,
  };
};
