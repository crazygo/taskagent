# TaskAgent 重构路线图

**日期**: 2025-11-04  
**目标**: 渐进式重构 View-Tab-Agent 架构  
**原则**: 每个阶段独立可运行、可测试、可回滚

---

## 现状评估

### 当前测试基础设施
```bash
yarn test:ci           # 运行所有测试
yarn test:story        # Story tab 启动测试
yarn test:glossary     # Glossary tab 启动测试
yarn e2e:experiment    # E2E 自动化测试
```

### 现有测试文件
- `tests/registry-slash.test.ts` - 命令注册测试
- `tests/fork-session.test.ts` - Session 分叉测试
- `tests/e2e/cli.test.ts` - CLI 参数测试
- `tests/e2e/automation.test.ts` - E2E 自动化测试

### 当前代码结构
```
src/
├── agents/log-monitor/          # 只有 1 个 Agent
├── drivers/                     # 其他 Agent + Driver 混合
│   ├── glossary/agent.ts
│   ├── story/agent.ts
│   ├── monitor/index.ts
│   ├── ui-review/
│   └── registry.ts
├── components/
│   ├── ChatPanel.tsx
│   ├── DriverView.tsx
│   └── TaskSpecificView.tsx
└── domain/
    ├── conversationStore.ts
    └── taskStore.ts
```

---

## 重构总览（7 个阶段）

```
Phase 0: 准备阶段 - 测试覆盖 & 基准建立
Phase 1: Agent 统一化 - 迁移到 src/agents/
Phase 2: 消息归属化 - 增加 sourceTabId
Phase 3: Tab 配置分离 - 创建 src/tabs/
Phase 4: Adapter 层引入 - 消除 Driver handler 中的 UI 操作
Phase 5: Executor 层重构 - 统一执行协调
Phase 6: Screen 统一化 - 合并 ChatPanel + DriverView
Phase 7: 清理与优化 - 删除遗留代码
```

---

## Phase 0: 准备阶段

**目标**: 建立测试基准，确保现有功能完整可测

### 0.1 补充单元测试

**新增测试文件**:
```
tests/
├── agents/
│   ├── story.test.ts         # Story Agent 测试
│   ├── glossary.test.ts      # Glossary Agent 测试
│   └── monitor.test.ts       # Monitor Agent 测试
├── drivers/
│   └── handler.test.ts       # Driver handler 测试
└── integration/
    └── tab-switching.test.ts # Tab 切换集成测试
```

**测试内容**:
```typescript
// tests/agents/story.test.ts
describe('Story Agent', () => {
    it('should create agent instance', async () => {
        const agent = await createStoryAgent();
        expect(agent.id).toBe('story');
    });
    
    it('should generate prompt', () => {
        const agent = await createStoryAgent();
        const prompt = agent.getPrompt('test input', { sourceTabId: 'story' });
        expect(prompt).toBe('test input');
    });
    
    it('should provide agent definitions', () => {
        const agent = await createStoryAgent();
        const defs = agent.getAgentDefinitions?.();
        expect(defs).toBeDefined();
    });
});
```

### 0.2 建立性能基准

**新增测试**:
```typescript
// tests/performance/baseline.test.ts
describe('Performance Baseline', () => {
    it('should render 100 messages in < 1s', async () => {
        const start = Date.now();
        // 模拟渲染 100 条消息
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(1000);
    });
    
    it('should switch tabs in < 100ms', async () => {
        // 测试 Tab 切换性能
    });
});
```

### 0.3 快照测试

**新增测试**:
```typescript
// tests/snapshots/ui.test.tsx
import { render } from 'ink-testing-library';

describe('UI Snapshots', () => {
    it('matches Story tab snapshot', () => {
        const { lastFrame } = render(<App initialTab="story" />);
        expect(lastFrame()).toMatchSnapshot();
    });
});
```

### 检查点 ✓

**验收标准**:
- [ ] 所有现有测试通过: `yarn test:ci`
- [ ] 新增测试覆盖率 > 60%
- [ ] 性能基准建立完成
- [ ] 快照测试生成完成

**回滚策略**: 删除新增测试文件即可

**时间估计**: 2-3 天

---

## Phase 1: Agent 统一化

**目标**: 将所有 Agent 迁移到 `src/agents/` 目录

### 1.1 迁移 Story Agent

