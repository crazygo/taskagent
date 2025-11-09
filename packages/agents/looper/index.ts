/**
 * Looper Agent - Coder-Review 循环执行引擎
 * 
 * 特性：
 * - 双支路架构：应答支路（立即返回）+ 运行支路（后台循环）
 * - 状态机管理：IDLE ↔ RUNNING
 * - 候补队列：在 JUDGE 阶段整合新任务
 * - 支持命令：start, stop, status, add_pending
 */

import type { RunnableAgent, AgentStartContext, AgentStartSinks, ExecutionHandle } from '../runtime/types.js';
import { parseCommand, type LooperCommand } from './command.js';
import { createInitialState, LooperStatus, LooperSubStatus, canStartLoop, shouldTerminate, type LooperState } from './state.js';
import { createJudgeAgent, parseJudgeOutput } from './judge/index.js';
import { EventCollector } from './event-collector.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { addLog } from '@taskagent/shared/logger';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOPER_AGENT_ID = 'looper';
const LOOPER_DESCRIPTION = 'Coder-Review循环执行引擎，管理开发和审查的迭代循环';

interface LooperEvent {
    type: 'progress' | 'result';
    payload: any;
}

export class LooperGraphAgent implements RunnableAgent {
    readonly id = LOOPER_AGENT_ID;
    readonly description = LOOPER_DESCRIPTION;

    private state: LooperState = createInitialState();
    private currentSinks?: AgentStartSinks;
    private currentContext?: AgentStartContext;
    private judgeAgent?: RunnableAgent;
    private summarizerAgent?: RunnableAgent;
    private eventCollector: EventCollector = new EventCollector();
    private summaryTimer?: NodeJS.Timeout;
    private taskManager?: any;  // Will be injected

    constructor(options?: { taskManager?: any }) {
        this.taskManager = options?.taskManager;
    }

    async initialize() {
        if (!this.judgeAgent) {
            this.judgeAgent = await createJudgeAgent();
        }
        if (!this.summarizerAgent) {
            this.summarizerAgent = await this.createSummarizerAgent();
        }
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        addLog('[Looper] start() called with input: ' + userInput);
        this.currentSinks = sinks;
        this.currentContext = context;

        // Parse command
        const command = parseCommand(userInput);
        addLog('[Looper] Parsed command: ' + JSON.stringify(command));

        // Handle command synchronously (应答支路)
        const response = this.handleCommand(command);
        addLog('[Looper] Response: ' + response);

        // Push response immediately using emit
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
            sessionId: context.session?.id || 'looper-session',
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

        this.emit({ type: 'progress', payload: `[AUTO] 循环开始，最大轮次: ${this.state.maxIterations}` });

        while (this.state.iteration < this.state.maxIterations && !this.state.shouldStop) {
            this.state.iteration++;
            this.emit({ type: 'progress', payload: `[AUTO] === Iteration ${this.state.iteration} ===` });
            this.emit({ type: 'progress', payload: `[AUTO] 当前任务: ${this.state.currentTask}` });

            // Step 1: Run Coder
            this.state.subStatus = LooperSubStatus.WAITING_CODER;
            this.emit({ type: 'progress', payload: '[AUTO] 启动 Coder...' });
            
            const coderResult = await this.runAgent('coder', this.state.currentTask);
            
            if (!coderResult.success) {
                this.emit({ type: 'progress', payload: `[AUTO] Coder 失败: ${coderResult.message}` });
                // Proceed to JUDGE for decision
            } else {
                this.emit({ type: 'progress', payload: '[AUTO] Coder 完成' });
            }

            // Step 2: Run Review (only if Coder succeeded)
            let reviewResult: { success: boolean; message: string } | null = null;
            
            if (coderResult.success) {
                this.state.subStatus = LooperSubStatus.WAITING_REVIEW;
                this.emit({ type: 'progress', payload: '[AUTO] 启动 Review...' });
                
                reviewResult = await this.runAgent('review', this.state.currentTask);
                
                if (!reviewResult.success) {
                    this.emit({ type: 'progress', payload: `[AUTO] Review 失败: ${reviewResult.message}` });
                } else {
                    this.emit({ type: 'progress', payload: '[AUTO] Review 完成' });
                }
            }

            // Step 3: JUDGE decision
            this.state.subStatus = LooperSubStatus.JUDGE;
            this.emit({ type: 'progress', payload: '[AUTO] JUDGE 决策中...' });

            const decision = await this.runJudge(coderResult, reviewResult);

            if (decision.type === 'terminate') {
                this.emit({ type: 'progress', payload: `[AUTO] 循环终止: ${decision.reason}` });
                
                // 发送结果数据给 Mediator
                if ('result' in decision && decision.result) {
                    this.emit({ type: 'result', payload: decision.result });
                }
                break;
            }

            // Continue: update task
            this.state.currentTask = decision.nextTask || this.state.currentTask;
            this.emit({ type: 'progress', payload: `[AUTO] 继续循环: ${decision.reason}` });
            this.emit({ type: 'progress', payload: `[AUTO] 下一轮任务: ${decision.nextTask || '(保持当前任务)'}` });
        }

        // Cleanup
        this.state.status = LooperStatus.IDLE;
        this.state.subStatus = undefined;
        
        if (this.state.shouldStop) {
            this.emit({ type: 'progress', payload: '[AUTO] 循环已手动停止' });
        } else if (this.state.iteration >= this.state.maxIterations) {
            this.emit({ type: 'progress', payload: `[AUTO] 达到最大轮次限制 (${this.state.maxIterations})，循环结束` });
        }

        this.currentSinks?.onCompleted?.('[Looper] 循环完成');
    }

