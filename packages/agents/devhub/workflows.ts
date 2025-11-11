import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { WorkflowRuntimeContext, WorkflowToolDefinition } from '../runtime/workflowTools.js';
import type { LooperCommand, LooperCommandType } from './looper/command.js';

const DEV_HUB_AGENT_ID = 'devhub';

export interface DevLoopBridge {
    startLoop: (task: string, context: WorkflowRuntimeContext) => Promise<{ message: string; isError?: boolean }>;
    sendCommand: (command: LooperCommand, context: WorkflowRuntimeContext) => Promise<{ message: string; isError?: boolean }>;
}

export function getDevHubToolDefinitions(looper: DevLoopBridge): WorkflowToolDefinition {
    return createDevHubTool(looper);
}

export function getDevHubOperatorToolDefinitions(looper: DevLoopBridge): WorkflowToolDefinition {
    return createDevHubCommandTool(looper);
}

function createDevHubTool(looper: DevLoopBridge): WorkflowToolDefinition {
    return {
        name: DEV_HUB_AGENT_ID,
        description: '调用 DevHub Agent，协调 Coder / Reviewer 循环直至满足需求',
        parameters: {
            task: z.string().min(1).describe('开发任务描述'),
        },
        run: async (args, context) => {
            const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');

            try {
                addLog(`[DevHub Workflow] Dispatching DevLoop start: ${task.substring(0, 100)}...`);
                const result = await looper.startLoop(task, context);
                return {
                    content: [{ type: 'text', text: result.message }],
                    isError: result.isError,
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

function createDevHubCommandTool(looper: DevLoopBridge): WorkflowToolDefinition {
    const commandSchema = z.enum(['start', 'stop', 'status', 'add_pending']);

    return {
        name: 'devhub_command_tool',
        description: '向 Looper 循环引擎发送命令或任务',
        parameters: {
            command: commandSchema,
            task: z.string().optional(),
        },
        run: async (args, context) => {
            const command = typeof args.command === 'string' ? args.command : undefined;
            const task = typeof args.task === 'string' ? args.task : undefined;

            if (!command) {
                const message = '缺少必要的 command 参数。';
                addLog(`[DevHub Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            const payload: LooperCommand = task
                ? { type: command as LooperCommandType, task }
                : { type: command as LooperCommandType };

            try {
                addLog(`[DevHub Tool] Sending Looper command: ${JSON.stringify(payload)}`);
                const result = await looper.sendCommand(payload, context);
                const confirmation = result.message || `命令已发送给 Looper: ${command}`;
                return {
                    content: [{ type: 'text', text: confirmation }],
                    isError: result.isError,
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
