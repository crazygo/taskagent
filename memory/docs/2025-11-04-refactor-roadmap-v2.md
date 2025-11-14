# TaskAgent 重构路线图 v2.0

**日期**: 2025-11-04  
**架构**: Monorepo + Event Bus + 单包多入口  
**目标**: 清晰边界、松耦合、可扩展  

---

## 架构蓝图（终态）

### 目录结构

```
taskagent/
├── packages/
│   ├── core/                    # 核心协议层
│   │   ├── types/
│   │   │   ├── AgentEvent.ts
│   │   │   ├── ScreenMessage.ts
│   │   │   └── TaskRequest.ts
│   │   ├── schemas/             # zod 边界校验
│   │   │   ├── message.schema.ts
│   │   │   └── event.schema.ts
│   │   ├── event-bus/
│   │   │   ├── EventBus.ts
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── agents/                  # Agent 统一收口（含 AI SDK 封装）
│   │   ├── runtime/             # AI SDK 集成层
│   │   │   ├── runClaudeStream.ts     # Claude Agent SDK
│   │   │   ├── buildPromptAgentStart.ts
│   │   │   ├── flows/
│   │   │   │   └── baseClaudeFlow.ts  # Chat flow (Vercel SDK)
│   │   │   └── types.ts
│   │   ├── registry/
│   │   │   └── AgentRegistry.ts
│   │   ├── base/
│   │   │   └── PromptAgent.ts
│   │   ├── story/
│   │   │   ├── index.ts
│   │   │   ├── coordinator.agent.md
│   │   │   └── agents/*.agent.md
│   │   ├── glossary/
│   │   ├── monitor/
│   │   ├── ui-review/
│   │   └── package.json
│   │
│   ├── execution/               # 执行协调层
│   │   ├── TabExecutor.ts
│   │   ├── MessageAdapter.ts   # Event Bus 适配
│   │   ├── TabExecutionManager.ts
│   │   └── package.json
│   │
│   ├── tabs/                    # Tab 配置层
│   │   ├── registry.ts
│   │   ├── types.ts
│   │   └── configs/
│   │       ├── story.ts
│   │       ├── glossary.ts
│   │       └── monitor.ts
│   │
│   ├── presets/                 # 入口预设配置
│   │   ├── default.ts           # 默认模式（全功能）
│   │   └── monitor.ts           # Monitor 模式（只有监控）
│   │
│   └── cli/                     # CLI 入口（唯一打包产物）
│       ├── main.ts
│       ├── components/
│       │   ├── Screen.tsx
│       │   ├── MessageRenderer.tsx
│       │   └── TabBar.tsx
│       ├── store/
│       │   └── messageStore.ts
│       └── package.json
│
└── package.json                 # 根配置（含 workspaces 字段）
```

### 架构分层

```
┌─────────────────────────────────────────────────┐
│            CLI 入口层（Ink UI）                  │
│  - Screen (统一渲染)                            │
│  - MessageStore (UI state)                      │
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
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│          AI Runtime 集成层                      │
│  ┌──────────────────┬──────────────────┐        │
│  │  Claude Agent    │   Vercel AI SDK  │        │
│  │  - Agent 模式    │   - Chat 模式    │        │
│  │  - Tool calling  │   - 简单对话     │        │
│  │  - Session 管理  │   - 流式输出     │        │
│  └──────────────────┴──────────────────┘        │
└─────────────────────────────────────────────────┘
```

### 两种 AI 能力对比

TaskAgent 支持两种不同的 AI 交互模式，使用不同的底层 SDK：

#### 1️⃣ Chat 模式（Vercel AI SDK）

**适用场景**: 
- 简单对话交互
- 快速响应用户问题
- 不需要工具调用

**技术栈**:
- SDK: `@vercel/ai-sdk` (原 `ai` package)
- 模型: OpenRouter API（兼容 OpenAI 格式）
- 实现: `packages/ai-runtime/vercel/createChatFlow.ts`

**特点**:
- ✅ 简单快速
- ✅ 流式输出
- ✅ 低延迟
- ❌ 无工具调用
- ❌ 无 Session 管理

**代码示例**:
```typescript
// packages/ai-runtime/vercel/createChatFlow.ts
import { streamText } from 'ai';

export async function runChatStream(prompt: string) {
    const result = await streamText({
        model: openai(process.env.OPENROUTER_MODEL_NAME),
        prompt
    });
    
    for await (const chunk of result.textStream) {
        yield chunk;
    }
}
```

---

#### 2️⃣ Agent 模式（Claude Agent SDK）

**适用场景**:
- 需要工具调用（文件操作、代码搜索等）
- 复杂任务编排（多步骤、多 Agent 协作）
- 需要保留上下文（Session 管理）

**技术栈**:
- SDK: `@anthropic-ai/claude-agent-sdk`
- 模型: Claude Sonnet 4.5
- 实现: `packages/ai-runtime/claude/runClaudeStream.ts`

**特点**:
- ✅ 强大工具调用能力
- ✅ Session 管理（new/resume/fork）
- ✅ 多 Agent 协作（Coordinator 模式）
- ✅ 详细日志和监控
- ⚠️ 略高延迟（工具调用开销）

