# 优先级分析与下一步建议

**时间**: 2025-11-04 23:55  
**当前状态**: Phase 1.5 完成，准备开始 Phase 2  

---

## 📊 当前状态

### 已完成
```
✅ Phase 1: Monorepo 重组          (100%)
✅ Phase 1.5: 路径更新             (100%)
   - 57 个 TS/TSX 文件
   - 9 个文件已修改
   - 路径结构完全正确
```

### 待办任务
```
⏳ Task 5: 确保测试 pass           (稍后)
⏳ Phase 2: CLI 集成 EventBus      (待开始)
⏳ Phase 2: MessageStore 重构       (待开始)
⏳ Phase 3: Agent 重构              (待开始)
```

---

## 🔍 发现的关键问题

### 🔥 Problem 1: 代码重复（6 个重复目录）

**现状**:
```
packages/agents/story/              ← Agent 实现
packages/cli/drivers/story/         ← Agent wrapper (重复)

packages/agents/glossary/           ← Agent 实现
packages/cli/drivers/glossary/      ← Agent wrapper (重复)

packages/agents/ui-review/          ← Agent 实现
packages/cli/drivers/ui-review/     ← Agent wrapper (重复)
```

**影响**:
- ❌ 维护困难（需要同时修改两处）
- ❌ 容易出现不一致
- ❌ 占用额外空间
- ❌ 不符合 Monorepo 架构原则

**优先级**: 🔥 **Critical** (P0)

---

### ⚠️ Problem 2: 反向依赖

**现状**:
```typescript
// packages/agents/monitor/LogMonitor.ts
import type { TaskEvent } from '../../cli/types.js';  // ⚠️ agents → cli
```

**影响**:
- ❌ 违反依赖原则（agents 应该独立于 cli）
- ❌ 导致循环依赖风险
- ❌ 不符合分层架构

**优先级**: 🔴 **High** (P1)

---

### ⚠️ Problem 3: Event Bus 未集成

**现状**:
- ✅ Event Bus 已实现（packages/core）
- ❌ CLI 未订阅 Event Bus
- ❌ Agent 未通过 Event Bus 发送消息

**影响**:
- ❌ 无法实现 Tab 隔离
- ❌ 消息流未解耦

**优先级**: 🟡 **Medium** (P2)

---

### 📝 Problem 4: 测试未通过

**现状**:
- ✅ 测试结构已迁移
- ❌ 测试未运行/pass

**影响**:
- ⚠️ 无法验证功能正确性
- ⚠️ 回归风险

**优先级**: 🟢 **Low** (P3) - 用户已明确"稍后"

---

## 🎯 优先级策略分析

### Option A: 按原路线图（Phase 2 → Phase 3）

```
1. Phase 2: Event Bus 集成           [2-3 hours]
2. Phase 2: MessageStore 重构        [1 hour]
3. Phase 3: Agent 重构               [2-3 hours]
4. 清理代码重复                      [1 hour]
```

**优点**: ✅ 按计划执行
**缺点**: ❌ 在混乱的代码上集成，容易出错

---

### Option B: 先清理代码（Phase 3 前置）

```
1. 清理代码重复                      [1 hour]
2. 解决反向依赖                      [30 min]
3. Phase 2: Event Bus 集成           [2 hours]
4. Phase 2: MessageStore 重构        [1 hour]
5. Phase 3: 其他 Agent 重构          [1-2 hours]
```

**优点**: ✅ 代码结构清晰，易于集成
**缺点**: ⚠️ 偏离原路线图

---

### Option C: 混合策略（推荐）⭐

```
Phase 2.0: 代码清理 (前置工作)
  1.1 删除重复 Agent 代码            [30 min]  P0
  1.2 修复 cli/drivers 引用           [20 min]  P0
  1.3 解决反向依赖（TaskEvent → core）[30 min]  P1
  
Phase 2.1: Event Bus 集成
  2.1 CLI 集成 EventBus              [1 hour]   P2
  2.2 MessageStore 重构              [1 hour]   P2
  2.3 验证 Event Bus 通信            [30 min]   P2
  
Phase 2.2: 验证
  2.4 修复编译错误                   [30 min]   P3
  2.5 确保测试 pass                  [1 hour]   P3
```

**总计**: 5-6 小时
**优点**: 
- ✅ 先解决最紧迫的问题
- ✅ 避免在混乱代码上集成
- ✅ 更容易验证每一步
- ✅ 风险更低

**缺点**: 
- ⚠️ 稍微偏离原路线图（但更合理）

---

## 🚀 推荐方案：Option C

### 理由

1. **代码重复是最紧迫的问题**
   - 6 个重复目录
   - 影响所有后续工作
   - 清理后代码结构更清晰

2. **反向依赖需要先解决**
   - 违反架构原则
   - 影响 Event Bus 集成
   - 解决成本低（30 分钟）

3. **Event Bus 集成需要干净的代码**
   - 当前代码混乱
   - 清理后更容易集成
   - 更容易验证正确性

---

## 📋 详细执行计划

### 🔥 Phase 2.0: 代码清理（1.5 小时）

#### Task 2.0.1: 删除重复 Agent 代码 [30 min]

**目标**: 删除 `packages/cli/drivers/{story,glossary,ui-review}/` 下的重复 agent 实现