**步骤**:
```bash
# 1. 创建目录
mkdir -p src/agents/story

# 2. 移动文件
mv src/drivers/story/agent.ts src/agents/story/index.ts
mv src/drivers/story/coordinator.agent.md src/agents/story/
mv src/drivers/story/agents/ src/agents/story/

# 3. 更新导入路径
# src/drivers/story/index.ts
- import { createStoryPromptAgent } from './agent.js';
+ import { createStoryPromptAgent } from '../../agents/story/index.js';
```

**测试**:
```typescript
// tests/agents/story.test.ts
import { createStoryPromptAgent } from '@/agents/story';  // 新路径

describe('Story Agent Migration', () => {
    it('should work after migration', async () => {
        const agent = await createStoryPromptAgent();
        expect(agent).toBeDefined();
    });
});
```

### 1.2 迁移 Glossary Agent

**同上，迁移到 `src/agents/glossary/`**

### 1.3 迁移 UI Review Agent

**步骤**:
```bash
mkdir -p src/agents/ui-review
mv src/drivers/ui-review/prompt.ts src/agents/ui-review/
# 创建 src/agents/ui-review/index.ts
```

**新文件**:
```typescript
// src/agents/ui-review/index.ts
import { buildUiReviewSystemPrompt } from './prompt.js';
import { loadAgentPipelineConfig } from '../agent/agentLoader.js';

export async function createUiReviewAgent() {
    const { systemPrompt, allowedTools, disallowedTools } = 
        await loadAgentPipelineConfig(__dirname, {
            systemPromptFactory: buildUiReviewSystemPrompt
        });
    
    return {
        id: 'ui-review',
        description: 'UI Review Agent',
        getPrompt: (input: string) => input,
        getSystemPrompt: () => systemPrompt,
        getTools: () => allowedTools,
        // ... 实现 RunnableAgent 接口
    };
}
```

### 1.4 统一导出

**新文件**:
```typescript
// src/agents/index.ts
export { createStoryPromptAgent } from './story';
export { createGlossaryPromptAgent } from './glossary';
export { createLogMonitor } from './log-monitor';
export { createUiReviewAgent } from './ui-review';

// Agent Registry
export { AgentRegistry } from './registry';
```

**新文件**:
```typescript
// src/agents/registry.ts
export class AgentRegistry {
    private agents = new Map<string, AgentFactory>();
    
    register(id: string, factory: AgentFactory) {
        this.agents.set(id, factory);
    }
    
    get(id: string): AgentFactory | undefined {
        return this.agents.get(id);
    }
    
    getAll(): AgentMeta[] {
        return Array.from(this.agents.entries()).map(([id, factory]) => ({
            id,
            label: factory.label,
            description: factory.description
        }));
    }
}

// 全局单例
export const agentRegistry = new AgentRegistry();
```

### 检查点 ✓

**验收标准**:
- [ ] 所有 Agent 在 `src/agents/` 目录下
- [ ] 原有 Driver handler 仍可正常调用 Agent
- [ ] 所有测试通过: `yarn test:ci`
- [ ] 启动测试通过: `yarn test:story`, `yarn test:glossary`
- [ ] E2E 测试通过: `yarn e2e:experiment`

**回滚策略**: 
```bash
git revert <commit-hash>
# 或恢复文件位置
mv src/agents/story/* src/drivers/story/
```

**时间估计**: 2-3 天

---

## Phase 2: 消息归属化

**目标**: 为消息增加 `sourceTabId`，支持按 Tab 过滤

### 2.1 扩展 Message 类型

**修改文件**: `src/types.ts`
```typescript
export interface Message {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    sourceTabId?: string;  // ✅ 新增（可选，向后兼容）
    timestamp?: number;     // ✅ 新增
    reasoning?: string;
    isBoxed?: boolean;
    isPending?: boolean;
}
```

### 2.2 创建 MessageStore

**新文件**: `src/domain/messageStore.ts`
```typescript
export class MessageStore {
    private tabMessages = new Map<string, TabMessages>();
    
    appendMessage(tabId: string, message: Message) {
        const messages = this.getMessages(tabId);
        message.sourceTabId = tabId;
        message.timestamp = Date.now();
        messages.frozen.push(message);
    }
    
    getMessages(tabId: string): TabMessages {
        if (!this.tabMessages.has(tabId)) {
            this.tabMessages.set(tabId, { frozen: [], active: [] });
        }
        return this.tabMessages.get(tabId)!;
    }
    
    getVisibleMessages(currentTabId: string): Message[] {
        const { frozen, active } = this.getMessages(currentTabId);
        return [...frozen, ...active];
    }
    
    // 向后兼容：支持全局消息（用于 Chat/Agent tab）
    getAllMessages(): Message[] {
        const all: Message[] = [];
        for (const { frozen, active } of this.tabMessages.values()) {
            all.push(...frozen, ...active);
        }
        return all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
}

interface TabMessages {
    frozen: Message[];
    active: Message[];
}
```

