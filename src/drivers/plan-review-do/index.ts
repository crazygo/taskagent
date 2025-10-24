
/**
 * Plan-Review-DO Driver 入口
 * 第一步：空实现，只记录日志并吞掉消息
 * 第二步：实现完整的 Coach 流程
 */

import type { Message } from '../../types.ts';
import { addLog } from '../../logger.ts';
import { runTask } from './flow.ts';

/**
 * 处理用户消息（Plan-Review-DO 模式）
 * 
 * @param userMessage - 用户输入的消息
 * @param callbacks - UI 回调函数（用于显示系统消息和访问 TaskManager）
 * @returns 是否成功处理
 */
export async function handlePlanReviewDo(
  userMessage: Message,
  callbacks: {
    nextMessageId: () => number;
    setActiveMessages: (updater: (prev: Message[]) => Message[]) => void;
    setFrozenMessages: (updater: (prev: Message[]) => Message[]) => void;
    createTask: (prompt: string) => { id: string };
    waitTask: (taskId: string) => Promise<{ id: string; status: string; output: string; error?: string | null }>;
  }
): Promise<boolean> {
  addLog(`[Plan-Review-DO] Received message: ${userMessage.content}`);

  // Progress helpers
  const pushSystem = (content: string, boxed = false) => {
    const msg: Message = {
      id: callbacks.nextMessageId(),
      role: 'system',
      content,
      isBoxed: boxed,
    };
    callbacks.setFrozenMessages(prev => [...prev, msg]);
  };

  pushSystem('PRD: Starting Plan-Review-DO flow');

  const result = await runTask(userMessage.content, {
    onNode: (name, message) => pushSystem(`${name.toUpperCase()}: ${message}`),
    onPlan: (plan) => {
      const planPreview = (plan || '').split('\n');
      const head = planPreview.slice(0, 20).join('\n');
      const suffix = planPreview.length > 20 ? '\n...' : '';
      pushSystem(`PLAN:\n${head}${suffix}`);
    },
    createTask: callbacks.createTask,
    waitTask: callbacks.waitTask,
  });

  // Summarize
  if (result.status === 'aborted_no_plan') {
    pushSystem(`PRD: Aborted (no plan). Reason: ${result.reason ?? 'n/a'}`, true);
  } else if (result.status === 'aborted_review') {
    pushSystem(`PRD: Aborted by review. Reason: ${result.reason ?? 'n/a'}`, true);
  } else if (result.status === 'done') {
    const diffInfo = result.doOutput?.codeDiff
      ? `\n\n--- diff (truncated) ---\n${result.doOutput.codeDiff.split('\n').slice(0, 20).join('\n')}\n...`
      : '';
    const artifactsInfo = result.doOutput?.artifacts?.length
      ? `\nArtifacts: ${result.doOutput.artifacts.slice(0, 5).join(', ')}${result.doOutput.artifacts.length > 5 ? ' ...' : ''}`
      : '';
    const outputInfo = result.doOutput?.output ? `\nOutput: ${result.doOutput.output.slice(0, 200)}` : '';
    pushSystem(`PRD: Done.${diffInfo}${artifactsInfo}${outputInfo}`, true);
  } else {
    pushSystem(`PRD: Error. ${result.reason ?? ''}`, true);
  }

  addLog(`[Plan-Review-DO] Completed with status=${result.status}`);
  return true;
}
