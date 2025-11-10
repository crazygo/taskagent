/**
 * DevHub Tools - MCP server + tool definitions
 *
 * Exposes the `send_to_looper` capability to Claude via the Agent SDK.
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { TabExecutor } from '../../execution/TabExecutor.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';

interface CreateDevHubMcpServerOptions {
  tabExecutor?: TabExecutor;
  workspacePath?: string;
}

/**
 * Build an in-process MCP server exposing DevHub-specific tools.
 */
export function createDevHubMcpServer(
  options: CreateDevHubMcpServerOptions
): McpSdkServerConfigWithInstance {
  const commandSchema = z.enum(['start', 'stop', 'status', 'add_pending']);

  const sendToLooper = tool(
    'send_to_looper',
    '向 Looper 循环引擎发送命令或任务',
    {
      command: commandSchema,
      task: z.string().optional(),
    },
    async (args) => {
      if (!options.tabExecutor) {
        const message = 'TabExecutor 未初始化，无法发送命令。';
        addLog(`[DevHub Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      const payload: Record<string, string> = args.task ? { type: args.command, task: args.task } : { type: args.command };

      try {
        addLog(
          `[DevHub Tool] Executing Looper command via TabExecutor: ${JSON.stringify(
            payload
          )}`
        );

        await options.tabExecutor.execute(
          'Looper',
          'looper',
          JSON.stringify(payload),
          {
            sourceTabId: 'DevHub',
            workspacePath: options.workspacePath,
            parentAgentId: 'devhub',
          }
        );

        const confirmation = `命令已发送给 Looper: ${args.command}\nLooper 将择机执行。`;
        return {
          content: [{ type: 'text', text: confirmation }],
        };
      } catch (error) {
        const message = `发送命令失败: ${
          error instanceof Error ? error.message : String(error)
        }`;
        addLog(`[DevHub Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: 'devhub-tools',
    tools: [sendToLooper],
  });
}