### 2.3 集成到 conversationStore

**修改文件**: `src/domain/conversationStore.ts`
```typescript
import { MessageStore } from './messageStore.js';

export const useConversationStore = ({ ... }) => {
    const messageStore = useMemo(() => new MessageStore(), []);
    
    // 向后兼容：仍然提供 nextMessageId
    const nextMessageId = useCallback(() => { ... }, []);
    
    return {
        messageStore,  // ✅ 新增
        nextMessageId,
        // ... 其他保持不变
    };
};
```

### 2.4 渐进式迁移（双写模式）

**修改**: Driver handlers 双写消息
```typescript
// src/drivers/story/index.ts
async function handleStoryInvocation(message, context) {
    const agent = await createStoryAgent();
    
    context.startForeground(agent, prompt, { ... }, {
        onText: (chunk) => {
            const textMsgId = context.nextMessageId();
            const msg = { id: textMsgId, role: 'assistant', content: chunk };
            
            // 双写：旧方式（保留）
            context.setFrozenMessages(prev => [...prev, msg]);
            
            // 新方式（增加）
            context.messageStore?.appendMessage('story', msg);
        }
    });
}
```

### 2.5 测试 Tab 隔离

**新增测试**:
```typescript
// tests/domain/messageStore.test.ts
describe('MessageStore', () => {
    it('should isolate messages by tab', () => {
        const store = new MessageStore();
        
        store.appendMessage('story', { id: 1, role: 'user', content: 'A' });
        store.appendMessage('glossary', { id: 2, role: 'user', content: 'B' });
        
        const storyMessages = store.getVisibleMessages('story');
        expect(storyMessages).toHaveLength(1);
        expect(storyMessages[0].content).toBe('A');
    });
});
```

### 检查点 ✓

**验收标准**:
- [ ] `Message` 类型扩展完成，向后兼容
- [ ] `MessageStore` 创建并通过单元测试
- [ ] 双写模式实现，旧功能不受影响
- [ ] 所有测试通过: `yarn test:ci`
- [ ] Tab 切换测试通过

**回滚策略**: 
- 删除 `messageStore.ts`
- 移除 `Message.sourceTabId` 字段
- 删除 handler 中的双写逻辑

**时间估计**: 2-3 天

---

## Phase 3: Tab 配置分离

**目标**: 创建 `src/tabs/` 目录，将 Tab 配置从 Driver 中分离

### 3.1 创建 Tab 类型定义

**新文件**: `src/tabs/types.ts`
```typescript
export interface TabConfig {
    id: string;
    label: string;
    type: 'chat' | 'agent' | 'agent-driven';
    
    // Agent 绑定
    agentId?: string;  // 引用 AgentRegistry 中的 ID
    
    // 配置
    requiresSession: boolean;
    executionMode: 'foreground' | 'background';
}
```

### 3.2 创建 Tab 配置文件

**新文件**: `src/tabs/configs/story.ts`
```typescript
import type { TabConfig } from '../types';

export const storyTabConfig: TabConfig = {
    id: 'story',
    label: 'Story',
    type: 'agent-driven',
    agentId: 'story',  // 引用 AgentRegistry
    requiresSession: true,
    executionMode: 'foreground'
};
```

**新文件**: `src/tabs/configs/chat.ts`
```typescript
export const chatTabConfig: TabConfig = {
    id: 'chat',
    label: 'Chat',
    type: 'chat',
    agentId: undefined,  // Chat 无 Agent
    requiresSession: false,
    executionMode: 'foreground'
};
```

### 3.3 创建 Tab Registry

**新文件**: `src/tabs/registry.ts`
```typescript
import { chatTabConfig } from './configs/chat';
import { agentTabConfig } from './configs/agent';
import { storyTabConfig } from './configs/story';
import { glossaryTabConfig } from './configs/glossary';
import { monitorTabConfig } from './configs/monitor';
import { uiReviewTabConfig } from './configs/ui-review';

export class TabRegistry {
    private tabs = new Map<string, TabConfig>();
    
    constructor() {
        this.register(chatTabConfig);
        this.register(agentTabConfig);
        this.register(storyTabConfig);
        this.register(glossaryTabConfig);
        this.register(monitorTabConfig);
        this.register(uiReviewTabConfig);
    }
    
    register(config: TabConfig) {
        this.tabs.set(config.id, config);
    }
    
    get(id: string): TabConfig | undefined {
        return this.tabs.get(id);
    }
    
    getAll(): TabConfig[] {
        return Array.from(this.tabs.values());
    }
    
    getTabs(): string[] {
        return Array.from(this.tabs.keys());
    }
}

// 全局单例
export const tabRegistry = new TabRegistry();
```

