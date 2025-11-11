import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';
import { createWorkflowToolset, type WorkflowToolDefinition } from '../runtime/workflowTools.js';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { TabExecutor } from '../../execution/TabExecutor.js';

const CODER_AGENT_ID = 'coder';
const CODER_DESCRIPTION = 'Backend development executor for implementing features with self-testing';

export async function createAgent(options?: { tabExecutor?: TabExecutor }): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coder.agent.md',
    });

    const getPrompt = (userInput: string, _ctx: AgentContext | AgentStartContext) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const workflowToolset = createWorkflowToolset({
        agentId: CODER_AGENT_ID,
        sharedDependencies: {
            tabExecutor: options?.tabExecutor,
            defaultParentAgentId: CODER_AGENT_ID,
        },
        tool: defineCoderTool(),
    });

    const resolveMcpTool = (ctx: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string }) =>
        workflowToolset.asMcpTool({
            sourceTabId: ctx.sourceTabId,
            workspacePath: ctx.workspacePath,
            parentAgentId: ctx.parentAgentId ?? CODER_AGENT_ID,
        });

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput, ctx),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpTools: (ctx) => {
            const tool = resolveMcpTool({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.rawContext?.parentAgentId ?? CODER_AGENT_ID,
            });
            return tool ? { [CODER_AGENT_ID]: tool } : undefined;
        },
    });

    return {
        id: CODER_AGENT_ID,
        description: CODER_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        asMcpTool: (ctx) =>
            resolveMcpTool({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.parentAgentId ?? CODER_AGENT_ID,
            }),
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => start(userInput, context, sinks),
    };
}

function defineCoderTool(): WorkflowToolDefinition {
    return {
        name: CODER_AGENT_ID,
        description: '调用 Coder Agent 实现/修改代码并自测',
        parameters: {
            task: z.string().min(1).describe('编码任务描述'),
        },
        run: async (args, context) => {
            const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');

            if (!context.tabExecutor) {
                const message = 'TabExecutor 未初始化，无法启动 Coder';
                addLog(`[Coder Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            try {
                addLog(`[Coder Workflow] Starting Coder task: ${task.substring(0, 100)}...`);

                const result = await context.tabExecutor.execute(
                    'Coder',
                    'coder',
                    task,
                    {
                        sourceTabId: context.sourceTabId ?? 'Start',
                        workspacePath: context.workspacePath,
                        parentAgentId: context.parentAgentId ?? CODER_AGENT_ID,
                    },
                    { async: false }
                );

                return {
                    content: [{ type: 'text', text: `✅ Coder 完成\n\n${result}` }],
                };
            } catch (error) {
                const message = `启动 Coder 失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[Coder Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        },
    };
}
