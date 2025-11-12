# Workflow Agents

工作流代理基类，提供高级编排模式。

## SequentialAgent

顺序执行多个子代理的工作流代理。

### 核心职责
- 按固定顺序依次执行子代理
- 管理子代理间的上下文传递
- 聚合所有子代理的输出
- 统一事件流处理

### 使用场景
- 需要多个步骤顺序执行的工作流（如：编写代码 → 审查 → 判断）
- 每个步骤由独立的 PromptAgent 实现
- 需要将前一步的输出传递给下一步

### 设计要点
```typescript
class MyWorkflow extends SequentialAgent {
    protected readonly subAgents = [
        new StepOneAgent(),
        new StepTwoAgent(),
        new StepThreeAgent(),
    ];

    // 可选：自定义上下文传递模式
    protected readonly contextMode = 'output'; // 'output' | 'accumulate' | 'none'

    // 可选：自定义失败策略
    protected readonly failFast = true;
}
```

## LoopAgent

循环执行工作流直到满足终止条件的代理。

### 核心职责
- 管理循环状态（轮次、任务队列等）
- 每轮调用子代理（通常是一个 SequentialAgent）
- 根据决策逻辑判断是否继续循环
- 处理循环控制命令（start/stop/status）
- 防止无限循环（maxIterations 限制）

### 使用场景
- 需要重复执行直到满足某个条件（如：修复代码直到测试通过）
- 每轮执行相同的工作流，但任务内容可能动态更新
- 需要外部决策代理（如 JudgeAgent）来判断是否继续

### 设计要点
```typescript
class MyLoop extends LoopAgent {
    protected readonly subAgents = [
        new SinglePassWorkflow(), // SequentialAgent
    ];

    protected readonly maxIterations = 10;

    // 必须实现：决策逻辑
    protected async shouldContinue(iterationResult: string) {
        // 调用 JudgeAgent 或其他决策逻辑
        return { continue: true, nextTask: 'updated task', reason: '...' };
    }
}
```

## 架构模式

### 组合使用
```
LoopAgent
  └─ SinglePass (SequentialAgent)
       ├─ CoderAgent (PromptAgent)
       ├─ ReviewerAgent (PromptAgent)
       └─ JudgeAgent (PromptAgent)
```

- **LoopAgent**: 管理循环控制与状态
- **SequentialAgent**: 定义单轮执行的步骤顺序
- **PromptAgent**: 实现具体的业务逻辑

### 事件流
```
User Command
  → LoopAgent.start()
    → 循环开始
      → SinglePass.start() (第 1 轮)
        → CoderAgent.start()
        → ReviewerAgent.start()
        → JudgeAgent.start()
      → shouldContinue() → { continue: true }
      → SinglePass.start() (第 2 轮)
        → ...
      → shouldContinue() → { continue: false }
    → 循环结束
  → 返回结果
```

## 实现注意事项

### SequentialAgent
1. **事件聚合**: 需要将所有子代理的事件统一转发给调用方
2. **取消处理**: 需要中断当前执行的子代理并停止后续执行
3. **上下文传递**: 根据 contextMode 正确传递输入
4. **错误处理**: 根据 failFast 决定是否在失败时终止

### LoopAgent
1. **双支路架构**: 应答支路（立即返回）+ 运行支路（后台循环）
2. **状态管理**: 线程安全的状态更新（IDLE ↔ RUNNING）
3. **任务队列**: 在循环运行时接收新任务并在判断阶段整合
4. **超时保护**: maxIterations 防止无限循环
5. **优雅停止**: shouldStop 标志支持手动中断

## 与 Google ADK 的对应关系

| 本项目 | Google ADK | 说明 |
|--------|-----------|------|
| SequentialAgent | SequentialAgent | 顺序编排模式 |
| LoopAgent | LoopAgent | 循环编排模式 |
| PromptAgent | LlmAgent | LLM 驱动的代理 |
| RunnableAgent | Agent | 统一代理接口 |
| EventBus | Callback | 观测与事件处理 |