### 3.4 集成到 ui.tsx

**修改**: `ui.tsx`
```typescript
import { tabRegistry } from './src/tabs/registry';

// 替换硬编码的 STATIC_TABS
- const STATIC_TABS = [Driver.CHAT, Driver.AGENT, ...DRIVER_TABS];
+ const STATIC_TABS = tabRegistry.getTabs();

// 替换 getDriverByLabel
- const driverEntry = getDriverByLabel(selectedTab);
+ const tabConfig = tabRegistry.get(selectedTab);
```

### 3.5 保持 Driver 向后兼容

**保留**: `src/drivers/registry.ts` (暂时不删除)
```typescript
// 为了向后兼容，保留 getDriverManifest()
// 但内部改为从 tabRegistry 读取
export function getDriverManifest(): DriverManifestEntry[] {
    const tabs = tabRegistry.getAll();
    
    return tabs
        .filter(tab => tab.type === 'agent-driven')
        .map(tab => ({
            type: 'view',
            id: tab.id as Driver,
            label: tab.label,
            // ... 映射其他字段
        }));
}
```

### 检查点 ✓

**验收标准**:
- [ ] `src/tabs/` 目录创建完成
- [ ] 所有 Tab 配置文件创建
- [ ] `TabRegistry` 实现并通过单元测试
- [ ] `ui.tsx` 集成 `tabRegistry`
- [ ] 原有 `getDriverManifest()` 仍可工作（兼容层）
- [ ] 所有测试通过: `yarn test:ci`
- [ ] Tab 切换功能正常

**回滚策略**:
```bash
rm -rf src/tabs/
# 恢复 ui.tsx 中的 STATIC_TABS
git checkout ui.tsx
```

**时间估计**: 2-3 天

---

## Phase 4: Adapter 层引入

**目标**: 创建 `MessageAdapter`，消除 Driver handler 中的 UI 操作

### 4.1 创建 MessageAdapter

**新文件**: `src/execution/adapters/MessageAdapter.ts`
```typescript
import type { Message } from '../../types';
import type { MessageStore } from '../../domain/messageStore';

export class MessageAdapter {
    private pendingId: number | null = null;
    private hasFinalizedPending = false;
    
    constructor(
        private tabId: string,
        private nextMessageId: () => number,
        private messageStore: MessageStore,
        private finalizeMessageById: (id: number) => void
    ) {}
    
    createForegroundSinks() {
        return {
            onText: (chunk: string) => {
                if (!chunk) return;
                
                // 自动管理 pending 状态
                if (!this.hasFinalizedPending && this.pendingId) {
                    this.finalizeMessageById(this.pendingId);
                    this.hasFinalizedPending = true;
                }
                
                // 创建消息
                const textMsgId = this.nextMessageId();
                const message: Message = {
                    id: textMsgId,
                    role: 'assistant',
                    content: chunk,
                    sourceTabId: this.tabId,
                    timestamp: Date.now()
                };
                
                // 写入 MessageStore
                this.messageStore.appendMessage(this.tabId, message);
            },
            
            onEvent: (event: TaskEvent) => {
                const icon = this.getLevelIcon(event.level);
                const message: Message = {
                    id: this.nextMessageId(),
                    role: 'system',
                    content: `${icon} [${this.tabId}] ${event.message}`,
                    sourceTabId: this.tabId,
                    isBoxed: event.level === 'error',
                    timestamp: Date.now()
                };
                
                this.messageStore.appendMessage(this.tabId, message);
            },
            
            onCompleted: (fullText: string) => {
                if (!this.hasFinalizedPending && this.pendingId) {
                    this.finalizeMessageById(this.pendingId);
                    this.hasFinalizedPending = true;
                }
            },
            
            onFailed: (error: string) => {
                if (!this.hasFinalizedPending && this.pendingId) {
                    this.finalizeMessageById(this.pendingId);
                    this.hasFinalizedPending = true;
                }
                
                const message: Message = {
                    id: this.nextMessageId(),
                    role: 'system',
                    content: `❌ [${this.tabId}] 失败：${error}`,
                    sourceTabId: this.tabId,
                    isBoxed: true,
                    timestamp: Date.now()
                };
                
                this.messageStore.appendMessage(this.tabId, message);
            }
        };
    }
    
    setPendingMessage(id: number) {
        this.pendingId = id;
        this.hasFinalizedPending = false;
    }
    
    private getLevelIcon(level: string): string {
        const icons = { info: 'ℹ️', warning: '⚠️', error: '❌' };
        return icons[level as keyof typeof icons] || '📝';
    }
}
```

