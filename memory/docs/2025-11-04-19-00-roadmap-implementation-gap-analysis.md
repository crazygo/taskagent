# TaskAgent 重构路线图实现差异分析

**分析日期**: 2025-11-04 19:00  
**对比文档**: `memory/docs/2025-11-04-refactor-roadmap-v2.md`  
**分析目标**: 找出当前代码实现与重构路线图的差异

---

## 执行摘要

当前项目已完成 **Phase 0-5 的大部分工作**（约 70%），包括 Monorepo 重组、Event Bus、Agent 统一化、消息协议化和 Tab 配置分离。但 **Phase 6-7 完全未实现**（Execution 协调层和多入口支持），且存在一些实现与文档不一致的地方。

### 完成度总览

| Phase | 内容 | 文档要求 | 实际状态 | 完成度 |
|-------|-----|---------|---------|--------|
| Phase 0 | 准备阶段 | 建立功能测试基准 | ✅ 测试存在且通过 | 100% |
| Phase 1 | Monorepo 重组 | 代码按 package 重组 | ✅ 完成 | 100% |
| Phase 2 | Event Bus 引入 | 建立 Event Bus 基础设施 | ⚠️ 部分差异 | 90% |
| Phase 3 | Agent 统一化 | 统一 Agent 接口 | ✅ 完成 | 95% |
| Phase 4 | 消息协议化 | Message 增加 sourceTabId | ✅ 完成 | 100% |
| Phase 5 | Tab 配置分离 | Tab 配置从 Driver 分离 | ✅ 完成 | 95% |
| Phase 6 | Execution 协调层 | MessageAdapter + TabExecutor | ❌ 未实现 | 0% |
| Phase 7 | 多入口支持 | Preset 系统 | ❌ 未实现 | 0% |

**总体进度**: 约 **60%**

---

## 详细差异分析

### ✅ Phase 1: Monorepo 重组 (100%)

#### 文档要求
```
packages/
├── core/               # 核心协议层
├── agents/             # Agent 统一收口
├── execution/          # 执行协调层
├── tabs/               # Tab 配置层
├── presets/            # 入口预设配置
└── cli/                # CLI 入口
```

#### 实际实现
```
packages/
├── core/              ✅ 已实现（types, schemas, event-bus）
├── agents/            ✅ 已实现（runtime, registry, story, glossary, monitor, ui-review）
├── cli/               ✅ 已实现（main.tsx, components, store, domain, drivers）
├── tabs/              ✅ 已实现（TabRegistry, configs, types）
├── shared/            ✅ 额外包（logger, task-manager, env）
├── execution/         ❌ 未创建
└── presets/           ❌ 未创建
```

**差异说明**:
- ✅ 核心包结构已创建
- ✅ 新增 `packages/shared/` 用于共享工具（合理设计）
- ❌ `packages/execution/` 完全缺失
- ❌ `packages/presets/` 完全缺失
- ⚠️ CLI 仍包含 `drivers/` 目录，未完全迁移到新架构

---

### ⚠️ Phase 2: Event Bus 引入 (90%)

#### 文档要求
```typescript
// Event Bus 不支持通配符
export class EventBus {
    emit(event: AgentEvent): void
    on(type: AgentEventType, handler: (event: AgentEvent) => void): void
    off(type: AgentEventType, handler: (event: AgentEvent) => void): void
}
```

#### 实际实现
```typescript
// packages/core/event-bus/EventBus.ts
export class EventBus {
    emit(event: AgentEvent): void {
        // ✅ Schema 校验
        const validated = AgentEventSchema.parse(event);
        this.emitter.emit(event.type, validated);
        
        // ⚠️ 文档说不支持通配符，但实现了
        this.emitter.emit('*', validated);
    }
    
    // ⚠️ 支持通配符订阅
    on(type: AgentEventType | '*', handler: (event: AgentEvent) => void): void
    
    // ✅ 其他方法符合文档
    once(...), listenerCount(...), removeAllListeners(...)
}
```

**差异说明**:
1. ⚠️ **通配符支持**: 文档明确说"固定 1.0 版本，不支持通配符"，但实际实现支持 `'*'` 通配符
2. ✅ Schema 校验正常工作
3. ✅ Event types 和 payload 结构正确

