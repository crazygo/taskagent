# TaskAgent Refactor Roadmap v2.0 - 进度分析

**分析时间**: 2025-11-05 01:00  
**当前状态**: Phase 3 完成，Phase 4 部分完成  
**下一步**: 完成 Phase 1 收尾 → Phase 4 → Phase 5  

---

## 📊 整体进度

| Phase | 任务 | 状态 | 完成度 | 备注 |
|-------|-----|------|--------|------|
| **Phase 0** | 准备阶段 | ✅ 完成 | 100% | 测试基准已建立，7/7 通过 |
| **Phase 1** | Monorepo 重组 | 🟡 部分完成 | 80% | 核心结构完成，需收尾 |
| **Phase 2** | Event Bus 引入 | ✅ 完成 | 100% | EventBus + Schema 完成 |
| **Phase 3** | Agent 统一化 | ✅ 完成 | 100% | AgentRegistry + EventBusAdapter |
| **Phase 4** | 消息协议化 | 🟡 部分完成 | 60% | Message 扩展完成，Store 需完善 |
| **Phase 5** | Tab 配置分离 | ❌ 未开始 | 0% | - |
| **Phase 6** | Execution 协调层 | ❌ 未开始 | 0% | - |
| **Phase 7** | 多入口支持 | ❌ 未开始 | 0% | - |

**总进度**: ~55% (4/7 阶段完成或接近完成)

---

## ✅ 已完成的工作

### Phase 0: 准备阶段 (100%)

**完成时间**: 2025-11-05 00:13

✅ **测试基准确认**:
```bash
yarn test:ci          # ✅ 7/7 tests passed
yarn test:story       # ✅ Story 功能正常
yarn test:glossary    # ✅ Glossary 功能正常
```

✅ **测试快照记录**:
- 所有现有测试通过
- 作为重构后的验收基准

**关键成果**:
- 建立了稳定的测试基线
- 修复了所有模块导入问题
- 解决了 Logger 循环依赖

---

### Phase 2: Event Bus 引入 (100%)

**完成时间**: 2025-11-04 23:00 (Phase 3 期间完成)

✅ **核心实现**:
```
packages/core/
├── event-bus/
│   ├── EventBus.ts          ✅ 完成
│   └── index.ts             ✅ 完成
├── types/
│   ├── AgentEvent.ts        ✅ 完成
│   ├── Message.ts           ✅ 完成
│   └── TaskEvent.ts         ✅ 完成
└── schemas/
    ├── agent-event.schema.ts ✅ 完成
    └── message.schema.ts     ✅ 完成
```

✅ **功能验证**:
- EventBus 实现完成 (基于 Node EventEmitter)
- Schema 校验工作 (Zod)
- CLI 集成 EventBus (packages/cli/main.tsx)
- 事件订阅测试通过

**关键特性**:
- 固定 1.0 版本，不支持通配符
- 类型安全的事件发送/订阅
- 实时日志记录

---

### Phase 3: Agent 统一化 (100%)

**完成时间**: 2025-11-04 23:30

✅ **Agent 解耦**:
- ✅ 所有 Agent 移到 `packages/agents/`
- ✅ Agent 只依赖 EventBus (无 UI 依赖)
- ✅ EventBusAdapter 实现 (runtime/eventBusAdapter.ts)

✅ **AgentRegistry**:
```typescript
packages/agents/
├── registry/
│   ├── AgentRegistry.ts      ✅ 实现
│   ├── registerAgents.ts     ✅ 实现
│   └── index.ts              ✅ 导出
```

**功能**:
- 全局单例 AgentRegistry
- 支持 Agent 工厂模式注册
- 统一 `startAgent()` 入口
- 与 EventBus 深度集成

✅ **CLI 初始化**:
```typescript
// packages/cli/main.tsx
registerAllAgents();  // 启动时注册所有 Agent
```

**关键成果**:
- Agent 完全解耦 UI
- 通过 EventBus 通信
- 支持灵活的 Agent 扩展

---

## 🟡 进行中的工作

### Phase 1: Monorepo 重组 (80%)

**已完成**:

