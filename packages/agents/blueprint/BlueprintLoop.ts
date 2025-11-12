/**
 * BlueprintLoop - Loop agent for edit-validate workflow
 * 
 * Simplified: directly calls feature-writer and validates, no SequentialAgent needed
 */

import { LoopAgent } from '../workflow-agents/LoopAgent.js';
import type { RunnableAgent, AgentStartContext, AgentStartSinks, ExecutionHandle } from '../runtime/types.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { addLog } from '@taskagent/shared/logger';
import { runAgent, emitProgress } from '../runtime/async-task/helpers.js';
import type { AsyncTaskContext } from '../runtime/async-task/types.js';

export class BlueprintLoop extends LoopAgent {
    readonly id = 'blueprint-loop';
    readonly description = 'Blueprint loop: write YAML → validate → retry if needed';

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

    /**
     * Override start() to implement simple loop logic
     */
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.currentSinks = sinks;
        
        // Start loop asynchronously
        this.runLoopAsync(userInput, context, sinks).catch(error => {
            addLog(`[BlueprintLoop] Error: ${error}`);
            sinks.onText?.(`❌ Blueprint 执行失败: ${error}`);
            sinks.onCompleted?.('');
        });

        // Return handle immediately
        return {
            cancel: () => { this.state.shouldStop = true; },
            sessionId: 'blueprint-loop',
            completion: Promise.resolve(true)
        };
    }

    private async runLoopAsync(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): Promise<void> {
        this.state.status = 'RUNNING';
        this.state.currentTask = userInput;
        this.state.iteration = 0;

        addLog('[BlueprintLoop] Starting loop');
        
        // targetTab 应该从 sourceTabId 获取
        const targetTab = context.sourceTabId;
        
        // 循环开始进度消息
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '🔄 Blueprint 循环开始...',
            undefined,
            context.parentAgentId
        );

        while (this.state.iteration < this.maxIterations && !this.state.shouldStop) {
            this.state.iteration++;
            addLog(`[BlueprintLoop] Iteration ${this.state.iteration}/${this.maxIterations}`);
            
            // 轮次进度消息
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                `--- 第 ${this.state.iteration} 轮 ---`,
                undefined,
                context.parentAgentId
            );

            // Execute single pass: write → validate
            const validationResult = await this.runSinglePass(this.state.currentTask, context, sinks);

            // Check if should continue
            const decision = await this.shouldContinue(validationResult);
            addLog(`[BlueprintLoop] Decision: ${JSON.stringify(decision)}`);

            if (!decision.continue) {
                addLog(`[BlueprintLoop] Loop completed: ${decision.reason}`);
                
                // 完成进度消息
                emitProgress(
                    this.eventBus,
                    'blueprint-loop',
                    targetTab,
                    `✅ Blueprint 完成: ${decision.reason}`,
                    undefined,
                    context.parentAgentId
                );
                
                // 完成详情：使用 onText（重要输出）
                sinks.onText?.(`\n✅ Blueprint 完成: ${decision.reason}\n`);
                break;
            }

            // Update task for next iteration
            if (decision.nextTask) {
                this.state.currentTask = decision.nextTask;
                
                // 重试进度消息
                emitProgress(
                    this.eventBus,
                    'blueprint-loop',
                    targetTab,
                    `⚠️ ${decision.reason}，准备重试...`,
                    undefined,
                    context.parentAgentId
                );
            }
        }

        if (this.state.iteration >= this.maxIterations) {
            // 最大迭代次数进度消息
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                `⚠️ 已达到最大迭代次数 (${this.maxIterations})`,
                undefined,
                context.parentAgentId
            );
            
            // 达到最大迭代次数详情：使用 onText（重要输出）
            sinks.onText?.(`\n⚠️ 已达到最大迭代次数 (${this.maxIterations})，停止循环\n`);
        }

        this.state.status = 'IDLE';
        sinks.onCompleted?.('Blueprint loop completed');
    }

    /**
     * Execute single pass: call feature-writer and validate
     */
    private async runSinglePass(
        prompt: string,
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<string> {
        addLog('[BlueprintLoop] Calling feature-writer...');
        
        // targetTab 应该从 sourceTabId 获取
        const targetTab = context.sourceTabId;
        emitProgress(
            this.eventBus,
            'blueprint-loop',
            targetTab,
            '📝 调用 Feature Writer 生成 YAML...',
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
                parentAgentId: context.parentAgentId || 'blueprint-loop',  // Fallback
            };

            const output = await runAgent('feature-writer', prompt, asyncContext);

            addLog(`[BlueprintLoop] Writer completed: ${output.slice(0, 100)}...`);
            
            // 进度消息：Writer 完成
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                '✓ Writer 完成',
                undefined,
                context.parentAgentId
            );

            // 进度消息：开始验证
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                '🔍 验证 YAML 结构...',
                undefined,
                context.parentAgentId
            );
            
            const validation = this.validateYAML(output);
            
            // 进度消息：验证完成
            const validationStatus = validation.includes('✅') ? '✅ 验证通过' : '❌ 验证失败';
            emitProgress(
                this.eventBus,
                'blueprint-loop',
                targetTab,
                validationStatus,
                undefined,
                context.parentAgentId
            );
            
            // 验证结果详情：使用 onText（重要输出，保留）
            sinks.onText?.(`${validation}\n`);
            
            return validation;
        } catch (error) {
            const errorMsg = `Feature Writer 执行失败: ${error}`;
            addLog(`[BlueprintLoop] ${errorMsg}`);
            
            // 错误消息：使用 onText（重要输出，保留）
            sinks.onText?.(`❌ ${errorMsg}\n`);
            return `❌验证失败：${errorMsg}`;
        }
    }

    /**
     * Simple YAML validation
     */
    private validateYAML(content: string): string {
        const hasFeature = content.includes('feature:');
        const hasScenarios = content.includes('scenarios:');
        const isValid = hasFeature && hasScenarios;
        
        return isValid
            ? '✅ 验证通过：YAML 结构完整'
            : '❌ 验证失败：YAML 缺少必要字段 (feature/scenarios)';
    }

    /**
     * Decide whether to continue loop based on validation result
     */
    protected async shouldContinue(
        iterationResult: string
    ): Promise<{ continue: boolean; nextTask?: string; reason: string }> {
        addLog(`[BlueprintLoop] Checking iteration result: ${iterationResult.slice(0, 100)}`);

        // Check if validation passed
        if (iterationResult.includes('✅ 验证通过')) {
            return {
                continue: false,
                reason: 'YAML 验证通过'
            };
        }

        // Check if max iterations reached
        if (this.state.iteration >= this.maxIterations) {
            return {
                continue: false,
                reason: `已达最大迭代次数 (${this.maxIterations})`
            };
        }

        // Continue with feedback
        return {
            continue: true,
            nextTask: `请根据验证反馈修正 YAML：${iterationResult}`,
            reason: 'YAML 验证未通过'
        };
    }
}