**影响**: 低。通配符功能是增强，不影响主流程。建议更新文档或移除通配符代码。

---

### ✅ Phase 3: Agent 统一化 (95%)

#### 文档要求
```typescript
// Agent 只依赖 EventBus，不依赖 UI
export interface RunnableAgent {
    id: string;
    description: string;
    start(userInput: string, context: AgentContext, eventBus: EventBus): ExecutionHandle;
}
```

#### 实际实现
```typescript
// packages/agents/registry/AgentRegistry.ts
export interface Agent {
    id: string;
    description: string;
    start(
        userInput: string,
        context: AgentStartContext,
        sinks: AgentStartSinks  // ⚠️ 使用 sinks 而非 eventBus
    ): ExecutionHandle | Promise<ExecutionHandle>;
}

// AgentRegistry 提供 startAgent 方法整合 EventBus
async startAgent(
    agentId: string,
    userInput: string,
    context: AgentStartContext,
    eventBus: EventBus,
    canUseTool: AgentStartSinks['canUseTool']
): Promise<ExecutionHandle | null>
```

**差异说明**:
1. ⚠️ **接口设计**: Agent 使用 `sinks` callback 而非直接传入 `EventBus`
2. ✅ **EventBusAdapter 存在**: `createEventBusAdapter()` 将 sinks 转换为 Event Bus 事件
3. ✅ AgentRegistry 提供了整合方法 `startAgent()`
4. ✅ Agent 实际上通过 adapter 与 EventBus 解耦

**影响**: 低。虽然接口不同，但通过 adapter 实现了相同的解耦效果，甚至更灵活（Agent 可选择不使用 EventBus）。

---

### ✅ Phase 4: 消息协议化 (100%)

#### 文档要求
```typescript
export interface Message {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    sourceTabId: string;      // ✅ 必填
    timestamp: number;         // ✅ 必填
    reasoning?: string;
    isBoxed?: boolean;
}
```

#### 实际实现
```typescript
// packages/core/types/Message.ts
export interface Message {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    sourceTabId: string;     // ✅ 必填
    timestamp: number;        // ✅ 必填
    reasoning?: string;
    isBoxed?: boolean;
    isPending?: boolean;      // ✅ 额外字段（流式消息）
}
```

**差异说明**:
1. ✅ 完全符合文档要求
2. ✅ 新增 `isPending` 字段用于流式消息标记（合理扩展）

**MessageStore 实现**:
```typescript
// packages/cli/store/MessageStore.ts
export class MessageStore {
    private tabMessages: Map<string, TabMessages>;  // ✅ 按 Tab 分区
    private currentTabId: string;
    
    appendMessage(tabId: string, message: Message): void {
        // ✅ 强制包含 sourceTabId
        // ✅ 不可见 Tab 限制消息数量
    }
    
    setCurrentTab(tabId: string): void {
        // ✅ 切换时添加分隔线
        // ✅ 触发消息裁剪
    }
}
```

**影响**: 无。完全符合文档要求。

---

### ✅ Phase 5: Tab 配置分离 (95%)

#### 文档要求
```typescript
export interface TabConfig {
    id: string;
    label: string;
    type: 'chat' | 'agent';  // 简化为两种
    agentId?: string;         // 固定绑定
    requiresSession: boolean;
    executionMode: 'foreground' | 'background';
    maxFrozenMessages?: number;  // 默认 20
}
```

#### 实际实现
```typescript
// packages/tabs/types.ts
export interface TabConfig {
    id: string;
    label: string;
    type: TabType;  // 'chat' | 'agent'  ✅
    agentId: string | null;   // ⚠️ null 而非可选
    description: string;
    requiresSession: boolean;
    executionMode?: ExecutionMode;  // 'foreground' | 'background'  ✅
    maxFrozenMessages?: number;
    isPlaceholder?: boolean;
    cliFlag?: string;         // ✅ 额外字段（CLI 集成）
    slashCommand?: string;    // ✅ 额外字段（命令集成）
}
```

**TabRegistry 实现**:
```typescript
// packages/tabs/TabRegistry.ts
export class TabRegistry {
    register(config: TabConfig): void
    get(id: string): TabConfig | undefined
    getAll(): TabConfig[]
    getByType(type: TabConfig['type']): TabConfig[]
    getByCliFlag(flag: string): TabConfig | undefined
    getBySlashCommand(command: string): TabConfig | undefined
}
```

