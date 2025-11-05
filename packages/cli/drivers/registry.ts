import type { Message } from '../types.js';
import { 
    Driver, 
    type DriverManifestEntry, 
    type ViewDriverEntry, 
    type BackgroundTaskDriverEntry, 
    type DriverRuntimeContext, 
    type DriverHandler, 
    type DriverPrepareFn 
} from './types.js';
import { handlePlanReviewDo } from './plan-review-do/index.js';
import { buildPromptAgentStart } from '@taskagent/agents/runtime/runPromptAgentStart.js';

// Import placeholder views
// import StoryView from '../views/StoryView.js'; // Will be replaced by StackAgentView
// import UiReviewView from '../views/UiReviewView.js'; // Will be replaced by StackAgentView
// import GlossaryView from '../views/GlossaryView.js'; // Will be replaced by StackAgentView
// import LogicReviewView from '../views/LogicReviewView.js'; // Will be replaced by StackAgentView
// import DataReviewView from '../views/DataReviewView.js'; // Will be replaced by StackAgentView

const createPlaceholderHandler = (label: string): DriverHandler => {
    return async (_message, context) => {
        const tabId = context.sourceTabId || label;
        const systemMessage: Message = {
            id: context.nextMessageId(),
            role: 'system',
            content: `⚠️ ${label} driver 尚未实现，敬请期待。`,
            isBoxed: true,
            isPending: false,
            queueState: 'completed',
            timestamp: Date.now(),
        };
        context.messageStore.appendMessage(tabId, systemMessage);
        return true;
    };
};

export function getDriverManifest(): readonly DriverManifestEntry[] {
    // Auto-generate fg/bg slash commands for PromptAgent-based drivers
    type AgentSlashSpec = {
        driverId: Driver;
        name: string; // e.g., 'story', 'glossary', 'log-monitor'
        requiresSession: boolean;
    };

    const agentSlashSpecs: AgentSlashSpec[] = [
        {
            driverId: Driver.STORY,
            name: 'story',
            requiresSession: true,
        },
        {
            driverId: Driver.GLOSSARY,
            name: 'glossary',
            requiresSession: true,
        },
        {
            driverId: Driver.LOG_MONITOR,
            name: 'log-monitor',
            requiresSession: true,
        },
    ];

    const fgEntries: BackgroundTaskDriverEntry[] = agentSlashSpecs.map((spec) => ({
        type: 'background_task',
        id: spec.driverId,
        label: `fg:${spec.name}`,
        slash: `fg:${spec.name}`,
        description: `前台运行 ${spec.driverId}`,
        requiresSession: spec.requiresSession,
        handler: async (message: Message, context: DriverRuntimeContext) => {
            const prompt = message.content.trim();
            if (!prompt) return false;
            const tabId = context.sourceTabId || String(spec.driverId);

            if (context.runAgentPipeline) {
                const success = await context.runAgentPipeline(spec.name, prompt, {
                    tabId,
                    session: context.session,
                });
                return success;
            }

            const systemMsg: Message = {
                id: context.nextMessageId(),
                role: 'system',
                content: `❌ [${spec.driverId}] 前台模式未接入 TabExecutor，命令已跳过。`,
                isBoxed: true,
                isPending: false,
                queueState: 'completed',
                timestamp: Date.now(),
            };
            context.messageStore.appendMessage(tabId, systemMsg);
            return false;
        },
    }));

    const bgEntries: BackgroundTaskDriverEntry[] = agentSlashSpecs.map((spec) => ({
        type: 'background_task',
        id: spec.driverId,
        label: `bg:${spec.name}`,
        slash: `bg:${spec.name}`,
        description: `后台运行 ${spec.driverId}`,
        requiresSession: spec.requiresSession,
        handler: async (message: Message, context: DriverRuntimeContext) => {
            const prompt = message.content.trim();
            if (!prompt) return false;
            const tabId = context.sourceTabId || String(spec.driverId);
            if (context.scheduleAgentPipeline) {
                context.scheduleAgentPipeline(spec.name, prompt, {
                    tabId,
                    session: context.session,
                });
                return true;
            }

            const systemMsg: Message = {
                id: context.nextMessageId(),
                role: 'system',
                content: `❌ [${spec.driverId}] 后台模式未接入 TabExecutor，命令已跳过。`,
                isBoxed: true,
                isPending: false,
                queueState: 'completed',
                timestamp: Date.now(),
            };
            context.messageStore.appendMessage(tabId, systemMsg);
            return false;
        },
    }));

    return [
        // Auto-generated slash entries for background/foreground execution
        ...fgEntries,
        ...bgEntries,
        // Explicit background workflow (not a simple PromptAgent)
        {
            type: 'background_task',
            id: Driver.PLAN_REVIEW_DO,
            label: Driver.PLAN_REVIEW_DO,
            slash: 'plan-review-do',
            description: '执行 Plan-Review-Do 工作流',
            requiresSession: false,
            handler: async (message: Message, context: DriverRuntimeContext) => {
                return await handlePlanReviewDo(message, {
                    nextMessageId: context.nextMessageId,
                    messageStore: context.messageStore,
                    tabId: context.sourceTabId || Driver.PLAN_REVIEW_DO,
                    startTask: (prompt: string, options?: { agents?: Record<string, any> }) => {
                        const adapter = {
                            getPrompt: (userInput: string) => userInput,
                            getAgentDefinitions: () => options?.agents as any,
                        };
                        const agent = {
                            id: 'plan-review-do',
                            description: 'Ephemeral agent for Plan-Review-Do workflow',
                            start: buildPromptAgentStart(adapter),
                        } as any;
                        const result = context.startBackground(agent, prompt, { sourceTabId: context.sourceTabId || 'Plan-Review-DO', workspacePath: context.workspacePath, timeoutSec: 900, session: context.session, forkSession: true });
                        return { id: result.task.id };
                    },
                    waitTask: context.waitTask,
                });
            },
        },
        // NOTE: View Drivers (tabs) are now managed by TabRegistry in packages/tabs/
        // This registry only handles slash commands for background/foreground execution
    ];
}

