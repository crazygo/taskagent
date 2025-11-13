# Monitor Agent 技术实施文档

**版本**: 1.0
**日期**: 2025-11-06
**状态**: 设计阶段

---

## 文档目标

本文档描述 Monitor Agent 系统的技术实施方案，包括：
- DevHub Agent（开发枢纽）
- Looper Agent（循环执行引擎）
- 跨 Tab 消息机制
- 与现有代码的集成点

**设计原则**：
- 复用现有基础设施（TabExecutor、EventBus、MessageStore）
- 最小化侵入性修改
- 保持架构清晰性

---

## 1. EventBus 消息订阅扩展

### 现状分析

**EventBus 实现**（`packages/core/event-bus/EventBus.ts`）：
- 基于 Node.js EventEmitter
- 当前事件类型：`agent:text`, `agent:completed` 等（Agent → UI）
- 支持类型安全的事件发射和订阅
- 支持通配符订阅 `*`

**MessageStore 实现**（`packages/cli/store/MessageStore.ts`）：
- 管理 Map<tabId, TabMessages>
- 核心方法：`appendMessage(tabId, message)`
- 当前**无事件发射机制**

### 新需求

**用例**：DevHub 需要订阅 Looper Tab 的消息，实时获取进展更新。

**技术目标**：
- MessageStore 推送消息时自动触发 EventBus 事件
- 支持按 Tab 过滤订阅
- 不影响现有功能

### 接口定义

```
┌─────────────────────────────────────────────────────┐
│  MessageStore.appendMessage(tabId, message)         │
│    ↓                                                │
│  1. 存储消息到 Map<tabId, messages>                 │
│  2. eventBus.emit('message:added', {                │
│       tabId,                                        │
│       message,                                      │
│       timestamp                                     │
│    })                                               │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│  DevHub Agent 订阅                                  │
│    eventBus.on('message:added', (event) => {        │
│      if (event.tabId === 'Looper') {                │
│        // 处理 Looper 消息                          │
│      }                                              │
│    })                                               │
└─────────────────────────────────────────────────────┘
```

**事件 Schema**：
```typescript
type MessageAddedEvent = {
  type: 'message:added';
  tabId: string;
  message: Message;
  timestamp: number;
};
```

### 技术方案

**方案**：MessageStore 构造函数注入 EventBus

```typescript
// MessageStore 修改
class MessageStore {
  constructor(
    private eventBus?: EventBus,  // 可选依赖（向后兼容）
    config: MessageStoreConfig = {}
  ) {}

  appendMessage(tabId: string, message: Message): void {
    // 现有逻辑
    tabData.messages.push(message);

    // 新增：发射事件
    this.eventBus?.emit({
      type: 'message:added',
      tabId,
      message,
      timestamp: Date.now(),
      version: '1.0',
      agentId: 'system',
      payload: { tabId, message }
    });
  }
}
```

### 使用示例

**DevHub 订阅 Looper 消息**：
```typescript
// DevHub Agent 初始化时
class DevHubAgent {
  constructor(private eventBus: EventBus) {
    // 订阅所有消息
    eventBus.on('message:added', (event) => {
      if (event.payload.tabId === 'Looper') {
        const message = event.payload.message;

        // 过滤 [AUTO] 消息
        if (message.content.includes('[AUTO]')) {
          this.handleLooperProgress(message);
        }
      }
    });
  }

  private handleLooperProgress(message: Message) {
    // 更新 DevHub 的内部上下文
    // 用于下次用户询问时提供信息
  }
}
```

### 影响范围

**修改文件**：
- `packages/core/types/AgentEvent.ts`：新增 `message:added` 事件类型
- `packages/cli/store/MessageStore.ts`：
  - 构造函数签名变更（新增可选参数 eventBus）
  - appendMessage() 方法新增事件发射逻辑

**影响点**：
- 所有创建 MessageStore 的地方（约 2-3 处）
- 向后兼容（eventBus 参数可选）

---

## 2. Looper Agent（GraphAgent）

### 现状分析

**RunnableAgent 接口**（`packages/agents/runtime/types.ts`）：
```typescript
interface RunnableAgent {
  id: string;
  description: string;
  start(userInput, context, sinks): ExecutionHandle;
}
```

**TaskManager**（`packages/shared/task-manager.ts`）：
- `startBackground(agent, prompt, context)` 返回 `{ task, emitter }`
- emitter 触发 `completed` / `failed` 事件

### 新需求

