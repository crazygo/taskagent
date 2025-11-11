import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { WorkflowToolDefinition } from '../runtime/workflowTools.js';

export function getDevHubWorkflowDefinitions(): WorkflowToolDefinition[] {
    return [createRunDevHubWorkflow(), createDispatchToDevloopWorkflow()];
}

function createRunDevHubWorkflow(): WorkflowToolDefinition {
    return {
        name: 'run_devhub',
        description: '启动 DevHub 开发枢纽，协调 Coder 和 Reviewer 的循环开发流程',
        parameters: {
            task: z.string().min(1).describe('开发任务描述'),
        },
        run: async (args, context) => {
            const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');

            if (!context.tabExecutor) {
                const message = 'TabExecutor 未初始化，无法启动 DevHub';
                addLog(`[DevHub Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            try {
                addLog(`[DevHub Workflow] Starting DevHub task: ${task.substring(0, 100)}...`);

                await context.tabExecutor.execute(
                    'DevHub',
                    'devhub',
                    task,
                    {
                        sourceTabId: context.sourceTabId ?? 'Desktop',
                        workspacePath: context.workspacePath,
                        parentAgentId: context.parentAgentId ?? 'devhub',
                    },
                    { async: true }
                );
                addLog('[DevHub Workflow] DevHub task dispatched (async)');

                return {
                    content: [{ type: 'text', text: '✅ DevHub 任务已启动，后台执行中...' }],
                };
            } catch (error) {
                const message = `启动 DevHub 失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[DevHub Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        },
    };
}

function createDispatchToDevloopWorkflow(): WorkflowToolDefinition {
    const commandSchema = z.enum(['start', 'stop', 'status', 'add_pending']);

    return {
        name: 'dispatch_to_devloop',
        description: '向 Looper 循环引擎发送命令或任务',
        parameters: {
            command: commandSchema,
            task: z.string().optional(),
        },
        run: async (args, context) => {
            const command = typeof args.command === 'string' ? args.command : undefined;
            const task = typeof args.task === 'string' ? args.task : undefined;

            if (!context.tabExecutor) {
                const message = 'TabExecutor 未初始化，无法发送命令。';
                addLog(`[DevHub Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            if (!command) {
                const message = '缺少必要的 command 参数。';
                addLog(`[DevHub Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            const payload: Record<string, string> = task ? { type: command, task } : { type: command };

            try {
                addLog(`[DevHub Tool] Executing Looper command via TabExecutor: ${JSON.stringify(payload)}`);

                await context.tabExecutor.execute(
                    'Looper',
                    'looper',
                    JSON.stringify(payload),
                    {
                        sourceTabId: 'DevHub',
                        workspacePath: context.workspacePath,
                        parentAgentId: context.parentAgentId ?? 'devhub',
                    }
                );

                const confirmation = `命令已发送给 Looper: ${command}\nLooper 将择机执行。`;
                return {
                    content: [{ type: 'text', text: confirmation }],
                };
            } catch (error) {
                const message = `发送命令失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[DevHub Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        },
    };
}
