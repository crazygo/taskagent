import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import { emitProgress, emitResult, runAgent } from '../runtime/async-task/helpers.js';
import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../runtime/types.js';
import type { AsyncTaskContext } from '../runtime/async-task/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

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

interface BlueprintAgentDeps {
    eventBus: any;
    tabExecutor: any;
    agentRegistry: any;
    systemPrompt: any;
    agentDefinitions?: Record<string, AgentDefinition>;
    allowedTools?: string[];
}

export class BlueprintAgent extends PromptAgent implements RunnableAgent {
    readonly id = BLUEPRINT_AGENT_ID;
    readonly description = 'Blueprint Agent - 分析需求并生成结构化的功能规范文档 (docs/features/*.yaml)';
    
    protected readonly inputSchema = {
        task: z
            .string()
            .min(1)
            .describe('需求描述，Blueprint 将整理并生成规范的 YAML 文档'),
    };

    constructor(private deps: BlueprintAgentDeps) {
        super();
    }

    /**
     * Override buildToolContext to provide instance dependencies
     */
    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            tabExecutor: this.deps.tabExecutor,
            agentRegistry: this.deps.agentRegistry,
            eventBus: this.deps.eventBus,
        };
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        return userInput.trim();
    }

    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
        return this.deps.agentDefinitions;
    }

    getTools(): string[] {
        return this.deps.allowedTools ?? [];
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        // Build and call start function directly with current context
        const startFn = buildPromptAgentStart({
            getPrompt: (userInput: string) => this.getPrompt(userInput, context),
            getSystemPrompt: () => this.deps.systemPrompt,
            getAgentDefinitions: () => this.getAgentDefinitions(),
            getMcpTools: (toolCtx) => {
                // Use context from getMcpTools callback which has workspacePath
                const tool = this.asMcpTool({
                    sourceTabId: toolCtx.sourceTabId,
                    workspacePath: toolCtx.workspacePath,
                    parentAgentId: toolCtx.rawContext?.parentAgentId ?? BLUEPRINT_AGENT_ID,
                });
                return tool ? { [this.id]: tool } : undefined;
            },
        });
        
        return startFn(userInput, context, sinks);
    }

    protected async execute(args: { task: string }, context: AgentToolContext): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
        const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');
        const targetTabId = context.sourceTabId ?? 'Blueprint';

        if (!context.agentRegistry || !context.eventBus || !context.tabExecutor) {
            const message = '缺少必要依赖，无法执行 Blueprint workflow。';
            addLog(`[Blueprint] ${message}`);
            return {
                content: [{ type: 'text', text: message }],
            };
        }

        addLog(`[${this.id}] tool starting: ${task}`);
        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, targetTabId, '[log] 任务已收到', undefined, context.parentAgentId);

        const flowContext: AsyncTaskContext = {
            agentRegistry: context.agentRegistry,
            eventBus: context.eventBus,
            tabExecutor: context.tabExecutor,
            workspacePath: context.workspacePath,
            sourceTabId: targetTabId,
            parentAgentId: context.parentAgentId ?? BLUEPRINT_AGENT_ID,
        };

        const taskId = `blueprint-task-${Date.now()}`;
        
        // Start workflow in background - do NOT await
        const parsedTask = this.parseTask(task);
        this.runEditValidateFlow(task, flowContext, taskId)
            .then(() => {
                addLog(`[${this.id}] Workflow completed successfully`);
                emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, targetTabId, `✅ Blueprint 完成！文件已生成：${parsedTask.targetFile}`, taskId, context.parentAgentId);
            })
            .catch((error) => {
                const message = `[log] 执行失败: ${error instanceof Error ? error.message : String(error)}`;
                addLog(`[${this.id}] ${message}`);
                emitResult(flowContext.eventBus, BLUEPRINT_AGENT_ID, flowContext.sourceTabId || 'Blueprint', { error: message }, taskId, flowContext.parentAgentId);
            });
        
        // Return immediately with "task started" message
        return {
            content: [{ type: 'text', text: `✅ Blueprint 任务已启动，正在后台生成 ${parsedTask.targetFile}，请稍候...` }],
        };
    }

    private async runEditValidateFlow(
        input: string,
        context: AsyncTaskContext,
        taskId: string,
        isCancelled: () => boolean = () => false
    ) {
        if (!context.workspacePath) {
            throw new Error('Blueprint task requires workspacePath');
        }

        const task = this.parseTask(input);
        const tabId = context.sourceTabId || 'Blueprint';

        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, `[log] 目标文件: ${task.targetFile}`, taskId, context.parentAgentId);

        let feedback: string | null = null;
        let attempt = 0;

        while (attempt < MAX_WRITER_ATTEMPTS) {
            attempt++;
            if (isCancelled()) {
                throw new Error('Task cancelled');
            }

            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, `[log] 写作迭代 ${attempt}，准备生成 YAML…`, taskId, context.parentAgentId);

            const writerPrompt = this.buildWriterPrompt(task, feedback);
            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 正在调用 Writer Agent 生成内容…', taskId, context.parentAgentId);

            await runAgent('writer', writerPrompt, context);

            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] Writer Agent 完成，开始验证…', taskId, context.parentAgentId);
            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 正在验证 YAML 完整性…', taskId, context.parentAgentId);

            const validation = await this.validateYaml(context.workspacePath, task.targetFile);
            if (validation.ok) {
                emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 验证通过，Blueprint 生成完成。', taskId, context.parentAgentId);
                emitResult(
                    context.eventBus,
                    BLUEPRINT_AGENT_ID,
                    tabId,
                    {
                        targetFile: task.targetFile,
                        feature: validation.feature,
                        iterations: attempt,
                    },
                    taskId,
                    context.parentAgentId
                );
                return;
            }

            feedback = validation.message || '';
            emitProgress(
                context.eventBus,
                BLUEPRINT_AGENT_ID,
                tabId,
                `[log] 验证失败：${feedback}（将重试）`,
                taskId,
                context.parentAgentId
            );
        }

        throw new Error('多次尝试后仍未通过验证');
    }

    private parseTask(userInput: string): WriterTask {
        const raw = userInput.trim();
        if (!raw) {
            throw new Error('任务描述为空，无法生成 Blueprint');
        }

        const targetFile = this.extractTargetFile(raw);
        const featureName = this.extractFeatureName(raw);
        return { targetFile, rawInput: raw, featureName };
    }

    private extractTargetFile(raw: string): string {
        const match = raw.match(/目标文件\s*[:：]\s*(.+)/i);
        let candidate = match?.[1]?.trim();
        if (!candidate || candidate.length === 0) {
            const fallbackSlug = this.slugify(this.extractFeatureName(raw) ?? 'feature-spec');
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
        return (
            value
                .toLowerCase()
                .replace(/[^a-z0-9\s\-]/g, '')
                .trim()
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-+|-+$/g, '') || 'feature'
        );
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

    private async validateYaml(workspacePath: string, targetFile: string): Promise<ValidationResult> {
        const absPath = path.resolve(workspacePath, targetFile);
        let content: string;

        try {
            content = await fs.readFile(absPath, 'utf-8');
        } catch (error) {
            return {
                ok: false,
                message: `读取 ${targetFile} 失败：${error instanceof Error ? error.message : String(error)}`,
            };
        }

        try {
            const data = yaml.load(content);
            const feature = typeof data === 'object' && data !== null && 'feature' in data ? (data as any).feature : undefined;

            return {
                ok: true,
                feature: typeof feature === 'string' ? feature : undefined,
            };
        } catch (error) {
            return {
                ok: false,
                message: `解析 YAML 失败：${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
}