**Looper 特性**：
- GraphAgent（手写逻辑，非 PromptAgent）
- 双支路架构：应答支路 + 运行支路
- 状态机：IDLE ↔ RUNNING
- 循环执行 Coder → Review → JUDGE

### 架构设计

```
┌──────────────────────────────────────────────────────┐
│  LooperGraphAgent                                    │
│  ┌────────────────────────────────────────────────┐  │
│  │  start(userInput, context, sinks)              │  │
│  │    ↓                                           │  │
│  │  1. parseCommand(userInput)                    │  │
│  │  2. 状态机转换（IDLE/RUNNING）                  │  │
│  │  3. 立即返回 ExecutionHandle                    │  │
│  │     completion = Promise.resolve(true)         │  │
│  │  ─────────────────────────────────────────────│  │
│  │  应答支路（同步，立即返回）                      │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  runLoopAsync(task)                            │  │
│  │    ↓                                           │  │
│  │  while (iteration < 5 && !shouldStop) {       │  │
│  │    1. 启动 Coder (TaskManager)                 │  │
│  │       await waitForCompletion(emitter)        │  │
│  │    2. 启动 Review (TaskManager)                │  │
│  │       await waitForCompletion(emitter)        │  │
│  │    3. JUDGE 节点 (PromptAgent)                 │  │
│  │       - 组装输入 string                        │  │
│  │       - 调用 LLM 决策                          │  │
│  │       - 返回结构化输出                         │  │
│  │       - continue → 更新 currentTask           │  │
│  │       - terminate → break 退出循环            │  │
│  │  }                                             │  │
│  │  ─────────────────────────────────────────────│  │
│  │  运行支路（异步，后台执行）                      │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 接口定义

**命令格式**：
```typescript
type LooperCommand =
  | { type: 'start', task: string }
  | { type: 'stop' }
  | { type: 'status' }
  | { type: 'add_pending', task: string };
```

**状态机**：
```
IDLE ─── start ──→ RUNNING
  ↑                  │
  │                  │
  └─── terminate ────┘
```

**JUDGE 节点输入**：
```
Current Task: [当前任务描述]
Iteration: [轮次]

Coder Result: SUCCESS/FAILED
[coder 输出]

Review Result: SUCCESS/FAILED
[review 输出]

Pending Messages (count):
1. [任务1]
2. [任务2]

Decision:
- continue: { nextTask: "整合后的新任务描述" }
- terminate: 任务完成
```

### 使用示例

**用户通过 DevHub 启动循环**：
```typescript
// DevHub 调用 send_to_looper 工具
tabExecutor.execute(
  'Looper',                                // tabId
  'looper',                                // agentId
  JSON.stringify({ type: 'start', task: '优化网页代码' }),  // userInput
  { sourceTabId: 'Looper', workspacePath: context.workspacePath }
);
// 不 await，立即返回
```

**用户直接在 Looper Tab 发消息**：
```
User 输入: "优化登录页面"
  ↓
Looper.start() 解析为 { type: 'start', task: '优化登录页面' }
  ↓
启动循环
```

### 影响范围

**新增文件**：
- `packages/agents/devhub/looper/index.ts` - LooperGraphAgent 类
- `packages/agents/devhub/looper/state.ts` - 状态机定义
- `packages/agents/devhub/looper/command.ts` - 命令解析
- `packages/agents/devhub/looper/judge/` - JUDGE Agent（PromptAgent）
  - `judge.agent.md` - JUDGE System Prompt
  - `index.ts` - JUDGE Agent 实现
  - `schema.ts` - 结构化输出 Schema

**注册**：
- `packages/agents/registry/registerAgents.ts` - 注册 looper agent
- `packages/cli/drivers/types.ts` - 新增 `Driver.LOOPER`
- `packages/tabs/TabRegistry.ts` - 注册 Looper Tab

---

## 2.1 JUDGE Agent（PromptAgent）

### 现状分析

JUDGE 是 Looper 循环中的决策节点，需要基于多种信息做智能决策。

### 新需求

**JUDGE 特性**：
- PromptAgent（使用 LLM 分析和决策）
- 接收结构化输入
- 返回结构化输出
- 决策逻辑灵活（由 Prompt 定义）

### 架构设计

```
┌─────────────────────────────────────────────────────┐
│  JUDGE Agent (PromptAgent)                          │
│  ┌───────────────────────────────────────────────┐  │
│  │  decide(input: string)                        │  │
│  │    ↓                                          │  │
│  │  1. 构建 System Prompt                        │  │
│  │  2. 调用 SDK.query(input)                     │  │
│  │  3. 启用 structured output                    │  │
│  │  4. 返回 JudgeDecision                        │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 接口定义

