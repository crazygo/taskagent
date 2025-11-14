/**
 * BlueprintLoop - Sequential agent with Feature-Plan → Loop(feature-edit → YAML validator) → Feature-Changes Review
 * 
 * Architecture:
 * 1. Feature-Plan stage: Analyze requirements and detect conflicts
 * 2. Loop stage: feature-edit → YAML validator (if no conflicts)
 * 3. Feature-Changes Review stage: Final review and report
 * 
 * Short-circuit on conflict: If Feature-Plan detects conflicts, pipeline aborts with structured failure
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

import { LoopAgent } from '../workflow-agents/LoopAgent.js';
import type { RunnableAgent, AgentStartContext, AgentStartSinks, AgentToolContext } from '../runtime/types.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@core/event-bus';
import { addLog } from '@shared/logger';
import { runAgent, emitProgress, emitResult } from '../runtime/async-task/helpers.js';
import type { AsyncTaskContext } from '../runtime/async-task/types.js';

/**
 * Result structure for Feature-Plan stage
 */
interface PlanResult {
    ok: boolean;
    code?: string;
    message: string;
    details?: any;
    analysis?: any;
}

export class BlueprintLoop extends LoopAgent {
    readonly id = 'blueprint';
    readonly description = 'Blueprint Agent - Feature-Plan → Loop(feature-edit → validator) → Review';

    protected readonly maxIterations = 3;
    protected readonly subAgents: RunnableAgent[] = []; // Not used, but required by LoopAgent
    
    // Store plan result to short-circuit if needed
    private planResult?: PlanResult;

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
     * Stage 2 (Loop): Execute single iteration - call feature-edit and validate
     */
    protected async runSinglePass(
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<string> {
        addLog('[BlueprintLoop] Calling feature-edit...');

        try {
            const asyncContext: AsyncTaskContext = {
                eventBus: this.eventBus,
                agentRegistry: this.agentRegistry,
                tabExecutor: this.tabExecutor,
                sourceTabId: context.sourceTabId,
                workspacePath: context.workspacePath,
                parentAgentId: context.parentAgentId || 'blueprint',
            };

            const output = await runAgent('feature-edit', this.state.currentTask, asyncContext);
            addLog(`[BlueprintLoop] Editor completed: ${output.slice(0, 800)}...`);

            const validation = await this.validateYAML(output, context.workspacePath);
            return validation;
        } catch (error) {
            const errorMsg = `Feature Edit 执行失败: ${error}`;
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

    /**
     * Stage 1: Feature-Plan - Analyze requirements and detect conflicts
     * Short-circuits the pipeline if conflicts are detected
     */
    protected async beforeLoop(context: AgentStartContext, sinks: AgentStartSinks): Promise<void> {
        const targetTab = context.sourceTabId;
        
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '📋 Stage 1: Feature-Plan - 分析需求并检测冲突...',
            undefined,
            context.parentAgentId
        );

        try {
            const asyncContext: AsyncTaskContext = {
                eventBus: this.eventBus,
                agentRegistry: this.agentRegistry,
                tabExecutor: this.tabExecutor,
                sourceTabId: context.sourceTabId,
                workspacePath: context.workspacePath,
                parentAgentId: context.parentAgentId || 'blueprint',
            };

            const planOutput = await runAgent('feature-plan', this.state.currentTask, asyncContext);
            addLog(`[BlueprintLoop] Feature-Plan output: ${planOutput.slice(0, 500)}...`);
            
            // Parse JSON result from Feature-Plan
            this.planResult = this.parsePlanResult(planOutput);
            
            if (!this.planResult.ok) {
                // Conflict detected - short-circuit pipeline
                const errorMsg = `❌ ${this.planResult.message}`;
                emitProgress(
                    this.eventBus,
                    'blueprint-loop',
                    targetTab,
                    errorMsg,
                    undefined,
                    context.parentAgentId
                );
                
                // Emit structured failure result
                emitResult(
                    this.eventBus,
                    'blueprint-loop',
                    targetTab,
                    this.planResult,
                    undefined,
                    context.parentAgentId
                );
                
                sinks.onText?.(`\n${errorMsg}\n`);
                if (this.planResult.details) {
                    sinks.onText?.(`\n详细信息: ${JSON.stringify(this.planResult.details, null, 2)}\n`);
                }
                
                // Stop the loop immediately
                this.state.shouldStop = true;
                return;
            }
            
            // No conflict - proceed to loop
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                '✅ Feature-Plan 完成: 未检测到冲突，开始编辑...',
                undefined,
                context.parentAgentId
            );
            
            sinks.onText?.(`\n✅ ${this.planResult.message}\n`);
        } catch (error) {
            const errorMsg = `Feature-Plan 执行失败: ${error}`;
            addLog(`[BlueprintLoop] ${errorMsg}`);
            
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                `❌ ${errorMsg}`,
                undefined,
                context.parentAgentId
            );
            
            sinks.onText?.(`\n❌ ${errorMsg}\n`);
            this.state.shouldStop = true;
        }
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
            '📝 调用 Feature Edit 编辑 YAML...',
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
            '✓ Editor 完成',
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

    /**
     * Stage 3: Feature-Changes Review - Generate final review report
     */
    protected async afterLoop(context: AgentStartContext, sinks: AgentStartSinks): Promise<void> {
        // Skip review if we short-circuited due to conflict
        if (this.planResult && !this.planResult.ok) {
            return;
        }
        
        const targetTab = context.sourceTabId || 'Start';
        
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '📊 Stage 3: Feature-Changes Review - 生成最终报告...',
            undefined,
            context.parentAgentId
        );
        
        // TODO: Implement feature-changes review agent
        // For now, just emit a completion message
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '✅ Feature-Changes Review 完成',
            undefined,
            context.parentAgentId
        );
        
        sinks.onText?.('\n✅ 所有阶段完成\n');
    }

    // ========================================
    // Private Helper Methods
    // ========================================
    
    /**
     * Parse JSON result from Feature-Plan agent
     */
    private parsePlanResult(output: string): PlanResult {
        try {
            // Extract JSON from output (may have surrounding text)
            const jsonMatch = output.match(/\{[\s\S]*"ok"[\s\S]*\}/);
            if (!jsonMatch) {
                // No JSON found, assume success (backward compatibility)
                return {
                    ok: true,
                    message: '需求分析完成',
                    analysis: { summary: output }
                };
            }
            
            const result = JSON.parse(jsonMatch[0]) as PlanResult;
            return result;
        } catch (error) {
            addLog(`[BlueprintLoop] Failed to parse plan result: ${error}`);
            // Default to success if parsing fails
            return {
                ok: true,
                message: '需求分析完成',
                analysis: { summary: output }
            };
        }
    }

    /**
     * Parse feature-edit output, read the referenced files, and validate YAML structure
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
