import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import { emitProgress, emitResult, runAgent } from '../runtime/async-task/helpers.js';
import type { WorkflowToolDefinition } from '../runtime/workflowTools.js';
import type { AsyncTaskContext } from '../runtime/async-task/types.js';
import { launchBackgroundTask } from './backgroundTask.js';

const BLUEPRINT_AGENT_ID = 'blueprint';
const MAX_WRITER_ATTEMPTS = 3;


interface WriterTask {
    targetFile: string;
    rawInput: string;
    featureName?: string;
}

interface ValidationResult {
    ok: boolean;
    message?: string;
    feature?: string;
}

export function defineRefineFeatureSpecWorkflow(): WorkflowToolDefinition {
    return {
        name: BLUEPRINT_AGENT_ID,
        description: '整理需求并编辑 docs/features/*.yaml，自动驱动 Writer 迭代直到通过校验。',
        parameters: {
            task: z
                .string()
                .min(1)
                .describe('任务描述，需包含目标文件和关键需求。例如 "更新 docs/login.yaml，整理登录流程"'),
        },
        run: async (args, context) => {
            const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');
            const targetTabId = context.sourceTabId ?? 'Blueprint';

            if (!context.agentRegistry || !context.eventBus || !context.tabExecutor) {
                const message = '缺少必要依赖，无法执行 Blueprint workflow。';
                addLog(`[Blueprint Workflow] ${message}`);
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }

            addLog(`[Blueprint Workflow] ${BLUEPRINT_AGENT_ID} tool starting: ${task}`);
            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, targetTabId, '[log] 任务已收到', undefined, context.parentAgentId);

            const taskHandle = launchBackgroundTask(
                task,
                {
                    agentRegistry: context.agentRegistry,
                    eventBus: context.eventBus,
                    tabExecutor: context.tabExecutor,
                    workspacePath: context.workspacePath,
                    sourceTabId: targetTabId,
                    parentAgentId: context.parentAgentId ?? BLUEPRINT_AGENT_ID,
                },
                async ({ input, context: taskContext, taskId, isCancelled }) => {
                    await executeRefineFeatureSpecPipeline(input, taskContext, taskId, isCancelled);
                }
            );

            void taskHandle.completion.catch(error => {
                const message = `[log]  workflow 后台执行失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[Blueprint Workflow] ${message}`);
            });

            return {
                content: [{ type: 'text', text: '✅ Blueprint workflow 已启动，稍后会同步进度。' }],
            };
        },
    };
}

async function executeRefineFeatureSpecPipeline(
    input: string,
    context: AsyncTaskContext,
    taskId: string,
    isCancelled: () => boolean
) {
    if (!context.workspacePath) {
        throw new Error('Blueprint task requires workspacePath');
    }

    const task = parseTask(input);
    const tabId = context.sourceTabId || 'Blueprint';

    emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, `[log] 目标文件: ${task.targetFile}`, taskId, context.parentAgentId);

    let feedback: string | null = null;

    for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
        if (isCancelled()) {
            throw new Error('Task cancelled');
        }

        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, `[log] 写作迭代 ${attempt}，准备生成 YAML…`, taskId, context.parentAgentId);

        const writerPrompt = buildWriterPrompt(task, feedback);
        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 正在调用 Writer Agent 生成内容…', taskId, context.parentAgentId);

        await runAgent('writer', writerPrompt, context);

        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] Writer Agent 完成，开始验证…', taskId, context.parentAgentId);
        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 正在验证 YAML 完整性…', taskId, context.parentAgentId);

        const validation = await validateYaml(context.workspacePath, task.targetFile);

        if (validation.ok) {
            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 验证通过，Blueprint 生成完成。', taskId, context.parentAgentId);
            const result = {
                targetFile: task.targetFile,
                feature: validation.feature,
                iterations: attempt,
            };
            emitResult(context.eventBus, BLUEPRINT_AGENT_ID, tabId, result, taskId, context.parentAgentId);
            return;
        }

        feedback = validation.message || '';
        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, `[log] 验证失败：${feedback}（将重试）`, taskId, context.parentAgentId);
    }

    throw new Error('多次尝试后仍未通过验证');
}

function parseTask(userInput: string): WriterTask {
    const raw = userInput.trim();
    if (!raw) {
        throw new Error('任务描述为空，无法生成 Blueprint');
    }

    const targetFile = extractTargetFile(raw);
    const featureName = extractFeatureName(raw);
    return { targetFile, rawInput: raw, featureName };
}