**输入格式**：
```
Current Task: [当前任务]
Iteration: [轮次]

Coder Result: SUCCESS/FAILED
[详细输出]

Review Result: SUCCESS/FAILED  
[健康度报告]

Pending Messages (count):
1. [用户新增的任务]
2. [...]
```

**输出 Schema**：
```typescript
type JudgeDecision = 
  | {
      type: 'continue';
      nextTask: string;  // 整合后的新任务描述
      reason: string;    // 决策理由
    }
  | {
      type: 'terminate';
      reason: string;    // 为什么结束
    };
```

### System Prompt

```markdown
# JUDGE Agent - 循环决策者

你是 Looper 循环的决策者，负责分析 Coder 和 Review 的结果，决定是否继续循环。

## 决策规则

### 必须 continue 的情况
1. Review 健康度 = critical（严重问题）
2. Coder 失败但可以修复（如路径错误、语法问题）
3. 有 pending 消息，且当前任务已完成

### 应该 terminate 的情况
1. Review 健康度 = normal，且无 pending 消息
2. 达到最大轮次限制
3. Coder 失败且无法修复（如环境问题）

### 生成 nextTask
- 如果 Review 有问题：整合问题描述到 nextTask
- 如果有 pending 消息：整合到 nextTask（保持任务连贯性）
- 保持上下文：nextTask 应基于 Current Task 的基础上调整

## 输出格式

必须返回 JSON：
\`\`\`json
{
  "type": "continue",
  "nextTask": "基于当前任务，修复XSS漏洞，优化性能。同时准备实现登录功能。",
  "reason": "Review 发现安全问题，需要修复。用户新增了登录功能需求。"
}
\`\`\`

或

\`\`\`json
{
  "type": "terminate",
  "reason": "Review 通过，代码质量正常，无待处理任务。"
}
\`\`\`
```

### 使用示例

**在 Looper 中调用 JUDGE**：
```typescript
// packages/agents/devhub/looper/index.ts
import { createJudgeAgent } from './judge/index.js';

class LooperGraphAgent {
  private judgeAgent: JudgeAgent;
  
  constructor() {
    this.judgeAgent = createJudgeAgent();
  }
  
  private async runLoopAsync(task: string) {
    while (iteration < 5 && !shouldStop) {
      // ... Coder 和 Review 执行 ...
      
      // JUDGE 决策
      const judgeInput = this.buildJudgeInput(
        this.state.currentTask,
        this.state.iteration,
        coderResult,
        reviewResult,
        this.state.pendingQueue
      );
      
      const decision = await this.judgeAgent.decide(judgeInput);
      
      if (decision.type === 'terminate') {
        this.pushMessage(`[Looper] 循环结束: ${decision.reason}`);
        break;
      }
      
      // continue: 更新任务
      this.state.currentTask = decision.nextTask;
      this.pushMessage(`[Looper] 继续循环: ${decision.reason}`);
      
      iteration++;
    }
  }
}
```

### 影响范围

**新增文件**：
- `packages/agents/devhub/looper/judge/judge.agent.md` - System Prompt
- `packages/agents/devhub/looper/judge/index.ts` - JUDGE Agent 实现
- `packages/agents/devhub/looper/judge/schema.ts` - JudgeDecision 类型定义

**依赖**：
- 复用 `buildPromptAgentStart` 工厂函数
- 使用 SDK 的 structured output 功能（Zod schema）

---

## 3. DevHub Agent（PromptAgent）

### 现状分析

**PromptAgent 基础**（`packages/agents/runtime/runPromptAgentStart.ts`）：
- `buildPromptAgentStart()` 工厂函数
- 支持自定义工具注入（通过 `canUseTool` sink）

**Story Agent 示例**（`packages/agents/blueprint/index.ts`）：
- 基于 `loadAgentPipelineConfig` 加载配置
- 自定义工具通过 SDK 的 tool calling 机制

### 新需求

**DevHub 职责**：
- 理解用户自然语言
- 路由任务（简单问答 vs 发送给 Looper）
- 订阅 Looper 消息，转述给用户

### 架构设计

