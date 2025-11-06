# 测试入口点总结

**日期**: 2025-11-05 00:50  
**项目**: TaskAgent Monorepo  

---

## 📋 测试入口汇总

### 1️⃣ Vitest 单元/集成测试

**配置文件**: `vitest.config.ts`

**运行命令**:
```bash
# 运行所有测试（watch 模式）
yarn test

# 运行所有测试（CI 模式，一次性）
yarn test:ci

# 运行测试（watch 模式）
yarn test:watch
```

**配置详情**:
```typescript
{
  include: ['tests/**/*.test.ts'],  // 包含所有 .test.ts 文件
  environment: 'node',               // Node.js 环境
  testTimeout: 60_000,               // 60秒超时
  pool: 'threads',                   // 使用线程池
  singleThread: true,                // 顺序执行（避免资源冲突）
}
```

**测试文件**: 4 个
```
tests/
├── registry-slash.test.ts        # Driver 注册和 slash 命令测试
├── fork-session.test.ts          # Session fork 功能测试
└── e2e/
    ├── cli.test.ts               # CLI 基础测试
    └── automation.test.ts        # E2E 自动化测试
```

---

### 2️⃣ 快速冒烟测试 (非交互模式)

**Story 测试**:
```bash
yarn test:story
# 等价于: yarn start -- --story -p "Hi"
```

**功能**: 
- 启动应用并切换到 Story Tab
- 自动发送 "Hi" 消息
- 验证应用启动和 Story Agent 基础功能
- 7 秒后自动退出

**Glossary 测试**:
```bash
yarn test:glossary
# 等价于: yarn start -- --glossary -p "Hi"
```

**功能**:
- 启动应用并切换到 Glossary Tab
- 自动发送 "Hi" 消息
- 验证 Glossary Agent 基础功能
- 7 秒后自动退出

---

### 3️⃣ E2E Expect 脚本测试

**运行命令**:
```bash
yarn e2e:experiment
# 等价于: expect scripts/e2e-experiment.expect --
```

**功能**:
- 使用 TCL expect 脚本驱动应用
- 自动化交互测试
- 验证终端 UI 交互

**Expect 脚本位置**:
```
scripts/
└── e2e-experiment.expect    # Expect 自动化脚本
```

---

## 📊 测试类型分类

### A. 单元测试

**文件**: 
- `tests/fork-session.test.ts`
- `tests/registry-slash.test.ts`

**特点**:
- ✅ 测试单个模块/函数
- ✅ 使用 mock/stub 隔离依赖
- ✅ 快速执行（毫秒级）

**示例**:
```typescript
// tests/fork-session.test.ts
describe('forkSession propagation', () => {
  it('passes forkSession=true to SDK options', async () => {
    await runClaudeStream({
      prompt: 'hello',
      session: { id: 'sess-123', initialized: true },
      queryOptions: { forkSession: true },
      // ...
    });
    // 验证 forkSession 参数传递
  });
});
```

---

### B. 集成测试

**文件**:
- `tests/e2e/cli.test.ts`
- `tests/e2e/automation.test.ts`

**特点**:
- ✅ 测试多个模块协作
- ✅ 真实启动应用进程
- ✅ 验证端到端流程

**示例**:
```typescript
// tests/e2e/cli.test.ts
describe('CLI smoke tests', () => {
  it('starts and exits cleanly', async () => {
    const result = await runCommand('yarn', ['start']);
    expect(result.exitCode).toBe(0);
  });
});
```

---

### C. 冒烟测试 (Smoke Tests)

**命令**:
- `yarn test:story`
- `yarn test:glossary`

**特点**:
- ✅ 快速验证核心功能
- ✅ 非交互模式（自动化）
- ✅ 适合 CI/CD pipeline

**流程**:
```
启动应用 → 切换 Tab → 发送消息 → 7秒后退出
```

---

### D. E2E 交互测试

**命令**:
- `yarn e2e:experiment`

**特点**:
- ✅ 使用 expect 脚本
- ✅ 模拟真实用户交互
- ✅ 验证终端 UI 响应

**工具**: TCL expect (需要安装)

---

## 🎯 测试覆盖分析

### 当前测试覆盖

| 测试类型 | 文件数 | 覆盖范围 | 状态 |
|---------|-------|---------|------|
| **单元测试** | 2 个 | forkSession, slash commands | ⚠️ 旧架构 |
| **集成测试** | 2 个 | CLI 启动, E2E 自动化 | ⚠️ 旧架构 |
| **冒烟测试** | 2 个 | Story, Glossary 基础功能 | ⚠️ 旧架构 |
| **E2E 测试** | 1 个 | 交互流程 | ⚠️ 旧架构 |

### 缺失的测试覆盖

| 测试类型 | 覆盖范围 | 优先级 |
|---------|---------|--------|
| **EventBus** | 事件发送/接收 | 🔥 High |
| **Tab 隔离** | 消息过滤 | 🔥 High |
| **AgentRegistry** | Agent 注册/启动 | 🔴 Medium |
| **EventBus Adapter** | 回调转事件 | 🔴 Medium |
| **Message Protocol** | sourceTabId, timestamp | 🟡 Low |

---

## ⚠️ 当前测试状态

### 问题 1: 编译错误