function extractTargetFile(raw: string): string {
    const match = raw.match(/目标文件\s*[:：]\s*(.+)/i);
    let candidate = match?.[1]?.trim();
    if (!candidate || candidate.length === 0) {
        const fallbackSlug = slugify(extractFeatureName(raw) ?? 'feature-spec');
        candidate = `docs/features/${fallbackSlug}.yaml`;
    }

    candidate = candidate.replace(/^['"`]/, '').replace(/['"`]$/, '');
    if (!candidate.endsWith('.yaml')) {
        candidate = candidate.replace(/\.(md|json|yml)$/i, '') + '.yaml';
    }
    if (!candidate.startsWith('docs/')) {
        candidate = `docs/features/${candidate}`.replace(/\\/g, '/');
    } else {
        candidate = candidate.replace(/\\/g, '/');
    }
    return candidate;
}

function extractFeatureName(raw: string): string | undefined {
    const match = raw.match(/(功能标题|feature)\s*[:：]\s*(.+)/i);
    const value = match?.[2]?.trim();
    return value && value.length > 0 ? value : undefined;
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s\-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '') || 'feature';
}

function buildWriterPrompt(task: WriterTask, feedback?: string | null): string {
    const sections = [
        '# Blueprint 任务',
        `目标文件: ${task.targetFile}`,
        '## 用户提供的需求',
        task.rawInput,
        '## 编写要求',
        '- 将上述需求转换为 docs/features/*.yaml 的结构化规范。',
        '- 顶层字段必须包含 feature, description, scenarios。',
        '- 每个场景都要写出 scenario/given/when/then，给定/当/则可用字符串数组。',
        '- 使用 file 工具整体写入目标文件，禁止输出 Markdown 或 JSON。',
    ];

    if (feedback) {
        sections.push('## 验证反馈（必须修复）', feedback);
    }

    return sections.join('\n\n');
}

async function validateYaml(workspacePath: string, targetFile: string): Promise<ValidationResult> {
    const absPath = path.resolve(workspacePath, targetFile);
    const content = await fs.readFile(absPath, 'utf-8');
    const parsed = yaml.load(content);

    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, message: 'YAML 顶层必须是对象结构。' };
    }

    const data = parsed as Record<string, unknown>;
    const issues: string[] = [];

    if (typeof data.feature !== 'string' || data.feature.trim().length === 0) {
        issues.push('缺少 `feature` 字段或内容为空。');
    }
    if (typeof data.description !== 'string' || data.description.trim().length === 0) {
        issues.push('缺少 `description` 字段或内容为空。');
    }

    if (!Array.isArray(data.scenarios) || data.scenarios.length === 0) {
        issues.push('`scenarios` 必须是非空数组。');
    } else {
        (data.scenarios as unknown[]).forEach((scenarioRaw, index) => {
            if (!scenarioRaw || typeof scenarioRaw !== 'object') {
                issues.push(`场景 #${index + 1} 不是对象。`);
                return;
            }
            const scenario = scenarioRaw as Record<string, unknown>;
            if (typeof scenario.scenario !== 'string' || scenario.scenario.trim().length === 0) {
                issues.push(`场景 #${index + 1} 缺少 scenario 标题。`);
            }
            ['given', 'when', 'then'].forEach(key => {
                const value = scenario[key];
                if (value == null) {
                    issues.push(`场景 #${index + 1} 缺少 ${key}。`);
                    return;
                }
                if (typeof value === 'string') {
                    if (!value.trim()) {
                        issues.push(`场景 #${index + 1} 的 ${key} 为空。`);
                    }
                } else if (Array.isArray(value)) {
                    if (value.length === 0) {
                        issues.push(`场景 #${index + 1} 的 ${key} 为空数组。`);
                    }
                    value.forEach((entry, entryIndex) => {
                        if (typeof entry !== 'string' || !entry.trim()) {
                            issues.push(`场景 #${index + 1} 的 ${key}[${entryIndex}] 不是非空字符串。`);
                        }
                    });
                } else {
                    issues.push(`场景 #${index + 1} 的 ${key} 必须是字符串或字符串数组。`);
                }
            });
        });
    }

    if (issues.length > 0) {
        return { ok: false, message: issues.join('\n') };
    }

    return {
        ok: true,
        feature: typeof data.feature === 'string' ? data.feature : undefined,
    };
}