```
┌───────────────────────────────────────────────────────┐
│  DevHubAgent (PromptAgent)                           │
│  ┌─────────────────────────────────────────────────┐  │
│  │  初始化                                         │  │
│  │    eventBus.on('message:added', ...)           │  │
│  │    订阅 Looper Tab 消息                         │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  start(userInput, context, sinks)               │  │
│  │    ↓                                            │  │
│  │  SDK.query(prompt + 历史上下文)                 │  │
│  │    ↓                                            │  │
│  │  LLM 决策：                                     │  │
│  │    - 简单问答 → 直接回复                        │  │
│  │    - 复杂任务 → 调用 send_to_looper 工具        │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  工具：send_to_looper                           │  │
│  │    ↓                                            │  │
│  │  tabExecutor.execute('Looper', 'looper', ...)   │  │
│  │  不 await，立即返回                             │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### 接口定义

**工具定义**：
```typescript
tools: {
  send_to_looper: {
    description: "向 Looper 发送任务或命令",
    parameters: {
      command: "start | stop | status | add_pending",
      task?: "任务描述（仅 start/add_pending 需要）"
    }
  },

  query_looper_state: {
    description: "查询 Looper 当前状态",
    parameters: {}
  }
}
```

**消息流**：
```
用户: "优化网页代码"
  ↓
DevHub (LLM 理解意图)
  ↓
调用工具: send_to_looper({ command: 'start', task: '优化网页代码' })
  ↓
DevHub 响应: "好的，已启动优化循环"
  ↓
[Looper 后台运行...]
  ↓
EventBus 推送: message:added { tabId: 'Looper', content: '[AUTO] Coder 完成' }
  ↓
DevHub 接收事件，更新内部上下文
  ↓
用户: "进展如何？"
  ↓
DevHub (基于上下文): "Coder 已完成，正在审查中"
```

### 使用示例

**DevHub 工具实现**：
```typescript
// packages/agents/devhub/tools.ts
export const devHubTools = {
  send_to_looper: async (params: {
    command: string;
    task?: string;
  }, context: AgentContext) => {
    const looperCommand = {
      type: params.command,
      task: params.task
    };

    // 通过 TabExecutor 发送（不等待）
    tabExecutor.execute(
      'Looper',
      'looper',
      JSON.stringify(looperCommand),
      { sourceTabId: 'Looper', workspacePath: context.workspacePath }
    );
    // 不 await

    return { success: true, message: '命令已发送给 Looper' };
  },

  query_looper_state: async (params, context) => {
    // 向 Looper 发送 status 命令（fire-and-forget）
    tabExecutor.execute(
      'Looper',
      'looper',
      JSON.stringify({ type: 'status' }),
      { sourceTabId: 'Looper', workspacePath: context.workspacePath }
    );

    // 工具立即返回，Looper 会通过 EventBus 推送状态
    return { success: true, message: '状态查询已发送给 Looper' };
  }
};
```

### 影响范围

**新增文件**：
- `packages/agents/devhub/index.ts` - DevHub Agent
- `packages/agents/devhub/mediator.agent.md` - System Prompt
- `packages/agents/devhub/tools.ts` - 工具实现

**注册**：
- `packages/agents/registry/registerAgents.ts` - 注册 devhub
- Monitor Tab 关联到 DevHub Agent（修改 TabRegistry）

---

## 4. Tab 和 Driver 注册

### 现状分析

**TabRegistry**（`packages/tabs/TabRegistry.ts`）：
- 管理 Tab 配置：`{ id, driver, label?, ... }`
- 默认 Tab：Chat, Agent, Monitor 等

**Driver 枚举**（`packages/cli/drivers/types.ts`）：
```typescript
enum Driver {
  CHAT = 'Chat',
  AGENT = 'Agent',
  MONITOR = 'Monitor',
  // ...
}
```

### 新需求

**新增 Looper Tab**：
- 独立 Tab，默认可见
- 使用 Driver.LOOPER
- 关联 Looper Agent

### 接口定义

```
TabRegistry
  ├─ Chat Tab → Driver.CHAT → (无 Agent)
  ├─ Agent Tab → Driver.AGENT → DefaultPromptAgent
  ├─ Monitor Tab → Driver.MONITOR → DevHub Agent
  └─ Looper Tab → Driver.LOOPER → Looper Agent (新增)
