/**
 * Blueprint AsyncTask - Extract features-editor logic
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type { AsyncTaskContext, AsyncTaskHandle } from '../runtime/async-task/types.js';
import { runAgent, emitProgress, emitResult } from '../runtime/async-task/helpers.js';

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

export async function runBlueprintTask(
    input: string,
    context: AsyncTaskContext
): Promise<AsyncTaskHandle> {
    const taskId = `blueprint-task-${Date.now()}`;
    let cancelled = false;

    const completion = (async () => {
        try {
            if (!context.workspacePath) {
                throw new Error('Blueprint task requires workspacePath');
            }

            const task = parseTask(input);
            const agentId = 'blueprint';
            const tabId = context.sourceTabId || 'Blueprint';
            
            emitProgress(context.eventBus, agentId, tabId, `目标文件: ${task.targetFile}`, taskId);

            let feedback: string | null = null;

            for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
                if (cancelled) {
                    throw new Error('Task cancelled');
                }

                emitProgress(context.eventBus, agentId, tabId, `写作迭代 ${attempt}，准备生成 YAML…`, taskId);

                const writerPrompt = buildWriterPrompt(task, feedback);
                emitProgress(context.eventBus, agentId, tabId, '正在调用 Writer Agent 生成内容…', taskId);
                await runAgent('writer', writerPrompt, context);
                emitProgress(context.eventBus, agentId, tabId, 'Writer Agent 完成，开始验证…', taskId);

                emitProgress(context.eventBus, agentId, tabId, '正在验证 YAML 完整性…', taskId);
                const validation = await validateYaml(context.workspacePath, task.targetFile);

                if (validation.ok) {
                    emitProgress(context.eventBus, agentId, tabId, '验证通过，Blueprint 生成完成。', taskId);
                    const result = {
                        targetFile: task.targetFile,
                        feature: validation.feature,
                        iterations: attempt,
                    };
                    emitResult(context.eventBus, agentId, tabId, result, taskId);
                    return true;
                }

                feedback = validation.message || '';
                emitProgress(context.eventBus, agentId, tabId, `验证失败：${feedback}（将重试）`, taskId);
            }

            throw new Error('多次尝试后仍未通过验证');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const agentId = 'blueprint';
            const tabId = context.sourceTabId || 'Blueprint';
            emitResult(context.eventBus, agentId, tabId, { error: message }, taskId);
            return false;
        }
    })();

    return {
        taskId,
        cancel: () => { cancelled = true; },
        completion,
    };
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
    try {
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
                        if (value.trim().length === 0) {
                            issues.push(`场景 #${index + 1} 的 ${key} 内容为空。`);
                        }
                    } else if (Array.isArray(value)) {
                        if (value.length === 0) {
                            issues.push(`场景 #${index + 1} 的 ${key} 数组为空。`);
                        }
                        for (const entry of value) {
                            if (typeof entry !== 'string' || entry.trim().length === 0) {
                                issues.push(`场景 #${index + 1} 的 ${key} 数组存在非字符串或空项。`);
                                break;
                            }
                        }
                    } else {
                        issues.push(`场景 #${index + 1} 的 ${key} 必须是字符串或字符串数组。`);
                    }
                });
            });
        }

        if (issues.length > 0) {
            return { ok: false, message: issues.join(' ') };
        }

        return { ok: true, feature: String(data.feature) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `无法验证 YAML：${message}` };
    }
}