**代码示例**:
```typescript
// packages/ai-runtime/claude/runClaudeStream.ts
import { query } from '@anthropic-ai/claude-agent-sdk';

export async function runClaudeStream({ prompt, session, queryOptions }) {
    const result = query({
        prompt,
        options: {
            model: 'claude-sonnet-4.5',
            resume: session.initialized ? session.id : undefined,
            agents: queryOptions.agents,  // Sub-agents
            systemPrompt: queryOptions.systemPrompt,
            canUseTool: queryOptions.canUseTool
        }
    });
    
    for await (const message of result) {
        // 处理 assistant/tool/user/system 事件
        yield message;
    }
}
```

---

#### 对比表格

| 维度 | Chat 模式 | Agent 模式 |
|-----|---------|-----------|
| **底层 SDK** | Vercel AI SDK | Claude Agent SDK |
| **适用 Tab** | Chat | Story, Glossary, Monitor, UI Review |
| **工具调用** | ❌ | ✅ |
| **Session 管理** | ❌ | ✅ (new/resume/fork) |
| **多 Agent 协作** | ❌ | ✅ (Coordinator 模式) |
| **响应速度** | 快 | 中等（工具调用开销） |
| **复杂度** | 低 | 高 |
| **典型用例** | 快速问答 | 代码分析、文档生成、任务编排 |

---

### 数据流

```
用户输入 "整理需求" (Story Tab)
  ↓
CLI: handleSubmit()
  ↓
TabExecutor.execute('story', 'story', '整理需求')
  ↓
检查并发状态 → 创建 StoryAgent 实例
  ↓
MessageAdapter 包装 Agent sinks
  ↓
agent.start() → 输出通过 sinks
  ↓
MessageAdapter.onText() → eventBus.emit('agent:text', {...})
  ↓
CLI 订阅事件 → messageStore.appendMessage()
  ↓
Screen 过滤渲染 → 只显示当前 Tab 的消息
```

### 入口配置

```typescript
// packages/presets/default.ts
export const defaultPreset = {
    tabs: ['chat', 'agent', 'story', 'glossary', 'ui-review', 'monitor'],
    agents: ['story', 'glossary', 'ui-review', 'monitor'],
    defaultTab: 'chat'
};

// packages/presets/monitor.ts
export const monitorPreset = {
    tabs: ['monitor'],
    agents: ['monitor', 'log-monitor'],
    defaultTab: 'monitor',
    theme: { primary: 'red', mode: 'focus' }
};
```

### 运行方式

```bash
# 默认模式（全功能）
taskagent
# 或
taskagent --preset default

# Monitor 模式
taskagent --preset monitor
# 或
taskagent-monitor  # alias
```

---

### 命令系统

#### 全局命令（与当前保持一致）

命令系统是全局的，在任何 Tab 都可以使用：

**Tab 切换命令**:
- Tab键 / Shift+Tab - 切换 Tab
- 数字键 - 快速切换到对应 Tab

**Agent 执行命令**:
- `/fg:<agent-id> <prompt>` - 前台执行指定 Agent（单次，不改变默认绑定）
  ```bash
  # 在 Story tab 临时使用 Glossary Agent
  /fg:glossary "查找术语 'BDD'"
  ```

- `/bg:<agent-id> <prompt>` - 后台执行指定 Agent（fork session，渲染到小区域）
  ```bash
  # 后台运行 Monitor，不影响当前 Tab
  /bg:monitor "监控 debug.log"
  ```

**其他全局命令**:
- `/help` - 显示帮助
- `/version` - 显示版本
- `/quit` - 退出应用

#### Tab 绑定规则

- **固定绑定**: 每个 Tab 默认绑定一个 Agent（如 Story Tab → Story Agent）
- **临时切换**: 使用 `/fg:<agent-id>` 可以单次使用其他 Agent，不改变默认绑定
- **无命令输入**: 直接输入文本，使用当前 Tab 的默认 Agent

---

### Session 管理策略

#### Session 共享与隔离

**全局 Session**:
- 默认情况下，所有前台 Tab 共享同一个 Session
- Session 保存在内存中（`TabExecutionState`），重启丢失
- 优先复用，保持上下文连续性

**Fork Session（后台任务）**:
- 使用 `/bg:agent` 命令时，fork 当前 Session
- 后台任务使用独立的 Session ID（bgtask 专有）
- 外层保持原有 Session ID 不变

**示例**:
```typescript
// 前台 Tab：共享 Session
Story Tab: session_id = "abc123"
Glossary Tab: session_id = "abc123"  // 共享

// 后台任务：fork Session
/bg:monitor: session_id = "abc123_fork_001"  // fork 自 abc123
```

---

## Phase 0: 准备阶段

**目标**: 建立功能测试基准

### 关键产出

1. **测试基准确认**
   ```bash
   yarn test:ci              # 确保通过
   yarn test:story           # Story 功能测试
   yarn test:glossary        # Glossary 功能测试
   yarn e2e:experiment       # E2E 功能测试
   ```

2. **测试快照**
   - 记录所有测试的通过状态
   - 作为重构后的验收基准

### 验收标准

- [ ] 所有现有测试通过
- [ ] 测试快照已记录

**时间**: 1 天

---

## Phase 1: Monorepo 重组

**目标**: 代码按 package 重组，建立清晰边界