**Tab 配置示例**:
```typescript
// packages/tabs/configs/story.ts
export const storyTabConfig: TabConfig = {
    id: 'Story',
    label: 'Story',
    type: 'agent',
    agentId: 'story',
    description: 'Story orchestration · Review and document user stories',
    requiresSession: true,
    executionMode: 'foreground',
    maxFrozenMessages: 20,
    isPlaceholder: false,
    cliFlag: '--build-specs',
};
```

**差异说明**:
1. ✅ Tab 类型简化为 `'chat' | 'agent'`
2. ✅ TabRegistry 实现完整且功能丰富
3. ✅ 所有 Tab 配置已迁移（chat, agent, story, glossary, ui-review, monitor）
4. ⚠️ `agentId` 类型是 `string | null` 而非 `string | undefined`（小差异）
5. ✅ 额外的 `cliFlag` 和 `slashCommand` 字段提升集成便利性

**影响**: 极低。实现比文档更完善。

---

### ❌ Phase 6: Execution 协调层 (0%)

#### 文档要求

**目录结构**:
```
packages/execution/
├── MessageAdapter.ts
├── TabExecutor.ts
└── TabExecutionManager.ts
```

**核心类**:
```typescript
// MessageAdapter - Event-Driven
export class MessageAdapter {
    constructor(tabId: string, agentId: string, eventBus: EventBus)
    createSinks(): AgentSinks
}

// TabExecutionManager - 并发控制
export class TabExecutionManager {
    execute(tabId, agentId, userInput, executor): Promise<void>
    isIdle(tabId: string): boolean
    getState(tabId: string): TabExecutionState
}

// TabExecutor - 协调器
export class TabExecutor {
    execute(tabId, agentId, userInput, context): Promise<void>
}
```

#### 实际实现

**❌ `packages/execution/` 目录不存在**

**当前实现方式**:
```typescript
// packages/cli/main.tsx 中直接处理
const App = () => {
    // ❌ CLI 直接管理 Agent 执行，未使用 TabExecutor
    const startAgentPrompt = useCallback(async (job: AgentPromptJob) => {
        // ❌ 直接调用 agentFlow.handleUserInput()
        await activeAgentFlow.handleUserInput({
            prompt,
            agentSessionId: sessionId,
            sessionInitialized: agentSessionInitializedRef.current,
            ...overrides,
        });
    }, []);
    
    // ❌ 并发控制在 UI 层实现（agentPendingQueue）
    // ❌ 没有独立的 TabExecutionManager
};
```

**替代实现**:
- ✅ `packages/agents/runtime/eventBusAdapter.ts` 提供了类似 MessageAdapter 的功能
- ✅ `AgentRegistry.startAgent()` 提供了部分 TabExecutor 功能
- ❌ 没有独立的 TabExecutionManager（并发控制在 UI 层）
- ❌ 没有统一的 Execution 层，Agent 执行逻辑分散在 CLI 和 Driver 中

**差异说明**:
1. ❌ **完全缺失独立的 Execution 层**
2. ⚠️ Agent 执行逻辑与 UI 耦合（在 `main.tsx` 中）
3. ⚠️ 并发控制由 UI 状态管理（`agentPendingQueue`），而非独立的 Manager
4. ⚠️ Tab 级别的状态管理缺失（Session、执行状态等）

**影响**: 高。这是架构解耦的关键层，缺失导致：
- Agent 执行与 UI 耦合
- 难以支持多 UI（Web/VSCode）
- Session 管理分散
- 并发控制不统一

---

### ❌ Phase 7: 多入口支持 (0%)

#### 文档要求

**目录结构**:
```
packages/presets/
├── default.ts
├── monitor.ts
└── types.ts
```

**Preset 配置**:
```typescript
export interface PresetConfig {
    name: string;
    tabs: string[];
    agents: string[];
    defaultTab: string;
    theme?: ThemeConfig;
}

// default preset
export const defaultPreset: PresetConfig = {
    name: 'default',
    tabs: ['chat', 'agent', 'story', 'glossary', 'ui-review', 'monitor'],
    agents: ['story', 'glossary', 'ui-review', 'monitor'],
    defaultTab: 'chat',
};

// monitor preset
export const monitorPreset: PresetConfig = {
    name: 'monitor',
    tabs: ['monitor'],
    agents: ['monitor', 'log-monitor'],
    defaultTab: 'monitor',
};
```

