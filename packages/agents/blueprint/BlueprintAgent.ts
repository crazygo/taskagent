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
    task_id: string;
    task: string;
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

    private async runEditValidateFlow(
        prompt: string,
        context: AsyncTaskContext,
        taskId: string,
        isCancelled: () => boolean = () => false
    ): Promise<{ targetFile: string } | void> {
        if (!context.workspacePath) {
            throw new Error('Blueprint task requires workspacePath');
        }

        // Extract task_id from prompt
        const task_id = this.extractTaskId(prompt) || `blueprint-${Date.now()}`;
        const task = this.parseTask(task_id, prompt);
        const tabId = context.sourceTabId || 'Blueprint';
        
        const taskDir = `tasks/${task_id}`;
        emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, `[log] 任务目录: ${taskDir}`, taskId, context.parentAgentId);

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

            // Call Feature Writer through runAgent (will extract task_id from prompt)
            await runAgent('feature-writer', writerPrompt, context);

            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] Writer Agent 完成，开始验证…', taskId, context.parentAgentId);
            emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 正在验证 YAML 完整性…', taskId, context.parentAgentId);

            const taskDir = `tasks/${task.task_id}`;
            const validation = await this.validateYamlDirectory(context.workspacePath, taskDir);
            if (validation.ok) {
                emitProgress(context.eventBus, BLUEPRINT_AGENT_ID, tabId, '[log] 验证通过，Blueprint 生成完成。', taskId, context.parentAgentId);
                emitResult(
                    context.eventBus,
                    BLUEPRINT_AGENT_ID,
                    tabId,
                    {
                        taskDir: taskDir,
                        files: validation.files,
                        iterations: attempt,
                    },
                    taskId,
                    context.parentAgentId
                );
                return { targetFile: taskDir };
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

    private parseTask(task_id: string, userInput: string): WriterTask {
        const task = userInput.trim();
        if (!task) {
            throw new Error('任务描述为空，无法生成 Blueprint');
        }
        
        return { task_id, task };
    }
    
    private extractTaskId(prompt: string): string | undefined {
        const match = prompt.match(/^Task ID:\s*([a-z0-9\-]+)/im);
        return match?.[1];
    }

    private buildWriterPrompt(writerTask: WriterTask, feedback?: string | null): string {
        const taskDir = `tasks/${writerTask.task_id}`;
        const sections = [
            '# Blueprint 任务',
            `Task ID: ${writerTask.task_id}`,
            `文档目录: ${taskDir}/`,
            '',
            '## 用户提供的需求',
            writerTask.task,
            '',
            '## 编写要求',
            `- 将上述需求转换为结构化的 YAML 文档，保存在 ${taskDir}/ 目录下。`,
            '- 文件名根据功能模块自行命名（例如：game-rules.yaml, ui-components.yaml）。',
            '- 每个 YAML 文件顶层必须包含 feature, description, scenarios。',
            '- 每个场景都要写出 scenario/given/when/then，给定/当/则可用字符串数组。',
            '- 可以创建多个文件来组织不同模块的规范。',
            '- 使用 Write 工具写入文件，禁止输出 Markdown 或 JSON。',
        ];

        if (feedback) {
            sections.push('', '## 验证反馈（必须修复）', feedback);
        }

        return sections.join('\n');
    }

    private async validateYamlDirectory(workspacePath: string, taskDir: string): Promise<ValidationResult & { files?: string[] }> {
        const dirPath = path.resolve(workspacePath, taskDir);
        
        try {
            const files = await fs.readdir(dirPath);
            const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            
            if (yamlFiles.length === 0) {
                return {
                    ok: false,
                    message: `目录 ${taskDir} 中没有找到 YAML 文件`,
                };
            }
            
            // Validate each YAML file
            for (const file of yamlFiles) {
                const filePath = path.join(dirPath, file);
                const content = await fs.readFile(filePath, 'utf-8');
                
                try {
                    const data = yaml.load(content);
                    // Check basic structure
                    if (typeof data !== 'object' || data === null) {
                        return {
                            ok: false,
                            message: `${file}: YAML 内容格式不正确`,
                        };
                    }
                } catch (error) {
                    return {
                        ok: false,
                        message: `${file}: 解析失败 - ${error instanceof Error ? error.message : String(error)}`,
                    };
                }
            }
            
            return {
                ok: true,
                files: yamlFiles,
            };
        } catch (error) {
            return {
                ok: false,
                message: `读取目录 ${taskDir} 失败：${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
}