### 目录变化

```
Before (单体):
src/
├── agents/log-monitor/
├── drivers/story/agent.ts
├── drivers/glossary/agent.ts
├── components/
└── domain/

After (Monorepo):
packages/
├── core/               # 新建
├── agents/             # 迁移 + 合并
│   ├── runtime/        # 从 src/agent/runtime 迁移（Claude SDK 封装）
│   ├── story/          # 从 src/drivers/story 迁移
│   ├── glossary/       # 从 src/drivers/glossary 迁移
│   └── monitor/        # 从 src/agents/log-monitor 迁移
├── execution/          # 新建（暂空）
├── tabs/               # 新建（暂空）
└── cli/                # 迁移 src/components + ui.tsx
```

### 关键步骤

1. **初始化 Monorepo**
   ```json
   // 在根目录 package.json 中添加 workspaces 配置
   {
     "workspaces": [
       "packages/*"
     ]
   }
   ```

2. **创建 packages/core**
   ```typescript
   // packages/core/types/Message.ts
   export interface Message {
       id: number;
       role: 'user' | 'assistant' | 'system';
       content: string;
       sourceTabId: string;     // 必填
       timestamp: number;        // 必填
       reasoning?: string;
       isBoxed?: boolean;
   }
   ```

3. **迁移 Agents 和 Runtime**
   ```bash
   # 迁移 Claude Agent SDK 封装
   mv src/agent/runtime packages/agents/runtime
   mv src/agent/flows packages/agents/runtime/flows
   
   # 迁移 Agent 实现
   mv src/drivers/story packages/agents/story
   mv src/drivers/glossary packages/agents/glossary
   mv src/agents/log-monitor packages/agents/monitor
   ```

4. **更新 package.json**
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
   ```

5. **迁移 CLI**
   ```bash
   mv src/components packages/cli/components
   mv ui.tsx packages/cli/main.tsx
   ```

### 验收标准

- [ ] Monorepo 结构创建完成
- [ ] 所有代码迁移到 packages/
- [ ] yarn install 成功（Yarn workspace 配置正确）
- [ ] 原有测试通过（路径更新后）
- [ ] 启动测试通过: `yarn start:test`

**时间**: 2-3 天

---

## Phase 2: Event Bus 引入

**目标**: 建立 Event Bus 基础设施

### 新增文件

```
packages/core/
├── event-bus/
│   ├── EventBus.ts
│   ├── types.ts
│   └── events.ts
└── schemas/
    ├── agent-event.schema.ts
    └── message.schema.ts
```

### 核心实现

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

```typescript
// packages/core/event-bus/EventBus.ts
import { EventEmitter } from 'events';
import type { AgentEvent } from './types';

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
    
    off(type: AgentEventType, handler: (event: AgentEvent) => void): void {
        this.emitter.off(type, handler);
    }
}
```

```typescript
// packages/core/schemas/agent-event.schema.ts
import { z } from 'zod';

export const AgentEventSchema = z.object({
    type: z.enum(['agent:text', 'agent:reasoning', 'agent:event', 'agent:completed', 'agent:failed']),
    agentId: z.string(),
    tabId: z.string(),
    timestamp: z.number(),
    payload: z.unknown(),
    version: z.literal('1.0')
});
```

### 集成到 CLI

```typescript
// packages/cli/main.tsx
import { EventBus } from '@taskagent/core/event-bus';

const App = () => {
    const eventBus = useMemo(() => new EventBus(), []);
    
    // 订阅事件
    useEffect(() => {
        eventBus.on('agent:text', (event) => {
            messageStore.appendMessage(event.tabId, {
                id: nextId(),
                role: 'assistant',
                content: event.payload.chunk,
                sourceTabId: event.tabId
            });
        });
    }, [eventBus]);
    
    // ... 其他逻辑
};
```

### 验收标准

- [ ] EventBus 实现完成
- [ ] Schema 校验工作
- [ ] CLI 集成 EventBus
- [ ] 事件订阅测试通过
- [ ] 所有测试通过

**时间**: 2 天

---

## Phase 3: Agent 统一化

**目标**: 统一所有 Agent 接口，解耦 UI 依赖

### Agent Registry

```typescript
// packages/agents/registry/AgentRegistry.ts
export class AgentRegistry {
    private factories = new Map<string, AgentFactory>();
    
    register(id: string, factory: AgentFactory): void {
        this.factories.set(id, factory);
    }
    
    create(id: string, eventBus: EventBus): RunnableAgent {
        const factory = this.factories.get(id);
        if (!factory) throw new Error(`Agent not found: ${id}`);
        return factory.create(eventBus);
    }
    
    getAll(): AgentMeta[] {
        return Array.from(this.factories.entries()).map(([id, factory]) => ({
            id,
            label: factory.label,
            description: factory.description
        }));
    }
}

// 全局单例
export const agentRegistry = new AgentRegistry();
```

### Agent 接口标准化

```typescript
// packages/agents/base/PromptAgent.ts
export interface RunnableAgent {
    id: string;
    description: string;
    
    // Agent 只依赖 EventBus
    start(
        userInput: string,
        context: AgentContext,
        eventBus: EventBus
    ): ExecutionHandle;
}

