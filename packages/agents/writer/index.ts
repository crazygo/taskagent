import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';
import { createWorkflowToolset, type WorkflowToolDefinition } from '../runtime/workflowTools.js';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { TabExecutor } from '../../execution/TabExecutor.js';

const WRITER_AGENT_ID = 'writer';
const WRITER_DESCRIPTION = 'Writer - Write structured feature YAML files';

export async function createAgent(options?: { tabExecutor?: TabExecutor }): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'writer.agent.md',
    });

    const getPrompt = (userInput: string, _ctx: AgentContext | AgentStartContext) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const workflowToolset = createWorkflowToolset({
        agentId: WRITER_AGENT_ID,
        serverName: 'writer-tools',
        sharedDependencies: {
            tabExecutor: options?.tabExecutor,
            defaultParentAgentId: WRITER_AGENT_ID,
        },
        tools: [createRunWriterWorkflow()],
    });

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput, ctx),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpServers: (ctx) =>
            workflowToolset.asMcpServer({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.rawContext?.parentAgentId ?? WRITER_AGENT_ID,
            }),
    });

    return {
        id: WRITER_AGENT_ID,
        description: WRITER_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        asMcpServer: (ctx) =>
            workflowToolset.asMcpServer({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.parentAgentId ?? WRITER_AGENT_ID,
            }),
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => start(userInput, context, sinks),
    };
}

function createRunWriterWorkflow(): WorkflowToolDefinition {
    return {
        name: 'WriterAgent',
        description: '直接调用 Writer Agent 创建或编辑文件',
        parameters: {
            task: z.string().min(1).describe('写作任务描述，包含目标文件和内容要求'),
        },
        run: async (args, context) => {
            const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');

            if (!context.tabExecutor) {
                const message = 'TabExecutor 未初始化，无法启动 Writer';
                addLog(`[Writer Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            try {
                addLog(`[Writer Workflow] Starting Writer task: ${task.substring(0, 100)}...`);

                const result = await context.tabExecutor.execute(
                    'Writer',
                    'writer',
                    task,
                    {
                        sourceTabId: context.sourceTabId ?? 'Desktop',
                        workspacePath: context.workspacePath,
                        parentAgentId: context.parentAgentId ?? WRITER_AGENT_ID,
                    },
                    { async: false }
                );

                return {
                    content: [{ type: 'text', text: `✅ Writer 完成\n\n${result}` }],
                };
            } catch (error) {
                const message = `启动 Writer 失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[Writer Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        },
    };
}
