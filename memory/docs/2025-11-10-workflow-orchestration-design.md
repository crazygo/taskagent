# Workflow Orchestration 设计讨论

**日期**: 2025-11-10  
**参与者**: 用户 + AI Agent  
**主题**: TaskAgent 后台任务编排框架设计，对比 Google ADK

---

## 核心需求

构建一个独立于主进程的后台任务编排系统，支持：

1. **后台任务独立运行** - 与主进程解耦，可推送消息到主进程
2. **运行时控制协议** - 查询状态、追加任务、启动/打断/恢复
3. **自然语言生成任务** - 通过 Planner agent 将自然语言需求转换为可执行的工作流 DSL
4. **灵活的流水线定义** - 支持循环、条件判断、并行执行、节点组合

---

## 关键设计洞察

### 1. 条件是代码条件，而非自然语言

**为什么重要：**
- 自然语言条件需要每次 LLM 推理，成本高、不稳定
- 代码条件（JavaScript 表达式）可以高效、确定性地评估
- 示例：
  ```typescript
  // ✅ 好的条件（代码表达式）
  condition: 'state.reviewStatus !== "APPROVED"'
  condition: 'state.testsPassed && state.lintPassed'
  condition: 'iteration < 5 && state.errorCount > 0'
  
  // ❌ 避免（自然语言条件）
  condition: "如果 review 没通过就继续"  // 需要 LLM 每次推理
  ```

**实现方式：**
```typescript
private evaluateCondition(
    condition: string | ConditionFn, 
    state: State, 
    iteration: number
): boolean {
    if (typeof condition === 'function') {
        return condition(state, iteration);
    }
    // 字符串表达式求值：state.reviewStatus !== "APPROVED"
    // 使用 vm.runInContext 或 new Function 安全执行
    return evalCondition(condition, { state, iteration });
}
```

---

### 2. 条件变量来自共享的 Context

**关键特性：**
- 每个节点可以读取和修改共享的 `state` 对象
- 状态在节点间流动，支持累积式计算
- Loop/Conditional 节点的条件基于当前 state

**状态流动示例：**
```typescript
// 初始状态
state = {
    requirement: "实现登录功能",
    reviewStatus: "NEEDS_REVISION",
    iteration: 0
};

// Iteration 1:
// 1. Coder agent 执行
state = {
    ...state,
    code: "... 生成的代码 ...",
    codeVersion: 1
};

// 2. Reviewer agent 执行
state = {
    ...state,
    reviewStatus: "NEEDS_REVISION",
    reviewFeedback: "缺少错误处理",
    reviewDecision: "REJECT"
};

// 3. 检查循环条件
evaluateCondition('state.reviewStatus !== "APPROVED"', state, 1)
// => true，继续下一次迭代

// Iteration 2:
// Coder 根据 state.reviewFeedback 修复
state = {
    ...state,
    code: "... 修复后的代码 ...",
    codeVersion: 2
};

// Reviewer 再次检查
state = {
    ...state,
    reviewStatus: "APPROVED",
    reviewDecision: "ACCEPT"
};

// 检查循环条件
evaluateCondition('state.reviewStatus !== "APPROVED"', state, 2)
// => false，循环结束
```

**Context 管理机制：**
```typescript
interface WorkflowState {
    // 用户输入
    requirement?: string;
    
    // 节点输出（累积）
    plannerOutput?: any;
    coderOutput?: string;
    reviewerOutput?: any;
    
    // 控制标志
    reviewStatus?: 'PENDING' | 'NEEDS_REVISION' | 'APPROVED';
    shouldContinue?: boolean;
    
    // 元数据
    iteration?: number;
    startTime?: number;
    errors?: string[];
}

class WorkflowRuntime {
    async executeNode(node: WorkflowNode, state: State): Promise<State> {
        const result = await this.runAgent(node.agentId, state);
        
        // 节点修改 state
        return {
            ...state,
            [node.output || `${node.agentId}Output`]: result,
            iteration: (state.iteration || 0) + 1
        };
    }
}
```

---

### 3. 循环体抽象度高，不关注内部实现