export interface AgentContext {
    sourceTabId: string;
    workspacePath?: string;
    session?: { id: string; initialized: boolean };
}
```

### 重构 Story Agent

```typescript
// packages/agents/story/index.ts
export function createStoryAgent(eventBus: EventBus): RunnableAgent {
    return {
        id: 'story',
        description: 'Story orchestration agent',
        
        async start(userInput, context) {
            const { systemPrompt, agents } = await loadAgentPipelineConfig(__dirname);
            
            // 使用 Claude Agent SDK 执行
            const result = await runClaudeStream({
                prompt: userInput,
                session: context.session ?? { id: crypto.randomUUID(), initialized: false },
                queryOptions: {
                    model: 'claude-sonnet-4.5',
                    cwd: context.workspacePath,
                    canUseTool: context.canUseTool,
                    systemPrompt,
                    agents
                }
            });
            
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
            
            return { cancel: () => {}, sessionId: result.sessionId };
        }
    };
}
```

### 注册所有 Agent

```typescript
// packages/agents/index.ts
import { agentRegistry } from './registry/AgentRegistry';
import { createStoryAgent } from './story';
import { createGlossaryAgent } from './glossary';
import { createLogMonitor } from './monitor';

export function registerAgents(eventBus: EventBus) {
    agentRegistry.register('story', {
        label: 'Story',
        description: 'Story orchestration',
        create: () => createStoryAgent(eventBus)
    });
    
    agentRegistry.register('glossary', {
        label: 'Glossary',
        description: 'Terminology management',
        create: () => createGlossaryAgent(eventBus)
    });
    
    agentRegistry.register('monitor', {
        label: 'Monitor',
        description: 'Log monitoring',
        create: () => createLogMonitor(eventBus, 'debug.log', 100, 30)
    });
}
```

### 验收标准

- [ ] 所有 Agent 在 packages/agents/
- [ ] Agent 只依赖 EventBus（不依赖 UI）
- [ ] AgentRegistry 实现完成
- [ ] Story/Glossary/Monitor 迁移完成
- [ ] 启动测试通过

**时间**: 3 天

---

## Phase 4: 消息协议化

**目标**: 消息增加 sourceTabId，支持按 Tab 隔离

### Message 扩展

```typescript
// packages/core/types/Message.ts
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

### MessageStore 重构

```typescript
// packages/cli/store/messageStore.ts
export class MessageStore {
    private tabMessages = new Map<string, TabMessages>();
    private currentTabId: string;
    
    appendMessage(tabId: string, message: Omit<Message, 'sourceTabId' | 'timestamp'>): void {
        const messages = this.getMessages(tabId);
        
        const fullMessage: Message = {
            ...message,
            sourceTabId: tabId,
            timestamp: Date.now()
        };
        
        messages.frozen.push(fullMessage);
        
        // 不可见 Tab 限制消息数量（默认 20 条，可配置）
        const maxMessages = this.getTabConfig(tabId)?.maxFrozenMessages ?? 20;
        if (tabId !== this.currentTabId && messages.frozen.length > maxMessages) {
            messages.frozen = messages.frozen.slice(-maxMessages);
        }
    }
    
    getVisibleMessages(currentTabId: string): Message[] {
        const { frozen, active } = this.getMessages(currentTabId);
        return [...frozen, ...active];
    }
    
    setCurrentTab(newTabId: string): void {
        if (this.currentTabId !== newTabId) {
            // 切换 Tab 时，批量加载消息到 frozen，并添加分隔线
            const newTabMessages = this.getMessages(newTabId);
            if (newTabMessages.frozen.length > 0) {
                // 添加分隔线消息，标识 Tab 切换
                newTabMessages.frozen.push({
                    id: Date.now(),
                    role: 'system',
                    content: '─'.repeat(50),  // 横线分割
                    sourceTabId: newTabId,
                    timestamp: Date.now()
                });
            }
            this.currentTabId = newTabId;
        }
    }
}

interface TabMessages {
    frozen: Message[];
    active: Message[];
}
```

### CLI 订阅 Event Bus

```typescript
// packages/cli/main.tsx
const App = () => {
    const eventBus = useMemo(() => new EventBus(), []);
    const messageStore = useMemo(() => new MessageStore(), []);
    
    useEffect(() => {
        // 订阅 agent:text 事件
        eventBus.on('agent:text', (event) => {
            messageStore.appendMessage(event.tabId, {
                id: nextMessageId(),
                role: 'assistant',
                content: event.payload.chunk
            });
        });
        
        // 订阅 agent:event 事件
        eventBus.on('agent:event', (event) => {
            const icon = getIcon(event.payload.level);
            messageStore.appendMessage(event.tabId, {
                id: nextMessageId(),
                role: 'system',
                content: `${icon} ${event.payload.message}`,
                isBoxed: event.payload.level === 'error'
            });
        });
    }, [eventBus, messageStore]);
    
    return <Screen selectedTab={selectedTab} messageStore={messageStore} />;
};
```

### 验收标准

- [ ] Message 强制包含 sourceTabId
- [ ] MessageStore 按 Tab 分区存储
- [ ] CLI 正确订阅 Event Bus
- [ ] Tab 切换时消息正确过滤
- [ ] 不可见 Tab 消息限制生效

