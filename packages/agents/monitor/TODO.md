# Monitor Agent 实现待办事项（MVP）

## 已完成 ✅
1. **ReviewAgent 设计与实现**
   - coordinator.agent.md (自然语言驱动)
   - 3个子PromptAgent: specs_breakdown, task_log, git_diff
   - index.ts (RunnableAgent 实现)
   - 输出包含健康度评级（normal/warning/critical）
2. **Coder Agent 实现**
   - coder.agent.md (开发+自测)
   - index.ts (RunnableAgent 实现)
   - 已注册到 registry
3. **斜杠命令**
   - fg:coder, bg:coder, fg:review, bg:review 已添加
4. **需求场景定义** (features/core_behaviors.yaml - 8个场景)
5. **架构设计文档**
   - `/docs/design/monitor_mediator_looper.md` - 技术实施文档
   - `/docs/design/sonnet_design_monitor_mediator_architecture.md` - 初始架构提案

---

## 核心架构决策

### 双 Agent 架构

```
Monitor Tab → Mediator Agent (PromptAgent)
  ├─ 职责: 理解用户自然语言，路由任务
  ├─ 能力: 简单问答直接回复，复杂任务转发给 Looper
  └─ 工具: send_to_looper, query_looper_status

Looper Tab → Looper Agent (GraphAgent)
  ├─ 职责: 管理 Coder ↔ Review 循环
  ├─ 能力: 状态机管理，候补队列，并发控制
  └─ 接口: 接收命令（start/stop/status/add_pending）
```

### 消息流设计

**用户 → Mediator → Looper 流程**：
1. 用户发自然语言给 Mediator
2. Mediator (LLM) 理解意图，生成结构化命令
3. Mediator 调用 send_to_looper 工具，通过 TabExecutor 发送给 Looper
4. Looper 解析命令，执行状态机转换

**用户 → Looper 直接流程**：
1. 用户切换到 Looper Tab，直接发送命令或自然语言
2. Looper 解析输入（支持结构化命令或自然语言）
3. 执行状态机转换

**关键点**：两种路径对 Looper 等效，统一处理

### Looper 状态机

```
状态:
  IDLE（空闲）
    ├─ 接收启动命令 → RUNNING
    ├─ 接收候补命令 → 视为启动命令，→ RUNNING
    └─ 接收status → 返回"空闲"状态

  RUNNING（运行中）
    ├─ 子状态: WAITING_CODER → WAITING_REVIEW → JUDGE
    ├─ 接收启动命令 → 忽略（已在运行）
    ├─ 接收候补消息 → 加入 pendingQueue
    ├─ 接收stop → 设置 shouldStop 标志
    └─ 接收status → 直接推送状态到屏幕（不经过 LLM）

候补队列处理节点:
  JUDGE 阶段（每轮后）
    ├─ 输入：当前任务 + coder结果 + review结果 + pending消息（组装为一个string）
    ├─ 决策：continue(nextTask) | terminate
    ├─ nextTask 整合 review comment 和 pending 消息
    └─ pending 消息在此阶段一次性全部消费

终止条件（满足任一即终止）:
  1. shouldStop 标志 = true（用户主动停止）
  2. 达到最大轮次（5次）
  3. JUDGE 决策为 terminate
```

### 并发控制策略

- **单循环保证**：状态机确保 runLoopAsync 只能在 IDLE 时启动一次
- **非阻塞响应**：Looper.start() 立即返回，循环在后台异步执行
- **候补而非中断**：新任务不杀死当前执行，而是进入队列等待间隙

### 回复策略

**Mediator（PromptAgent）**：
- 总是回复用户
- 回复内容由 LLM 生成
- 告知用户任务已转发给 Looper
- 通过 EventBus 订阅 Looper Tab 的消息，获取进展更新

**Looper（GraphAgent）**：
- **双支路设计**：
  - 应答支路：立即响应命令（start() 立即返回，completion 立即 resolve）
  - 运行支路：后台执行循环逻辑（runLoopAsync）
- 仅在特定命令（status）时推送状态到屏幕
- 状态推送不经过 LLM，直接格式化输出
- 循环过程中推送 [AUTO] 消息到 Looper Tab 的 MessageStore
- 所有消息通过 EventBus 广播，Mediator 可订阅

---

## 待实现 🔲（MVP 范围）

### 1. Mediator Agent

**位置**: `packages/agents/mediator/`

**组件**：
- `mediator.agent.md` - System Prompt
  - 角色定位：对话路由器
  - 理解用户意图（简单问答 vs 复杂任务）
  - 工具定义：send_to_looper, query_looper_status
  
- `index.ts` - RunnableAgent 实现
  - 基于 buildPromptAgentStart
  - 注入自定义工具实现
  
