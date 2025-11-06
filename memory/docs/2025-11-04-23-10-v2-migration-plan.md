# TaskAgent v2.0 迁移计划

**日期**: 2025-11-04 23:10  
**基于**: `2025-11-04-refactor-roadmap-v2.md`  
**架构**: Monorepo + Event Bus + 双 AI SDK  

---

## 🔄 架构演进对比

### 当前状态（v1 Phase 1 已完成）
```
src/
├── agents/              # ✅ 已统一（v1 完成）
│   ├── story/
│   ├── glossary/
│   ├── ui-review/
│   └── log-monitor/
├── drivers/             # ⚠️ 保留了兼容层
├── components/          # ❌ UI 仍在根目录
└── domain/              # ❌ Store 仍在根目录
```

### 目标状态（v2.0）
```
packages/
├── core/                # 🆕 协议层
│   ├── types/           # Message, AgentEvent
│   ├── schemas/         # Zod 校验
│   └── event-bus/       # EventBus
├── agents/              # 🔄 迁移 + 重构
│   ├── runtime/         # Claude SDK + Vercel SDK
│   ├── registry/        # AgentRegistry
│   ├── story/
│   ├── glossary/
│   ├── monitor/
│   └── ui-review/
├── execution/           # 🆕 执行层
│   ├── TabExecutor.ts
│   ├── MessageAdapter.ts
│   └── TabExecutionManager.ts
├── tabs/                # 🆕 Tab 配置层
│   ├── registry.ts
│   └── configs/
├── presets/             # 🆕 入口预设
│   ├── default.ts
│   └── monitor.ts
└── cli/                 # 🔄 迁移 UI
    ├── main.tsx
    ├── components/
    └── store/
```

---

## 📊 v1 Phase 1 成果评估

### ✅ 已完成（有价值）
1. **Agent 统一化** 
   - 所有 Agent 已移到 `src/agents/`
   - 向后兼容层保留
   - **价值**: 可直接迁移到 `packages/agents/`

2. **测试基础设施改进**
   - Settings 权限处理
   - Vitest 配置优化
   - 测试通过率 43% → 86%
   - **价值**: 作为 Phase 0 基准

3. **编译验证**
   - TypeScript 编译通过
   - 无 Linter 错误
   - **价值**: 代码质量基础良好

### ⚠️ 需要重构
1. **架构不符合 v2.0**
   - 未使用 Monorepo
   - 未引入 Event Bus
   - Agent 仍有 UI 依赖（通过 sinks 直接调用）

2. **缺少关键组件**
   - 无 MessageStore（按 Tab 隔离）
   - 无 TabExecutor（执行协调）
   - 无 Event Bus（解耦桥梁）

---

## 🎯 v2.0 核心变革

### 1. Monorepo 架构
**目标**: 清晰边界，独立包

**关键变化**:
- 根 `package.json` 添加 `workspaces: ["packages/*"]`
- 每个 package 独立 `package.json`
- 使用 `workspace:*` 引用内部包

**示例**:
```json
// packages/agents/package.json
{
  "name": "@taskagent/agents",
  "dependencies": {
    "@taskagent/core": "workspace:*",
    "@anthropic-ai/claude-agent-sdk": "^x.x.x"
  }
}
```

---

### 2. Event Bus 解耦

**Before (v1 - 直接调用)**:
```typescript
// Agent 通过 sinks 直接更新 UI
context.setFrozenMessages(prev => [...prev, message]);
```

**After (v2.0 - Event Bus)**:
```typescript
// Agent 发送事件
eventBus.emit({
  type: 'agent:text',
  agentId: 'story',
  tabId: 'story',
  timestamp: Date.now(),
  payload: { chunk: 'Hello' },
  version: '1.0'
});

// CLI 订阅事件
eventBus.on('agent:text', (event) => {
  messageStore.appendMessage(event.tabId, {
    id: nextId(),
    role: 'assistant',
    content: event.payload.chunk
  });
});
```

**优势**:
- ✅ Agent 完全解耦 UI
- ✅ Schema 校验保证类型安全
- ✅ 易于扩展多 UI（Web/VSCode）

---

### 3. 双 AI SDK 架构

