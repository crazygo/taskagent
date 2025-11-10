import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { TabExecutor } from '../../execution/TabExecutor.js';
import { runBlueprintTask } from './async-task.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { emitProgress } from '../runtime/async-task/helpers.js';

interface CreateBlueprintMcpServerOptions {
    tabExecutor?: TabExecutor;
    workspacePath?: string;
    tabId?: string;
    agentRegistry?: AgentRegistry;
    eventBus?: EventBus;
}

export function createBlueprintMcpServer(options: CreateBlueprintMcpServerOptions) {
    return createSdkMcpServer({
        name: 'blueprint-tools',
        tools: [buildBlueprintTaskTool({
            name: 'run_blueprint_task',
            description: '启动 Blueprint 任务，自动执行 Writer + 验证循环',
            telemetryLabel: 'run_blueprint_task',
            options,
        })],
    });
}

function buildBlueprintTaskTool(params: {
    name: string;
    description: string;
    telemetryLabel: string;
    options: CreateBlueprintMcpServerOptions;
}) {
    const { name, description, telemetryLabel, options } = params;

    return tool(
        name,
        description,
        {
            task: z
                .string()
                .min(1)
                .describe('任务描述，包含目标文件和关键需求。例如 "更新 docs/login.md，整理登录流程"'),
        },
        async ({ task }) => {
            const targetTabId = options.tabId ?? 'Blueprint';

            if (!options.agentRegistry || !options.eventBus || !options.tabExecutor) {
                const message = '缺少必要依赖，无法启动 Blueprint 任务。';
                addLog(`[Blueprint Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            try {
                addLog(`[Blueprint Tool] ${telemetryLabel} starting async task: ${task}`);

                // 启动异步任务（立即返回 handle），并立刻播报一次进度以注册监听
                const handle = await runBlueprintTask(task, {
                    agentRegistry: options.agentRegistry,
                    eventBus: options.eventBus,
                    tabExecutor: options.tabExecutor,
                    workspacePath: options.workspacePath,
                    sourceTabId: targetTabId,
                    parentAgentId: 'blueprint',
                });
                emitProgress(options.eventBus, 'blueprint', targetTabId, 'Blueprint 任务已启动', handle.taskId);

                // 后台继续执行（不阻塞对话）
                void handle.completion.catch(error => {
                    const message = `Blueprint 任务后台执行失败: ${error instanceof Error ? error.message : String(error)}`;
                    addLog(`[Blueprint Tool] ${message}`);
                });

                return {
                    content: [{ type: 'text', text: '✅ Blueprint 任务已启动，稍后会同步进度。你可以继续对话。' }],
                };
            } catch (error) {
                const message = `启动 Blueprint 任务失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[Blueprint Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        }
    );
}
