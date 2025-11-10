import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import type { TabExecutor } from '../../execution/TabExecutor.js';

interface CreateStoryMcpServerOptions {
    tabExecutor?: TabExecutor;
    workspacePath?: string;
    tabId?: string;
}

export function createStoryMcpServer(options: CreateStoryMcpServerOptions) {
    return createSdkMcpServer({
        name: 'story-tools',
        tools: [buildFeaturesEditorTool({
            name: 'run_features_editor',
            description: '启动 Features Editor，自动执行规划 → diff → review → 总结',
            telemetryLabel: 'run_features_editor',
            options,
        })],
    });
}

function buildFeaturesEditorTool(params: {
    name: string;
    description: string;
    telemetryLabel: string;
    options: CreateStoryMcpServerOptions;
}) {
    const { name, description, telemetryLabel, options } = params;

    return tool(
        name,
        description,
        {
            task: z
                .string()
                .min(1)
                .describe('任务描述，包含目标文件和关键需求。例如 "更新 docs/login.md，整理登录流程故事"'),
        },
        async ({ task }) => {
            const targetTabId = options.tabId ?? 'Story';

            if (!options.tabExecutor) {
                const message = 'TabExecutor 未初始化，无法启动 Features Editor。';
                addLog(`[Story Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            try {
                addLog(`[Story Tool] ${telemetryLabel} payload: ${task}`);
                void options.tabExecutor.execute(targetTabId, 'features-editor', task, {
                    sourceTabId: targetTabId,
                    workspacePath: options.workspacePath,
                    parentAgentId: 'story',
                }).catch(error => {
                    const message = `Features Editor 后台执行失败: ${error instanceof Error ? error.message : String(error)}`;
                    addLog(`[Story Tool] ${message}`);
                });

                return {
                    content: [{ type: 'text', text: '任务已转交给 Features Editor，稍候会持续同步进展。' }],
                };
            } catch (error) {
                const message = `启动 Features Editor 失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[Story Tool] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        }
    );
}