```

### 使用示例

**注册 Looper Tab**：
```typescript
// packages/tabs/TabRegistry.ts
export const defaultTabs: TabConfig[] = [
  { id: 'Chat', driver: Driver.CHAT },
  { id: 'Agent', driver: Driver.AGENT },
  { id: 'Monitor', driver: Driver.MONITOR },
  { id: 'Looper', driver: Driver.LOOPER },  // 新增
  // ...
];
```

**Driver 注册**：
```typescript
// packages/cli/drivers/types.ts
export enum Driver {
  CHAT = 'Chat',
  AGENT = 'Agent',
  MONITOR = 'Monitor',
  LOOPER = 'Looper',  // 新增
  // ...
}
```

### 影响范围

**修改文件**：
- `packages/tabs/TabRegistry.ts` - defaultTabs 数组新增 Looper
- `packages/cli/drivers/types.ts` - Driver 枚举新增 LOOPER
- `packages/cli/drivers/registry.ts` - 注册 Driver.LOOPER 的处理逻辑

---

## 5. TabExecutor 集成

### 现状分析

**TabExecutor**（`packages/execution/TabExecutor.ts`）：
- `execute(tabId, agentId, userInput, context)` 方法
- 通过 AgentRegistry 创建 Agent 实例
- 返回 Promise<ExecutionResult>

### 新需求

**DevHub 调用 Looper 时不等待**：
- 当前 execute() 会等待 agent.start() 的 completion
- DevHub 需要 fire-and-forget 模式

### 接口定义

```
DevHub → TabExecutor.execute('Looper', 'looper', ...)
              ↓
            不 await（立即返回）
              ↓
            Looper.start() 立即返回（completion 立即 resolve）
              ↓
            TabExecutor.execute() Promise resolve
              ↓
            DevHub 继续执行（不阻塞）
```

### 技术方案

**方案**：Looper.start() 的 completion 立即 resolve

Looper 已设计为双支路：
- 应答支路：start() 立即返回，completion 立即 resolve
- 运行支路：runLoopAsync() 后台执行

因此**无需修改 TabExecutor**，现有机制已满足需求。

### 使用示例

```typescript
// DevHub 工具中
tabExecutor.execute('Looper', 'looper', command, context);
// 不 await，但 execute 会立即返回（因为 Looper completion 立即 resolve）
```

### 影响范围

**无需修改**：TabExecutor 无需变更

---

## 6. 实现顺序

### Phase 1: 基础设施
1. EventBus 扩展（message:added 事件）
2. MessageStore 集成 EventBus
3. Tab 和 Driver 注册（Looper Tab）

### Phase 2: Looper Agent
4. Looper 状态机和命令解析
5. Looper 循环逻辑（Coder → Review → JUDGE）
6. JUDGE 节点实现

### Phase 3: DevHub Agent
7. DevHub Agent 实现
8. DevHub 工具实现（send_to_looper, query_looper_state）
9. EventBus 订阅集成

### Phase 4: 集成测试
10. 测试 DevHub → Looper 通信
11. 测试用户直接操作 Looper
12. 测试候补队列和停止命令

---

## 7. 风险和依赖

### 技术风险

1. **EventBus 性能**：
   - 每条消息都触发事件，高频场景下可能有性能影响
   - 缓解：事件发射是同步操作，性能开销极小

2. **Looper 循环稳定性**：
   - 循环中任何环节失败可能导致卡死
   - 缓解：每个步骤都有超时和错误处理

3. **跨 Tab 消息顺序**：
   - EventBus 事件可能与 UI 更新有时序问题
   - 缓解：事件只用于通知，不影响核心逻辑

### 外部依赖

- **无新增外部依赖**：完全基于现有代码库

### 兼容性

- **向后兼容**：MessageStore 的 eventBus 参数可选
- **无破坏性变更**：所有修改都是新增或可选

---

## 8. 测试策略

### CLI 命令行测试（优先）

**测试原则**：优先使用命令行测试，验证完整的用户体验和系统集成。

#### 测试环境准备

```bash
# 测试工作区
TEST_WORKSPACE=/Users/admin/Downloads/zcode-test/xiaoyouxi

# 确保工作区存在
mkdir -p $TEST_WORKSPACE
```

#### 测试用例

**Test 1: Looper 基础启动和状态查询**
```bash
yarn start -- \
  --workspace $TEST_WORKSPACE \
  --newsession \
  --looper \
  --auto-allow \
  -p '{"type":"start","task":"创建一个简单的 hello.txt 文件"}'

# 预期：
# - Looper Tab 激活
# - 显示 "启动循环任务: 创建一个简单的 hello.txt 文件"
# - 看到 Iteration 1 开始
```

**Test 2: Looper 状态查询**
```bash
yarn start -- \
  --workspace $TEST_WORKSPACE \
  --newsession \
  --looper \
  --auto-allow \
  -p '{"type":"status"}'

