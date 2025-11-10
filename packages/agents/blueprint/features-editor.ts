import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import type {
    AgentStartContext,
    AgentStartSinks,
    ExecutionHandle,
    RunnableAgent,
} from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { parseAgentMdFile } from '../runtime/agentLoader.js';

const FEATURES_EDITOR_AGENT_ID = 'features-editor';
const FEATURES_EDITOR_DESCRIPTION = 'Features Editor - Blueprint YAML writer + validator';
const MAX_WRITER_ATTEMPTS = 3;

type PromptStarter = (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;

type WriterTask = {
    targetFile: string;
    rawInput: string;
    featureName?: string;
};

type ValidationResult =
    | { ok: true; feature: string }
    | { ok: false; message: string };

export async function createFeaturesEditorAgent(): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const writerConfig = await parseAgentMdFile(path.join(agentDir, 'writer.agent.md'));
    if (!writerConfig) {
        throw new Error('Failed to load blueprint writer agent definition.');
    }

    const writerStart = buildPromptAgentStart({
        getPrompt: (input: string) => input.trim(),
        getSystemPrompt: () => writerConfig.prompt,
        getAgentDefinitions: () => writerConfig.agents,
        getModel: () => writerConfig.model,
    });

    return new FeaturesEditorAgent(writerStart);
}

class FeaturesEditorAgent implements RunnableAgent {
    readonly id = FEATURES_EDITOR_AGENT_ID;
    readonly description = FEATURES_EDITOR_DESCRIPTION;