### 4.2 重构 Story Handler（使用 Adapter）

**修改**: `src/drivers/story/index.ts`
```typescript
import { MessageAdapter } from '../../execution/adapters/MessageAdapter';

async function handleStoryInvocation(message: Message, context: DriverRuntimeContext): Promise<boolean> {
    const prompt = message.content.trim();
    if (!prompt) return false;

    const agent = await createStoryPromptAgent();
    
    // ✅ 使用 Adapter（新方式）
    const adapter = new MessageAdapter(
        'story',
        context.nextMessageId,
        context.messageStore,  // 假设已添加到 context
        context.finalizeMessageById
    );
    
    // 创建 pending 消息
    const pendingId = context.nextMessageId();
    adapter.setPendingMessage(pendingId);
    // ... 设置 pending 消息到 active
    
    // ✅ 使用 Adapter 的 sinks
    const sinks = adapter.createForegroundSinks();
    
    context.startForeground(agent, prompt, { ... }, {
        ...sinks,
        canUseTool: context.canUseTool
    });
    
    return true;
}
```

**对比**:
```typescript
// ❌ Before（70 行，50% UI 操作）
onText: (chunk) => {
    if (!hasFinalizedPending) {
        context.finalizeMessageById(pendingId);
        hasFinalizedPending = true;
    }
    const textMsgId = context.nextMessageId();
    context.setFrozenMessages(prev => [...prev, { id: textMsgId, ... }]);
}

// ✅ After（10 行，0% UI 操作）
const sinks = adapter.createForegroundSinks();
context.startForeground(agent, prompt, { ... }, sinks);
```

### 4.3 渐进迁移其他 Handlers

**顺序**:
1. ✅ Story handler
2. ✅ Glossary handler
3. ✅ Monitor handler
4. ✅ Registry 中自动生成的 fg/bg handlers

### 4.4 测试 Adapter

**新增测试**:
```typescript
// tests/execution/MessageAdapter.test.ts
describe('MessageAdapter', () => {
    it('should create foreground sinks', () => {
        const adapter = new MessageAdapter('test', mockNextId, mockStore, mockFinalize);
        const sinks = adapter.createForegroundSinks();
        
        expect(sinks.onText).toBeDefined();
        expect(sinks.onEvent).toBeDefined();
    });
    
    it('should auto-manage pending state', () => {
        const adapter = new MessageAdapter(...);
        adapter.setPendingMessage(1);
        
        sinks.onText('chunk');
        
        expect(mockFinalize).toHaveBeenCalledWith(1);
    });
});
```

### 检查点 ✓

**验收标准**:
- [ ] `MessageAdapter` 创建并通过单元测试
- [ ] 所有 Driver handlers 迁移到 Adapter
- [ ] Handler 代码行数减少 50%+
- [ ] 所有测试通过: `yarn test:ci`
- [ ] E2E 测试通过: `yarn e2e:experiment`
- [ ] 性能无回退（对比 Phase 0 基准）

**回滚策略**:
```bash
rm src/execution/adapters/MessageAdapter.ts
git checkout src/drivers/*/index.ts
```

**时间估计**: 3-4 天

---

## Phase 5: Executor 层重构

**目标**: 创建统一的 `TabExecutor`，管理执行协调和并发控制

### 5.1 创建 TabExecutionState

**新文件**: `src/execution/TabExecutionState.ts`
```typescript
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
        executor: (agent: RunnableAgent, input: string) => Promise<void>
    ) {
        const state = this.getState(tabId);
        
        if (state.status === 'busy') {
            state.queue.push({ agentId, userInput });
            return;
        }
        
        await this.executeImmediate(tabId, agentId, userInput, executor);
    }
    
    private async executeImmediate(...) {
        const state = this.getState(tabId);
        const agent = agentRegistry.create(agentId);
        
        state.status = 'busy';
        state.agentInstance = agent;
        
        try {
            await executor(agent, userInput);
        } finally {
            this.onExecutionComplete(tabId);
        }
    }
    
    private async onExecutionComplete(tabId: string) {
        const state = this.getState(tabId);
        
        state.status = 'idle';
        state.agentInstance = null;
        state.currentExecution = null;
        
        // 处理队列
        if (state.queue.length > 0) {
            const next = state.queue.shift()!;
            await this.execute(tabId, next.agentId, next.userInput, ...);
        }
    }
}
```