# 预期：
# - 立即返回状态信息
# - 显示 "状态: IDLE" 或 "状态: RUNNING"
```

**Test 3: DevHub 启动 Looper**
```bash
yarn start -- \
  --workspace $TEST_WORKSPACE \
  --newsession \
  --devhub \
  --auto-allow \
  -p "优化代码质量，重点检查错误处理"

# 预期：
# - DevHub 理解意图
# - 调用 send_to_looper 工具
# - DevHub 响应 "已启动优化循环"
# - 在 Looper Tab 看到循环开始
```

**Test 4: 候补任务**
```bash
# 先启动一个长任务
yarn start -- --workspace $TEST_WORKSPACE --looper -p '{"type":"start","task":"优化所有文件"}'

# 等待几秒后，发送候补任务（新窗口）
yarn start -- --workspace $TEST_WORKSPACE --looper -p '{"type":"add_pending","task":"添加日志功能"}'

# 预期：
# - 第二条命令立即返回
# - Looper 显示 "任务已加入队列"
# - 当前轮次完成后，看到切换到新任务
```

**Test 5: 停止循环**
```bash
yarn start -- --workspace $TEST_WORKSPACE --looper -p '{"type":"stop"}'

# 预期：
# - Looper 显示 "收到停止信号"
# - 当前轮次完成后循环终止
```

**Test 6: Coder + Review 集成**
```bash
yarn start -- \
  --workspace $TEST_WORKSPACE \
  --newsession \
  --looper \
  --auto-allow \
  -p '{"type":"start","task":"在 test.js 中添加一个求和函数，并创建测试"}'

# 预期：
# - Iteration 1: Coder 创建文件
# - Review 分析代码
# - JUDGE 决策（可能 continue 或 terminate）
# - 如果 continue，看到 Iteration 2
```

**Test 7: EventBus 跨 Tab 消息（手动验证）**
```bash
# 启动 DevHub Tab
yarn start -- --workspace $TEST_WORKSPACE --devhub

# 手动操作：
# 1. 发送 "优化代码"
# 2. 切换到 Looper Tab，观察循环执行
# 3. 切回 Monitor Tab，发送 "进展如何？"
# 4. 验证 DevHub 能回答当前状态

# 预期：
# - DevHub 能看到 Looper 的 [AUTO] 消息
# - 基于这些消息回答用户
```

---

### 单元测试（辅助）

**仅测试核心逻辑**，不依赖完整系统：

#### Looper 状态机测试
```bash
# packages/agents/devhub/looper/state.test.ts
- 测试 IDLE → RUNNING 转换
- 测试候补队列 push/pop
- 测试终止条件判断
```

#### 命令解析测试
```bash
# packages/agents/devhub/looper/command.test.ts
- parseCommand('{"type":"start","task":"xxx"}')
```

#### JUDGE 节点测试
```bash
# packages/agents/devhub/looper/judge/judge.test.ts
- 输入组装格式验证
- Prompt 构建验证
- 结构化输出解析（continue vs terminate）
- nextTask 生成质量验证（集成 review 和 pending）
```

---

### 集成测试（中级优先级）

**使用 TaskManager 和真实 Agent**：

```bash
# tests/integration/looper.test.ts
- 启动 Looper，模拟 Coder 成功
- 启动 Looper，模拟 Review 失败
- 验证错误处理进入 JUDGE
```

---

### 验收测试清单

参考 TODO.md 中的验证目标，使用 CLI 命令逐一验证：

- [ ] **Test 1**: 用户通过 DevHub 启动循环任务
- [ ] **Test 2**: 用户直接在 Looper Tab 启动任务
- [ ] **Test 3**: Looper 执行 Coder → Review → JUDGE 循环
- [ ] **Test 4**: 用户查询 Looper 状态（通过 DevHub 或直接）
- [ ] **Test 5**: 用户添加候补任务
- [ ] **Test 6**: Looper 在 JUDGE 节点处理候补任务
- [ ] **Test 7**: 用户停止正在运行的循环
- [ ] **Test 8**: 看到 [AUTO] 状态消息推送到 Looper Tab
- [ ] **Test 9**: DevHub 通过 EventBus 接收 Looper 消息

---

### 调试技巧

**查看日志**：
```bash
# 实时查看 debug.log
tail -f debug.log | grep -E "Looper|DevHub|JUDGE"
```

**手动测试工具调用**：
```bash
# 测试 send_to_looper 工具
yarn start -- --devhub -p "测试工具：发送任务给 Looper"

