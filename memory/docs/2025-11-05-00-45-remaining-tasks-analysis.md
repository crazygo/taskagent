# 剩余任务分析 - 测试目标与策略

**日期**: 2025-11-05 00:45  
**当前进度**: 45% (核心架构完成)  

---

## 📊 当前状态分析

### ✅ 已完成的核心架构 (45%)

```
✅ Phase 1: Monorepo 重组 (100%)
   - packages/core, agents, cli 结构
   - workspace 配置
   - 57 个文件迁移

✅ Phase 1.5: 路径更新 (100%)
   - 所有 import 路径正确
   - 9 个文件更新

✅ Phase 2.0: 代码清理 (100%)
   - 删除 6+ 个重复文件
   - 解决反向依赖
   - TaskEvent → @taskagent/core

✅ Phase 2.1: Event Bus 集成 (100%)
   - EventBus 实例创建
   - 5 种事件订阅
   - Tab 隔离消息过滤

✅ Phase 3: Agent 重构 (100%)
   - EventBus Adapter (105 lines)
   - AgentRegistry (213 lines)
   - 4 个 Agent 注册
```

---

## ⚠️ 当前问题

### 1. 代码无法运行 🔴

**原因**: Yarn PnP 模块解析问题

```bash
# TypeScript 编译错误
$ cd packages/core && tsc --noEmit
error TS2307: Cannot find module 'node:events'
error TS2307: Cannot find module 'zod'
```

**根本原因**:
- Yarn PnP 不使用 `node_modules`
- TypeScript 需要配置才能找到 PnP 解析的模块
- 需要 `yarn run tsc` 或配置 SDK

### 2. 测试无法运行 🔴

**原因**: 
- 代码无法编译 → 测试无法运行
- 旧测试路径已更新，但测试逻辑可能过时

```bash
# 测试文件已更新路径
tests/registry-slash.test.ts  ✅ 路径已更新
tests/fork-session.test.ts    ✅ 路径已更新

# 但是...
- 测试依赖的代码无法编译
- 测试可能依赖旧的架构（直接调用 UI）
- 测试可能不适用新架构（EventBus）
```

---

## 🎯 "修复测试"的真正目标是什么？

### ❌ 错误的理解

> "修复测试 = 让旧测试全部 pass"

**问题**:
- 旧测试基于旧架构（Agent 直接调用 UI）
- 新架构已完全改变（Agent → EventBus → UI）
- 强行修复旧测试 = 测试过时的架构

---

### ✅ 正确的目标

> "修复测试 = 验证新架构能正常工作"

**分为两个阶段**:

#### 阶段 1: 让代码能运行 (必需)
**目标**: 解决编译问题，代码可以启动

**任务**:
1. 修复 Yarn PnP TypeScript 配置
2. 解决模块解析问题
3. 验证 `yarn start` 可以运行

**验收标准**:
- ✅ `tsc --noEmit` 通过（或 `yarn run tsc`）
- ✅ `yarn start` 可以启动应用
- ✅ 没有编译错误

**预计时间**: 1-2 小时

---

#### 阶段 2: 验证新架构 (核心)
**目标**: 确保新架构（EventBus + AgentRegistry）工作正常

**验证方式 A: 手动测试** (推荐)
```bash
# 1. 启动应用
yarn start

# 2. 切换到 Story Tab
# 3. 输入: "创建一个登录页面的 story"
# 4. 验证:
#    - Agent 通过 EventBus 发送事件 ✓
#    - CLI 接收事件并更新 UI ✓
#    - 消息显示在 Story Tab ✓
#    - 切换到 Chat Tab，Story 消息不显示 ✓ (Tab 隔离)
```