#### Chat 模式（Vercel AI SDK）
```typescript
// packages/agents/runtime/vercel/runChatStream.ts
import { streamText } from 'ai';

export async function* runChatStream(prompt: string) {
  const result = await streamText({
    model: openai(process.env.OPENROUTER_MODEL_NAME),
    prompt
  });
  
  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
```

**适用**: Chat Tab（简单对话，无工具）

#### Agent 模式（Claude Agent SDK）
```typescript
// packages/agents/runtime/claude/runClaudeStream.ts
import { query } from '@anthropic-ai/claude-agent-sdk';

export async function runClaudeStream({ prompt, session, queryOptions }) {
  const result = query({
    prompt,
    options: {
      model: 'claude-sonnet-4.5',
      resume: session.initialized ? session.id : undefined,
      agents: queryOptions.agents,
      systemPrompt: queryOptions.systemPrompt,
      canUseTool: queryOptions.canUseTool
    }
  });
  
  for await (const message of result) {
    yield message;
  }
}
```

**适用**: Story/Glossary/Monitor/UI-Review Tab（工具调用 + Session 管理）

---

### 4. MessageStore 按 Tab 隔离

**Before (v1)**:
```typescript
// 全局 frozenMessages + activeMessages
const [frozenMessages, setFrozenMessages] = useState<Message[]>([]);
```

**After (v2.0)**:
```typescript
export class MessageStore {
  private tabMessages = new Map<string, TabMessages>();
  
  appendMessage(tabId: string, message: Omit<Message, 'sourceTabId' | 'timestamp'>) {
    const fullMessage: Message = {
      ...message,
      sourceTabId: tabId,  // 强制绑定
      timestamp: Date.now()
    };
    
    this.getMessages(tabId).frozen.push(fullMessage);
    
    // 不可见 Tab 限制消息数量（默认 20 条）
    if (tabId !== this.currentTabId) {
      this.limitMessages(tabId, 20);
    }
  }
  
  getVisibleMessages(currentTabId: string): Message[] {
    const { frozen, active } = this.getMessages(currentTabId);
    return [...frozen, ...active];
  }
}
```

---

## 🚀 迁移路线图（v2.0）

### Phase 0: 测试基准 ✅ 进行中
**目标**: 记录当前测试状态

**已完成**:
- ✅ 测试通过率 86% (6/7)
- ✅ 失败测试：仅 e2e-automation（PTY 问题）
- ✅ 编译状态良好

**产出**:
- 测试快照记录
- 性能基准（可选）

**时间**: 0.5 天

---

### Phase 1: Monorepo 重组
**目标**: 建立 Monorepo 结构

#### 1.1 初始化 Monorepo
```bash
# 根 package.json
{
  "private": true,
  "workspaces": ["packages/*"]
}
```

#### 1.2 创建 packages/core
```bash
mkdir -p packages/core/{types,schemas,event-bus}
```

**核心文件**:
- `packages/core/types/Message.ts` - 消息类型
- `packages/core/types/AgentEvent.ts` - 事件类型
- `packages/core/event-bus/EventBus.ts` - Event Bus 实现
- `packages/core/schemas/*.schema.ts` - Zod 校验

#### 1.3 迁移 Agents
```bash
# 创建 packages/agents
mkdir -p packages/agents

# 迁移 runtime（Claude SDK 封装）
mv src/agent/runtime packages/agents/runtime
mv src/agent/flows packages/agents/runtime/flows

# 迁移 Agent 实现（利用 v1 Phase 1 成果）
mv src/agents/story packages/agents/story
mv src/agents/glossary packages/agents/glossary
mv src/agents/ui-review packages/agents/ui-review
mv src/agents/log-monitor packages/agents/monitor

# 删除旧的 drivers（已有兼容层）
rm -rf src/drivers/story/agent.ts src/drivers/glossary/agent.ts
```

#### 1.4 迁移 CLI
```bash
mkdir -p packages/cli

mv src/components packages/cli/components
mv ui.tsx packages/cli/main.tsx
mv src/domain packages/cli/store  # 重命名为 store
```