**设计哲学：**
- Loop/Parallel/Sequential 是**容器型节点**，只负责控制流
- 内部可以是任何节点组合：单个 agent、Sequential、Parallel、甚至嵌套的 Loop
- 组合方式灵活，无需修改 Runtime 代码

**抽象层次示例：**
```yaml
# Level 1: 简单循环（单个 agent）
type: loop
condition: state.done !== true
maxIterations: 5
nodes:
  - type: agent
    agentId: worker

---

# Level 2: 循环包含序列（Coder → Reviewer）
type: loop
condition: state.reviewStatus !== "APPROVED"
maxIterations: 10
nodes:
  - type: sequential
    nodes:
      - type: agent
        agentId: coder
      - type: agent
        agentId: reviewer

---

# Level 3: 循环包含并行（Coder → [Reviewer || Tester]）
type: loop
condition: state.allChecksPassed !== true
maxIterations: 10
nodes:
  - type: sequential
    nodes:
      - type: agent
        agentId: coder
      - type: parallel
        nodes:
          - type: agent
            agentId: reviewer
          - type: agent
            agentId: tester

---

# Level 4: 嵌套循环（外层总控，内层精细优化）
type: sequential
nodes:
  - type: agent
    agentId: planner
  
  - type: loop
    condition: state.featuresRemaining > 0
    maxIterations: 20
    nodes:
      - type: agent
        agentId: feature-picker
      
      - type: loop
        condition: state.currentFeatureStatus !== "DONE"
        maxIterations: 5
        nodes:
          - type: sequential
            nodes:
              - type: agent
                agentId: coder
              - type: agent
                agentId: reviewer
```

**Runtime 实现的关键：**
```typescript
export class WorkflowRuntime {
    // 统一的执行入口
    async execute(node: WorkflowNode, state: State): Promise<State> {
        switch (node.type) {
            case 'agent':
                return this.executeAgent(node, state);
            
            case 'sequential':
                return this.executeSequential(node.nodes!, state);
            
            case 'parallel':
                return this.executeParallel(node.nodes!, state);
            
            case 'loop':
                return this.executeLoop(node, state);
            
            case 'conditional':
                return this.executeConditional(node, state);
        }
    }

    // Loop 不需要知道内部是什么
    async executeLoop(node: WorkflowNode, state: State): Promise<State> {
        let iteration = 0;
        while (iteration < (node.maxIterations || 100)) {
            // 执行循环体（内部可以是任何节点）
            for (const subNode of node.nodes!) {
                state = await this.execute(subNode, state);  // 递归调用
            }
            
            // 检查条件（基于共享 state）
            if (node.condition) {
                const shouldContinue = this.evaluateCondition(
                    node.condition, 
                    state, 
                    iteration
                );
                if (!shouldContinue) break;
            }
            
            iteration++;
            state.iteration = iteration;
            
            // 发送进度事件
            this.emitProgress({
                type: 'loop:iteration',
                iteration,
                nodeId: node.id,
                state: this.sanitizeState(state)  // 避免泄露敏感信息
            });
        }
        return state;
    }
}
```

---

## 对比 Google ADK

| 维度 | Google ADK | TaskAgent 设计 | 优势 |
|------|-----------|----------------|------|
| **节点类型** | Sequential, Parallel, Loop | Sequential, Parallel, Loop, Conditional, Agent | 基本一致 |
| **组合方式** | Python 类嵌套 | JSON/YAML DSL 嵌套 | ✅ DSL 可动态生成 |
| **条件定义** | Python lambda 函数 | 字符串表达式 + 函数 | ✅ 可从自然语言生成 |
| **状态管理** | Context object (Python dict) | State object (TypeScript) | 类似 |
| **状态共享** | 手动传递 context.state | 自动流动 + 每个节点可修改 | ✅ 更自动化 |
| **并行隔离** | asyncio.gather, 需手动 fork | Promise.all + fork 机制 | 类似 |
| **动态生成** | ❌ 需手写代码 | ✅ Planner agent 生成 DSL | **核心优势** |
| **运行时控制** | ❌ 启动后无法控制 | ✅ query/pause/resume/interrupt | **核心优势** |
| **可观测性** | ⚠️ 文档未强调 | ✅ EventBus + 进度事件 | **核心优势** |
| **后台执行** | 需手动管理 handle | ✅ TabExecutor 天然支持 | **核心优势** |