**CLI 入口**:
```bash
taskagent                    # 默认模式
taskagent --preset monitor   # Monitor 模式
taskagent-monitor            # Monitor 别名
```

#### 实际实现

**❌ `packages/presets/` 目录不存在**

**当前实现方式**:
```typescript
// packages/cli/main.tsx
const tabRegistry = getGlobalTabRegistry();

// ❌ 硬编码注册所有 Tab（没有 preset）
tabRegistry.register(chatTabConfig);
tabRegistry.register(agentTabConfig);
tabRegistry.register(storyTabConfig);
tabRegistry.register(glossaryTabConfig);
tabRegistry.register(uiReviewTabConfig);
tabRegistry.register(monitorTabConfig);

// ❌ 没有 --preset 参数
// ❌ 没有 taskagent-monitor 别名
```

**差异说明**:
1. ❌ **完全缺失 Preset 系统**
2. ❌ 所有 Tab 总是加载（无法按需加载）
3. ❌ 不支持 `--preset` 参数
4. ❌ 没有 Monitor 模式专用入口
5. ❌ 无法同时运行不同预设的实例

**影响**: 中。当前功能可用，但缺少：
- 专用入口（如 Monitor 模式）
- 按需加载（性能优化）
- 灵活配置（不同团队需求）

---

## 架构对比

### 文档目标架构（Phase 6-7 完成后）

```
┌─────────────────────────────────────────────────┐
│            CLI 入口层（Ink UI）                  │
│  - Preset 选择                                   │
│  - EventBus 订阅                                │
└────────────────┬────────────────────────────────┘
                 │ Event Bus
                 │ (解耦桥梁)
┌────────────────▼────────────────────────────────┐
│           Execution 执行层                       │
│  - TabExecutor (协调)                           │
│  - MessageAdapter (Event 发送)                  │
│  - TabExecutionManager (并发控制)               │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│            Agents 业务层                        │
│  - Story / Glossary / Monitor / UI              │
│  - 完全不知道 UI 存在                           │
│  - 只通过 Event Bus 发送事件                    │
└─────────────────────────────────────────────────┘
```

### 当前实际架构

```
┌─────────────────────────────────────────────────┐
│            CLI 入口层（Ink UI）                  │
│  - 硬编码所有 Tab                               │
│  - 直接调用 Agent                               │
│  - UI 管理并发控制                              │
└────────────────┬────────────────────────────────┘
                 │ 直接调用
                 │ (部分通过 EventBus)
┌────────────────▼────────────────────────────────┐
│            Agents 业务层                        │
│  - Story / Glossary / Monitor / UI              │
│  - 通过 EventBusAdapter 发送事件                │
│  - AgentRegistry 管理                           │
└─────────────────────────────────────────────────┘

⚠️ 缺失 Execution 协调层
⚠️ CLI 与 Agent 部分耦合
```

**关键差异**:
1. ❌ 缺少独立的 Execution 协调层
2. ⚠️ 并发控制在 UI 层而非 Execution 层
3. ⚠️ Session 管理分散（UI + Agent）
4. ✅ EventBus 基础设施已建立
5. ✅ Agent 通过 adapter 部分解耦

---

## 实现细节差异

### 1. 命令系统

#### 文档要求
```typescript
// 全局命令，任何 Tab 都可用
- Tab键 / Shift+Tab - 切换 Tab
- 数字键 - 快速切换
- /fg:<agent-id> <prompt> - 前台执行指定 Agent
- /bg:<agent-id> <prompt> - 后台执行指定 Agent（fork session）
```

#### 实际实现
```typescript
// packages/cli/drivers/registry.ts
// ✅ /fg: 命令存在
const fgEntries: BackgroundTaskDriverEntry[] = [...];

// ✅ /bg: 命令存在
const bgEntries: BackgroundTaskDriverEntry[] = [...];

// ⚠️ 实现方式不同：基于老的 Driver 系统，而非新的 Tab+Agent 架构
async (message: Message, context: DriverRuntimeContext) => {
    const agent = await spec.createAgent();
    // ⚠️ 使用 context.startBackground() 而非 TabExecutor
    const result = (context as any).startBackground(agent, prompt, {
        sourceTabId: ...,
        forkSession: true
    });
};
```