**步骤**:
```bash
# 1. 确认 packages/agents 中的 agent 是完整的
# 2. 删除 cli/drivers 中的重复文件
rm -rf packages/cli/drivers/story/agents/
rm -rf packages/cli/drivers/glossary/agents/
rm -f packages/cli/drivers/story/agent.ts
rm -f packages/cli/drivers/glossary/agent.ts
```

**验证**: 检查 `packages/cli/drivers/registry.ts` 中的引用

---

#### Task 2.0.2: 修复 cli/drivers 引用 [20 min]

**目标**: 更新 `packages/cli/drivers/` 中对 agent 的引用

**修改文件**:
- `packages/cli/drivers/registry.ts`
- `packages/cli/drivers/story/index.ts`
- `packages/cli/drivers/glossary/index.ts`

**路径映射**:
```typescript
// Before
import { createStoryPromptAgent } from './story/agent.js';

// After
import { createStoryPromptAgent } from '@taskagent/agents/story/index.js';
```

---

#### Task 2.0.3: 解决反向依赖 [30 min]

**目标**: 将 `TaskEvent` 移到 `@taskagent/core`

**步骤**:
1. 从 `packages/cli/types.ts` 提取 `TaskEvent` 类型
2. 移到 `packages/core/types/TaskEvent.ts`
3. 更新所有引用：
   - `packages/cli/` → `@taskagent/core/types/TaskEvent`
   - `packages/agents/monitor/` → `@taskagent/core/types/TaskEvent`

---

### ⚡ Phase 2.1: Event Bus 集成（2.5 小时）

#### Task 2.1.1: CLI 集成 EventBus [1 hour]

**目标**: 在 `packages/cli/main.tsx` 中创建 EventBus 实例

**步骤**:
1. 在 `main.tsx` 中导入并创建 `EventBus`
2. 订阅 `agent:text`, `agent:reasoning`, `agent:completed` 事件
3. 更新 UI 组件以响应事件

---

#### Task 2.1.2: MessageStore 重构 [1 hour]

**目标**: 按 Tab 隔离消息存储

**步骤**:
1. 在 `packages/cli/store/conversationStore.ts` 中添加 Tab 隔离
2. 确保每个 Tab 的消息独立存储
3. 添加 `sourceTabId` 字段验证

---

#### Task 2.1.3: 验证 Event Bus 通信 [30 min]

**目标**: 测试 Event Bus 事件流

**步骤**:
1. 添加调试日志
2. 运行应用测试事件流
3. 验证 Tab 隔离正确

---

### 🧪 Phase 2.2: 验证（2 小时）

#### Task 2.2.1: 修复编译错误 [30 min]

**目标**: 解决 Yarn PnP 模块解析问题

**方案**:
- 使用 `yarn run tsc` 代替 `tsc`
- 或配置 TypeScript SDK 路径

---

#### Task 2.2.2: 确保测试 pass [1 hour]

**目标**: 修复所有测试，确保 CI 通过

**步骤**:
1. 运行 `yarn test:ci`
2. 修复失败的测试
3. 验证所有测试通过

---

## 🎯 下一步行动

### 立即开始：Task 2.0.1

**任务**: 删除重复 Agent 代码  
**预计时间**: 30 分钟  
**优先级**: 🔥 P0 Critical  

**命令**:
```bash
# 1. 确认 packages/agents 中的 agent 是完整的
ls -la packages/agents/{story,glossary,ui-review}/

# 2. 备份（可选）
git status

# 3. 删除重复代码
rm -rf packages/cli/drivers/story/agents/
rm -rf packages/cli/drivers/glossary/agents/
rm -f packages/cli/drivers/story/agent.ts
rm -f packages/cli/drivers/glossary/agent.ts
```

**验证**:
```bash
# 确认删除成功
find packages/cli/drivers -name "*.agent.md" -o -name "agent.ts"
```

---

## 📊 执行时间线

```
Phase 2.0: 代码清理               [1.5 hours]  🔥
  ├─ 2.0.1 删除重复 Agent         [30 min]    ← 立即开始
  ├─ 2.0.2 修复 cli/drivers 引用  [20 min]
  └─ 2.0.3 解决反向依赖           [30 min]

Phase 2.1: Event Bus 集成         [2.5 hours]  ⚡
  ├─ 2.1.1 CLI 集成 EventBus      [1 hour]
  ├─ 2.1.2 MessageStore 重构      [1 hour]
  └─ 2.1.3 验证 Event Bus 通信    [30 min]

Phase 2.2: 验证                   [2 hours]    🧪
  ├─ 2.2.1 修复编译错误           [30 min]
  └─ 2.2.2 确保测试 pass          [1 hour]

---
总计: 6 小时
完成时间: 2025-11-05 凌晨 6:00
```

---

## ✅ 完成标准

### Phase 2.0 完成
- [ ] 无重复 Agent 代码
- [ ] cli/drivers 引用正确
- [ ] 无反向依赖

### Phase 2.1 完成
- [ ] CLI 订阅 Event Bus
- [ ] MessageStore 按 Tab 隔离
- [ ] Event Bus 通信正常

### Phase 2.2 完成
- [ ] TypeScript 编译通过
- [ ] 所有测试 pass
- [ ] CI 通过

---

**建议**: 立即开始 **Task 2.0.1: 删除重复 Agent 代码** 🚀