const DRIVER_MANIFEST = getDriverManifest();

// Correctly generate tabs only from View drivers
export const DRIVER_TABS: readonly Driver[] = DRIVER_MANIFEST.filter((entry): entry is ViewDriverEntry => entry.type === 'view').map(entry => entry.label as Driver);

// Correctly generate commands only from Background Task drivers
export const getDriverCommandEntries = (): { name: string; description: string }[] => {
    return DRIVER_MANIFEST.filter((entry): entry is BackgroundTaskDriverEntry => entry.type === 'background_task').map(entry => ({
        name: entry.slash,
        description: entry.description,
    }));
};

// Helper to get a view driver by its label
export const getDriverByLabel = (label: string): ViewDriverEntry | undefined => {
    return DRIVER_MANIFEST.find((entry): entry is ViewDriverEntry => entry.type === 'view' && entry.label === label);
};

// Helper to get a background task driver by its slash command
export const getDriverBySlash = (slashName: string): BackgroundTaskDriverEntry | undefined => {
    const normalized = slashName.toLowerCase();
    const entry = DRIVER_MANIFEST.find(entry => entry.type === 'background_task' && entry.slash === normalized);
    if (entry && entry.type === 'background_task') {
        return entry;
    }
    return undefined;
};

export const getDriverByCliName = (cliName: string): ViewDriverEntry | undefined => {
    const normalizedCliName = cliName.toLowerCase();
    const entry = DRIVER_MANIFEST.find(entry => 
        entry.type === 'view' && 
        (entry.id.toLowerCase() === normalizedCliName || 
         entry.label.toLowerCase().replace(/\s/g, '-') === normalizedCliName)
    );
    if (entry && entry.type === 'view') {
        return entry;
    }
    return undefined;
};