    private async runAgent(agentId: string, task: string): Promise<{ success: boolean; message: string }> {
        if (!this.taskManager) {
            return { success: false, message: 'TaskManager 未初始化' };
        }

        try {
            // Get agent from registry
            const { getGlobalAgentRegistry } = await import('../registry/index.js');
            const registry = getGlobalAgentRegistry();
            const agentFactory = registry.getFactory(agentId);

            if (!agentFactory) {
                return { success: false, message: `Agent ${agentId} 未找到` };
            }

            const agent = await agentFactory();

            // Start background task
            const { task: bgTask, emitter } = this.taskManager.startBackground(
                agent,
                task,
                {
                    sourceTabId: this.currentContext?.sourceTabId || 'Looper',
                    workspacePath: this.currentContext?.workspacePath,
                    timeoutSec: 300, // 5 minutes timeout
                    session: this.currentContext?.session,
                    forkSession: true,
                    parentAgentId: 'looper',
                }
            );

            // Listen to child agent events for progress summary
            emitter.on('event', (e: any) => this.handleChildEvent(e, agentId));
            
            // Start summary timer
            this.startSummaryTimer(agentId);

            // Wait for completion
            const result = await this.waitForTask(emitter);
            
            // Stop timer and generate final summary
            this.stopSummaryTimer();
            if (this.eventCollector.hasEvents()) {
                await this.generateSummary(agentId);
            }
            
            if (result.success) {
                return { success: true, message: result.output || '' };
            } else {
                return { success: false, message: result.error || '未知错误' };
            }
        } catch (error) {
            return { 
                success: false, 
                message: `执行出错: ${error instanceof Error ? error.message : String(error)}` 
            };
        }
    }

    private waitForTask(emitter: EventEmitter): Promise<{ success: boolean; output?: string; error?: string }> {
        return new Promise((resolve) => {
            emitter.once('completed', () => {
                resolve({ success: true, output: 'Agent 执行完成' });
            });

            emitter.once('failed', (error: string) => {
                resolve({ success: false, error });
            });
        });
    }

