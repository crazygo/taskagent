/**
 * Desktop Tools - MCP server for dispatching to atomic and composite agents
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { TabExecutor } from '../../execution/TabExecutor.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';

interface CreateDesktopMcpServerOptions {
  tabExecutor?: TabExecutor;
  workspacePath?: string;
}

/**
 * Build an in-process MCP server exposing Desktop-specific tools.
 */
export function createDesktopMcpServer(
  options: CreateDesktopMcpServerOptions
): McpSdkServerConfigWithInstance {
  const taskSchema = z.string().min(1).describe('任务描述');

  // Tool: run_blueprint
  const runBlueprint = tool(
    'run_blueprint',
    '启动 Blueprint 任务，生成 docs/features/*.yaml 规范文档',
    { task: taskSchema },
    async ({ task }) => {
      if (!options.tabExecutor) {
        const message = 'TabExecutor 未初始化，无法启动 Blueprint';
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      try {
        addLog(`[Desktop Tool] Starting Blueprint task: ${task.substring(0, 100)}...`);

        await options.tabExecutor.execute(
          'Blueprint',
          'blueprint',
          task,
          {
            sourceTabId: 'Desktop',
            workspacePath: options.workspacePath,
            parentAgentId: 'desktop',
          },
          { async: true }  // Fire-and-forget mode
        );
        addLog(`[Desktop Tool] Blueprint task dispatched (async)`);

        return {
          content: [{ type: 'text', text: '✅ Blueprint 任务已启动，后台执行中...' }],
        };
      } catch (error) {
        const message = `启动 Blueprint 失败: ${error instanceof Error ? error.message : String(error)}`;
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  // Tool: run_writer
  const runWriter = tool(
    'run_writer',
    '直接调用 Writer Agent 创建或编辑文件',
    { task: taskSchema },
    async ({ task }) => {
      if (!options.tabExecutor) {
        const message = 'TabExecutor 未初始化，无法启动 Writer';
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      try {
        addLog(`[Desktop Tool] Starting Writer task: ${task.substring(0, 100)}...`);

        const result = await options.tabExecutor.execute(
          'Writer',
          'writer',
          task,
          {
            sourceTabId: 'Desktop',
            workspacePath: options.workspacePath,
            parentAgentId: 'desktop',
          },
          { async: false }  // Wait for result
        );

        return {
          content: [{ type: 'text', text: `✅ Writer 完成\n\n${result}` }],
        };
      } catch (error) {
        const message = `启动 Writer 失败: ${error instanceof Error ? error.message : String(error)}`;
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  // Tool: run_coder
  const runCoder = tool(
    'run_coder',
    '调用 Coder Agent 实现代码功能',
    { task: taskSchema },
    async ({ task }) => {
      if (!options.tabExecutor) {
        const message = 'TabExecutor 未初始化，无法启动 Coder';
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      try {
        addLog(`[Desktop Tool] Starting Coder task: ${task.substring(0, 100)}...`);

        const result = await options.tabExecutor.execute(
          'Coder',
          'coder',
          task,
          {
            sourceTabId: 'Desktop',
            workspacePath: options.workspacePath,
            parentAgentId: 'desktop',
          },
          { async: false }  // Wait for result
        );

        return {
          content: [{ type: 'text', text: `✅ Coder 完成\n\n${result}` }],
        };
      } catch (error) {
        const message = `启动 Coder 失败: ${error instanceof Error ? error.message : String(error)}`;
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  // Tool: run_reviewer
  const runReviewer = tool(
    'run_reviewer',
    '调用 Reviewer Agent 进行代码审查',
    { task: taskSchema },
    async ({ task }) => {
      if (!options.tabExecutor) {
        const message = 'TabExecutor 未初始化，无法启动 Reviewer';
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      try {
        addLog(`[Desktop Tool] Starting Reviewer task: ${task.substring(0, 100)}...`);

        const result = await options.tabExecutor.execute(
          'Review',
          'review',
          task,
          {
            sourceTabId: 'Desktop',
            workspacePath: options.workspacePath,
            parentAgentId: 'desktop',
          },
          { async: false }  // Wait for result
        );

        return {
          content: [{ type: 'text', text: `✅ Reviewer 完成\n\n${result}` }],
        };
      } catch (error) {
        const message = `启动 Reviewer 失败: ${error instanceof Error ? error.message : String(error)}`;
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  // Tool: run_devhub
  const runDevHub = tool(
    'run_devhub',
    '启动 DevHub 开发枢纽，协调 Coder 和 Reviewer 循环开发流程',
    { task: taskSchema },
    async ({ task }) => {
      if (!options.tabExecutor) {
        const message = 'TabExecutor 未初始化，无法启动 DevHub';
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      try {
        addLog(`[Desktop Tool] Starting DevHub task: ${task.substring(0, 100)}...`);

        await options.tabExecutor.execute(
          'DevHub',
          'devhub',
          task,
          {
            sourceTabId: 'Desktop',
            workspacePath: options.workspacePath,
            parentAgentId: 'desktop',
          },
          { async: true }  // Fire-and-forget mode
        );
        addLog(`[Desktop Tool] DevHub task dispatched (async)`);

        return {
          content: [{ type: 'text', text: '✅ DevHub 任务已启动，后台执行中...' }],
        };
      } catch (error) {
        const message = `启动 DevHub 失败: ${error instanceof Error ? error.message : String(error)}`;
        addLog(`[Desktop Tool] ${message}`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: 'desktop-tools',
    tools: [runBlueprint, runWriter, runCoder, runReviewer, runDevHub],
  });
}