---

## DSL 设计规范

### 基础 Schema

```typescript
interface WorkflowNode {
    // 节点类型
    type: 'agent' | 'sequential' | 'parallel' | 'loop' | 'conditional';
    
    // Agent 节点专用
    agentId?: string;
    input?: string | object;  // 可以是模板字符串：'${state.xxx}'
    output?: string;          // 输出到 state 的哪个字段
    
    // 容器节点专用
    nodes?: WorkflowNode[];
    
    // Loop/Conditional 专用
    condition?: string | ConditionFn;  // 'state.xxx !== "yyy"'
    maxIterations?: number;            // Loop 专用
    
    // 元数据
    id?: string;
    name?: string;
    description?: string;
    
    // 错误处理
    onError?: 'stop' | 'continue' | 'retry';
    retries?: number;
    timeout?: number;  // 毫秒
}

interface WorkflowDefinition {
    version: '1.0';
    name: string;
    description?: string;
    
    // 初始状态
    initialState?: Record<string, any>;
    
    // 根节点
    root: WorkflowNode;
    
    // 全局配置
    config?: {
        maxExecutionTime?: number;  // 整个 workflow 最大执行时间
        eventEmit?: boolean;         // 是否发送进度事件
        stateSnapshot?: boolean;     // 是否保存状态快照
    };
}
```

### 示例：完整的 Coder-Review 循环 DSL

```yaml
version: '1.0'
name: 'coder-review-loop'
description: '后台循环执行写代码→review，直到通过或达到最大迭代次数'

initialState:
  requirement: '实现用户登录功能'
  reviewStatus: 'NEEDS_REVISION'
  maxIterations: 10

root:
  type: loop
  name: 'main-optimization-loop'
  condition: 'state.reviewStatus !== "APPROVED" && state.criticalError !== true'
  maxIterations: ${state.maxIterations}
  
  nodes:
    - type: sequential
      name: 'code-review-cycle'
      nodes:
        # Step 1: Coder agent
        - type: agent
          agentId: coder
          input: |
            需求: ${state.requirement}
            Review 反馈: ${state.reviewFeedback || '首次编写'}
          output: codeChanges
          timeout: 120000  # 2分钟
        
        # Step 2: Parallel review (Reviewer + Tester)
        - type: parallel
          name: 'quality-checks'
          nodes:
            # Reviewer
            - type: agent
              agentId: reviewer
              input: ${state.codeChanges}
              output: reviewResult
            
            # Tester
            - type: agent
              agentId: tester
              input: ${state.codeChanges}
              output: testResult
        
        # Step 3: Aggregate results
        - type: agent
          agentId: decision-maker
          input: |
            Review: ${state.reviewResult}
            Tests: ${state.testResult}
          output: finalDecision
          
        # Step 4: Update state for next iteration
        - type: agent
          agentId: state-updater
          input: ${state.finalDecision}
          output: nextIterationState

config:
  maxExecutionTime: 600000  # 10分钟
  eventEmit: true
  stateSnapshot: true
```

---

## 运行时控制协议

### 任务生命周期

```typescript
interface TaskHandle {
    taskId: string;
    workflowName: string;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    
    // 当前执行位置
    currentNode: string;
    currentIteration?: number;
    
    // 状态快照
    state: WorkflowState;
    
    // 时间信息
    startTime: number;
    lastUpdateTime: number;
    endTime?: number;
    
    // 错误信息
    error?: string;
    
    // 控制方法
    query(): Promise<TaskStatus>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    cancel(): Promise<void>;
    interrupt(reason: string): Promise<void>;
    
    // 动态修改
    appendNodes(nodes: WorkflowNode[]): Promise<void>;
    updateState(patch: Partial<WorkflowState>): Promise<void>;
}

interface TaskRuntime {
    // 启动任务
    start(workflow: WorkflowDefinition): Promise<TaskHandle>;
    
    // 查询任务
    query(taskId: string): Promise<TaskStatus>;
    list(filter?: TaskFilter): Promise<TaskHandle[]>;
    
    // 控制任务
    pause(taskId: string): Promise<void>;
    resume(taskId: string): Promise<void>;
    cancel(taskId: string): Promise<void>;
    interrupt(taskId: string, reason: string): Promise<void>;
    
    // 动态修改（慎用）
    append(taskId: string, nodes: WorkflowNode[]): Promise<void>;
    patchState(taskId: string, patch: Partial<WorkflowState>): Promise<void>;
}
```

