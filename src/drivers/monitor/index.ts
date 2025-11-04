import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverRuntimeContext } from '../types.js';
import type { Message } from '../../types.js';
import { createLogMonitor } from '../../agents/log-monitor/index.js';

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

  const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' } as const;

  context.startForeground(
    agent,
    prompt,
    { sourceTabId: context.sourceTabId || 'Monitor', workspacePath: context.workspacePath, session: context.session },
    {
      onText: (chunk: string) => {
        context.setActiveMessages(prev => prev.map(m => m.id === pendingId ? { ...m, content: (m.content || '') + chunk } : m));
      },
      onEvent: (event) => {
        const icon = levelIcons[event.level] || '📝';
        context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `${icon} [Monitor] ${event.message}`, isBoxed: event.level === 'error' }]);
      },
      onCompleted: () => {
        context.finalizeMessageById(pendingId);
        context.session?.markInitialized();
      },
      onFailed: (error: string) => {
        context.finalizeMessageById(pendingId);
        context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `❌ [Monitor] 失败：${error}`, isBoxed: true }]);
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

export { createLogMonitor } from '../../agents/log-monitor/index.js';