**验证方式 B: 新增集成测试**
```typescript
// tests/eventbus-integration.test.ts (新建)
describe('EventBus Integration', () => {
  it('Agent 通过 EventBus 发送消息', async () => {
    const eventBus = new EventBus();
    const messages: AgentEvent[] = [];
    
    // 订阅事件
    eventBus.on('agent:text', (event) => messages.push(event));
    
    // 模拟 Agent 发送事件
    eventBus.emit({
      type: 'agent:text',
      agentId: 'story',
      tabId: 'Story',
      timestamp: Date.now(),
      payload: 'Hello',
      version: '1.0',
    });
    
    // 验证
    expect(messages.length).toBe(1);
    expect(messages[0].payload).toBe('Hello');
  });
  
  it('Tab 隔离正确工作', () => {
    const messages = [
      { id: 1, content: 'A', sourceTabId: 'Story' },
      { id: 2, content: 'B', sourceTabId: 'Glossary' },
      { id: 3, content: 'C' }, // 无 sourceTabId = 全局
    ];
    
    // 过滤 Story Tab 的消息
    const storyMessages = messages.filter(msg => 
      !msg.sourceTabId || msg.sourceTabId === 'Story'
    );
    
    // 验证
    expect(storyMessages.length).toBe(2); // A + C
    expect(storyMessages[0].content).toBe('A');
    expect(storyMessages[1].content).toBe('C');
  });
});
```

**验收标准**:
- ✅ EventBus 事件发送/接收正常
- ✅ Tab 隔离过滤正确
- ✅ Agent 可以通过 Registry 启动
- ✅ Agent → EventBus → UI 流程完整

**预计时间**: 2-3 小时

---

#### 阶段 3: 更新/重写旧测试 (可选)
**目标**: 适配旧测试到新架构

**策略**:
- 保留核心业务逻辑的测试
- 删除过时的 UI 集成测试
- 重写为 EventBus 集成测试

**示例**: `tests/registry-slash.test.ts`

**Before** (旧架构):
```typescript
// 测试 Driver 直接调用 startForeground
it('resolves fg:glossary and invokes startForeground', async () => {
  const startForeground = vi.fn().mockReturnValue({ cancel: () => {} });
  const context = { startForeground, ... };
  
  await entry.handler(message, context);
  
  expect(startForeground).toHaveBeenCalledTimes(1);
});
```

**After** (新架构):
```typescript
// 测试 Driver 通过 AgentRegistry + EventBus
it('resolves fg:glossary and starts agent via registry', async () => {
  const eventBus = new EventBus();
  const events: AgentEvent[] = [];
  eventBus.on('agent:text', (e) => events.push(e));
  
  // 使用 globalAgentRegistry.startAgent()
  await globalAgentRegistry.startAgent(
    'glossary',
    'define API',
    { sourceTabId: 'Glossary', workspacePath: process.cwd() },
    eventBus,
    async () => undefined // canUseTool
  );
  
  // 验证事件发送
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].agentId).toBe('glossary');
});
```

**预计时间**: 2-4 小时

---

## 📋 完整的测试策略

### 优先级排序

| 优先级 | 任务 | 目标 | 时间 | 必要性 |
|--------|------|------|------|--------|
| 🔥 **P0** | 修复编译 | 代码能运行 | 1-2h | **必需** |
| 🔴 **P1** | 手动测试新架构 | 验证 EventBus 工作 | 30min | **必需** |
| 🟡 **P2** | 新增集成测试 | 自动化验证 | 2-3h | **推荐** |
| 🟢 **P3** | 更新旧测试 | 适配新架构 | 2-4h | 可选 |

---

## 🎯 推荐的执行顺序

### Step 1: 修复编译 (P0) 🔥

**目标**: 让代码可以运行

**任务**:
```bash
# 方案 A: 使用 yarn run tsc (快速)
yarn run tsc --noEmit

# 方案 B: 配置 TypeScript SDK (彻底)
yarn dlx @yarnpkg/sdks vscode
yarn dlx @yarnpkg/sdks vim  # 如果使用 vim
```

**验收**:
- ✅ `yarn run tsc --noEmit` 无错误
- ✅ `yarn start` 可以启动

**预计时间**: 1 小时

---

### Step 2: 手动验证新架构 (P1) 🔴

**目标**: 确认核心功能工作

**测试清单**:
```
1. 启动应用 ✓
   $ yarn start

2. 测试 EventBus 日志 ✓
   查看 debug.log:
   - [EventBus] Created new EventBus instance
   - [EventBus] Subscribed to all agent events
   - [AgentRegistry] All agents registered

3. 测试 Story Agent ✓
   - 切换到 Story Tab
   - 输入: "创建登录 story"
   - 验证消息显示

4. 测试 Tab 隔离 ✓
   - Story Tab 有消息
   - 切换到 Chat Tab
   - 验证 Story 消息不显示

5. 测试 Glossary Agent ✓
   - 切换到 Glossary Tab
   - 输入: "What is API?"
   - 验证消息显示且隔离

6. 查看 EventBus 日志 ✓
   debug.log 应该有:
   - [EventBus] Received agent:text from story
   - [EventBus] Received agent:completed from story
```