### 事件系统

```typescript
// 标准事件格式
interface WorkflowEvent {
    type: 'workflow:start' | 'workflow:progress' | 'workflow:complete' | 'workflow:error'
        | 'node:enter' | 'node:exit' | 'loop:iteration' | 'parallel:start' | 'parallel:complete';
    
    taskId: string;
    timestamp: number;
    
    // 事件负载
    payload: {
        nodeId?: string;
        nodeName?: string;
        iteration?: number;
        state?: WorkflowState;  // 可选的状态快照
        error?: string;
    };
}

// EventBus 集成
eventBus.on('workflow:progress', (event: WorkflowEvent) => {
    // 更新 UI
    messageStore.appendMessage(tabId, {
        role: 'assistant',
        content: `[${event.payload.nodeName}] Iteration ${event.payload.iteration}`,
        timestamp: event.timestamp
    });
});
```

---

## 实现路径

### Phase 1: 核心 Runtime（2-3天）
- [x] `WorkflowRuntime` 基础类
- [ ] `executeSequential` 实现
- [ ] `executeLoop` 实现（含条件求值）
- [ ] `executeParallel` 实现（含 fork/merge）
- [ ] `executeAgent` 实现（集成现有 AgentRegistry）
- [ ] 基础状态管理（State 对象流动）

### Phase 2: DSL + 验证（1-2天）
- [ ] Zod schema 定义 `WorkflowDefinition`
- [ ] YAML → JSON 解析器
- [ ] 条件表达式求值器（安全沙箱）
- [ ] DSL 验证器（检查循环依赖、无限循环风险）

### Phase 3: 控制协议（2-3天）
- [ ] `TaskHandle` 实现
- [ ] `query/pause/resume/cancel` API
- [ ] EventBus 集成（progress/error 事件）
- [ ] 状态快照与恢复

### Phase 4: Planner 集成（2天）
- [ ] Planner agent（自然语言 → DSL）
- [ ] DSL 模板库（常见模式）
- [ ] 验证 + 用户确认流程

### Phase 5: UI 集成（1-2天）
- [ ] 后台任务列表 UI
- [ ] 实时进度展示
- [ ] 手动控制按钮（pause/resume/cancel）

---

## 使用场景示例

### 场景 1: 用户自然语言请求

```
用户: "后台帮我循环优化登录功能代码，每次让 coder 写代码，reviewer 检查，
      如果不通过就继续改，最多改10次"
```

**系统流程：**
1. DevHub 收到请求
2. 调用 Planner agent 生成 DSL
3. 验证 DSL 并展示给用户确认
4. 启动 TaskRuntime，返回 taskId
5. EventBus 推送进度到 DevHub tab
6. 用户可随时查询状态或打断

### 场景 2: 主进程监控并干预

```typescript
// 启动任务
const handle = await taskRuntime.start(workflow);

// 监听进度
eventBus.on('workflow:progress', (event) => {
    if (event.payload.iteration > 3 && event.payload.state.errorCount > 10) {
        // 发现严重偏差，打断任务
        taskRuntime.interrupt(handle.taskId, '错误率过高，方向可能错误');
    }
});

// 查询状态
const status = await handle.query();
console.log(`当前在第 ${status.currentIteration} 次迭代，节点: ${status.currentNode}`);

// 动态追加节点（高级用法）
if (status.state.reviewStatus === 'APPROVED') {
    await handle.appendNodes([
        {
            type: 'agent',
            agentId: 'doc-writer',
            input: '${state.codeChanges}'
        }
    ]);
}
```

### 场景 3: 复杂嵌套流程

```
需求: "先让 planner 做总体规划，然后对每个功能点，循环执行 coder→reviewer，
      每个功能点通过后并行执行测试和文档编写"
```