### 5.2 创建 TabExecutor

**新文件**: `src/execution/TabExecutor.ts`
```typescript
export class TabExecutor {
    constructor(
        private tabExecManager: TabExecutionManager,
        private agentRegistry: AgentRegistry,
        private messageStore: MessageStore
    ) {}
    
    async execute(
        tabId: string,
        agentId: string,
        userInput: string,
        context: ExecutionContext
    ): Promise<boolean> {
        // 检查 Tab 状态
        if (!this.tabExecManager.isIdle(tabId)) {
            // 加入队列
            await this.tabExecManager.execute(tabId, agentId, userInput, 
                (agent, input) => this.doExecute(tabId, agent, input, context)
            );
            return true;
        }
        
        // 立即执行
        const agent = this.agentRegistry.create(agentId);
        await this.doExecute(tabId, agent, userInput, context);
        return true;
    }
    
    private async doExecute(
        tabId: string,
        agent: RunnableAgent,
        userInput: string,
        context: ExecutionContext
    ) {
        // 创建 Adapter
        const adapter = new MessageAdapter(
            tabId,
            context.nextMessageId,
            this.messageStore,
            context.finalizeMessageById
        );
        
        // 启动 Agent
        const handle = agent.start(userInput, { ... }, {
            ...adapter.createForegroundSinks(),
            canUseTool: context.canUseTool
        });
        
        // 等待完成（或异步）
    }
}
```

### 5.3 集成到 ui.tsx

**修改**: `ui.tsx`
```typescript
import { TabExecutor } from './src/execution/TabExecutor';
import { TabExecutionManager } from './src/execution/TabExecutionState';

const App = () => {
    // 创建 Executor
    const tabExecManager = useMemo(() => new TabExecutionManager(), []);
    const tabExecutor = useMemo(() => 
        new TabExecutor(tabExecManager, agentRegistry, messageStore), 
        []
    );
    
    const handleSubmit = useCallback(async (userInput: string) => {
        const tabConfig = tabRegistry.get(selectedTab);
        
        if (tabConfig?.type === 'agent-driven') {
            // ✅ 使用 Executor
            return await tabExecutor.execute(
                selectedTab,
                tabConfig.agentId!,
                userInput,
                { nextMessageId, finalizeMessageById, canUseTool, ... }
            );
        }
        
        // 其他模式（Chat/Agent）保持不变
        // ...
    }, [selectedTab]);
};
```

### 5.4 测试并发控制

**新增测试**:
```typescript
// tests/execution/TabExecutionManager.test.ts
describe('Tab Concurrency', () => {
    it('should queue messages when busy', async () => {
        const manager = new TabExecutionManager();
        
        // 第一个消息：立即执行
        await manager.execute('story', 'story', 'msg1', mockExecutor);
        expect(manager.getState('story').status).toBe('busy');
        
        // 第二个消息：加入队列
        await manager.execute('story', 'story', 'msg2', mockExecutor);
        expect(manager.getState('story').queue).toHaveLength(1);
    });
    
    it('should execute independently across tabs', async () => {
        const manager = new TabExecutionManager();
        
        await manager.execute('story', 'story', 'msg1', mockExecutor);
        await manager.execute('glossary', 'glossary', 'msg2', mockExecutor);
        
        expect(manager.getState('story').status).toBe('busy');
        expect(manager.getState('glossary').status).toBe('busy');  // ✅ 独立
    });
});
```

### 检查点 ✓

**验收标准**:
- [ ] `TabExecutionManager` 实现并通过单元测试
- [ ] `TabExecutor` 实现并通过单元测试
- [ ] Tab 并发控制测试通过
- [ ] `ui.tsx` 集成 `TabExecutor`
- [ ] 所有测试通过: `yarn test:ci`
- [ ] E2E 测试通过: `yarn e2e:experiment`

**回滚策略**:
```bash
rm src/execution/TabExecutionState.ts
rm src/execution/TabExecutor.ts
git checkout ui.tsx
```

**时间估计**: 3-4 天

---

## Phase 6: Screen 统一化

**目标**: 合并 `ChatPanel` 和 `DriverView`，创建统一的 `Screen` 组件

### 6.1 创建 Screen 组件