**差异说明**:
- ✅ 命令存在且功能可用
- ⚠️ 实现基于老的 Driver 系统
- ⚠️ 未使用新的 TabExecutor 架构
- ⚠️ Session fork 逻辑分散

### 2. Session 管理

#### 文档要求
```typescript
// 全局 Session 共享
Story Tab: session_id = "abc123"
Glossary Tab: session_id = "abc123"  // 共享

// 后台任务 Fork Session
/bg:monitor: session_id = "abc123_fork_001"  // fork 自 abc123
```

#### 实际实现
```typescript
// packages/cli/main.tsx
const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
const agentSessionInitializedRef = useRef(false);

// ⚠️ Session 存储在 UI 状态中
// ⚠️ 没有明确的 Session 管理器
// ⚠️ Fork session 逻辑分散在 Driver 中

// packages/cli/drivers/registry.ts
// ⚠️ Fork session 在 /bg 命令中处理
const result = (context as any).startBackground(agent, prompt, {
    session: (context as any).session,
    forkSession: true  // ✅ 支持 fork，但逻辑不统一
});
```

**差异说明**:
- ⚠️ Session 管理分散（UI + Driver）
- ⚠️ 没有统一的 Session 管理器
- ✅ 支持 fork session，但实现不统一
- ⚠️ Session 存储在内存（UI state），符合文档要求，但管理不清晰

### 3. AI Runtime 双 SDK 架构

#### 文档要求
```typescript
// Chat 模式（Vercel AI SDK）
import { streamText } from 'ai';

// Agent 模式（Claude Agent SDK）
import { query } from '@anthropic-ai/claude-agent-sdk';
```

#### 实际实现
```typescript
// packages/agents/runtime/flows/baseClaudeFlow.ts
import { query } from '@anthropic-ai/claude-agent-sdk';

// ✅ Claude Agent SDK 已集成
export async function createBaseClaudeFlow(/* ... */) {
    // ...
    const result = query({
        prompt,
        options: { /* ... */ }
    });
    // ...
}

// ⚠️ Vercel AI SDK 仅用于简单场景，未形成独立的 Chat flow
```

**差异说明**:
- ✅ Claude Agent SDK 已完整集成
- ⚠️ Vercel AI SDK 未形成独立的 "Chat 模式"
- ⚠️ 两种 SDK 的切换逻辑不明确
- ⚠️ Chat tab 仍使用 Agent SDK 而非 Vercel SDK

---

## 缺失功能清单

### 高优先级（影响架构解耦）

1. **Execution 协调层** ❌
   - `packages/execution/MessageAdapter.ts`
   - `packages/execution/TabExecutor.ts`
   - `packages/execution/TabExecutionManager.ts`
   - 影响：Agent 与 UI 耦合

2. **Session 管理统一化** ⚠️
   - 独立的 Session Manager
   - 统一的 fork 逻辑
   - 影响：Session 状态管理混乱

3. **Tab 级并发控制** ⚠️
   - TabExecutionState
   - 每个 Tab 独立的执行队列
   - 影响：并发控制在 UI 层

### 中优先级（影响功能扩展）

4. **Preset 系统** ❌
   - `packages/presets/default.ts`
   - `packages/presets/monitor.ts`
   - `packages/presets/types.ts`
   - 影响：无法按需加载，无专用入口

5. **命令系统重构** ⚠️
   - 基于 TabExecutor 的 `/fg` 和 `/bg` 命令
   - 统一的命令处理流程
   - 影响：当前基于老系统，不够统一

6. **AI Runtime 分离** ⚠️
   - Vercel AI SDK 独立 Chat flow
   - 与 Claude Agent SDK 清晰分工
   - 影响：架构不够清晰

### 低优先级（文档与实现不一致）

7. **EventBus 通配符** ⚠️
   - 文档说不支持，实际支持 `'*'`
   - 影响：文档与实现不一致

8. **agentId 类型** ⚠️
   - 文档：`agentId?: string`
   - 实现：`agentId: string | null`
   - 影响：极低，语义相同