✅ **Monorepo 结构**:
```
packages/
├── core/               ✅ 完成
├── agents/             ✅ 完成 (迁移 + 合并)
│   ├── runtime/        ✅ Claude SDK 封装
│   ├── story/          ✅ 迁移完成
│   ├── glossary/       ✅ 迁移完成
│   ├── monitor/        ✅ 迁移完成
│   ├── ui-review/      ✅ 迁移完成
│   └── registry/       ✅ 新增
├── cli/                ✅ 完成 (迁移 UI 代码)
│   ├── main.tsx        ✅ 主入口
│   ├── components/     ✅ UI 组件
│   └── drivers/        ✅ Driver 适配层
```

✅ **依赖配置**:
- Yarn workspace 配置正确
- 包间依赖解析正常
- Module exports 配置完善

✅ **测试通过**:
- `yarn test:ci` ✅ 7/7 tests passed
- `yarn start:test` ✅ 启动正常

**未完成**:

❌ **目录清理**:
- `src/` 目录仍然存在（旧代码）
- 需要验证是否还有未迁移的文件

❌ **缺失的 packages**:
- `packages/execution/` - 未创建
- `packages/tabs/` - 未创建
- `packages/presets/` - 未创建

**剩余工作量**: 1-2 天

---

### Phase 4: 消息协议化 (60%)

**已完成**:

✅ **Message 扩展**:
```typescript
// packages/core/types/Message.ts
export interface Message {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    sourceTabId: string;      // ✅ 已添加
    timestamp: number;         // ✅ 已添加
    reasoning?: string;
    isBoxed?: boolean;
}
```

✅ **CLI 订阅 EventBus**:
```typescript
// packages/cli/main.tsx
useEffect(() => {
    eventBus.on('agent:text', handleAgentText);
    eventBus.on('agent:reasoning', handleAgentReasoning);
    eventBus.on('agent:event', handleAgentEvent);
    eventBus.on('agent:completed', handleAgentCompleted);
    eventBus.on('agent:failed', handleAgentFailed);
}, []);
```

✅ **Tab 消息过滤**:
```typescript
const filteredFrozenMessages = useMemo(() => {
    return frozenMessages.filter(msg => 
        !msg.sourceTabId || msg.sourceTabId === selectedTab
    );
}, [frozenMessages, selectedTab]);
```

**未完成**:

❌ **MessageStore 重构**:
- 当前使用简单的数组存储
- 需要按 Tab 分区存储
- 需要实现不可见 Tab 消息限制（20 条，可配置）
- 需要在 Tab 切换时添加分隔线

❌ **消息管理策略**:
```typescript
// 路线图要求的 MessageStore
export class MessageStore {
    private tabMessages = new Map<string, TabMessages>();
    private currentTabId: string;
    
    appendMessage(tabId: string, message: Omit<Message, 'sourceTabId' | 'timestamp'>): void;
    getVisibleMessages(currentTabId: string): Message[];
    setCurrentTab(newTabId: string): void;  // 添加分隔线
}
```

**剩余工作量**: 2 天

---

## ❌ 未开始的工作

### Phase 5: Tab 配置分离 (0%)

**预计**: 2 天

**关键任务**:
1. 创建 `packages/tabs/`
2. 定义 `TabConfig` 接口
3. 实现 `TabRegistry`
4. 迁移所有 Tab 配置
5. CLI 集成 TabRegistry

**依赖**: Phase 1 和 Phase 4 完成

---

### Phase 6: Execution 协调层 (0%)

**预计**: 3 天

**关键任务**:
1. 创建 `packages/execution/`
2. 实现 `MessageAdapter` (Event-Driven)
3. 实现 `TabExecutionManager` (并发控制)
4. 实现 `TabExecutor` (协调层)
5. CLI 集成

**依赖**: Phase 5 完成

---

### Phase 7: 多入口支持 (0%)

**预计**: 2 天

**关键任务**:
1. 创建 `packages/presets/`
2. 实现 `defaultPreset` 和 `monitorPreset`
3. CLI 支持 `--preset` 参数
4. 创建 `taskagent` 和 `taskagent-monitor` 别名

**依赖**: Phase 6 完成

---

## 🎯 接下来的任务优先级

### 优先级 P0 (立即执行)

#### Task 1.1: 完成 Phase 1 收尾 (0.5-1 天)

**目标**: 清理旧代码，完善 Monorepo 结构

