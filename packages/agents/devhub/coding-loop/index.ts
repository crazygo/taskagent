/**
 * CodingLoop - Coder-Review循环执行引擎
 * 
 * 特性：
 * - 双支路架构：应答支路（立即返回）+ 运行支路（后台循环）
 * - 状态机管理：IDLE ↔ RUNNING
 * - 候补队列：在 JUDGE 阶段整合新任务
 * - 支持命令：start, stop, status, add_pending
 * - Callback 模式：可插拔的观测器（summarization, metrics, logging）
 */

import { LoopAgent } from '../../workflow-agents/LoopAgent.js';
import type { RunnableAgent, AgentStartContext, AgentStartSinks, ExecutionHandle } from '../../runtime/types.js';
import { parseCommand, type LooperCommand } from './command.js';
import { createInitialState, LooperStatus, type LooperState } from './state.js';
import { createJudgeAgent, parseJudgeOutput } from '../judge/index.js';
import { createSummarizerAgent } from '../summarizer/index.js';
import { SummarizationCallback } from './SummarizationCallback.js';
import { SinglePass } from './SinglePass.js';
import { addLog } from '@taskagent/shared/logger';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODING_LOOP_ID = 'coding-loop';
const CODING_LOOP_DESCRIPTION = 'Coder-Review循环执行引擎，管理开发和审查的迭代循环';

interface LooperEvent {
    type: 'progress' | 'result';
    payload: any;
}

export class CodingLoop extends LoopAgent {
    readonly id = CODING_LOOP_ID;
    readonly description = CODING_LOOP_DESCRIPTION;

    protected state: LooperState = createInitialState();
    private judgeAgent?: RunnableAgent;
    private summarizerAgent?: RunnableAgent;
    private singlePass?: RunnableAgent;
    private summarizationCallback?: SummarizationCallback;

    protected readonly maxIterations = 5;
    protected readonly subAgents: RunnableAgent[] = []; // Populated in initialize()

    async initialize() {
        // Create Judge agent
        if (!this.judgeAgent) {
            this.judgeAgent = await createJudgeAgent();
        }

        // Create Summarizer agent
        if (!this.summarizerAgent) {
            this.summarizerAgent = await createSummarizerAgent();
        }

        // Create Coder and Reviewer agents
        const { getGlobalAgentRegistry } = await import('../../registry/index.js');
        const registry = getGlobalAgentRegistry();
        
        const coderFactory = registry.getFactory('coder');
        const reviewerFactory = registry.getFactory('review');
        
        if (!coderFactory || !reviewerFactory) {
            throw new Error('Coder or Reviewer agent not found in registry');
        }

        const coderAgent = await coderFactory();
        const reviewerAgent = await reviewerFactory();

        // Create SinglePass workflow
        this.singlePass = new SinglePass(coderAgent, reviewerAgent);
        (this as any).subAgents = [this.singlePass]; // Satisfy LoopAgent requirement

        // Create SummarizationCallback
        this.summarizationCallback = new SummarizationCallback(
            this.summarizerAgent,
            (summary) => this.emit({ type: 'progress', payload: summary })
        );
        
        this.addCallback(this.summarizationCallback);
    }

    override start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        addLog('[CodingLoop] start() called with input: ' + userInput);
        this.currentSinks = sinks; // Save for emit() and callbacks
        
        // Parse command
        const command = parseCommand(userInput);
        addLog('[CodingLoop] Parsed command: ' + JSON.stringify(command));

        // Handle command synchronously (应答支路)
        const response = this.handleCommand(command);
        addLog('[CodingLoop] Response: ' + response);

        // Push response immediately
        if (response) {
            this.emit({ type: 'progress', payload: response });
            setTimeout(() => sinks.onCompleted?.(response), 10);
        }

        // Return ExecutionHandle immediately
        const completion = Promise.resolve(true);
        