- `tools.ts` - 工具实现
  - send_to_looper: 通过 TabExecutor.execute('Looper', ...) 发送命令
  - query_looper_status: 发送 status 命令并返回结果

**关键决策**：
- Mediator 是 PromptAgent（利用 LLM 理解自然语言）
- 通过 TabExecutor 与 Looper 通信（复用现有机制）
- 工具调用时传递结构化命令（JSON 格式）

---

### 2. Looper Agent

**位置**: `packages/agents/looper/`

**组件**：
- `index.ts` - LooperGraphAgent (实现 RunnableAgent 接口)
  - start() 方法：解析命令，状态机转换，立即返回 ExecutionHandle
  - runLoopAsync() 方法：后台循环逻辑
  - 状态机管理：IDLE ↔ RUNNING
  - IDLE 时接收候补命令 → 视为启动命令
  
- `state.ts` - 状态定义
  - LooperState 接口
  - 状态机转换规则
  - 候补队列管理（push 模式，JUDGE 时批量取出）
  
- `command.ts` - 命令解析
  - parseCommand(): 支持自然语言和结构化命令
  - 命令类型：start, stop, status, add_pending
  
- `judge.ts` - JUDGE 节点逻辑
  - JUDGE 是一个 PromptAgent
  - 输入组装：当前任务 + coder结果 + review结果 + pending消息（合并为string）
  - 调用 LLM 进行决策
  - 结构化输出：`{ type: 'continue', nextTask: string } | { type: 'terminate' }`
  - nextTask 整合 review comment 和 pending 消息

**关键决策**：
- Looper 是 GraphAgent（手写逻辑，不依赖 LLM）
- 实现 RunnableAgent 接口（可通过 TabExecutor 调用）
- 双支路：应答支路（立即返回）+ 运行支路（后台循环）
- 使用 TaskManager 启动 Coder/Review，通过 EventEmitter 等待完成
- 错误处理统一进入 JUDGE 节点决策
- JUDGE 生成下一次循环的新任务描述（带完整上下文）
- status 命令直接推送格式化状态到 MessageStore + EventBus
- 终止条件：满足任一即终止（shouldStop | 最大轮次 | JUDGE决策terminate）

---

### 3. Tab 注册

**位置**: `packages/tabs/TabRegistry.ts`

**修改**：
- 新增 Looper Tab 定义
- Looper Tab 默认可见
- 关联 Looper Agent 到 Looper Tab

---

### 4. Driver 注册

**位置**: `packages/cli/drivers/types.ts` 和 `registry.ts`

**修改**：
- 新增 Driver.LOOPER 枚举
- 注册 Looper 到 driver manifest

---

### 5. EventBus 与 MessageStore 集成

**位置**: `packages/shared/message-store.ts` 或 `packages/core/event-bus/`

**修改**：
- MessageStore.appendMessage() 触发 EventBus 事件
- 事件格式：`message:${tabId}`
- Payload：完整的 Message 对象

**用途**：
- 支持跨 Tab 消息订阅
- Mediator 订阅 Looper Tab 的消息
- 未来可扩展其他 Tab 间通信场景

---

## 通信协议

### Mediator → Looper 命令格式

```typescript
interface LooperCommand {
  command: 'start' | 'stop' | 'status' | 'add_pending';
  task?: string;  // 仅 start/add_pending 需要
}

// 通过 TabExecutor 发送（异步，不等待）
tabExecutor.execute('Looper', 'looper', JSON.stringify(command), context)
  // 不 await，立即返回
```

### 跨 Tab 消息订阅（EventBus）

```typescript
// Mediator 订阅 Looper Tab 的消息
eventBus.subscribe('message:Looper', (message) => {
  // Mediator 可以看到 Looper 的所有消息
  // 用于转述给用户或更新上下文
});

// Looper 推送消息时
messageStore.appendMessage('Looper', message);
// → 触发 EventBus.emit('message:Looper', message)
```

### Looper 状态输出格式

```
[Looper 状态]
状态: RUNNING
当前任务: 优化网页代码
轮次: 2/5
子状态: WAITING_REVIEW
候补队列: 2条消息（"添加登录功能", "添加注册功能"）
```

---

## 实现顺序

### Phase 1: 基础架构
1. Looper Agent 实现（状态机、命令解析、循环逻辑）
2. Mediator Agent 实现（PromptAgent + 工具）
3. Tab 和 Driver 注册

### Phase 2: 集成测试
4. 测试场景 1-3（基础操作、后台任务触发）
5. 测试 Mediator → Looper 通信
6. 测试用户直接操作 Looper

