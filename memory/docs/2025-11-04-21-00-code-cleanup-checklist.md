# 代码清理清单

**日期**: 2025-11-04 21:00  
**目的**: 移除重复、过时和未使用的代码，保持代码库整洁

---

## 🗑️ 需要清理的代码

### 1. 空目录清理 ✅ 优先级：高

#### src/ 目录（完全空）

**位置**: `/src/`

**内容**:
```
src/
├── drivers/
│   ├── glossary/  (空)
│   └── story/     (空)
└── views/         (空)
```

**原因**: 
- 所有代码已迁移到 `packages/` 目录
- 目录为空，无实际用途
- 造成混淆，让人以为还有旧代码

**清理命令**:
```bash
rm -rf src/
```

**影响**: 无，目录为空

**状态**: ⚠️ 待清理

---

### 2. 重复代码清理 ⚠️ 优先级：中

#### eventBusAdapter.ts（与 MessageAdapter 重复）

**位置**: `packages/agents/runtime/eventBusAdapter.ts`

**问题**:
- 与新实现的 `packages/execution/MessageAdapter.ts` 功能完全重复
- 两者代码基本相同（~105 行 vs ~125 行）
- 目前 `AgentRegistry.ts` 还在使用旧版本

**对比**:

| 特性 | eventBusAdapter | MessageAdapter |
|-----|----------------|----------------|
| 位置 | agents/runtime/ | execution/ |
| 形式 | 函数 | 类 + 方法 |
| 功能 | ✅ 完整 | ✅ 完整 |
| 状态 | 旧版本 | 新版本 |
| 使用 | AgentRegistry | TabExecutor |

**清理步骤**:

1. **更新 AgentRegistry 使用 MessageAdapter**
   ```typescript
   // packages/agents/registry/AgentRegistry.ts
   
   // 删除
   - import { createEventBusAdapter } from '../runtime/eventBusAdapter.js';
   
   // 添加
   + import { MessageAdapter } from '@taskagent/execution/MessageAdapter.js';
   
   // 修改 startAgent 方法
   - const sinks = createEventBusAdapter(
   -     { eventBus, agentId: agent.id, tabId: context.sourceTabId },
   -     canUseTool
   - );
   
   + const adapter = new MessageAdapter(
   +     context.sourceTabId,
   +     agent.id,
   +     eventBus
   + );
   + const sinks = adapter.createSinks(canUseTool);
   ```

2. **删除旧文件**
   ```bash
   rm packages/agents/runtime/eventBusAdapter.ts
   ```

3. **更新 package 依赖**
   ```json
   // packages/agents/package.json
   {
     "dependencies": {
       "@taskagent/execution": "workspace:*"  // 添加依赖
     }
   }
   ```

**影响**: 
- ✅ 代码更一致
- ✅ 减少维护负担
- ⚠️ 需要更新 AgentRegistry

**状态**: ⚠️ 待清理

---

### 3. EventBus 通配符支持 ⚠️ 优先级：低

#### EventBus.ts 中的通配符功能

**位置**: `packages/core/event-bus/EventBus.ts`

**问题**:
- 文档明确说"固定 1.0 版本，不支持通配符"
- 但实现中支持 `'*'` 通配符订阅
- **实际未被使用**（grep 搜索无结果）

**代码**:
```typescript
// 第 26 行 - 发出通配符事件
this.emitter.emit('*', validated);

// 第 32 行 - 支持通配符订阅
on(type: AgentEventType | '*', handler: ...): void
```

**决策选项**:

**选项 A: 保留通配符（推荐）**
- ✅ 功能有用（调试、监控）
- ✅ 实现简单，无性能影响
- ✅ 未来可能需要
- ⚠️ 需要更新文档

**选项 B: 移除通配符**
- ✅ 符合原始文档要求
- ✅ 代码更简单
- ❌ 失去灵活性
- ❌ 未来可能需要重新添加

**推荐**: **选项 A - 保留并更新文档**

**如果选择保留，更新文档**:
```markdown
# 重构路线图 v2.0
## Event Bus 设计

- Event 版本固定为 1.0
- 支持通配符订阅 `'*'` 用于调试和监控
- 类型安全的事件系统
```

**如果选择移除，清理代码**:
```typescript
// packages/core/event-bus/EventBus.ts

emit(event: AgentEvent): void {
    const validated = AgentEventSchema.parse(event);
    this.emitter.emit(event.type, validated);
    // 删除: this.emitter.emit('*', validated);
}

// 将所有 AgentEventType | '*' 改为 AgentEventType
on(type: AgentEventType, handler: ...): void
off(type: AgentEventType, handler: ...): void
once(type: AgentEventType, handler: ...): void
listenerCount(type: AgentEventType): number
removeAllListeners(type?: AgentEventType): void
```

**影响**: 极小（功能未被使用）

**状态**: 💭 待决策

---

### 4. 未使用的导入和类型 ℹ️ 优先级：低

#### 需要检查的文件