        return {
            cancel: () => {
                this.state.shouldStop = true;
            },
            sessionId: context.session?.id || 'coding-loop-session',
            completion,
        };
    }

    private handleCommand(command: LooperCommand): string {
        switch (command.type) {
            case 'start':
                return this.handleStart(command.task || '');
            case 'stop':
                return this.handleStop();
            case 'status':
                return this.handleStatus();
            case 'add_pending':
                return this.handleAddPending(command.task || '');
            default:
                return `未知命令: ${command.type}`;
        }
    }

    private handleStart(task: string): string {
        if (this.state.status === LooperStatus.IDLE) {
            // Start loop asynchronously (运行支路)
            this.state.status = LooperStatus.RUNNING;
            this.state.currentTask = task;
            this.state.iteration = 0;
            this.state.shouldStop = false;

            // Launch loop in background
            this.runLoopAsync(task).catch(error => {
                this.emit({ type: 'progress', payload: `[Looper] 循环执行出错: ${error}` });
                this.state.status = LooperStatus.IDLE;
            });

            return `[Looper] 已启动循环任务: ${task}`;
        } else {
            // Already running, add to pending queue
            this.state.pendingQueue.push(task);
            return `[Looper] 循环正在运行中，任务已加入候补队列（位置 ${this.state.pendingQueue.length}）`;
        }
    }

    private handleStop(): string {
        if (this.state.status === LooperStatus.RUNNING) {
            this.state.shouldStop = true;
            return `[Looper] 已发送停止信号，将在当前轮次完成后终止`;
        } else {
            return `[Looper] 当前未运行`;
        }
    }

    private handleStatus(): string {
        if (this.state.status === LooperStatus.IDLE) {
            return `[Looper 状态]\n状态: IDLE（空闲）\n候补队列: ${this.state.pendingQueue.length} 条消息`;
        } else {
            return `[Looper 状态]\n状态: RUNNING（运行中）\n当前任务: ${this.state.currentTask}\n轮次: ${this.state.iteration}/${this.state.maxIterations}\n子状态: ${this.state.subStatus || 'N/A'}\n候补队列: ${this.state.pendingQueue.length} 条消息`;
        }
    }

    private handleAddPending(task: string): string {
        if (this.state.status === LooperStatus.IDLE) {
            // Treat as start command
            return this.handleStart(task);
        } else {
            this.state.pendingQueue.push(task);
            return `[Looper] 任务已加入候补队列（位置 ${this.state.pendingQueue.length}）`;
        }
    }

    private async runLoopAsync(initialTask: string): Promise<void> {
        await this.initialize();

        // Start summarization callback timer
        this.summarizationCallback?.startTimer('iteration');

        this.emit({ type: 'progress', payload: `[AUTO] 循环开始，最大轮次: ${this.maxIterations}` });

        while (this.state.iteration < this.maxIterations && !this.state.shouldStop) {
            this.state.iteration++;
            
            // Notify callbacks
            this.notifyCallbacks('onIterationStart', this.state.iteration, this.state.currentTask);
            
            this.emit({ type: 'progress', payload: `[AUTO] === Iteration ${this.state.iteration} ===` });
            this.emit({ type: 'progress', payload: `[AUTO] 当前任务: ${this.state.currentTask}` });

            // Execute SinglePass (Coder → Reviewer)
            this.emit({ type: 'progress', payload: '[AUTO] 执行 SinglePass (Coder → Review)...' });
            
            const iterationResult = await this.runSinglePass(this.state.currentTask);
            
            this.emit({ type: 'progress', payload: '[AUTO] SinglePass 完成' });

            // Notify callbacks
            this.notifyCallbacks('onIterationEnd', this.state.iteration, iterationResult);

            // Judge decision
            this.emit({ type: 'progress', payload: '[AUTO] JUDGE 决策中...' });

            const decision = await this.shouldContinue(iterationResult);

            if (!decision.continue) {
                this.emit({ type: 'progress', payload: `[AUTO] 循环终止: ${decision.reason}` });
                
                // Emit result if available
                if ('result' in (decision as any) && (decision as any).result) {
                    this.emit({ type: 'result', payload: (decision as any).result });
                }
                break;
            }

            // Continue: update task
            this.updateTask(decision);
            this.emit({ type: 'progress', payload: `[AUTO] 继续循环: ${decision.reason}` });
            this.emit({ type: 'progress', payload: `[AUTO] 下一轮任务: ${decision.nextTask || '(保持当前任务)'}` });
        }

        // Cleanup
        this.summarizationCallback?.stopTimer();
        this.state.status = LooperStatus.IDLE;
        
        if (this.state.shouldStop) {
            this.emit({ type: 'progress', payload: '[AUTO] 循环已手动停止' });
        } else if (this.state.iteration >= this.maxIterations) {
            this.emit({ type: 'progress', payload: `[AUTO] 达到最大轮次限制 (${this.maxIterations})，循环结束` });
        }

        this.currentSinks?.onCompleted?.('[CodingLoop] 循环完成');
    }

    /**
     * Execute SinglePass (Coder → Reviewer) workflow
     */
    private async runSinglePass(task: string): Promise<string> {
        if (!this.singlePass) {
            throw new Error('SinglePass not initialized');
        }

        return new Promise((resolve, reject) => {
            let result = '';

            const sinks: AgentStartSinks = {
                onText: (chunk) => {
                    result += chunk;
                    // Forward to callbacks
                    this.notifyCallbacks('onText', 'single-pass', chunk);
                },
                onEvent: (event) => {
                    // Forward to callbacks
                    if (event && typeof event === 'object') {
                        const data = (event as any).data || event;
                        if (data.type === 'tool_use') {
                            this.notifyCallbacks('onToolUse', 'single-pass', data.name || '', event);
                        }
                    }
                },
                onCompleted: () => {
                    this.notifyCallbacks('onAgentEnd', 'single-pass', result);
                    resolve(result);
                },
                onFailed: (error) => {
                    this.notifyCallbacks('onAgentFailed', 'single-pass', error);
                    reject(new Error(error));
                },
                canUseTool: async (_toolName, input) => ({
                    behavior: 'allow',
                    updatedInput: input,
                }),
            };

            this.notifyCallbacks('onAgentStart', 'single-pass');
            
            this.singlePass!.start(
                task,
                {
                    sourceTabId: 'CodingLoop',
                    workspacePath: undefined,
                },
                sinks
            );
        });
    }

    /**
     * Implement LoopAgent abstract method: decide whether to continue
     */
    protected async shouldContinue(iterationResult: string): Promise<{ continue: boolean; nextTask?: string; reason: string }> {
        if (!this.judgeAgent) {
            return { continue: false, reason: 'JUDGE Agent 未初始化' };
        }

        // Consume pending tasks
        const pendingMessages = this.state.pendingQueue.splice(0);
        
        // Build JUDGE input
        const judgeInput = `
Current Task: ${this.state.currentTask}
Iteration: ${this.state.iteration}

Iteration Result:
${iterationResult}

Pending Messages (${pendingMessages.length}):
${pendingMessages.map((m, i) => `${i + 1}. ${m}`).join('\n') || '(无)'}
`.trim();

        try {
            // Call JUDGE Agent
            let judgeOutput = '';
            const judgeCompletion = new Promise<boolean>((resolve) => {
                const sinks: AgentStartSinks = {
                    onText: (chunk: string) => {
                        judgeOutput += chunk;
                    },
                    onCompleted: () => resolve(true),
                    onFailed: () => resolve(false),
                    canUseTool: async (_toolName, input) => ({
                        behavior: 'allow',
                        updatedInput: input,
                    }),
                };

                this.judgeAgent!.start(judgeInput, { sourceTabId: 'CodingLoop', workspacePath: undefined }, sinks);
            });

            await judgeCompletion;

            // Parse decision
            const decision = parseJudgeOutput(judgeOutput);
            
            // Convert Judge output to expected format
            if (decision.type === 'continue') {
                return {
                    continue: true,
                    nextTask: decision.nextTask,
                    reason: decision.reason,
                };
            } else {
                return {
                    continue: false,
                    nextTask: undefined,
                    reason: decision.reason,
                    result: decision.result,
                } as any;
            }
        } catch (error) {
            return {
                continue: false,
                reason: `JUDGE 执行出错: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

}

export async function createAgent(): Promise<RunnableAgent> {
    const agent = new CodingLoop();
    await agent.initialize();
    return agent;
}