    private async runJudge(
        coderResult: { success: boolean; message: string },
        reviewResult: { success: boolean; message: string } | null
    ): Promise<{ type: 'continue' | 'terminate'; nextTask?: string; reason: string }> {
        if (!this.judgeAgent) {
            // Fallback: terminate if no JUDGE
            return { type: 'terminate', reason: 'JUDGE Agent 未初始化' };
        }

        // Build JUDGE input
        const pendingMessages = this.state.pendingQueue.splice(0); // Consume all pending
        
        const judgeInput = `
Current Task: ${this.state.currentTask}
Iteration: ${this.state.iteration}

Coder Result: ${coderResult.success ? 'SUCCESS' : 'FAILED'}
${coderResult.message}

Review Result: ${reviewResult ? (reviewResult.success ? 'SUCCESS' : 'FAILED') : 'N/A'}
${reviewResult?.message || 'N/A'}

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
                    canUseTool: async (_toolName, input, _options) => ({
                        behavior: 'allow',
                        updatedInput: input,
                        // Explicit PermissionResult keeps SDK satisfied during judge automation; see https://docs.claude.com/en/api/agent-sdk/typescript.md.
                    }),
                };

                this.judgeAgent!.start(judgeInput, this.currentContext!, sinks);
            });

            await judgeCompletion;

            // Parse decision
            const decision = parseJudgeOutput(judgeOutput);
            return decision;
        } catch (error) {
            // Fallback: terminate on error
            return {
                type: 'terminate',
                reason: `JUDGE 执行出错: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    private emit(event: LooperEvent): void {
        this.currentSinks?.onEvent?.({
            level: 'info',
            message: `looper:${event.type}`,
            ...event,
        } as any);
    }

    /**
     * Handle child agent event for progress tracking
     */
    private handleChildEvent(event: any, agentName: string): void {
        this.eventCollector.add(event);
        
        // Trigger summary if threshold reached
        if (this.eventCollector.shouldSummarize()) {
            this.generateSummary(agentName).catch(err => {
                addLog(`[Looper] Summary generation failed: ${err}`);
            });
        }
    }

    /**
     * Start timer for periodic summaries
     */
    private startSummaryTimer(agentName: string): void {
        this.summaryTimer = setInterval(() => {
            if (this.eventCollector.hasEvents()) {
                this.generateSummary(agentName).catch(err => {
                    addLog(`[Looper] Timer summary failed: ${err}`);
                });
            }
        }, 30000); // 30 seconds
    }

    /**
     * Stop summary timer
     */
    private stopSummaryTimer(): void {
        if (this.summaryTimer) {
            clearInterval(this.summaryTimer);
            this.summaryTimer = undefined;
        }
    }

    /**
     * Generate summary from collected events
     */
    private async generateSummary(agentName: string): Promise<void> {
        const events = this.eventCollector.flush();
        if (events.length === 0) return;

        try {
            addLog(`[Looper] Generating summary for ${events.length} events`);
            
            const prompt = this.buildSummaryPrompt(events);
            const summary = await this.callSummarizer(prompt);
            
            if (summary) {
                this.emit({ type: 'progress', payload: `[${agentName}] ${summary}` });
            }
        } catch (error) {
            addLog(`[Looper] Summary error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Build prompt for summarizer from events
     */
    private buildSummaryPrompt(events: any[]): string {
        const tools: string[] = [];
        const texts: string[] = [];

        for (const event of events) {
            if (event.data?.type === 'tool_use') {
                const tool = event.data;
                const name = tool.name;
                const input = tool.input || {};
                
                // Format tool call
                let toolDesc = `- ${name}`;
                if (input.file_path) toolDesc += ` ${input.file_path}`;
                if (input.command) toolDesc += `: ${input.command}`;
                if (input.content) toolDesc += ` (content truncated)`;
                
                tools.push(toolDesc);
            } else if (event.data?.type === 'text' && event.data?.content) {
                texts.push(`- "${event.data.content}"`);
            }
        }

        let prompt = '';
        if (tools.length > 0) {
            prompt += 'Tools:\n' + tools.join('\n') + '\n\n';
        }
        if (texts.length > 0) {
            prompt += 'Text:\n' + texts.join('\n') + '\n\n';
        }

        if (!prompt) {
            prompt = 'Agent is processing...\n\n';
        }

        return prompt;
    }

    /**
     * Call summarizer agent to generate summary
     */
    private async callSummarizer(prompt: string): Promise<string> {
        if (!this.summarizerAgent) {
            addLog('[Looper] SummarizerAgent not initialized');
            return '';
        }

        return new Promise((resolve) => {
            let summary = '';
            
            const handle = this.summarizerAgent!.start(
                prompt,
                { sourceTabId: 'Looper', workspacePath: this.currentContext?.workspacePath },
                {
                    onText: (chunk: string) => {
                        summary += chunk;
                    },
                    onReasoning: () => {},
                    onEvent: () => {},
                    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                }
            );

            handle.completion.then(() => {
                resolve(summary.trim());
            }).catch((err) => {
                addLog(`[Looper] Summarizer execution failed: ${err}`);
                resolve('');
            });
        });
    }

    /**
     * Create summarizer agent from .agent.md
     */
    private async createSummarizerAgent(): Promise<RunnableAgent> {
        const agentDir = path.dirname(fileURLToPath(import.meta.url));
        const summarizerDir = path.join(agentDir, 'summarizer');

        const { systemPrompt } = await loadAgentPipelineConfig(summarizerDir, {
            coordinatorFileName: 'summarizer.agent.md',
        });

        const summarizerStart = buildPromptAgentStart({
            getPrompt: (userInput: string) => userInput, // User input is the prompt
            getSystemPrompt: () => systemPrompt || '',
        });

        return {
            id: 'looper-summarizer',
            description: 'Progress summarizer for Looper child agents',
            start: summarizerStart,
        };
    }
}

export async function createAgent(options?: { taskManager?: any }): Promise<RunnableAgent> {
    const agent = new LooperGraphAgent(options);
    await agent.initialize();
    return agent;
}