**新文件**: `src/components/Screen.tsx`
```typescript
import { Box, Static } from 'ink';
import { MessageRenderer } from './MessageRenderer';

interface ScreenProps {
    selectedTab: string;
    messageStore: MessageStore;
}

export const Screen: React.FC<ScreenProps> = ({ selectedTab, messageStore }) => {
    // 只获取当前 Tab 的消息
    const visibleMessages = messageStore.getVisibleMessages(selectedTab);
    
    // 分离 frozen 和 active
    const frozen = visibleMessages.filter(m => !m.isPending);
    const active = visibleMessages.filter(m => m.isPending);
    
    return (
        <Box flexDirection="column" height="100%">
            {/* Frozen messages（不重绘） */}
            <Static items={frozen}>
                {(msg) => <MessageRenderer key={msg.id} message={msg} />}
            </Static>
            
            {/* Active messages（可重绘） */}
            {active.map(msg => (
                <MessageRenderer key={msg.id} message={msg} />
            ))}
        </Box>
    );
};
```

### 6.2 创建 MessageRenderer

**新文件**: `src/components/MessageRenderer.tsx`
```typescript
export const MessageRenderer: React.FC<{ message: Message }> = ({ message }) => {
    const color = message.role === 'user' ? 'white' : 
                  message.role === 'assistant' ? 'gray' : 'yellow';
    
    if (message.isBoxed) {
        return (
            <Box borderStyle="single" borderColor="red">
                <Text color={color}>{message.content}</Text>
            </Box>
        );
    }
    
    return <Text color={color}>{message.content}</Text>;
};
```

### 6.3 替换 ChatPanel 和 DriverView

**修改**: `ui.tsx`
```typescript
- import { ChatPanel } from './src/components/ChatPanel';
- import { DriverView } from './src/components/DriverView';
+ import { Screen } from './src/components/Screen';

const App = () => {
    return (
        <Box flexDirection="column" height="100%">
-           <ChatPanel frozenMessages={...} activeMessages={...} />
-           {isDriverViewActive && <DriverView selectedTab={selectedTab} />}
+           <Screen selectedTab={selectedTab} messageStore={messageStore} />
            
            <InputBar ... />
            <TaskPanel ... />
            <TabView ... />
        </Box>
    );
};
```

### 6.4 测试 Tab 切换渲染

**新增测试**:
```typescript
// tests/components/Screen.test.tsx
import { render } from 'ink-testing-library';

describe('Screen Component', () => {
    it('should only render current tab messages', () => {
        const store = new MessageStore();
        store.appendMessage('story', { id: 1, content: 'Story msg' });
        store.appendMessage('glossary', { id: 2, content: 'Glossary msg' });
        
        const { lastFrame } = render(
            <Screen selectedTab="story" messageStore={store} />
        );
        
        expect(lastFrame()).toContain('Story msg');
        expect(lastFrame()).not.toContain('Glossary msg');
    });
    
    it('should update when switching tabs', async () => {
        const { rerender, lastFrame } = render(
            <Screen selectedTab="story" messageStore={store} />
        );
        
        rerender(<Screen selectedTab="glossary" messageStore={store} />);
        
        expect(lastFrame()).toContain('Glossary msg');
        expect(lastFrame()).not.toContain('Story msg');
    });
});
```

### 检查点 ✓

**验收标准**:
- [ ] `Screen` 组件创建并通过渲染测试
- [ ] `ChatPanel` 和 `DriverView` 被替换
- [ ] Tab 切换时消息正确过滤
- [ ] 所有测试通过: `yarn test:ci`
- [ ] E2E 测试通过: `yarn e2e:experiment`
- [ ] 视觉测试通过（手动验证）
- [ ] 性能无回退（对比 Phase 0 基准）

**回滚策略**:
```bash
rm src/components/Screen.tsx
rm src/components/MessageRenderer.tsx
git checkout ui.tsx
git checkout src/components/ChatPanel.tsx
git checkout src/components/DriverView.tsx
```

**时间估计**: 2-3 天

---

## Phase 7: 清理与优化

**目标**: 删除遗留代码，优化性能，完善文档

### 7.1 删除遗留代码

**删除文件**:
```bash
rm src/components/ChatPanel.tsx
rm src/components/DriverView.tsx
rm src/components/StackAgentView.tsx

# 保留但清理 src/drivers/
# - 删除 handler 函数（已迁移到 Executor）
# - 保留 Agent 导出（已迁移到 src/agents/）
# - 可选：完全删除 src/drivers/，只保留 src/agents/ + src/tabs/
```

### 7.2 性能优化