#### 1.5 更新依赖
```json
// packages/agents/package.json
{
  "name": "@taskagent/agents",
  "dependencies": {
    "@taskagent/core": "workspace:*",
    "@anthropic-ai/claude-agent-sdk": "^x.x.x",
    "ai": "^4.x.x"
  }
}

// packages/cli/package.json
{
  "name": "@taskagent/cli",
  "dependencies": {
    "@taskagent/core": "workspace:*",
    "@taskagent/agents": "workspace:*",
    "ink": "^6.3.1",
    "react": "^19.2.0"
  },
  "bin": {
    "taskagent": "dist/main.js"
  }
}
```

**验收标准**:
- [ ] `yarn install` 成功（Yarn workspace 配置正确）
- [ ] 所有代码在 `packages/` 下
- [ ] TypeScript 编译通过
- [ ] 测试通过（路径更新后）

**时间**: 2-3 天

---

### Phase 2: Event Bus 引入
**目标**: 建立 Event Bus 基础设施

#### 2.1 实现 Event Bus
```typescript
// packages/core/event-bus/EventBus.ts
import { EventEmitter } from 'events';
import { AgentEventSchema } from '../schemas/agent-event.schema';

export class EventBus {
  private emitter = new EventEmitter();
  
  emit(event: AgentEvent): void {
    // Schema 校验
    const validated = AgentEventSchema.parse(event);
    this.emitter.emit(event.type, validated);
  }
  
  on(type: AgentEventType, handler: (event: AgentEvent) => void): void {
    this.emitter.on(type, handler);
  }
}
```

#### 2.2 定义事件类型
```typescript
// packages/core/event-bus/types.ts
export type AgentEventType = 
  | 'agent:text'
  | 'agent:reasoning'
  | 'agent:event'
  | 'agent:completed'
  | 'agent:failed';

export interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  tabId: string;
  timestamp: number;
  payload: unknown;
  version: '1.0';
}
```

#### 2.3 CLI 集成
```typescript
// packages/cli/main.tsx
const App = () => {
  const eventBus = useMemo(() => new EventBus(), []);
  
  useEffect(() => {
    eventBus.on('agent:text', (event) => {
      messageStore.appendMessage(event.tabId, {
        id: nextId(),
        role: 'assistant',
        content: event.payload.chunk
      });
    });
  }, [eventBus]);
  
  return <Screen messageStore={messageStore} />;
};
```

**验收标准**:
- [ ] EventBus 实现完成
- [ ] Schema 校验工作
- [ ] CLI 订阅事件
- [ ] 测试通过

**时间**: 2 天

---

### Phase 3: Agent 统一化
**目标**: Agent 只依赖 EventBus

#### 3.1 创建 AgentRegistry
```typescript
// packages/agents/registry/AgentRegistry.ts
export class AgentRegistry {
  private factories = new Map<string, AgentFactory>();
  
  register(id: string, factory: AgentFactory): void {
    this.factories.set(id, factory);
  }
  
  create(id: string, eventBus: EventBus): RunnableAgent {
    const factory = this.factories.get(id);
    return factory.create(eventBus);
  }
}
```

#### 3.2 重构 Agent 接口
```typescript
// packages/agents/base/RunnableAgent.ts
export interface RunnableAgent {
  id: string;
  description: string;
  
  start(
    userInput: string,
    context: AgentContext,
    eventBus: EventBus  // 只依赖 EventBus
  ): ExecutionHandle;
}
```

#### 3.3 重构 Story Agent
```typescript
// packages/agents/story/index.ts
export function createStoryAgent(eventBus: EventBus): RunnableAgent {
  return {
    id: 'story',
    async start(userInput, context) {
      const result = await runClaudeStream({ ... });
      
      // 通过 Event Bus 发送输出
      for await (const chunk of result) {
        eventBus.emit({
          type: 'agent:text',
          agentId: 'story',
          tabId: context.sourceTabId,
          timestamp: Date.now(),
          payload: { chunk },
          version: '1.0'
        });
      }
    }
  };
}
```

**验收标准**:
- [ ] 所有 Agent 只依赖 EventBus
- [ ] AgentRegistry 实现完成
- [ ] Agent 无 UI 依赖
- [ ] 测试通过

**时间**: 3 天

---

### Phase 4-7 概览

