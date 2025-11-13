# DevHub C4 L2 — LoopAgent + SequentialAgent + PromptAgent + Callback Refactor

```
+------------------------------+
|          User / CLI          |
+---------------+--------------+
                |
                v
        +----------------------+
        |  DevHubCoordinator   |  (解析命令/启动循环)
        +-----------+----------+
                    |
                    v
            +------------------+
            |   CodingLoop     |  (LoopAgent: 循环控制/状态管理)
            | + callbacks[]    |
            +--------+---------+
                     |
                     ├─────────────────────────────────────┐
                     |                                     |
                     | (每次迭代调用)                       | (shouldContinue 调用)
                     v                                     v
            +------------------+                    +-------------+
            |   SinglePass     |                    | JudgeAgent  | (决策：继续/终止)
            | (SequentialAgent)|                    +-------------+
            +----+-----+-------+
                 |     |
                 v     v
     +---------------+ +---------------+
     |  CoderAgent   | | ReviewerAgent |
     |  (PromptAgent)| | (PromptAgent) |
     +-------+-------+ +-------+-------+
             \                |
              \               |
               +--------------v---------------+
                          EventBus
                  (工具/文本事件 → Callbacks)
                              ↓
                  +---------------------------+
                  |  Callbacks (pluggable)    |
                  +---------------------------+
                  | SummarizationCallback     |
                  |  - EventCollector         |
                  |  - SummaryTimer           |
                  |  - triggers Summarizer    |
                  +-------------+-------------+
                                |
                                v
                       +--------------------+
                       | SummarizerAgent    | (PromptAgent: 生成摘要)
                       +---------+----------+
                                 |
                                 v
                          (progress summary → 用户/上下文)
```

## 关键变化

- **SinglePass(SequentialAgent)** 仅封装 Coder→Reviewer（工作代理），不含 Judge
- **JudgeAgent 独立调用** 由 CodingLoop.shouldContinue() 调用（决策代理，非工作流步骤）
- **Callback 模式** 事件收集/摘要逻辑提取到 SummarizationCallback（可插拔）
- **职责分离**：
  - SinglePass = 单轮工作流编排
  - CodingLoop = 循环控制 + 状态管理
  - SummarizationCallback = 观测/摘要
  - JudgeAgent = 循环决策

## 组件说明

### Core Agents (PromptAgent)
- **CoderAgent**: 编写代码
- **ReviewerAgent**: 审查代码
- **JudgeAgent**: 决策是否继续循环（由 CodingLoop 调用）
- **SummarizerAgent**: 生成进度摘要（由 SummarizationCallback 调用）

### Workflow Agents
- **SinglePass** (SequentialAgent): 
  - 依赖：CoderAgent, ReviewerAgent
  - 职责：定义单次迭代的工作流顺序
  - 输出：Coder + Review 的聚合结果
  
- **CodingLoop** (LoopAgent):
  - 依赖：SinglePass, JudgeAgent, callbacks[]
  - 职责：循环控制、状态管理、任务队列
  - 每轮调用 SinglePass → 调用 JudgeAgent.shouldContinue() → 决定继续/终止

### Cross-Cutting Concerns (Callbacks)
- **SummarizationCallback** (AgentCallback):
  - 内部：EventCollector, SummaryTimer
  - 触发：阈值 or 30s定时 or 任务完成 flush
  - 职责：收集事件 → 触发 SummarizerAgent → 发射 progress 消息
  - 可替换：可换成 MetricsCallback, DebugLoggingCallback 等

### Infrastructure
- **EventBus**: 跨代理通信（Coder/Review 事件 → Callbacks 监听）
- **无需**: LooperAgent/StateStore/Telemetry（已简化）

## 设计优势

1. **单一职责**: CodingLoop 只管循环，Callback 管观测
2. **可插拔性**: 运行时注入不同 callbacks 无需改 CodingLoop 代码
3. **可测试性**: Mock callback 即可独立测试循环逻辑
4. **可扩展性**: 添加新 callback（metrics/logging）零破坏性变更
5. **符合 ADK**: Callback 模式提取横切关注点