# 观察 debug.log 中的工具调用记录
```

**验证 EventBus 消息**：
```bash
# 在代码中临时添加日志
eventBus.on('message:added', (event) => {
  console.log('[EventBus] message:added', event.payload.tabId);
});
```

---

## 附录：关键代码位置

| 模块 | 文件路径 |
|------|---------|
| EventBus | `packages/core/event-bus/EventBus.ts` |
| MessageStore | `packages/cli/store/MessageStore.ts` |
| TabExecutor | `packages/execution/TabExecutor.ts` |
| TabRegistry | `packages/tabs/TabRegistry.ts` |
| TaskManager | `packages/shared/task-manager.ts` |
| AgentRegistry | `packages/agents/registry/registerAgents.ts` |
| DevHub Agent | `packages/agents/devhub/` |
| Looper Agent | `packages/agents/devhub/looper/` |
| Coder Agent | `packages/agents/coder/` |
| Review Agent | `packages/agents/review/` |

---

## 9. 实施计划与里程碑

### Milestone 1: 基础设施搭建（3-5天）

**目标**: 完成 EventBus、MessageStore 集成，注册 Tab 和 Driver

**任务列表**:
- [ ] 扩展 EventBus 事件类型（message:added）
- [ ] MessageStore 集成 EventBus 发射逻辑
- [ ] 注册 Looper Tab 到 TabRegistry
- [ ] 添加 Driver.LOOPER 到 Driver 枚举
- [ ] 单元测试：EventBus 消息发射和订阅

**验收标准**:
- MessageStore.appendMessage() 成功触发 EventBus 事件
- 订阅者能接收到 message:added 事件
- Looper Tab 在 UI 中可见

---

### Milestone 2: Looper Agent 实现（5-7天）

**目标**: 完成 Looper 状态机、循环逻辑、JUDGE 节点

**任务列表**:
- [ ] 实现 LooperGraphAgent 类（packages/agents/devhub/looper/index.ts）
- [ ] 实现状态机管理（state.ts）
- [ ] 实现命令解析器（command.ts）
- [ ] 实现 JUDGE Agent（judge/ 目录）
  - [ ] judge.agent.md - System Prompt
  - [ ] index.ts - JUDGE Agent 实现
  - [ ] schema.ts - 决策输出 Schema
- [ ] 集成 TaskManager 启动 Coder/Review
- [ ] 实现双支路架构（应答 + 运行）
- [ ] 实现候补队列管理
- [ ] 单元测试：状态机转换、命令解析、JUDGE 决策

**验收标准**:
- Looper 可接收命令（start/stop/status/add_pending）
- 循环正确执行 Coder → Review → JUDGE 流程
- JUDGE 正确决策 continue/terminate
- 候补任务在 JUDGE 阶段正确整合
- 支持用户停止循环

**CLI 测试**:
```bash
# Test 1: 基础启动
yarn start -- --looper -p '{"type":"start","task":"创建 hello.txt"}'

# Test 2: 状态查询
yarn start -- --looper -p '{"type":"status"}'

# Test 3: 停止循环
yarn start -- --looper -p '{"type":"stop"}'
```

---

### Milestone 3: DevHub Agent 实现（3-5天）

**目标**: 完成 DevHub 对话路由、工具实现、EventBus 订阅

**任务列表**:
- [ ] 实现 DevHub Agent（packages/agents/devhub/index.ts）
- [ ] 编写 System Prompt（mediator.agent.md）
- [ ] 实现工具（tools.ts）
  - [ ] send_to_looper: 发送命令到 Looper Tab
  - [ ] query_looper_state: 查询 Looper 状态
- [ ] 集成 EventBus 订阅 Looper 消息
- [ ] 实现上下文更新逻辑（基于 Looper 进展）
- [ ] 单元测试：工具调用、EventBus 订阅

- **验收标准**:
- DevHub 能理解自然语言并路由任务
- send_to_looper 工具正确调用 TabExecutor
- DevHub 能订阅并接收 Looper Tab 消息
- 用户询问进展时，DevHub 基于订阅的消息回复

**CLI 测试**:
```bash
# Test 4: DevHub 启动 Looper
yarn start -- --devhub -p "优化代码质量"