### Phase 3: 循环逻辑
7. 测试 Coder ↔ Review 循环
8. 测试候补队列
9. 测试停止和状态查询

---

## 关键技术点

### Looper 的双支路架构

**应答支路**（立即响应）：
- start() 方法解析命令，更新状态机
- 立即返回 ExecutionHandle（completion 立即 resolve）
- 对于 status 命令，直接推送状态到 MessageStore

**运行支路**（后台循环）：
- runLoopAsync() 在独立执行上下文中运行
- 不阻塞 start() 的返回
- 通过 MessageStore + EventBus 推送状态更新

### Looper 等待 Coder/Review 完成

- 使用 Promise 包装 TaskManager 的 EventEmitter
- 监听 'completed' 和 'failed' 事件
- 支持 async/await 语法

### Looper 的错误处理

**Coder 失败**：
- 进入 JUDGE 节点
- 输入：coder 失败消息 + pending 消息
- JUDGE 决策：重试、修改任务、或终止

**Review 失败**：
- 前提：Coder 成功
- 进入 JUDGE 节点
- 输入：coder 成功 + review 失败消息 + pending 消息
- JUDGE 决策：视为环境问题，继续或终止

### JUDGE 节点的输入组装

```typescript
// 从 pendingQueue 取出所有消息
const pendingMessages = this.state.pendingQueue.splice(0);

// 组装为单个 string
const judgeInput = `
Current Task: ${this.state.currentTask}
Iteration: ${this.state.iteration}

Coder Result: ${coderResult.success ? 'SUCCESS' : 'FAILED'}
${coderResult.message}

Review Result: ${reviewResult?.success ? 'SUCCESS' : 'FAILED'}
${reviewResult?.message || 'N/A'}

Pending Messages (${pendingMessages.length}):
${pendingMessages.map((m, i) => `${i+1}. ${m}`).join('\n')}

Decision:
- continue: { nextTask: "整合 review 问题和 pending 的新任务描述" }
- terminate: 任务完成，退出循环
`;

// 调用 JUDGE Agent（PromptAgent）
const judgeAgent = createJudgeAgent();
const decision = await judgeAgent.decide(judgeInput);
// decision 结构化输出：{ type: 'continue' | 'terminate', nextTask?: string }

if (decision.type === 'continue') {
  this.state.currentTask = decision.nextTask;  // 更新任务描述
}
```

### JUDGE Agent 实现

**JUDGE 是一个 PromptAgent**：
- 接收组装好的输入字符串
- 通过 LLM 分析当前状态
- 返回结构化决策（使用 SDK 的 structured output 功能）

**System Prompt 示例**：
```markdown
你是一个任务循环决策者。根据 Coder 和 Review 的结果，以及用户的候补消息，决定是否继续循环。

## 决策规则

1. 如果 Review 发现严重问题（critical），必须 continue，修复问题
2. 如果 Review 通过（normal），但有 pending 消息，continue 执行新任务
3. 如果 Review 通过且无 pending，terminate 结束循环
4. 如果 Coder 失败，分析原因，决定是否值得重试

## 输出格式

必须返回 JSON：
\`\`\`json
{
  "type": "continue",
  "nextTask": "整合后的任务描述"
}
\`\`\`

或

\`\`\`json
{
  "type": "terminate"
}
\`\`\`
```

### 状态的直接推送

- status 命令不调用 LLM
- 格式化当前状态字符串
- 推送到 Looper Tab：messageStore.appendMessage('Looper', ...)
- 通过 EventBus 广播：eventBus.emit('message:Looper', ...)

### 跨 Tab 消息订阅（EventBus）

**需求**：Mediator 需要订阅 Looper Tab 的消息

**实现要点**：
- MessageStore.appendMessage() 触发 EventBus 事件
- 事件格式：`message:${tabId}`
- Mediator 在初始化时订阅 `message:Looper`
- 接收到消息后，Mediator 可以更新自己的上下文或转述给用户

**架构影响**：
- 需要确保 MessageStore 与 EventBus 集成
- 可能需要在 MessageStore 中添加事件发射逻辑

---

## 验证目标（MVP）

能够手动测试以下场景：

1. ✅ 用户通过 Mediator 启动循环任务
2. ✅ 用户直接在 Looper Tab 启动任务
3. ✅ Looper 执行 Coder → Review 循环
4. ✅ 用户查询 Looper 状态（通过 Mediator 或直接）
5. ✅ 用户添加候补任务
6. ✅ Looper 在合适时机处理候补任务
7. ✅ 用户停止正在运行的循环
8. ✅ 看到 [AUTO] 状态消息推送

**Phase 2 暂缓**：Loop Manager 的定期触发（场景 6-8 中的自动监控部分）