```bash
$ yarn test:ci
# Error: Cannot find module 'zod'
# Error: Cannot find module 'node:events'
```

**原因**: Yarn PnP 模块解析问题  
**影响**: ❌ 所有测试无法运行

---

### 问题 2: 架构不匹配

**旧测试假设**:
- Agent 直接调用 `startForeground()`
- Driver 直接更新 UI 状态
- 没有 EventBus 中间层

**新架构实现**:
- Agent → EventBus Adapter → EventBus → UI
- Driver 使用 `globalAgentRegistry.startAgent()`
- 完全解耦

**结果**: ⚠️ 旧测试逻辑过时

---

## 🚀 测试优先级

### P0: 修复编译 (必需)

**任务**: 让测试可以运行

```bash
# 方案 A: 使用 yarn run
yarn run vitest run

# 方案 B: 配置 TypeScript SDK
yarn dlx @yarnpkg/sdks vscode
```

**验收**: `yarn test:ci` 可以执行（不要求 pass）

---

### P1: 验证冒烟测试 (快速验证)

**任务**: 确认基础功能

```bash
# 测试 Story
yarn test:story
# 预期: 启动 → 发送 "Hi" → 7秒后退出 (code 0)

# 测试 Glossary
yarn test:glossary
# 预期: 启动 → 发送 "Hi" → 7秒后退出 (code 0)
```

**验收**: 两个冒烟测试都返回 exit code 0

---

### P2: 新增 EventBus 测试 (新架构验证)

**新建测试文件**:
```
tests/
├── eventbus/
│   ├── eventbus-basic.test.ts       # EventBus 基础功能
│   ├── tab-isolation.test.ts        # Tab 隔离
│   └── adapter.test.ts              # EventBus Adapter
└── registry/
    └── agent-registry.test.ts       # AgentRegistry
```

**验收**: 新测试覆盖核心架构

---

### P3: 更新旧测试 (适配新架构)

**策略**:
- ✅ 保留: 核心逻辑测试 (forkSession)
- ❌ 删除: 过时的 UI 集成测试
- 🔄 重写: 改为 EventBus 测试 (registry-slash)

**验收**: CI 全部 pass

---

## 📋 测试清单

### 当前可用的测试命令

| 命令 | 用途 | 状态 | 可运行 |
|------|------|------|--------|
| `yarn test` | Vitest watch 模式 | ⚠️ | ❌ (编译错误) |
| `yarn test:ci` | Vitest CI 模式 | ⚠️ | ❌ (编译错误) |
| `yarn test:story` | Story 冒烟测试 | ⚠️ | ❌ (编译错误) |
| `yarn test:glossary` | Glossary 冒烟测试 | ⚠️ | ❌ (编译错误) |
| `yarn e2e:experiment` | Expect 自动化测试 | ⚠️ | ❓ (未验证) |

### 修复后可用的测试流程

```bash
# 1. 修复编译
yarn dlx @yarnpkg/sdks vscode

# 2. 运行单元测试
yarn test:ci

# 3. 运行冒烟测试
yarn test:story
yarn test:glossary

# 4. 运行 E2E 测试
yarn e2e:experiment

# 5. 查看测试报告
cat artifacts/junit.xml
```

---

## 💡 推荐测试策略

### 阶段 1: 修复基础 (P0)

**目标**: 让测试可以运行

```bash
# 修复编译
yarn dlx @yarnpkg/sdks vscode

# 验证测试可执行
yarn run vitest run
```

**预计时间**: 1 hour

---

### 阶段 2: 快速验证 (P1)

**目标**: 验证基础功能

```bash
# 冒烟测试
yarn test:story    # 应返回 0
yarn test:glossary # 应返回 0

# 手动启动验证
yarn start
# 测试 Story Tab
# 测试 Tab 隔离
```

**预计时间**: 30 min

---

### 阶段 3: 新增测试 (P2)

**目标**: 覆盖新架构

```bash
# 创建新测试
tests/eventbus/eventbus-basic.test.ts
tests/eventbus/tab-isolation.test.ts
tests/registry/agent-registry.test.ts

# 运行新测试
yarn test:ci
```

**预计时间**: 2-3 hours

---

## 📊 总结

### 测试入口总览

```
5 种测试入口:
├── yarn test          (Vitest watch)
├── yarn test:ci       (Vitest CI)
├── yarn test:story    (冒烟测试 - Story)
├── yarn test:glossary (冒烟测试 - Glossary)
└── yarn e2e:experiment (Expect 自动化)

4 个测试文件:
├── tests/registry-slash.test.ts  (Driver 注册)
├── tests/fork-session.test.ts    (Session fork)
├── tests/e2e/cli.test.ts         (CLI 基础)
└── tests/e2e/automation.test.ts  (E2E 自动化)
```

### 当前状态

```
❌ 所有测试无法运行 (编译错误)
⚠️ 测试基于旧架构 (需要更新)
✅ 测试结构完整 (5 个入口 + 4 个文件)
```

### 下一步

```
1. 修复编译 (P0) - 1 hour
2. 冒烟测试 (P1) - 30 min
3. 新增测试 (P2) - 2-3 hours
```

---

**报告时间**: 2025-11-05 00:50  
**测试入口**: 5 个  
**测试文件**: 4 个  
**推荐**: 先修复编译，再验证冒烟测试  