**时间**: 2 天

---

## Phase 5: Tab 配置分离

**目标**: Tab 配置从 Driver 中分离，成为独立配置层

### Tab 类型定义

```typescript
// packages/tabs/types.ts
export interface TabConfig {
    id: string;
    label: string;
    type: 'chat' | 'agent';  // 简化为两种：chat(Vercel SDK) 和 agent(Claude SDK)
    
    // Agent 绑定（通过 ID 引用，固定绑定）
    agentId?: string;
    
    // 配置
    requiresSession: boolean;
    executionMode: 'foreground' | 'background';  // foreground=主屏幕, background=小区域(fork session)
    maxFrozenMessages?: number;  // 切换回 tab 时保留的消息数，默认 20
}
```

### Tab 配置文件

```typescript
// packages/tabs/configs/story.ts
import type { TabConfig } from '../types';

export const storyTabConfig: TabConfig = {
    id: 'story',
    label: 'Story',
    type: 'agent',              // Agent 类型（使用 Claude SDK）
    agentId: 'story',           // 固定绑定 Story Agent
    requiresSession: true,
    executionMode: 'foreground', // 渲染到主屏幕
    maxFrozenMessages: 20       // 切换回来时保留最近 20 条
};
```

```typescript
// packages/tabs/configs/monitor.ts
export const monitorTabConfig: TabConfig = {
    id: 'monitor',
    label: 'Monitor',
    type: 'agent',
    agentId: 'monitor',
    requiresSession: true,
    executionMode: 'foreground',
    maxFrozenMessages: 100      // Monitor 可能需要更多历史
};
```

### Tab Registry

```typescript
// packages/tabs/registry.ts
export class TabRegistry {
    private tabs = new Map<string, TabConfig>();
    
    register(config: TabConfig): void {
        this.tabs.set(config.id, config);
    }
    
    get(id: string): TabConfig | undefined {
        return this.tabs.get(id);
    }
    
    getTabs(): string[] {
        return Array.from(this.tabs.keys());
    }
}

// 根据预设初始化
export function createTabRegistry(preset: PresetConfig): TabRegistry {
    const registry = new TabRegistry();
    
    preset.tabs.forEach(tabId => {
        const config = getTabConfig(tabId);  // 从 configs/ 加载
        registry.register(config);
    });
    
    return registry;
}
```

### CLI 集成

```typescript
// packages/cli/main.tsx
const App = ({ preset }: { preset: PresetConfig }) => {
    const tabRegistry = useMemo(() => createTabRegistry(preset), [preset]);
    const staticTabs = tabRegistry.getTabs();
    
    // selectedTab 只能在 staticTabs 范围内
    const [selectedTab, setSelectedTab] = useState(preset.defaultTab);
    
    // ...
};
```

### 验收标准

- [ ] packages/tabs/ 创建完成
- [ ] 所有 Tab 配置迁移完成
- [ ] TabRegistry 实现并测试通过
- [ ] CLI 集成 TabRegistry
- [ ] Tab 列表根据预设动态生成

**时间**: 2 天

---

## Phase 6: Execution 协调层

**目标**: 创建 MessageAdapter 和 TabExecutor，实现松耦合执行

### MessageAdapter（Event-Driven）

```typescript
// packages/execution/MessageAdapter.ts
import type { EventBus } from '@taskagent/core/event-bus';

export class MessageAdapter {
    constructor(
        private tabId: string,
        private agentId: string,
        private eventBus: EventBus
    ) {}
    
    // 创建 Agent sinks（包装为 Event 发送）
    createSinks(): AgentSinks {
        return {
            onText: (chunk: string) => {
                this.eventBus.emit({
                    type: 'agent:text',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { chunk },
                    version: '1.0'
                });
            },
            
            onReasoning: (reasoning: string) => {
                this.eventBus.emit({
                    type: 'agent:reasoning',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { reasoning },
                    version: '1.0'
                });
            },
            
            onEvent: (event: TaskEvent) => {
                this.eventBus.emit({
                    type: 'agent:event',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: event,
                    version: '1.0'
                });
            },
            
            onCompleted: (fullText: string) => {
                this.eventBus.emit({
                    type: 'agent:completed',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { fullText },
                    version: '1.0'
                });
            },
            
            onFailed: (error: string) => {
                this.eventBus.emit({
                    type: 'agent:failed',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { error },
                    version: '1.0'
                });
            }
        };
    }
}
```

### TabExecutionManager