**子任务**:
1. 检查 `src/` 目录是否还有未迁移的代码
   ```bash
   find src -type f -name "*.ts" -o -name "*.tsx"
   ```
2. 如果 `src/` 为空或只有旧文件，备份后删除
3. 创建占位 packages (可选，为后续阶段准备):
   ```bash
   mkdir -p packages/execution packages/tabs packages/presets
   ```
4. 更新文档，标记 Phase 1 完成

**验收标准**:
- [ ] `src/` 目录已清理或删除
- [ ] 所有测试仍然通过
- [ ] Monorepo 结构清晰

---

#### Task 4.1: 实现 MessageStore 重构 (1.5-2 天)

**目标**: 按照路线图实现完整的 MessageStore

**子任务**:

1. **创建 MessageStore 类** (0.5 天)
   ```typescript
   // packages/cli/store/messageStore.ts
   export class MessageStore {
       private tabMessages = new Map<string, TabMessages>();
       private currentTabId: string;
       
       appendMessage(tabId: string, message: Omit<Message, 'sourceTabId' | 'timestamp'>): void {
           // 实现消息追加逻辑
           // 不可见 Tab 限制消息数（默认 20 条）
       }
       
       getVisibleMessages(currentTabId: string): Message[] {
           // 返回当前 Tab 的所有消息
       }
       
       setCurrentTab(newTabId: string): void {
           // 切换 Tab 时添加分隔线
       }
   }
   ```

2. **实现不可见 Tab 消息限制** (0.5 天)
   - 当 Tab 不在前台时，只保留最近 N 条消息（默认 20）
   - 可通过配置调整

3. **实现 Tab 切换分隔线** (0.5 天)
   - 切换回 Tab 时，添加横线分割
   - 格式: `─` 重复 50 次

4. **集成到 CLI** (0.5 天)
   ```typescript
   // packages/cli/main.tsx
   const messageStore = useMemo(() => new MessageStore(), []);
   
   // 更新所有 EventBus 订阅使用 messageStore
   ```

5. **测试验证** (0.5 天)
   - 手动测试 Tab 切换
   - 验证消息限制生效
   - 验证分隔线显示

**验收标准**:
- [ ] MessageStore 类实现完成
- [ ] 不可见 Tab 消息限制生效
- [ ] Tab 切换时显示分隔线
- [ ] 所有测试通过
- [ ] 手动测试通过

---

### 优先级 P1 (后续执行)

#### Task 5.1: Tab 配置分离 (2 天)

**目标**: 创建独立的 Tab 配置层

**前置条件**: Phase 1 和 Phase 4 完成

**子任务**:
1. 创建 `packages/tabs/`
2. 定义 `TabConfig` 类型
3. 创建 Tab 配置文件 (story.ts, glossary.ts, monitor.ts 等)
4. 实现 `TabRegistry`
5. CLI 集成

**验收标准**:
- [ ] packages/tabs/ 创建完成
- [ ] TabRegistry 实现并测试通过
- [ ] CLI 集成 TabRegistry
- [ ] Tab 列表动态生成

---

#### Task 6.1: Execution 协调层 (3 天)

**目标**: 创建 Execution 协调层，解耦执行逻辑

**前置条件**: Phase 5 完成

**子任务**:
1. 创建 `packages/execution/`
2. 实现 `MessageAdapter` (已有雏形，需移动到此包)
3. 实现 `TabExecutionManager`
4. 实现 `TabExecutor`
5. CLI 集成

**验收标准**:
- [ ] MessageAdapter 实现完成
- [ ] TabExecutionManager 实现完成
- [ ] TabExecutor 实现完成
- [ ] Tab 并发控制测试通过

---

#### Task 7.1: 多入口支持 (2 天)

**目标**: 支持不同的入口预设

**前置条件**: Phase 6 完成

**子任务**:
1. 创建 `packages/presets/`
2. 实现 `defaultPreset` 和 `monitorPreset`
3. CLI 支持 `--preset` 参数
4. 创建别名 `taskagent-monitor`

**验收标准**:
- [ ] 预设配置完成
- [ ] CLI 支持 --preset
- [ ] taskagent 和 taskagent-monitor 工作正常

---

## 📋 任务清单总结

### 立即执行 (P0)

