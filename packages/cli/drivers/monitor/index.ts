import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverRuntimeContext } from '../types.js';
import type { Message } from '../../types.js';
import { createLogMonitor } from '@taskagent/agents';
import { addLog } from '../../logger.js';

// Foreground handler: run LogMonitor as a PromptAgent instance in the Monitor tab
async function handleMonitorInvocation(message: Message, context: DriverRuntimeContext): Promise<boolean> {
  const prompt = message.content.trim();
  if (!prompt) return false;

  const agent = createLogMonitor('debug.log', 100, 30);

  if (!context.startForeground) {
    throw new Error('startForeground is not available in runtime context');
  }

  // Show the user's message and finalize it into history
  const userId = context.nextMessageId();
  context.setActiveMessages(prev => [...prev, { id: userId, role: 'user', content: prompt }]);
  context.finalizeMessageById(userId);

  // Create an assistant message container for streaming output
  const pendingId = context.nextMessageId();
  context.setActiveMessages(prev => [...prev, { id: pendingId, role: 'assistant', content: '', isPending: true }]);
  let hasFinalizedPending = false;

  const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' } as const;

  context.startForeground(
    agent,
    prompt,
    { sourceTabId: context.sourceTabId || 'Monitor', workspacePath: context.workspacePath, session: context.session },
    {
      onText: (chunk: string) => {
        if (!hasFinalizedPending) {
          context.finalizeMessageById(pendingId);
          hasFinalizedPending = true;
        }

        const textMsgId = context.nextMessageId();
        context.setFrozenMessages(prev => [...prev, { id: textMsgId, role: 'assistant', content: chunk }]);
      },
      onEvent: (event) => {
        const icon = levelIcons[event.level] || '📝';
        const eventMsgId = context.nextMessageId();
        const timestamp = new Date().toISOString();
        addLog(`[Monitor-onEvent] ${timestamp} - Creating message #${eventMsgId}: ${event.message}`);
        
        // Use standard message flow: activeMessages → finalizeMessageById → frozenMessages
        // This ensures proper ordering with permission placeholders and other system messages
        context.setActiveMessages(prev => {
          addLog(`[Monitor-onEvent] ${timestamp} - Adding to activeMessages, id=${eventMsgId}`);
          return [...prev, { id: eventMsgId, role: 'system', content: `${icon} [Monitor] ${event.message}`, isBoxed: event.level === 'error' }];
        });
        
        addLog(`[Monitor-onEvent] ${timestamp} - Calling finalizeMessageById for id=${eventMsgId}`);
        context.finalizeMessageById(eventMsgId);
        addLog(`[Monitor-onEvent] ${timestamp} - Finalized message #${eventMsgId}`);
      },
      onCompleted: () => {
        if (!hasFinalizedPending) {
          context.finalizeMessageById(pendingId);
          hasFinalizedPending = true;
        }
        context.session?.markInitialized();
      },
      onFailed: (error: string) => {
        const timestamp = new Date().toISOString();
        if (!hasFinalizedPending) {
          addLog(`[Monitor-onFailed] ${timestamp} - Finalizing pending message #${pendingId}`);
          context.finalizeMessageById(pendingId);
          hasFinalizedPending = true;
        }
        
        const failMsgId = context.nextMessageId();
        addLog(`[Monitor-onFailed] ${timestamp} - Creating failure message #${failMsgId}: ${error}`);
        context.setActiveMessages(prev => [...prev, { id: failMsgId, role: 'system', content: `❌ [Monitor] 失败：${error}`, isBoxed: true }]);
        context.finalizeMessageById(failMsgId);
      },
      canUseTool: context.canUseTool,
    }
  );

  return true;
}

export const monitorDriverEntry: ViewDriverEntry = {
  type: 'view',
  id: Driver.MONITOR,
  label: Driver.MONITOR,
  description: 'Log Monitor · 监控 debug.log、任务日志与 git 变更（10 分钟轮询）',
  requiresSession: true,
  component: StackAgentView,
  handler: handleMonitorInvocation,
};

export { createLogMonitor } from '@taskagent/agents/monitor/index.js';