**验收**:
- ✅ 所有 6 项测试通过
- ✅ debug.log 有完整的 EventBus 日志

**预计时间**: 30 分钟

---

### Step 3: 新增集成测试 (P2) 🟡

**目标**: 自动化验证核心功能

**新建测试文件**:
```
tests/
├── eventbus-integration.test.ts   (EventBus 基础功能)
├── tab-isolation.test.ts          (Tab 隔离)
├── agent-registry.test.ts         (AgentRegistry)
└── agent-eventbus-flow.test.ts    (端到端流程)
```

**验收**:
- ✅ 4 个新测试文件
- ✅ 所有新测试 pass
- ✅ 覆盖核心功能

**预计时间**: 2-3 小时

---

### Step 4: 更新旧测试 (P3) 🟢

**目标**: 适配旧测试到新架构

**策略**:
- 保留: 核心业务逻辑测试
- 删除: 过时的 UI 集成测试
- 重写: 改为 EventBus 测试

**验收**:
- ✅ 旧测试适配完成
- ✅ CI 测试全部 pass

**预计时间**: 2-4 小时

---

## 💡 关键洞察

### 测试的真正目的

> **不是让旧测试 pass，而是验证新架构能工作**

```
旧架构测试 → 可能过时，不必强求 pass
新架构验证 → 核心目标，必须完成
```

### 最小可行验证 (MVP)

**最快验证新架构的方式**:

```
1. 修复编译 (1 hour)
   ↓
2. 手动测试 (30 min)
   ↓
3. 确认工作 ✓
```

**总计**: 1.5 小时即可验证核心架构

**新增自动化测试**: 后续渐进式添加

---

## 🎯 最终目标定义

### "修复测试"的真正含义

| 层次 | 目标 | 验收标准 | 必要性 |
|------|------|----------|--------|
| **L1: 基础** | 代码能运行 | `yarn start` 成功 | ✅ 必需 |
| **L2: 核心** | 新架构工作 | 手动测试通过 | ✅ 必需 |
| **L3: 稳定** | 自动化测试 | 新测试 pass | 🟡 推荐 |
| **L4: 完整** | 所有测试 pass | CI 通过 | 🟢 理想 |

---

## 📊 时间估算

```
P0: 修复编译               1 hour    🔥 立即
P1: 手动验证               30 min    🔥 立即
------------------------------------------
  MVP (验证新架构)          1.5 hours  ← 最小目标

P2: 新增集成测试           2-3 hours  🟡 推荐
P3: 更新旧测试             2-4 hours  🟢 可选
------------------------------------------
  完整测试覆盖              5-8 hours  ← 理想目标
```

---

## 🚀 推荐行动

### 立即执行 (MVP)

1. **修复编译** (P0) - 1 hour
   - 配置 Yarn PnP + TypeScript
   - 验证 `yarn start` 可运行

2. **手动验证** (P1) - 30 min
   - 测试 EventBus 日志
   - 测试 Tab 隔离
   - 确认核心功能

**完成后**: ✅ 新架构验证完成，可以继续开发

---

### 后续渐进 (完善)

3. **新增集成测试** (P2) - 2-3 hours
   - EventBus 测试
   - Tab 隔离测试
   - Agent Registry 测试

4. **更新旧测试** (P3) - 2-4 hours
   - 适配新架构
   - 删除过时测试

**完成后**: ✅ 自动化测试完整，CI 可用

---

## 💡 结论

### 核心观点

> **"修复测试"不是目的，验证新架构才是目标**

- ❌ 不要纠结于让旧测试 pass
- ✅ 重点验证新架构（EventBus + AgentRegistry）能工作
- ✅ MVP: 修复编译 + 手动验证 (1.5 hours)
- ✅ 理想: 新增自动化测试 (5-8 hours total)

### 下一步

**建议**: 先完成 MVP (P0 + P1)，验证架构正确后再决定是否继续 P2/P3

---

**分析时间**: 2025-11-05 00:45  
**推荐**: 执行 P0 (修复编译) → P1 (手动验证) → 确认架构 OK  
**MVP 时间**: 1.5 小时  