```typescript
// packages/execution/TabExecutionManager.ts
export interface TabExecutionState {
    status: 'idle' | 'busy';
    queue: Array<{ agentId: string; userInput: string }>;
    currentExecution: ExecutionHandle | null;
    agentInstance: RunnableAgent | null;
}

export class TabExecutionManager {
    private tabStates = new Map<string, TabExecutionState>();
    
    getState(tabId: string): TabExecutionState {
        if (!this.tabStates.has(tabId)) {
            this.tabStates.set(tabId, {
                status: 'idle',
                queue: [],
                currentExecution: null,
                agentInstance: null
            });
        }
        return this.tabStates.get(tabId)!;
    }
    
    isIdle(tabId: string): boolean {
        return this.getState(tabId).status === 'idle';
    }
    
    async execute(
        tabId: string,
        agentId: string,
        userInput: string,
        executor: ExecutorFn
    ): Promise<void> {
        const state = this.getState(tabId);
        
        if (state.status === 'busy') {
            // 加入队列
            state.queue.push({ agentId, userInput });
            return;
        }
        
        // 立即执行
        await this.executeImmediate(tabId, agentId, userInput, executor);
    }
    
    private async executeImmediate(
        tabId: string,
        agentId: string,
        userInput: string,
        executor: ExecutorFn
    ): Promise<void> {
        const state = this.getState(tabId);
        
        state.status = 'busy';
        
        try {
            await executor(agentId, userInput);
        } finally {
            state.status = 'idle';
            state.agentInstance = null;
            
            // 处理队列
            if (state.queue.length > 0) {
                const next = state.queue.shift()!;
                await this.executeImmediate(tabId, next.agentId, next.userInput, executor);
            }
        }
    }
}
```

### TabExecutor

```typescript
// packages/execution/TabExecutor.ts
export class TabExecutor {
    constructor(
        private tabExecManager: TabExecutionManager,
        private agentRegistry: AgentRegistry,
        private eventBus: EventBus
    ) {}
    
    async execute(
        tabId: string,
        agentId: string,
        userInput: string,
        context: ExecutionContext
    ): Promise<void> {
        await this.tabExecManager.execute(
            tabId,
            agentId,
            userInput,
            async (aid, input) => {
                // 创建 Agent 实例
                const agent = this.agentRegistry.create(aid, this.eventBus);
                
                // 创建 Adapter
                const adapter = new MessageAdapter(tabId, aid, this.eventBus);
                
                // 启动 Agent（无 UI 依赖）
                const handle = agent.start(input, {
                    sourceTabId: tabId,
                    workspacePath: context.workspacePath,
                    session: context.session
                }, adapter.createSinks());
                
                // 等待完成（简化版，实际需要处理异步）
            }
        );
    }
}
```

### CLI 集成

```typescript
// packages/cli/main.tsx
const App = ({ preset }: { preset: PresetConfig }) => {
    const eventBus = useMemo(() => new EventBus(), []);
    const tabExecManager = useMemo(() => new TabExecutionManager(), []);
    const tabExecutor = useMemo(() => 
        new TabExecutor(tabExecManager, agentRegistry, eventBus), 
        []
    );
    
    const handleSubmit = useCallback(async (userInput: string) => {
        const tabConfig = tabRegistry.get(selectedTab);
        
        if (tabConfig?.type === 'agent-driven') {
            await tabExecutor.execute(
                selectedTab,
                tabConfig.agentId!,
                userInput,
                { workspacePath, session }
            );
        }
        // ... 其他模式（chat/agent）
    }, [selectedTab]);
    
    return <Screen selectedTab={selectedTab} messageStore={messageStore} />;
};
```

### 验收标准

- [ ] MessageAdapter 实现完成（Event-Driven）
- [ ] TabExecutionManager 实现完成
- [ ] TabExecutor 实现完成
- [ ] Tab 并发控制测试通过
- [ ] Agent 完全解耦 UI（只依赖 EventBus）
- [ ] 所有测试通过

**时间**: 3 天

---

## Phase 7: 多入口支持

**目标**: 支持不同的入口预设（默认模式 + Monitor 模式）

### Preset 配置

```typescript
// packages/presets/default.ts
import type { PresetConfig } from './types';

export const defaultPreset: PresetConfig = {
    name: 'default',
    tabs: ['chat', 'agent', 'story', 'glossary', 'ui-review', 'monitor'],
    agents: ['story', 'glossary', 'ui-review', 'monitor'],
    defaultTab: 'chat',
    theme: {
        primary: 'blue',
        mode: 'standard'
    }
};
```

```typescript
// packages/presets/monitor.ts
export const monitorPreset: PresetConfig = {
    name: 'monitor',
    tabs: ['monitor'],                    // 只有 Monitor tab
    agents: ['monitor', 'log-monitor'],   // 只加载 Monitor 相关 Agent
    defaultTab: 'monitor',
    theme: {
        primary: 'red',
        mode: 'focus'                      // 聚焦模式（最大化日志显示）
    }
};
```

```typescript
// packages/presets/types.ts
export interface PresetConfig {
    name: string;
    tabs: string[];
    agents: string[];
    defaultTab: string;
    theme?: ThemeConfig;
}
```

### CLI 入口改造

```typescript
// packages/cli/main.ts
import minimist from 'minimist';
import { defaultPreset } from '@taskagent/presets/default';
import { monitorPreset } from '@taskagent/presets/monitor';

const args = minimist(process.argv.slice(2));
const presetName = args.preset || process.env.TASKAGENT_PRESET || 'default';

// 加载预设
const presets = { default: defaultPreset, monitor: monitorPreset };
const preset = presets[presetName];

if (!preset) {
    console.error(`Unknown preset: ${presetName}`);
    process.exit(1);
}

// 启动应用
render(<App preset={preset} />);
```

### package.json 配置

```json
{
  "name": "@taskagent/cli",
  "bin": {
    "taskagent": "dist/main.js",
    "taskagent-monitor": "dist/main-monitor.js"
  },
  "scripts": {
    "build": "tsc",
    "postbuild": "node scripts/create-aliases.js"
  }
}
```