#### Phase 4: 消息协议化（2 天）
- Message 强制 `sourceTabId` + `timestamp`
- MessageStore 按 Tab 分区
- CLI 订阅 Event Bus 更新

#### Phase 5: Tab 配置分离（2 天）
- 创建 `packages/tabs/`
- TabRegistry + TabConfig
- Tab 类型简化为 `chat` 和 `agent`

#### Phase 6: Execution 协调层（3 天）
- MessageAdapter（Event-Driven）
- TabExecutor + TabExecutionManager
- 并发控制

#### Phase 7: 多入口支持（2 天）
- `packages/presets/`
- default + monitor 预设
- `taskagent` + `taskagent-monitor` 命令

---

## ⏱️ 时间估计

| Phase | 内容 | 时间 | 累计 |
|-------|-----|-----|-----|
| Phase 0 | 测试基准 ✅ | 0.5 天 | 0.5 天 |
| Phase 1 | Monorepo 重组 | 2-3 天 | 3.5 天 |
| Phase 2 | Event Bus | 2 天 | 5.5 天 |
| Phase 3 | Agent 统一化 | 3 天 | 8.5 天 |
| Phase 4 | 消息协议化 | 2 天 | 10.5 天 |
| Phase 5 | Tab 配置分离 | 2 天 | 12.5 天 |
| Phase 6 | Execution 协调层 | 3 天 | 15.5 天 |
| Phase 7 | 多入口支持 | 2 天 | 17.5 天 |

**总计**: 约 **3 周**

---

## 🎯 当前优先级

### 立即执行（高优先级）

#### Option A: 完成 Phase 0 基准记录
```bash
# 1. 运行完整测试
yarn test:ci
yarn test:story
yarn test:glossary

# 2. 记录测试快照
# 生成报告：当前通过的测试列表
```

**时间**: 0.5 天  
**价值**: 作为后续验收标准

#### Option B: 直接开始 Phase 1 Monorepo
```bash
# 1. 初始化 Monorepo
# 2. 创建 packages/core
# 3. 迁移代码到 packages/
```

**时间**: 2-3 天  
**风险**: 未记录基准，回退困难

---

## 📝 建议

### 推荐方案：**Option A（完成 Phase 0）**

**理由**:
1. **低风险**: 只需记录测试状态，不改动代码
2. **高价值**: 建立验收标准，后续每个 Phase 都可对比
3. **快速**: 0.5 天完成
4. **符合 v2.0 路线图**: Phase 0 明确要求建立基准

**下一步操作**:
```bash
# 1. 运行测试并记录结果
yarn test:ci > phase0-test-report.txt

# 2. 生成测试快照文档
# 记录：通过的测试、失败的测试、覆盖率

# 3. 完成后开始 Phase 1 Monorepo
```

---

## 🔄 v1 Phase 1 工作的处理

### 保留
- `src/agents/` 目录和文件（可直接复制到 `packages/agents/`）
- 测试基础设施改进（Settings、Vitest 配置）
- 向后兼容层（作为过渡）

### 删除（Monorepo 后）
- `src/drivers/` 整个目录
- `src/components/`（迁移到 `packages/cli/components`）
- `src/domain/`（迁移到 `packages/cli/store`）

---

## ✅ 验收标准（整体）

### 功能验收
- [ ] 所有现有测试通过
- [ ] Story/Glossary/Monitor/UI-Review 功能正常
- [ ] Tab 切换消息正确过滤
- [ ] 后台任务（`/bg:agent`）工作

### 架构验收
- [ ] Agent 完全解耦 UI（只依赖 EventBus）
- [ ] Monorepo 结构清晰
- [ ] Event Bus Schema 校验工作
- [ ] Tab 和 Agent 通过 ID 引用

### 代码质量验收
- [ ] 测试覆盖率 > 80%
- [ ] 所有包独立可编译
- [ ] 符合 SOLID 原则

---

**迁移计划状态**: v2.0 已确认  
**当前进度**: Phase 0 进行中（测试基准记录）  
**下一步**: 完成 Phase 0 → 开始 Phase 1 Monorepo

**创建时间**: 2025-11-04 23:10  
**基于文档**: `2025-11-04-refactor-roadmap-v2.md`