**优化点**:
1. **消息限制**
```typescript
// MessageStore.ts
appendMessage(tabId: string, message: Message) {
    const messages = this.getMessages(tabId);
    
    // 不可见 Tab 限制消息数量
    if (tabId !== this.currentTabId && messages.frozen.length > 100) {
        messages.frozen = messages.frozen.slice(-100);
    }
    
    messages.frozen.push(message);
}
```

2. **增量渲染**
```typescript
// Screen.tsx - 只渲染新消息
const [lastRenderedCount, setLastRenderedCount] = useState(0);
const newMessages = visibleMessages.slice(lastRenderedCount);
```

### 7.3 更新文档

**更新文件**:
- `README.md` - 更新架构说明
- `src/AGENTS.md` - 更新组件说明
- `docs/task-architecture-high-level.md` - 更新架构文档

### 7.4 完善测试覆盖

**目标覆盖率**: > 80%

**新增测试**:
```typescript
// tests/integration/full-flow.test.ts
describe('Full Integration', () => {
    it('should complete story workflow', async () => {
        // 启动 Story tab
        // 发送消息
        // 验证输出
        // 切换到 Glossary tab
        // 验证 Story 消息不显示
    });
});
```

### 检查点 ✓

**验收标准**:
- [ ] 遗留代码删除完成
- [ ] 性能优化完成，对比 Phase 0 基准
- [ ] 文档更新完成
- [ ] 测试覆盖率 > 80%
- [ ] 所有测试通过: `yarn test:ci`
- [ ] E2E 测试通过: `yarn e2e:experiment`
- [ ] 代码 Review 通过

**回滚策略**: 
- 整个 Phase 7 可以跳过或延后
- 不影响核心功能

**时间估计**: 2-3 天

---

## 总时间估计

| Phase | 时间 | 累计 |
|-------|-----|-----|
| Phase 0 | 2-3 天 | 3 天 |
| Phase 1 | 2-3 天 | 6 天 |
| Phase 2 | 2-3 天 | 9 天 |
| Phase 3 | 2-3 天 | 12 天 |
| Phase 4 | 3-4 天 | 16 天 |
| Phase 5 | 3-4 天 | 20 天 |
| Phase 6 | 2-3 天 | 23 天 |
| Phase 7 | 2-3 天 | 26 天 |

**总计**: 约 **4-5 周**

---

## CI/CD 集成

### GitHub Actions 配置

**新文件**: `.github/workflows/refactor.yml`
```yaml
name: Refactor CI

on:
  push:
    branches: [feature/refactor-*]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: yarn install --immutable
      
      - name: Run tests
        run: yarn test:ci
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
      
      - name: E2E tests
        run: yarn e2e:experiment
      
      - name: Performance baseline
        run: yarn test:performance
```

### Pre-commit Hook

**新文件**: `.husky/pre-commit`
```bash
#!/bin/sh
yarn test:ci
yarn build
```

---

## 风险管理

### 高风险点

1. **Phase 4-5**: Adapter + Executor 重构
   - **风险**: 可能破坏现有功能
   - **缓解**: 双写模式，渐进迁移

2. **Phase 6**: Screen 统一化
   - **风险**: 渲染性能问题
   - **缓解**: 性能基准测试，增量渲染

### 回滚策略

每个 Phase 都可以独立回滚：
```bash
# 查看 Phase N 的提交
git log --oneline --grep="Phase N"

# 回滚到 Phase N 之前
git revert <commit-range>

# 或回滚整个 branch
git reset --hard origin/main
```

---

## 验收总结

### 功能验收
- [ ] 所有现有功能正常工作
- [ ] Tab 切换正确过滤消息
- [ ] Tab 并发控制正确
- [ ] Agent 和 Tab 自由绑定
- [ ] /fg, /bg 命令正常

### 性能验收
- [ ] 消息渲染性能无回退
- [ ] Tab 切换 < 100ms
- [ ] 内存使用稳定

### 代码质量验收
- [ ] 测试覆盖率 > 80%
- [ ] 所有测试通过
- [ ] 代码行数减少 30%+
- [ ] 架构符合 SOLID 原则

---

## 后续优化（Phase 8+）

1. **Agent 热重载**: 支持运行时更新 Agent 配置
2. **消息持久化**: 保存消息到磁盘
3. **消息搜索**: 全文搜索历史消息
4. **多窗口支持**: 同时查看多个 Tab
5. **插件系统**: 支持第三方 Agent

---

**路线图状态**: 初版完成  
**下一步**: 获得团队 Review 和批准后，开始 Phase 0