```javascript
// scripts/create-aliases.js
const fs = require('fs');

// 为 monitor 创建 wrapper
const wrapper = `#!/usr/bin/env node
process.argv.push('--preset', 'monitor');
require('./main.js');
`;

fs.writeFileSync('dist/main-monitor.js', wrapper);
fs.chmodSync('dist/main-monitor.js', '755');
```

### 验收标准

- [ ] packages/presets/ 创建完成
- [ ] default 和 monitor 预设配置完成
- [ ] CLI 支持 --preset 参数
- [ ] taskagent 和 taskagent-monitor 别名工作
- [ ] Monitor 模式只显示 Monitor tab
- [ ] 默认模式显示所有 tab
- [ ] 两个窗口可同时运行不同预设

### 测试场景

```bash
# Terminal 1: 默认模式
taskagent
# 显示: [Chat] [Agent] [Story] [Glossary] [UI] [Monitor]

# Terminal 2: Monitor 模式
taskagent-monitor
# 显示: [Monitor]

# 或使用参数
taskagent --preset monitor
```

**时间**: 2 天

---

## 总时间估计

| Phase | 内容 | 时间 | 累计 |
|-------|-----|-----|-----|
| Phase 0 | 准备阶段 | 1 天 | 1 天 |
| Phase 1 | Monorepo 重组 | 2-3 天 | 4 天 |
| Phase 2 | Event Bus 引入 | 2 天 | 6 天 |
| Phase 3 | Agent 统一化 | 3 天 | 9 天 |
| Phase 4 | 消息协议化 | 2 天 | 11 天 |
| Phase 5 | Tab 配置分离 | 2 天 | 13 天 |
| Phase 6 | Execution 协调层 | 3 天 | 16 天 |
| Phase 7 | 多入口支持 | 2 天 | 18 天 |

**总计**: 约 **3 周**

---

## 验收总览

### 功能验收

根据 `docs/refactor_acceptance_criteria.md`:

**Scenario 1: 启动和 Tab 渲染**
- [ ] `yarn start:test` 无错误
- [ ] 默认模式显示所有 Tab
- [ ] Monitor 模式只显示 Monitor Tab

**Scenario 2: 命令功能**
- [ ] 命令菜单正确（根据预设）
- [ ] `/plan-review-do` 工作

**Scenario 3: Story Driver CLI**
- [ ] `--blueprint` flag 工作
- [ ] Story Agent 正确执行

**Scenario 4: Glossary Driver CLI**
- [ ] `--glossary` flag 工作
- [ ] Coordinator + sub-agents 正确加载

**Scenario 5: Tab 切换**
- [ ] Story tab 输入响应正确
- [ ] Glossary tab 输入响应正确
- [ ] 切换时消息正确过滤

### 架构验收

- [ ] Agent 完全解耦 UI（只依赖 EventBus）
- [ ] Tab 和 Agent 通过 ID 引用（松耦合）
- [ ] 消息按 Tab 隔离存储
- [ ] Tab 级别并发控制正确
- [ ] 两个入口可同时运行

### 代码质量验收

- [ ] Monorepo 结构清晰（packages 边界明确）
- [ ] Event Bus 校验工作（Schema）
- [ ] 现有测试通过（test:ci, test:story, test:glossary 等）
- [ ] 代码行数减少（Agent 无 UI 代码）
- [ ] 符合 SOLID 原则

---

## 关键设计决策

### 1. Event Bus vs Direct Call

**选择**: Event Bus

**理由**:
- ✅ Agent 完全解耦 UI
- ✅ 支持未来多 UI（Web/VSCode）
- ✅ Schema 校验保证类型安全
- ⚠️ 调试略复杂（需要 Event Bus 监控工具）

### 2. Monorepo 单包 vs 多包

**选择**: Monorepo + 单包

**理由**:
- ✅ 代码边界清晰（packages 分离）
- ✅ 打包简单（单个产物）
- ✅ 安装简单（只需要 @taskagent/cli）
- ✅ 可独立发布 packages（如 @taskagent/agents）

### 3. 两个入口 vs 多个入口

**选择**: 先支持 2 个（default + monitor）

**理由**:
- ✅ 满足当前需求（全功能 + 专注监控）
- ✅ 验证架构可扩展性
- 📈 未来可轻松添加更多预设（writer/ops/dev）

### 4. AI Runtime 双 SDK 架构

**选择**: 分离 Chat（Vercel AI SDK）和 Agent（Claude Agent SDK）

**理由**:
- ✅ Chat 模式快速简单，满足基础对话需求
- ✅ Agent 模式功能强大，支持工具调用和复杂任务
- ✅ 各自优化，不互相干扰
- ✅ 易于维护和扩展
- 📈 未来可扩展其他 SDK（如 LangChain）

---

### 5. Tab 类型简化

**选择**: 简化为两种类型 `'chat'` 和 `'agent'`

**理由**:
- ✅ `'chat'` = Vercel SDK（简单对话）
- ✅ `'agent'` = Claude SDK（包括纯 Agent 和特定 Driver Agent）
- ✅ 消除 `'agent-driven'` 冗余概念
- ✅ 更清晰的分类

---