    constructor(private readonly writerStart: PromptStarter) {}

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        const controller = new AbortController();
        const completion = this.run(userInput, context, sinks, controller.signal)
            .then(summary => {
                sinks.onCompleted?.(summary);
                return true;
            })
            .catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                sinks.onFailed?.(message);
                return false;
            });

        return {
            cancel: () => controller.abort(),
            sessionId: context.session?.id ?? `${FEATURES_EDITOR_AGENT_ID}-${Date.now()}`,
            completion,
        };
    }

    private async run(
        userInput: string,
        context: AgentStartContext,
        sinks: AgentStartSinks,
        signal: AbortSignal
    ): Promise<string> {
        if (!context.workspacePath) {
            throw new Error('Features Editor requires workspacePath.');
        }
        const task = this.parseTask(userInput);
        this.emitProgress(sinks, `[FeaturesEditor] 目标文件: ${task.targetFile}`);
        let feedback: string | null = null;

        for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
            if (signal.aborted) {
                throw new Error('Features Editor invocation aborted.');
            }

            this.emitProgress(sinks, `[FeaturesEditor] 写作迭代 ${attempt}，准备生成 YAML…`);
            const writerPrompt = this.buildWriterPrompt(task, feedback);
            await this.invokeWriter(writerPrompt, context, sinks, signal, attempt);

            this.emitProgress(sinks, '[FeaturesEditor] 正在验证 YAML 完整性…');
            const validation = await this.validateYaml(context.workspacePath, task.targetFile);
            if (validation.ok) {
                this.emitProgress(sinks, '[FeaturesEditor] 验证通过，Blueprint 生成完成。');
                const resultPayload = {
                    targetFile: task.targetFile,
                    feature: validation.feature,
                    iterations: attempt,
                };
                sinks.onEvent?.({
                    type: 'features:result',
                    level: 'info',
                    payload: resultPayload,
                    ts: Date.now(),
                } as any);
                return `Blueprint 完成：${task.targetFile}`;
            }

            feedback = validation.message;
            this.emitProgress(
                sinks,
                `[FeaturesEditor] 验证失败：${feedback}（将重试）`
            );
        }

        throw new Error('Features Editor 多次尝试后仍未通过验证。');
    }

    private parseTask(userInput: string): WriterTask {
        const raw = userInput.trim();
        if (!raw) {
            throw new Error('任务描述为空，无法生成 Blueprint。');
        }

        const targetFile = this.extractTargetFile(raw);
        const featureName = this.extractFeatureName(raw);
        return { targetFile, rawInput: raw, featureName };
    }

    private extractTargetFile(raw: string): string {
        const match = raw.match(/目标文件\s*[:：]\s*(.+)/i);
        let candidate = match?.[1]?.trim();
        if (!candidate || candidate.length === 0) {
            const fallbackSlug = this.slugify(
                this.extractFeatureName(raw) ?? 'feature-spec'
            );
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

    private extractFeatureName(raw: string): string | undefined {
        const match = raw.match(/(功能标题|feature)\s*[:：]\s*(.+)/i);
        const value = match?.[2]?.trim();
        return value && value.length > 0 ? value : undefined;
    }

    private slugify(value: string): string {
        return value
            .toLowerCase()
            .replace(/[^a-z0-9\s\-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '') || 'feature';
    }

    private buildWriterPrompt(task: WriterTask, feedback?: string | null): string {
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

    private async invokeWriter(
        prompt: string,
        context: AgentStartContext,
        parentSinks: AgentStartSinks,
        signal: AbortSignal,
        attempt: number
    ): Promise<void> {
        let failedMessage: string | null = null;
        const capturedEvents: any[] = [];
        const childSinks: AgentStartSinks = {
            onText: () => {},
            onEvent: event => {
                if (this.isToolEvent(event)) {
                    capturedEvents.push(event);
                    return;
                }
                parentSinks.onEvent?.(event);
            },
            onReasoning: chunk => parentSinks.onReasoning?.(chunk),
            onCompleted: () => {},
            onFailed: error => {
                failedMessage = error;
            },
            canUseTool: parentSinks.canUseTool,
        };

        const handle = this.writerStart(prompt, { ...context, forkSession: true }, childSinks);
        signal.addEventListener('abort', () => handle.cancel(), { once: true });
        const success = await handle.completion;
        if (!success || failedMessage) {
            throw new Error(`[FeaturesEditor writer] 第 ${attempt} 次写作失败：${failedMessage ?? ''}`.trim());
        }

        this.emitToolSummary('writer', capturedEvents, parentSinks);
    }

    private async validateYaml(workspacePath: string, targetFile: string): Promise<ValidationResult> {
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

                    const allowedKeys = new Set(['scenario', 'given', 'when', 'then']);
                    Object.keys(scenario).forEach(key => {
                        if (!allowedKeys.has(key)) {
                            issues.push(`场景 #${index + 1} 包含未识别字段 \"` + key + '\"。');
                        }
                    });
                });
            }

            if (issues.length > 0) {
                return { ok: false, message: issues.join(' ')};
            }

            return { ok: true, feature: String(data.feature) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, message: `无法验证 YAML：${message}` };
        }
    }

    private emitProgress(sinks: AgentStartSinks, message: string) {
        sinks.onEvent?.({
            type: 'features:progress',
            level: 'info',
            message,
            ts: Date.now(),
        } as any);
    }

    private isToolEvent(event: any): boolean {
        if (!event || typeof event !== 'object') return false;
        const type = event.type ?? event?.data?.type;
        return type === 'tool_use' || type === 'tool_result';
    }

    private emitToolSummary(stage: 'writer' | 'validator', events: any[], sinks: AgentStartSinks) {
        if (!events || events.length === 0) return;
        const descriptions = events
            .map(event => this.describeToolEvent(event))
            .filter((text): text is string => Boolean(text));
        if (descriptions.length === 0) return;
        this.emitProgress(sinks, `[FeaturesEditor][${stage}] ${descriptions.join('；')}`);
    }

    private describeToolEvent(event: any): string | null {
        const type = event?.type;
        if (type === 'tool_use') {
            const name = event?.name || 'tool';
            const target = this.extractTargetFromInput(event?.input);
            return `${name} 准备处理${target ? ' ' + target : ''}`.trim();
        }
        if (type === 'tool_result') {
            const name = event?.name || 'tool';
            const target = this.extractTargetFromInput(event?.input);
            if (event?.isError || event?.error) {
                const detail = event?.content || event?.error;
                return `${name} 失败${target ? '（' + target + '）' : ''}${detail ? `：${this.truncate(String(detail))}` : ''}`;
            }
            return `${name} 已完成${target ? ' ' + target : ''}`.trim();
        }
        return null;
    }

    private extractTargetFromInput(input: any): string | null {
        if (!input || typeof input !== 'object') return null;
        const file = input.file_path || input.path || input.target_file;
        if (typeof file === 'string' && file.length > 0) {
            return file;
        }
        if (typeof input.pattern === 'string') {
            return `pattern=${input.pattern}`;
        }
        return null;
    }

    private truncate(text: string, max = 60): string {
        return text.length > max ? `${text.slice(0, max)}…` : text;
    }
}