```
□ Task 1.1: 完成 Phase 1 收尾 (0.5-1 天)
  □ 1.1.1 检查并清理 src/ 目录
  □ 1.1.2 创建占位 packages (可选)
  □ 1.1.3 验证测试通过
  
□ Task 4.1: MessageStore 重构 (1.5-2 天)
  □ 4.1.1 创建 MessageStore 类
  □ 4.1.2 实现不可见 Tab 消息限制
  □ 4.1.3 实现 Tab 切换分隔线
  □ 4.1.4 集成到 CLI
  □ 4.1.5 测试验证
```

### 后续执行 (P1)

```
□ Task 5.1: Tab 配置分离 (2 天)
□ Task 6.1: Execution 协调层 (3 天)
□ Task 7.1: 多入口支持 (2 天)
```

**总剩余时间**: ~10 天 (2 周)

---

## 🎓 关键洞察

### 1. 已完成的工作价值很高

**EventBus + AgentRegistry 架构已经成型**:
- ✅ Agent 完全解耦 UI
- ✅ 通过 Event 通信
- ✅ Schema 校验保证类型安全
- ✅ 测试全部通过

这是整个重构的核心，已经完成 ~55%。

---

### 2. 剩余工作清晰可控

**Phase 4-7 主要是配置层和协调层**:
- Phase 4: MessageStore 重构（数据管理）
- Phase 5: Tab 配置分离（配置管理）
- Phase 6: Execution 协调层（执行管理）
- Phase 7: 多入口支持（入口管理）

这些都是在现有架构基础上的细化和完善，风险较低。

---

### 3. 测试基线是最大的保障

**7/7 测试通过** = 架构稳定性的保证:
- 每次修改后都可以快速验证
- 避免回退和返工
- 保证功能不丢失

---

## 🚀 推荐执行路径

### 路径 A: 稳扎稳打（推荐）

```
Day 1-2:   Task 1.1 + Task 4.1 (P0)
Day 3-4:   Task 5.1 (Tab 配置分离)
Day 5-7:   Task 6.1 (Execution 协调层)
Day 8-9:   Task 7.1 (多入口支持)
Day 10:    全面测试和文档更新
```

**优点**:
- ✅ 每个阶段都有明确的验收标准
- ✅ 测试驱动，风险可控
- ✅ 符合路线图顺序

---

### 路径 B: 快速迭代（激进）

```
Day 1:     Task 1.1 (收尾)
Day 2-3:   Task 4.1 (MessageStore)
Day 4-6:   Task 5.1 + Task 6.1 并行
Day 7-8:   Task 7.1 (多入口)
Day 9:     全面测试
```

**优点**:
- ✅ 更快完成
- ⚠️ 风险略高（并行开发）

---

## 📊 进度可视化

```
Phase 0: ████████████████████ 100% ✅
Phase 1: ████████████████     80% 🟡
Phase 2: ████████████████████ 100% ✅
Phase 3: ████████████████████ 100% ✅
Phase 4: ████████████         60% 🟡
Phase 5: ░░░░░░░░░░░░░░░░░░░░  0% ❌
Phase 6: ░░░░░░░░░░░░░░░░░░░░  0% ❌
Phase 7: ░░░░░░░░░░░░░░░░░░░░  0% ❌

Total:   ███████████░░░░░░░░░ 55%
```

---

## 💡 建议

### 短期（本周）

1. **立即执行 Task 1.1** (清理 src/)
2. **专注 Task 4.1** (MessageStore 重构)
3. **保持测试通过** (每次修改后运行 `yarn test:ci`)

### 中期（下周）

1. **完成 Phase 5** (Tab 配置分离)
2. **开始 Phase 6** (Execution 协调层)
3. **持续验证功能** (手动测试 + 自动化测试)

### 长期（两周后）

1. **完成 Phase 7** (多入口支持)
2. **全面测试验证** (功能 + 性能)
3. **更新文档** (架构图 + API 文档)

---

**报告时间**: 2025-11-05 01:00  
**当前进度**: 55% (Phase 0-3 完成，Phase 4 进行中)  
**下一步**: Task 1.1 (收尾) + Task 4.1 (MessageStore)  
**预计完成**: 2 周  

🎯 **优先任务**: 完成 Phase 1 收尾，然后实现 MessageStore 重构

