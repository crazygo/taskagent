/**
 * Mediator Agent - 对话路由器
 * 
 * 职责：
 * - 理解用户自然语言
 * - 路由任务到 Looper
 * - 订阅 Looper 消息，转述给用户
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { createMediatorMcpServer } from './tools.js';

const MEDIATOR_AGENT_ID = 'mediator';
const MEDIATOR_DESCRIPTION = '对话路由器，理解用户需求并协调任务执行';

export async function createAgent(options?: { 
  eventBus?: EventBus;
  tabExecutor?: any;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    // Load agent pipeline configuration (coordinator + sub-agents)
    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    console.log('[Mediator] Loaded agent definitions:', Object.keys(agentDefinitions || {}));
    console.log('[Mediator] System prompt length:', systemPrompt?.length || 0);
    console.log('[Mediator] Allowed tools:', allowedTools);

    // Verified: this subscription does NOT cause double Thinking (2025-11-07T02:12:26.025Z)
    // Subscribe to Looper messages via EventBus
    if (options?.eventBus) {
        options.eventBus.on('message:added', (event: any) => {
            if (event.payload.tabId === 'Looper') {
                const message = event.payload.message;
                if (message.content.includes('[AUTO]')) {
                    console.log(`[Mediator] Received Looper update: ${message.content}`);
                }
            }
        });
    }

    const getPrompt = (userInput: string) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpServers: (ctx) => {
            if (!options?.tabExecutor) {
                return undefined;
            }
            const server = createMediatorMcpServer({
                tabExecutor: options.tabExecutor,
                workspacePath: ctx.workspacePath,
            });
            return {
                'mediator-tools': server,
            };
        },
    });

    return {
        id: MEDIATOR_AGENT_ID,
        description: MEDIATOR_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
            // Inject tabExecutor into context for tools
            const enhancedContext = {
                ...context,
                tabExecutor: options?.tabExecutor,
            };
            
            return start(userInput, enhancedContext as any, sinks);
        },
    };
}
