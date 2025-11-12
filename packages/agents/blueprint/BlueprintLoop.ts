/**
 * BlueprintLoop - Loop agent for edit-validate workflow
 * 
 * Uses Template Method pattern: implements runSinglePass() and shouldContinue()
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

import { LoopAgent } from '../workflow-agents/LoopAgent.js';
import type { RunnableAgent, AgentStartContext, AgentStartSinks, AgentToolContext } from '../runtime/types.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { addLog } from '@taskagent/shared/logger';
import { runAgent, emitProgress } from '../runtime/async-task/helpers.js';
import type { AsyncTaskContext } from '../runtime/async-task/types.js';

export class BlueprintLoop extends LoopAgent {
    readonly id = 'blueprint';
    readonly description = 'Blueprint Agent - Generate structured feature documentation with edit-validate loop';

    protected readonly maxIterations = 3;
    protected readonly subAgents: RunnableAgent[] = []; // Not used, but required by LoopAgent

    constructor(
        private agentRegistry: AgentRegistry,
        private eventBus: EventBus,
        private tabExecutor: any  // Required by AsyncTaskContext
    ) {
        super();
    }

    async initialize(): Promise<void> {
        addLog('[BlueprintLoop] Initialized');
    }

    // Provide dependencies to BaseAgent.asMcpTool / asMcpToolWithSchema
    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            eventBus: this.eventBus,
            tabExecutor: this.tabExecutor,
            agentRegistry: this.agentRegistry,
            sourceTabId: this.runtimeContext.sourceTabId,
            workspacePath: this.runtimeContext.workspacePath,
            parentAgentId: this.runtimeContext.parentAgentId,
        };
    }

    // ========================================
    // Abstract Methods Implementation
    // ========================================

    /**
     * Execute single iteration: call feature-writer and validate
     */
    protected async runSinglePass(
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<string> {
        addLog('[BlueprintLoop] Calling feature-writer...');

        try {
            const asyncContext: AsyncTaskContext = {
                eventBus: this.eventBus,
                agentRegistry: this.agentRegistry,
                tabExecutor: this.tabExecutor,
                sourceTabId: context.sourceTabId,
                workspacePath: context.workspacePath,
                parentAgentId: context.parentAgentId || 'blueprint',
            };

            const output = await runAgent('feature-writer', this.state.currentTask, asyncContext);
            addLog(`[BlueprintLoop] Writer completed: ${output.slice(0, 800)}...`);

            const validation = await this.validateYAML(output, context.workspacePath);
            return validation;
        } catch (error) {
            const errorMsg = `Feature Writer 执行失败: ${error}`;
            addLog(`[BlueprintLoop] ${errorMsg}`);
            sinks.onText?.(`❌ ${errorMsg}\n`);
            return `❌验证失败：${errorMsg}`;
        }
    }

    /**
     * Decide whether to continue loop based on validation result
     */
    protected async shouldContinue(
        iterationResult: string
    ): Promise<{ continue: boolean; nextTask?: string; reason: string }> {
        addLog(`[BlueprintLoop] Checking iteration result: ${iterationResult.slice(0, 100)}`);

        if (iterationResult.includes('✅ 验证通过')) {
            return {
                continue: false,
                reason: 'YAML 验证通过'
            };
        }

        return {
            continue: true,
            nextTask: `请根据验证反馈修正 YAML：${iterationResult}`,
            reason: 'YAML 验证未通过'
        };
    }

    // ========================================
    // Hook Methods (Optional Overrides)
    // ========================================

    protected async beforeLoop(context: AgentStartContext, sinks: AgentStartSinks): Promise<void> {
        const targetTab = context.sourceTabId;
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '🔄 Blueprint 循环开始...',
            undefined,
            context.parentAgentId
        );
    }

    protected async onIterationStart(iteration: number, context: AgentStartContext, sinks: AgentStartSinks): Promise<void> {
        const targetTab = context.sourceTabId;
        
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            `--- 第 ${iteration} 轮 ---`,
            undefined,
            context.parentAgentId
        );

        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '📝 调用 Feature Writer 生成 YAML...',
            undefined,
            context.parentAgentId
        );
    }

    protected async onIterationEnd(iteration: number, result: string, context: AgentStartContext, sinks: AgentStartSinks): Promise<void> {
        const targetTab = context.sourceTabId;

        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '✓ Writer 完成',
            undefined,
            context.parentAgentId
        );

        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '🔍 验证 YAML 结构...',
            undefined,
            context.parentAgentId
        );

        const validationStatus = result.includes('✅') ? '✅ 验证通过' : '❌ 验证失败';
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            validationStatus,
            undefined,
            context.parentAgentId
        );

        sinks.onText?.(`${result}\n`);
    }

    protected async onComplete(
        decision: { continue: boolean; nextTask?: string; reason: string },
        sinks: AgentStartSinks
    ): Promise<void> {
        const targetTab = this.currentContext?.sourceTabId || 'Start';
        
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            `✅ Blueprint 完成: ${decision.reason}`,
            undefined,
            this.currentContext?.parentAgentId
        );

        sinks.onText?.(`\n✅ Blueprint 完成: ${decision.reason}\n`);
    }

    protected async onRetry(
        decision: { continue: boolean; nextTask?: string; reason: string },
        sinks: AgentStartSinks
    ): Promise<void> {
        const targetTab = this.currentContext?.sourceTabId || 'Start';
        
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            `⚠️ ${decision.reason}，准备重试...`,
            undefined,
            this.currentContext?.parentAgentId
        );
    }

    protected async onMaxIterations(sinks: AgentStartSinks): Promise<void> {
        const targetTab = this.currentContext?.sourceTabId || 'Start';
        
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            `⚠️ 已达到最大迭代次数 (${this.maxIterations})`,
            undefined,
            this.currentContext?.parentAgentId
        );

        sinks.onText?.(`\n⚠️ 已达到最大迭代次数 (${this.maxIterations})，停止循环\n`);
    }

    // ========================================
    // Private Helper Methods
    // ========================================

    /**
     * Parse feature-writer output, read the referenced files, and validate YAML structure
     */
    private async validateYAML(writerOutput: string, workspacePath?: string): Promise<string> {
        const changedFiles = this.extractChangedFiles(writerOutput);
        if (!changedFiles.length) {
            return '❌ 验证失败：输出缺少 changes 列表，无法定位更新文件';
        }

        const basePath = workspacePath || process.cwd();
        const errors: string[] = [];

        for (const relativePath of changedFiles) {
            const absolutePath = path.isAbsolute(relativePath)
                ? relativePath
                : path.join(basePath, relativePath);

            try {
                const fileContent = await readFile(absolutePath, 'utf-8');
                const structureError = this.validateYamlStructure(fileContent);
                if (structureError) {
                    errors.push(`${relativePath}: ${structureError}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                errors.push(`${relativePath}: 无法读取文件 (${message})`);
            }
        }

        if (errors.length) {
            return `❌ 验证失败：${errors.join('；')}`;
        }

        return `✅ 验证通过：${changedFiles.length} 个 YAML 文件结构正确`;
    }

    /**
     * Extract the yaml changes block for file paths
     */
    private extractChangedFiles(writerOutput: string): string[] {
        const match = writerOutput.match(/```yaml\s+changes\s*([\s\S]*?)```/i);
        if (!match || !match[1]) {
            return [];
        }
        const block = match[1];

        const entries = block
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.replace(/^-+\s*/, '').trim())
            .map(line => (line.startsWith('{') && line.endsWith('}')) ? line.slice(1, -1).trim() : line)
            .filter(Boolean);

        return Array.from(new Set(entries));
    }

    /**
     * Validate a single YAML document string
     */
    private validateYamlStructure(fileContent: string): string | null {
        let parsed: unknown;
        try {
            parsed = yaml.load(fileContent);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `YAML 解析失败：${message}`;
        }

        if (!parsed || typeof parsed !== 'object') {
            return 'YAML 内容为空或不是对象';
        }

        const record = parsed as Record<string, unknown>;
        const requiredKeys = ['feature', 'description', 'scenarios'];
        const missingKeys = requiredKeys.filter(key => !(key in record));

        if (missingKeys.length) {
            return `缺少字段：${missingKeys.join(', ')}`;
        }

        const scenarios = record.scenarios;
        if (!Array.isArray(scenarios) || scenarios.length === 0) {
            return 'scenarios 必须是包含至少一个元素的数组';
        }

        for (let index = 0; index < scenarios.length; index++) {
            const scenario = scenarios[index];
            const scenarioError = this.validateScenarioBlock(scenario, index);
            if (scenarioError) {
                return scenarioError;
            }
        }

        return null;
    }

    private validateScenarioBlock(value: unknown, index: number): string | null {
        if (!value || typeof value !== 'object') {
            return `scenarios[${index}] 不是有效对象`;
        }

        const scenario = value as Record<string, unknown>;
        if (typeof scenario.scenario !== 'string' || !scenario.scenario.trim()) {
            return `scenarios[${index}] 缺少 scenario 字段`;
        }

        for (const key of ['given', 'when', 'then']) {
            if (!(key in scenario)) {
                return `scenarios[${index}] 缺少 ${key} 字段`;
            }

            if (!this.isStringOrStringArray(scenario[key])) {
                return `scenarios[${index}] 的 ${key} 需要为字符串或字符串数组`;
            }
        }

        return null;
    }

    private isStringOrStringArray(value: unknown): boolean {
        if (typeof value === 'string') {
            return value.trim().length > 0;
        }

        if (Array.isArray(value)) {
            return value.length > 0 && value.every(item => typeof item === 'string' && item.trim().length > 0);
        }

        return false;
    }
}
