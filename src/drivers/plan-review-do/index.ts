
/**
 * Plan-Review-DO Driver 入口
 * 第一步：空实现，只记录日志并吞掉消息
 * 第二步：实现完整的 Coach 流程
 */

import type { Message } from '../../types.ts';
import { addLog } from '../../logger.ts';
import { makeDecision, dispatch, observe, review } from './flow.ts';

/**
 * 处理用户消息（Plan-Review-DO 模式）
 * 
 * @param userMessage - 用户输入的消息
 * @param callbacks - UI 回调函数（用于显示系统消息）
 * @returns 是否成功处理
 */
export async function handlePlanReviewDo(
  userMessage: Message,
  callbacks: {
    nextMessageId: () => number;
    setActiveMessages: (updater: (prev: Message[]) => Message[]) => void;
    setFrozenMessages: (updater: (prev: Message[]) => Message[]) => void;
  }
): Promise<boolean> {
  addLog(`[Plan-Review-DO] Received message: ${userMessage.content}`);
  
  // TODO: 第二步实现完整流程
  // 1. const decision = await makeDecision(userMessage.content);
  // 2. const subTasks = await dispatch(decision);
  // 3. const workers = await executeSubTasks(subTasks);
  // 4. const report = await observe(workers);
  // 5. const result = await review(report);
  // 6. 根据 result.decision 决定是否循环
  
  // 第一步：显示占位符消息
  const systemMessage: Message = {
    id: callbacks.nextMessageId(),
    role: 'system',
    content: '⚠️  Plan-Review-DO Driver is under construction.\n\nYour message has been received but not processed.\nThis will be implemented in Step 2.',
    isBoxed: true,
  };
  
  callbacks.setActiveMessages(prev => [...prev, systemMessage]);
  callbacks.setFrozenMessages(prev => [...prev, systemMessage]);
  
  addLog('[Plan-Review-DO] Message handled (placeholder implementation)');
  
  return true;
}