# Test 5: DevHub 查询进展
yarn start -- --devhub -p "进展如何？"
```

---

### Milestone 4: 端到端集成测试（2-3天）

**目标**: 验证完整的用户场景，修复集成问题

**测试场景**:
- [ ] **Test 1**: 用户通过 DevHub 启动循环任务
- [ ] **Test 2**: 用户直接在 Looper Tab 启动任务
- [ ] **Test 3**: Looper 执行 Coder → Review → JUDGE 循环
- [ ] **Test 4**: 用户查询 Looper 状态（通过 DevHub 或直接）
- [ ] **Test 5**: 用户添加候补任务
- [ ] **Test 6**: Looper 在 JUDGE 节点处理候补任务
- [ ] **Test 7**: 用户停止正在运行的循环
- [ ] **Test 8**: 看到 [AUTO] 状态消息推送到 Looper Tab
- [ ] **Test 9**: DevHub 通过 EventBus 接收 Looper 消息

**完整测试流程**:
```bash
# 1. 启动 DevHub，发送任务
yarn start -- --devhub -p "优化代码，重点检查错误处理"

# 2. 切换到 Looper Tab，观察循环执行
# 预期：看到 Iteration 1, 2, ... 的进度消息

# 3. 在 Looper Tab 添加候补任务
yarn start -- --looper -p '{"type":"add_pending","task":"添加日志功能"}'

# 4. 切回 Monitor Tab，询问进展
yarn start -- --devhub -p "当前进展如何？"
# 预期：DevHub 基于订阅的消息回复

# 5. 停止循环
yarn start -- --looper -p '{"type":"stop"}'
```

- **验收标准**:
- 所有测试场景通过
- 无崩溃或阻塞问题
- 消息流顺畅（用户 → DevHub → Looper → EventBus → DevHub）
- 日志清晰可追踪

---

### Milestone 5: 文档与优化（1-2天）

**目标**: 完善文档、代码注释、性能优化

**任务列表**:
- [ ] 更新用户文档（README.md）
- [ ] 添加架构图（ASCII 或 Mermaid）
- [ ] 代码注释补充（关键逻辑）
- [ ] 性能分析与优化（EventBus 频率、循环并发）
- [ ] 错误处理增强（边界情况）

**交付物**:
- 完整的技术文档（本文档）
- 用户使用指南
- 代码注释覆盖率 > 80%

---

## 10. 成功标准

### 功能完整性
- ✅ DevHub 能理解自然语言并路由任务
- ✅ Looper 能执行完整的 Coder → Review → JUDGE 循环
- ✅ 候补队列正确管理和消费
- ✅ 用户可随时停止循环
- ✅ 跨 Tab 消息通过 EventBus 正确传递

### 性能要求
- EventBus 消息延迟 < 100ms
- Looper 循环响应时间（命令到执行）< 1s
- 支持至少 5 轮循环无性能衰减

### 可维护性
- 代码模块化，职责清晰
- 单元测试覆盖核心逻辑 > 70%
- 文档完整，易于后续开发者理解

### 用户体验
- 命令响应迅速（非阻塞）
- 进度反馈及时（[AUTO] 消息）
- 错误提示清晰友好

---

## 11. 风险缓解策略

### 技术风险缓解

**风险 1: EventBus 性能瓶颈**
- 缓解：事件发射是同步操作，开销极小
- 监控：添加 EventBus 性能日志
- 回退：如有问题，改用轮询机制

**风险 2: Looper 循环卡死**
- 缓解：每个步骤都有超时（TaskManager 自带）
- 监控：添加循环轮次日志
- 回退：用户可随时停止循环

**风险 3: 跨 Tab 消息顺序问题**
- 缓解：EventBus 事件只用于通知，不影响核心逻辑
- 监控：添加消息时序日志
- 回退：Looper 状态以 MessageStore 为准

**风险 4: JUDGE 决策质量不佳**
- 缓解：精心设计 System Prompt，提供充分上下文
- 监控：记录所有 JUDGE 决策到日志
- 回退：用户可手动停止并调整任务

---

## 12. 未来扩展方向

### Phase 2: 定时监控（Loop Manager）
- 实现定时触发 Review Agent
- 自动健康度监控和告警推送
- 参考：`docs/design/sonnet_design_monitor_mediator_architecture.md`

### Phase 3: 高级特性
- **并行执行**: 支持多个 Coder 任务并行
- **优先级队列**: 候补任务支持优先级
- **智能调度**: 根据健康度动态调整检查频率
- **历史分析**: Looper 执行历史和成功率统计

### Phase 4: 生态集成
- **Webhook**: 完成通知推送到外部系统
- **可视化**: Web UI 显示循环进度和健康度
- **插件系统**: 支持自定义 JUDGE 逻辑和子 Agent

---

**文档完成日期**: 2025-11-06  
**文档版本**: 1.0 (完整版)  
**最后更新**: 添加实施计划与里程碑章节

---

**文档结束**