**生成的 DSL：**
```yaml
type: sequential
nodes:
  # 总体规划
  - type: agent
    agentId: planner
    output: featureList
  
  # 遍历每个功能点
  - type: loop
    condition: state.currentFeatureIndex < state.featureList.length
    nodes:
      # 当前功能点的优化循环
      - type: loop
        condition: state.currentFeatureStatus !== 'APPROVED'
        maxIterations: 5
        nodes:
          - type: agent
            agentId: coder
          - type: agent
            agentId: reviewer
      
      # 通过后并行执行测试+文档
      - type: parallel
        nodes:
          - type: agent
            agentId: tester
          - type: agent
            agentId: doc-writer
```

---

## 关键技术细节

### 1. 安全的条件求值

```typescript
import vm from 'vm';

function evaluateCondition(
    expr: string, 
    context: { state: any; iteration: number }
): boolean {
    // 创建沙箱上下文
    const sandbox = {
        state: context.state,
        iteration: context.iteration,
        // 禁止访问危险对象
        process: undefined,
        require: undefined,
        global: undefined,
    };
    
    try {
        // 在沙箱中执行表达式
        const script = new vm.Script(`(${expr})`);
        const result = script.runInNewContext(sandbox, {
            timeout: 1000  // 1秒超时
        });
        return Boolean(result);
    } catch (error) {
        console.error(`条件求值失败: ${expr}`, error);
        return false;  // 默认终止循环
    }
}
```

### 2. State Fork & Merge（并行执行）

```typescript
class WorkflowRuntime {
    // Fork: 为每个并行分支创建独立状态
    private forkState(state: State): State {
        return JSON.parse(JSON.stringify(state));  // Deep clone
    }
    
    // Merge: 聚合并行分支的结果
    private mergeStates(
        baseState: State, 
        results: PromiseSettledResult<State>[]
    ): State {
        const mergedState = { ...baseState };
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                // 策略 1: 按索引收集结果
                mergedState[`parallel_${index}`] = result.value;
                
                // 策略 2: 合并特定字段（可配置）
                if (result.value.output) {
                    mergedState.outputs = mergedState.outputs || [];
                    mergedState.outputs.push(result.value.output);
                }
            } else {
                // 记录失败
                mergedState.errors = mergedState.errors || [];
                mergedState.errors.push(result.reason);
            }
        });
        
        return mergedState;
    }
}
```

### 3. 节点超时与重试

```typescript
async executeNode(node: WorkflowNode, state: State): Promise<State> {
    const timeout = node.timeout || 300000;  // 默认5分钟
    const retries = node.retries || 0;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await Promise.race([
                this.runAgent(node.agentId!, state),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), timeout)
                )
            ]);
            
            return {
                ...state,
                [node.output || `${node.agentId}Output`]: result
            };
        } catch (error) {
            if (attempt === retries) {
                // 最后一次重试也失败
                if (node.onError === 'continue') {
                    return { ...state, error: error.message };
                }
                throw error;  // 'stop' 或默认行为
            }
            // 等待后重试
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
}
```

---

## 总结

这个设计的核心价值：

1. **代码条件 + 共享 Context** - 高效、确定、可累积
2. **高抽象循环体** - 容器型节点，不关注内部实现，可任意组合
3. **动态生成 DSL** - 自然语言 → 可执行工作流（vs ADK 手写代码）
4. **运行时控制** - query/pause/interrupt（vs ADK 启动即跑）
5. **事件可观测** - EventBus 实时推送进度

**下一步：** 实现 `packages/agents/runtime/workflow.ts` 原型，验证核心概念。

---

## 参考资源

- [Google ADK Workflow Agents 文档](https://google.github.io/adk-docs/agents/workflow-agents/)
- [LangGraph StateGraph 概念](https://langchain-ai.github.io/langgraph/)
- [AWS Step Functions ASL 规范](https://states-language.net/spec.html)
- TaskAgent 现有实现：
  - `packages/agents/story/features-editor.ts` - 三段式流水线
  - `packages/agents/looper/index.ts` - 硬编码循环
  - `packages/execution/TabExecutor.ts` - 后台任务执行