---

## 测试验收状态

### 功能测试（Phase 0）

| 测试 | 文档要求 | 实际状态 |
|-----|---------|---------|
| `yarn test:ci` | ✅ 通过 | ✅ 存在且可运行 |
| `yarn test:story` | ✅ 通过 | ✅ 存在且可运行 |
| `yarn test:glossary` | ✅ 通过 | ✅ 存在且可运行 |
| `yarn e2e:experiment` | ✅ 通过 | ✅ 存在且可运行 |

### 架构验收（Phase 6-7）

| 验收项 | 文档要求 | 实际状态 |
|-------|---------|---------|
| Agent 完全解耦 UI | ✅ 只依赖 EventBus | ⚠️ 部分通过 EventBusAdapter，部分直接调用 |
| Tab 和 Agent 松耦合 | ✅ 通过 ID 引用 | ✅ TabRegistry + AgentRegistry 实现 |
| 消息按 Tab 隔离 | ✅ 按 sourceTabId 存储 | ✅ MessageStore 已实现 |
| Tab 级并发控制 | ✅ TabExecutionManager | ❌ UI 层实现，无独立 Manager |
| 两个入口同时运行 | ✅ default + monitor | ❌ 无 Preset 系统 |

---

## 修复建议

### 短期（1-2 周）：完成 Phase 6

**目标**: 建立 Execution 协调层，实现 Agent 与 UI 完全解耦

**步骤**:
1. 创建 `packages/execution/`
   ```bash
   mkdir -p packages/execution
   touch packages/execution/MessageAdapter.ts
   touch packages/execution/TabExecutor.ts
   touch packages/execution/TabExecutionManager.ts
   touch packages/execution/package.json
   ```

2. 实现 MessageAdapter（基于现有 EventBusAdapter）
   ```typescript
   // 直接使用或重命名 eventBusAdapter.ts
   export class MessageAdapter {
       constructor(tabId: string, agentId: string, eventBus: EventBus);
       createSinks(): AgentStartSinks;
   }
   ```

3. 实现 TabExecutionManager（提取 CLI 中的并发控制逻辑）
   ```typescript
   export class TabExecutionManager {
       private tabStates: Map<string, TabExecutionState>;
       execute(tabId, agentId, userInput, executor): Promise<void>;
       isIdle(tabId: string): boolean;
   }
   ```

4. 实现 TabExecutor（整合 AgentRegistry + MessageAdapter）
   ```typescript
   export class TabExecutor {
       constructor(
           private tabExecManager: TabExecutionManager,
           private agentRegistry: AgentRegistry,
           private eventBus: EventBus
       );
       execute(tabId, agentId, userInput, context): Promise<void>;
   }
   ```

5. 重构 CLI main.tsx
   ```typescript
   const tabExecutor = useMemo(() => 
       new TabExecutor(tabExecManager, agentRegistry, eventBus), 
       []
   );
   
   const handleSubmit = useCallback(async (userInput: string) => {
       const tabConfig = tabRegistry.get(selectedTab);
       await tabExecutor.execute(
           selectedTab,
           tabConfig.agentId!,
           userInput,
           { workspacePath, session }
       );
   }, [selectedTab]);
   ```

**验收**:
- [ ] `packages/execution/` 创建完成
- [ ] Agent 执行完全通过 TabExecutor
- [ ] CLI 不再直接调用 Agent
- [ ] 所有测试通过

---

### 中期（3-4 周）：完成 Phase 7

**目标**: 支持多入口（default + monitor preset）

**步骤**:
1. 创建 `packages/presets/`
   ```typescript
   // packages/presets/types.ts
   export interface PresetConfig {
       name: string;
       tabs: string[];
       agents: string[];
       defaultTab: string;
       theme?: ThemeConfig;
   }
   
   // packages/presets/default.ts
   export const defaultPreset: PresetConfig = {
       name: 'default',
       tabs: ['chat', 'agent', 'story', 'glossary', 'ui-review', 'monitor'],
       agents: ['story', 'glossary', 'ui-review', 'monitor'],
       defaultTab: 'chat',
   };
   
   // packages/presets/monitor.ts
   export const monitorPreset: PresetConfig = {
       name: 'monitor',
       tabs: ['monitor'],
       agents: ['monitor', 'log-monitor'],
       defaultTab: 'monitor',
   };
   ```

