# 重构路线图 v2.0 - AI Runtime 架构补充

## 更新时间
2025-11-04 16:30

## 核心变更
在重构路线图 v2.0 中补充了 AI Runtime 集成层的完整设计，明确区分了两种 AI 能力。

## 新增内容

### 1. AI Runtime Package (`packages/ai-runtime/`)

#### 目录结构
```
packages/ai-runtime/
├── claude/              # Claude Agent SDK 封装
│   ├── runClaudeStream.ts
│   ├── buildPromptAgentStart.ts
│   └── types.ts
├── vercel/              # Vercel AI SDK 封装
│   ├── runChatStream.ts
│   └── types.ts
└── package.json
```

#### 依赖关系
- 依赖：`@anthropic-ai/claude-agent-sdk`, `ai` (Vercel SDK)
- 被依赖：`@taskagent/agents`, `@taskagent/cli`

---

### 2. 两种 AI 能力对比

#### Chat 模式（Vercel AI SDK）
- **适用场景**: 简单对话、快速响应
- **适用 Tab**: Chat
- **特点**: 
  - ✅ 简单快速
  - ✅ 流式输出
  - ❌ 无工具调用
  - ❌ 无 Session 管理
- **API**: `runChatStream()`

#### Agent 模式（Claude Agent SDK）
- **适用场景**: 工具调用、复杂任务编排、上下文保留
- **适用 Tab**: Story, Glossary, Monitor, UI Review
- **特点**:
  - ✅ 强大工具调用能力
  - ✅ Session 管理（new/resume/fork）
  - ✅ 多 Agent 协作（Coordinator 模式）
  - ✅ 详细日志和监控
- **API**: `runClaudeStream()`

---

### 3. 架构分层更新

新增第 5 层：AI Runtime 集成层

```
CLI 入口层
    ↓
Execution 执行层
    ↓
Agents 业务层
    ↓
AI Runtime 集成层  ← 新增
  ├── Claude Agent SDK
  └── Vercel AI SDK
```

---

### 4. Phase 1 更新

**迁移内容**:
- `src/agent/runtime/` → `packages/ai-runtime/claude/`
- `src/agent/flows/baseClaudeFlow.ts` → `packages/ai-runtime/claude/`
- `ui.tsx` 中的 Chat 逻辑 → `packages/ai-runtime/vercel/`

**package.json**:
```json
{
  "name": "@taskagent/ai-runtime",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^x.x.x",
    "ai": "^4.x.x"
  }
}
```

---

### 5. Phase 3 更新

**关键修改**: 将抽象的 `runLLM` 改为明确的 `runClaudeStream`

```typescript
// 旧代码（抽象）
const result = await runLLM(userInput, { systemPrompt, agents });

// 新代码（明确）
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
```

---

### 6. 关键设计决策

**决策 4**: AI Runtime 双 SDK 架构

**选择**: 分离 Chat（Vercel AI SDK）和 Agent（Claude Agent SDK）

**理由**:
- ✅ Chat 模式快速简单，满足基础对话需求
- ✅ Agent 模式功能强大，支持工具调用和复杂任务
- ✅ 各自优化，不互相干扰
- ✅ 统一封装在 `ai-runtime` package，易于维护
- 📈 未来可扩展其他 SDK（如 LangChain）

---

### 7. 附录：AI Runtime 详细设计

#### Claude Agent SDK 封装
- **文件**: `packages/ai-runtime/claude/runClaudeStream.ts`
- **职责**: Session 管理、日志监控、事件转换
- **详细文档**: `memory/docs/2025-11-04-16-00-claude-agent-sdk-integration.md`

#### Vercel AI SDK 封装
- **文件**: `packages/ai-runtime/vercel/runChatStream.ts`
- **职责**: 简化流式对话、支持 OpenRouter API

---

## 文档位置
- 重构路线图: `memory/docs/2025-11-04-refactor-roadmap-v2.md`
- Claude SDK 集成: `memory/docs/2025-11-04-16-00-claude-agent-sdk-integration.md`

## 关键改进
1. 消除了抽象的 `runLLM` 名称，改为明确的 `runClaudeStream`
2. 明确区分了 Chat 和 Agent 两种模式的底层实现
3. 在架构分层中补充了 AI Runtime 层
4. 在 Monorepo 结构中添加了 `ai-runtime` package
5. 提供了完整的对比表格和代码示例

## 影响范围
- ✅ 架构蓝图更新
- ✅ Phase 1 迁移计划更新
- ✅ Phase 3 代码示例更新
- ✅ 关键设计决策补充
- ✅ 附录补充详细 API 设计
