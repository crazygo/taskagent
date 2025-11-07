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
import { addLog } from '@taskagent/shared/logger';

const MEDIATOR_AGENT_ID = 'mediator';
const MEDIATOR_DESCRIPTION = '对话路由器，理解用户需求并协调任务执行';

export async function createAgent(options?: { 
  eventBus?: EventBus;
  tabExecutor?: any;
  messageStore?: any;
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

    addLog(`[Mediator] Loaded agent definitions: ${Object.keys(agentDefinitions || {})}`);
    addLog(`[Mediator] System prompt length: ${systemPrompt?.length || 0}`);
    addLog(`[Mediator] Allowed tools: ${allowedTools}`);

    // Subscribe to child agent outputs via agent:text events (agent hierarchy)
    // Mirror child agent outputs directly to Mediator tab, bypassing conversation queue
    if (options?.eventBus && options?.messageStore) {
        options.eventBus.on('agent:text', (event: any) => {
            try {
                const childAgentId = event?.agentId;
                const parentAgentId = event?.parentAgentId;
                const chunk = typeof event.payload === 'string' ? event.payload : '';
                
                addLog(`[Mediator] agent:text seen: agent=${childAgentId} parentAgent=${parentAgentId} chunk.length=${chunk.length}`);
                
                // Only mirror direct child agents (those calling Mediator as parent)
                if (parentAgentId !== 'mediator') return;
                if (!chunk) return;
                
                // Direct write to MessageStore, bypassing conversation queue
                addLog(`[Mediator] mirroring child agent ${childAgentId} output, len=${chunk.length}`);
                options.messageStore.appendMessage('Mediator', {
                    id: options.messageStore.getNextMessageId(),
                    role: 'assistant',
                    content: `[${childAgentId}] ${chunk}`,
                    isPending: false,
                    timestamp: event.timestamp || Date.now(),
                });
            } catch (e) {
                addLog(`[Mediator] mirror handler error: ${e instanceof Error ? e.message : String(e)}`);
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
