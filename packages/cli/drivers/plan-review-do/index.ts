
/**
 * Task Flow Driver 入口
 * V3: Simplified 2-node workflow (planWithReview + execute)
 */

import type { Message } from '../../types.js';
import type { MessageStore } from '../../store/MessageStore.js';
import { addLog } from '@taskagent/shared/logger';
import { runTask, type TaskRunState } from './flow.js';

/**
 * 处理用户消息（Task Flow 模式）
 * 
 * @param userMessage - 用户输入的消息
 * @param callbacks - UI 回调函数（用于显示系统消息和访问 TaskManager）
 * @returns 是否成功处理
 */
export async function handleTaskFlow(
  userMessage: Message,
  callbacks: {
    nextMessageId: () => number;
    messageStore: MessageStore;
    tabId: string;
    startTask: (prompt: string, queryOptions?: { agents?: Record<string, any> }) => { id: string };
    waitTask: (taskId: string) => Promise<{ id: string; status: string; output: string; error?: string | null }>;
  }
): Promise<boolean> {
  addLog(`[TaskFlow] Received message: ${userMessage.content}`);

  // Progress helpers
  const pushSystem = (content: string, boxed = false) => {
    const msg: Message = {
      id: callbacks.nextMessageId(),
      role: 'system',
      content,
      isBoxed: boxed,
      isPending: false,
      queueState: 'completed',
      timestamp: Date.now(),
    };
    callbacks.messageStore.appendMessage(callbacks.tabId, msg);
  };

  // Note: Workflow progress is logged to console by flow.ts
  // No need to push system messages for workflow start/end

  const result: TaskRunState = await runTask(userMessage.content, {
    startTask: callbacks.startTask,
    waitTask: callbacks.waitTask,
  });

  // After workflow completes, show final result to user
  if (!result.plan) {
    // No plan generated - workflow aborted
    pushSystem(`❌ Task Aborted - Unable to generate an approved plan`, true);
  } else {
    // Plan was generated, check if execution completed
    const lastMessage = result.messages[result.messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content.includes('<summary>')) {
      // Execution completed - show summary
      const confidenceMatch = lastMessage.content.match(/<exit\s+confidence=([\d.]+)\s*\/>/i);
      const confidence = confidenceMatch && confidenceMatch[1] ? parseFloat(confidenceMatch[1]) : 0;
      
      const summaryMatch = lastMessage.content.match(/<summary>([\s\S]*?)<\/summary>/i);
      const summary = summaryMatch && summaryMatch[1] ? summaryMatch[1].trim() : 'Execution completed';
      
      // Show execution summary with confidence
      pushSystem(`✅ Task Completed\n\n${summary}\n\nConfidence: ${confidence}`, true);
    } else {
      // Plan generated but execution didn't complete
      pushSystem(`⚠️ Plan was approved but execution did not complete`, true);
    }
  }

  // Debug info logged to file only
  addLog(`[TaskFlow] Completed. Plan: ${result.plan ? 'YES' : 'NO'}, Messages: ${result.messages.length}`);
  return true;
}

// Legacy alias (to be deprecated)
export const handlePlanReviewDo = handleTaskFlow;