运行 `yarn build` 后，TypeScript 会报告未使用的导入。可以使用工具自动清理：

```bash
# 使用 ESLint 检查未使用的导入
npx eslint packages/ --fix

# 或使用 ts-prune 检查未使用的导出
npx ts-prune
```

**常见问题**:
- 未使用的 import 语句
- 导出但从未被导入的类型
- 重复的类型定义

**状态**: ℹ️ 待检查

---

### 5. 老的 Driver 系统 🤔 优先级：待定

#### packages/cli/drivers/ 目录

**位置**: `packages/cli/drivers/`

**内容**:
```
packages/cli/drivers/
├── pipeline.ts
├── plan-review-do/
├── registry.ts
└── types.ts
```

**问题**:
- 与新的 Tab + Agent 架构共存
- 提供 `/fg:` 和 `/bg:` 命令功能
- 部分功能被新架构替代，但命令系统仍在使用

**决策**:
- **暂不清理**: 命令系统（`/fg`, `/bg`）仍在使用老的 Driver 系统
- **长期计划**: 基于 TabExecutor 重写命令系统后再清理

**状态**: 🔄 保留（暂不清理）

---

## 📋 清理优先级总结

### 立即清理（高优先级）

1. ✅ **删除 src/ 目录**
   - 命令: `rm -rf src/`
   - 时间: < 1 分钟
   - 风险: 无

### 近期清理（中优先级）

2. ⚠️ **替换 eventBusAdapter 为 MessageAdapter**
   - 更新 AgentRegistry.ts
   - 删除 eventBusAdapter.ts
   - 添加 execution 依赖
   - 时间: ~30 分钟
   - 风险: 低（需要测试）

### 可选清理（低优先级）

3. 💭 **EventBus 通配符**
   - 选项 A: 保留 + 更新文档（推荐）
   - 选项 B: 移除代码
   - 时间: ~15 分钟
   - 风险: 极低

4. ℹ️ **未使用的导入**
   - 运行 linter
   - 自动修复
   - 时间: ~10 分钟
   - 风险: 无

### 暂不清理

5. 🔄 **老的 Driver 系统**
   - 原因: 命令系统仍在使用
   - 计划: 长期重构后清理

---

## 🛠️ 清理脚本

### 一键清理脚本

```bash
#!/bin/bash
# cleanup.sh - 自动清理脚本

echo "🧹 Starting code cleanup..."

# 1. 删除空的 src/ 目录
if [ -d "src" ] && [ -z "$(ls -A src)" ]; then
    echo "✅ Removing empty src/ directory..."
    rm -rf src/
fi

# 2. 运行 linter 清理未使用的导入
echo "✅ Cleaning unused imports..."
npx eslint packages/ --fix --quiet

# 3. 格式化代码
echo "✅ Formatting code..."
npx prettier --write packages/

echo "🎉 Cleanup complete!"
```

**使用方式**:
```bash
chmod +x cleanup.sh
./cleanup.sh
```

---

## 📊 清理后效果

### 代码行数预估

| 项目 | 清理前 | 清理后 | 减少 |
|-----|-------|-------|------|
| src/ 目录 | 3 个空目录 | 0 | -3 |
| eventBusAdapter | ~105 行 | 0 | -105 |
| 未使用导入 | ~50 行（估计） | 0 | -50 |
| **总计** | ~158 行/结构 | 0 | **-158** |

### 好处

1. ✅ **代码库更清晰**
   - 无空目录
   - 无重复代码
   - 无未使用导入

2. ✅ **维护更简单**
   - 单一实现（MessageAdapter）
   - 清晰的代码边界
   - 减少困惑

3. ✅ **构建更快**
   - 更少的文件需要编译
   - 更少的类型检查

---

## ⚠️ 注意事项

### 清理前

1. **备份代码**
   ```bash
   git add -A
   git commit -m "备份：清理前快照"
   ```

2. **确认测试通过**
   ```bash
   yarn test:ci
   ```

### 清理后

1. **运行测试**
   ```bash
   yarn test:ci
   yarn test:story
   yarn test:glossary
   ```

2. **检查编译**
   ```bash
   yarn build
   ```

3. **手动测试**
   - 启动应用
   - 测试各 Tab 功能
   - 测试 Agent 执行

---

## 📝 决策记录

### EventBus 通配符

**日期**: 待定  
**决策**: 待定  
**选项**: 
- [ ] A. 保留 + 更新文档
- [ ] B. 移除功能

**理由**: _待填写_

---

## ✅ 清理检查清单

执行清理后，逐项确认：

- [ ] src/ 目录已删除
- [ ] eventBusAdapter.ts 已删除
- [ ] AgentRegistry 已更新使用 MessageAdapter
- [ ] 未使用的导入已清理
- [ ] 所有测试通过
- [ ] 编译无错误
- [ ] 手动测试通过
- [ ] Git commit 记录清理操作

---

**创建者**: Claude Assistant  
**审核者**: 待定  
**执行时间**: 预计 1-2 小时（包括测试）