2. CLI 支持 `--preset` 参数
   ```typescript
   // packages/cli/main.tsx
   const args = minimist(process.argv.slice(2));
   const presetName = args.preset || 'default';
   const preset = presets[presetName];
   
   // 根据 preset 动态注册 Tab
   preset.tabs.forEach(tabId => {
       const config = getTabConfig(tabId);
       tabRegistry.register(config);
   });
   ```

3. 创建 Monitor 入口别名
   ```javascript
   // scripts/create-aliases.js
   const wrapper = `#!/usr/bin/env node
   process.argv.push('--preset', 'monitor');
   require('./main.js');
   `;
   fs.writeFileSync('dist/main-monitor.js', wrapper);
   ```

4. 更新 package.json
   ```json
   {
     "bin": {
       "taskagent": "dist/packages/cli/main.js",
       "taskagent-monitor": "dist/main-monitor.js"
     }
   }
   ```

**验收**:
- [ ] `packages/presets/` 创建完成
- [ ] `taskagent` 和 `taskagent-monitor` 别名工作
- [ ] Monitor 模式只显示 Monitor tab
- [ ] 两个窗口可同时运行不同预设

---

### 长期：架构优化

1. **EventBus 通配符处理**
   - 决策：保留还是移除
   - 如保留：更新文档说明
   - 如移除：删除 `'*'` 相关代码

2. **Session 管理统一化**
   - 创建独立的 SessionManager
   - 统一 fork session 逻辑
   - 从 UI 状态中分离

3. **AI Runtime 清晰分离**
   - Chat 模式完全使用 Vercel AI SDK
   - Agent 模式完全使用 Claude Agent SDK
   - 在 TabConfig 中明确声明使用哪个 SDK

4. **命令系统重构**
   - 移除老的 Driver 系统
   - 基于 TabExecutor 重写 `/fg` 和 `/bg` 命令
   - 统一命令处理流程

---

## 风险评估

### 技术风险

1. **Execution 层引入复杂度** - 中等
   - 风险：新增抽象层可能引入 bug
   - 缓解：充分测试，渐进迁移

2. **Preset 系统兼容性** - 低
   - 风险：现有用户习惯改变
   - 缓解：默认 preset 保持当前行为

3. **Session 管理重构** - 高
   - 风险：Session 状态丢失或混乱
   - 缓解：先建立测试，再重构

### 进度风险

1. **Phase 6 工作量** - 中等
   - 预计：1-2 周
   - 实际可能：2-3 周（考虑调试）

2. **Phase 7 工作量** - 低
   - 预计：1 周
   - 实际可能：1-2 周（考虑 CLI 集成）

---

## 总结

### 已完成（值得肯定）

1. ✅ Monorepo 结构建立（Phase 1）
2. ✅ Event Bus 基础设施（Phase 2，虽有小差异）
3. ✅ Agent 统一化和 EventBusAdapter（Phase 3）
4. ✅ Message 协议化和 MessageStore（Phase 4）
5. ✅ Tab 配置分离和 TabRegistry（Phase 5）

### 待完成（关键缺失）

1. ❌ Execution 协调层（Phase 6）- 影响架构解耦
2. ❌ Preset 系统（Phase 7）- 影响功能扩展
3. ⚠️ Session 管理统一化 - 影响状态管理
4. ⚠️ 命令系统重构 - 影响代码一致性

### 关键建议

**优先级 1: 完成 Phase 6**
- 这是架构解耦的核心，必须完成
- 预计 2-3 周

**优先级 2: 完成 Phase 7**
- 实现多入口支持
- 预计 1-2 周

**优先级 3: 文档更新**
- 将实际实现差异同步到文档
- 或将实现向文档对齐

**总评**: 项目已完成约 60% 的重构工作，核心基础设施已建立。但缺少关键的 Execution 协调层，导致 Agent 与 UI 仍有耦合。建议优先完成 Phase 6-7，实现完整的架构解耦。

---

**生成时间**: 2025-11-04 19:00  
**分析工具**: 代码检查 + 文档对比  
**下一步**: 根据修复建议开始 Phase 6 实现