### 6. 固定绑定 + 命令灵活切换

**选择**: Tab 固定绑定 Agent，通过 `/fg` 命令临时切换

**理由**:
- ✅ 简化默认行为（每个 Tab 有明确的默认 Agent）
- ✅ 保留灵活性（通过命令可以单次使用其他 Agent）
- ✅ 用户心智模型清晰（Story Tab = Story Agent，除非显式指定）

---

### 7. Session 全局共享 + 后台 Fork

**选择**: 前台 Tab 共享 Session，后台任务 Fork Session

**理由**:
- ✅ 默认共享 Session，保持上下文连续性
- ✅ 后台任务独立 Session，不干扰前台
- ✅ 内存存储，简单高效（不持久化）
- ✅ 符合用户期望（切换 Tab 保持上下文，后台任务独立）

---

### 8. 构建工具链简化

**选择**: 直接使用 `tsc`，不引入 Turbo

**理由**:
- ✅ 单包架构无需复杂构建编排
- ✅ 与现有方式一致，降低迁移风险
- ✅ 减少依赖和配置复杂度

---

## 风险和缓解

### 风险 1: Event Bus 调试困难

**缓解**:
- 增加 Event Bus 日志中间件
- 开发 Event Bus 监控工具
- 单元测试覆盖所有事件类型

### 风险 2: Monorepo 复杂度

**缓解**:
- 使用 Yarn workspace（简单配置，项目已使用 Yarn Berry PnP）
- 避免过早优化（不引入 turborepo/nx）
- 清晰的 package 依赖关系

### 风险 3: 性能回退

**缓解**:
- Phase 0 建立性能基准
- 每个 Phase 对比性能
- Event Bus 使用 Node EventEmitter（高性能）

---

## 后续扩展方向

### Phase 8+: 更多预设

```typescript
// packages/presets/writer.ts
export const writerPreset: PresetConfig = {
    tabs: ['story', 'glossary', 'ui-review'],
    agents: ['story', 'glossary', 'ui-review'],
    defaultTab: 'story'
};

// packages/presets/ops.ts
export const opsPreset: PresetConfig = {
    tabs: ['monitor', 'log-monitor', 'health-check'],
    agents: ['monitor', 'log-monitor', 'health-check'],
    defaultTab: 'monitor'
};
```

### 未来扩展说明

当前架构采用 **Monorepo + 单包 + 多入口** 方案，专注于 CLI 应用。

**Event Bus 的价值**: 虽然当前只有 CLI 入口，Event Bus 架构为未来多 UI 扩展预留了可能性（如 Web UI、VSCode 插件等）。但这些扩展**不在当前路线图范围内**，当前只需确保架构清晰、边界分明即可

---

## 附录：AI Runtime 详细设计

### Claude Agent SDK 封装

**文件**: `packages/ai-runtime/claude/runClaudeStream.ts`

**职责**:
1. 封装 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数
2. 处理 Session 管理（new/resume/fork）
3. 统一日志和性能监控
4. 将 SDK 事件转换为标准 callbacks

**关键 API**:
```typescript
export async function runClaudeStream({
    prompt: string,
    session: { id: string, initialized: boolean },
    queryOptions: {
        model?: string,
        cwd?: string,
        canUseTool: Function,
        systemPrompt?: string | SystemPromptPreset,
        agents?: Record<string, AgentDefinition>,
        allowedTools?: string[],
        disallowedTools?: string[],
        permissionMode?: string,
        forkSession?: boolean
    },
    callbacks?: {
        onTextDelta?: (text: string) => void,
        onReasoningDelta?: (text: string) => void,
        onToolUse?: (event: ToolUseEvent) => void,
        onToolResult?: (event: ToolResultEvent) => void,
        onSessionId?: (sessionId: string) => void
    }
}): Promise<RunClaudeStreamResult>
```

**详细文档**: `memory/docs/2025-11-04-16-00-claude-agent-sdk-integration.md`

---

### Vercel AI SDK 封装

**文件**: `packages/ai-runtime/vercel/runChatStream.ts`

**职责**:
1. 封装 Vercel AI SDK 的 `streamText()` 函数
2. 简化流式对话接口
3. 支持 OpenRouter API

**关键 API**:
```typescript
export async function* runChatStream({
    prompt: string,
    model?: string,
    apiKey?: string
}): AsyncGenerator<string, void, unknown>
```

**使用示例**:
```typescript
// Chat Tab 处理器
for await (const chunk of runChatStream({ prompt: userInput })) {
    eventBus.emit({
        type: 'agent:text',
        tabId: 'chat',
        payload: { chunk }
    });
}
```

---

**路线图状态**: v2.0 已确认  
**架构选择**: Monorepo + Event Bus + 单包多入口 + 双 SDK + 简化构建  
**关键决策**:
- Tab 类型简化为 `chat` 和 `agent`
- 固定绑定 + `/fg` 灵活切换
- Session 全局共享 + 后台 Fork
- 不可见 Tab 保留 20 条消息（可配置）
- 构建使用 `tsc`，不引入 Turbo
- Event 固定 1.0 版本，支持通配符订阅 '*' (用于调试)
- 命令全局化，与当前保持一致

**下一步**: 开始 Phase 0 - 建立测试基准

