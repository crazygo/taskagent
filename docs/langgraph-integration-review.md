# LangGraph × RunnableAgent 集成方案审查与落地建议

## 结论概要

- 可行性：高。
- 与当前仓库对齐后的关键修正：
  - ExecutionHandle 在本仓库中不暴露事件监听（仅 `cancel()` 与 `sessionId`），事件/文本流通过 `start()` 的 sinks 回调传递；因此应改为“用 sinks 聚合 -> 返回 Promise”的适配，而非 `handle.on(...)`。
  - 上下文类型应对齐 `AgentStartContext`（`sourceTabId`, `workspacePath`, 可选 `session`）。
  - 取消/超时需要从 LangGraph→Agent 传播；当前 `cancel()` 仅能中止工具用法，基础流取消需后续增强。

整体思路仍然成立：让 LangGraph 负责编排与状态，节点内部通过 `RunnableAgent` 执行，借助一个辅助器把事件式流封装成单一 Promise。

---

## 1) startBackgroundTask：与现有类型的正确契约

建议的 TS 接口与实现骨架（对齐 `src/agent/types.ts`）：

- 输入：`RunnableAgent`、原始 `userInput: string`、`AgentStartContext`、可选 `{ signal?: AbortSignal; timeoutMs?: number }`
- 处理：通过 sinks 聚合 `text`/`events`，监听完成与失败；支持超时与取消；把 `ExecutionHandle` 存下来以便取消。
- 输出：`Promise<AgentFinalResult>`，包含累计文本、事件、`sessionId`、耗时等。

```ts
// types
import type { RunnableAgent, AgentStartContext } from "../src/agent/types";
import type { TaskEvent } from "../src/types";

export type AgentFinalResult = {
  text: string;
  events: TaskEvent[];
  sessionId: string;
  elapsedMs: number;
};

export async function startBackgroundTask(
  agent: RunnableAgent,
  userInput: string,
  context: AgentStartContext,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<AgentFinalResult> {
  const startedAt = Date.now();
  const events: TaskEvent[] = [];
  let text = "";
  let completed = false;
  let resolveFn!: (v: AgentFinalResult) => void;
  let rejectFn!: (e: unknown) => void;

  const p = new Promise<AgentFinalResult>((resolve, reject) => {
    resolveFn = resolve; rejectFn = reject;
  });

  // 组装 sinks：按仓库契约通过回调接收数据
  const handle = agent.start(userInput, context, {
    onText: (chunk) => { text += chunk; },
    onEvent: (e) => { if (e) events.push(e); },
    onCompleted: () => {
      if (!completed) {
        completed = true;
        resolveFn({
          text,
          events,
          sessionId: handle.sessionId,
          elapsedMs: Date.now() - startedAt,
        });
      }
    },
    onFailed: (err) => { if (!completed) { completed = true; rejectFn(new Error(err)); } },
    canUseTool: async (...args) => context.session ? Promise.resolve(true) : Promise.resolve(true),
  });

  // 超时
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      handle.cancel();
      if (!completed) {
        completed = true;
        rejectFn(new Error(`Task timed out after ${opts.timeoutMs}ms`));
      }
    }, opts.timeoutMs);
  }

  // 取消（LangGraph 或调用方传入的 AbortSignal）
  const abortHandler = () => {
    try { handle.cancel(); } catch {}
    if (!completed) {
      completed = true;
      rejectFn(new Error('Task was cancelled'));
    }
  };
  opts.signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    const result = await p;
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    opts.signal?.removeEventListener('abort', abortHandler);
  }
}
```

注意：当前 `ExecutionHandle.cancel()` 在实现上（`src/agent/runtime/runPromptAgentStart.ts`）使用了本地 `AbortController`，但未将 signal 传入基础流（`runClaudeStream`）。这意味着：
- 取消可中止工具调用（通过 `canUseTool` 的 signal），
- 但基础模型流可能继续直至完成。建议后续增强：
  - 将 `AbortSignal` 贯穿到 `runClaudeStream` / SDK `query()`，或
  - 在 abort 时调用 async iterator 的 `return()`（若 SDK 支持），以真正终止流。

---

## 2) 适配器节点（Adapter Node）模式

为避免在每个节点重复样板代码，提供一个通用 Node 适配器：

```ts
// NodeFn 与适配器
export type NodeFn<S> = (state: S, ctx: AgentStartContext, opts?: { signal?: AbortSignal }) => Promise<Partial<S>>;

export function makeAgentNode<S>(
  agent: RunnableAgent,
  selectInput: (s: S) => string,
  applyResult: (s: S, r: AgentFinalResult) => Partial<S>,
  options?: { timeoutMs?: number }
): NodeFn<S> {
  return async (state, ctx, opts) => {
    const res = await startBackgroundTask(agent, selectInput(state), ctx, { signal: opts?.signal, timeoutMs: options?.timeoutMs });
    return applyResult(state, res);
  };
}
```

在 Plan-Review-Do 中的具体示例：

```ts
// 假设存在对应的 RunnableAgent 包装器（可用现有 agentsConfig 派生）
const plannerAgent: RunnableAgent = /* ... */;
const reviewerAgent: RunnableAgent = /* ... */;
const executorAgent: RunnableAgent = /* ... */;

// State 参考 src/drivers/plan-review-do/flow.ts
type PRDState = { task: string; plan?: string; messages: Message[] };

export const plannerNode: NodeFn<PRDState> = makeAgentNode(
  plannerAgent,
  (s) => s.task,
  (_s, r) => ({ plan: r.text })
);

export const reviewerNode: NodeFn<PRDState> = makeAgentNode(
  reviewerAgent,
  (s) => s.plan ?? "",
  (_s, r) => ({ /* 例如：is_plan_approved, review_feedback 等 */ })
);

export const executorNode: NodeFn<PRDState> = makeAgentNode(
  executorAgent,
  (s) => JSON.stringify({ task: s.task, plan: s.plan }),
  (_s, r) => ({ /* 可把摘要等写入 messages */ })
);
```

---

## 3) Workflow 组装与渐进式集成

目前仓库已在 package.json 中声明了 LangGraph 依赖（@langchain/langgraph），但 src 目录下尚未使用该库；同时已存在一个顺序编排器 `runTask()`（见 `src/drivers/plan-review-do/flow.ts`）。建议引入一层运行时抽象，便于渐进式迁移：

```ts
export interface IWorkflowRuntime<S> {
  run(initial: S, graph: { entry: string; nodes: Record<string, NodeFn<S>>; router?: (s: S) => string | '__end__' }): Promise<S>;
}

// 1) 现有顺序实现（已可用）
export class SequentialRuntime<S> implements IWorkflowRuntime<S> {
  async run(initial: S, graph: { entry: string; nodes: Record<string, NodeFn<S>>; router?: (s: S) => string | '__end__' }): Promise<S> {
    let state = initial; let current = graph.entry;
    while (current !== '__end__') {
      state = { ...state, ...(await graph.nodes[current](state, { sourceTabId: 'cli' })) } as S;
      current = graph.router ? graph.router(state) : '__end__';
    }
    return state;
  }
}

// 2) LangGraphRuntime（后续引入 langgraph 后实现）
export class LangGraphRuntime<S> implements IWorkflowRuntime<S> {
  async run(initial: S, graph: { entry: string; nodes: Record<string, NodeFn<S>>; router?: (s: S) => string | '__end__' }): Promise<S> {
    // 将 nodes 包装为 LangGraph 节点，节点体内调用 NodeFn（即 startBackgroundTask）
    // 使用 runnableGraph.stream(...) 消费状态流并合并输出
    return initial; // 伪代码占位
  }
}
```

先以 `SequentialRuntime` 落地 adapter 与契约，确保行为正确；再切换/扩展为 LangGraph，实现 for-await-of 的流式状态消费与路由。

---

## 4) 生命周期与边界条件

- 取消（Cancellation）
  - LangGraph 节点收到 abort → 调用 `startBackgroundTask` 的 signal → 触发 `handle.cancel()`；
  - 目前基础流不会立刻终止（见“注意”），建议后续贯穿 AbortSignal 到 `runClaudeStream/query()`。
- 超时（Timeout）
  - 在 `startBackgroundTask` 内实现，触发时调用 cancel 并以 Error 结束。
- 重试（Retry）
  - 在节点层或 LangGraph 条件边缘实现指数退避重试，注意幂等性与副作用（比如工具调用）。
- 回压与 UI 刷新（Backpressure）
  - sinks.onText 频繁回调时，可在节点侧做节流（现有 UI 已有 100ms 节流策略）。
- 局部成功/部分结果
  - 在 `onFailed` 之前也可能累计了部分 `text`/`events`；如需保留，可在错误路径附带 `partial: true` 标记。
- 权限与工具调用
  - 通过 `canUseTool` surface 的 AbortSignal 已支持取消；注意将 LangGraph 的取消同步到这里。

---

## 5) 与现有 Plan-Review-Do 的兼容

- 当前 `flow.ts` 使用 `hooks.startTask/waitTask` 与 `agentsConfig`（Claude Agent SDK）。
- 上述方案可以通过两种方式融入：
  1) 直接基于 `agentsConfig` 构造三个 `RunnableAgent` 封装器（Planner/Reviewer/Executor），其 `getAgentDefinitions()` 即返回对应子代理定义；
  2) 或者引入一个“Coordinator StackAgent”，将 `planner/reviewer/executor` 暴露为子代理，通过一个协调 Prompt 完成内部对话（与现有 `StackAgent` 抽象契合）。
- 迁移策略：先用 `SequentialRuntime` + Adapter Node 替换 `hooks` 的调用点，确保行为与输出标签契约（`<plan>`, `<exit .../>` 等）一致，再按需切到 LangGraph。

---

## 6) 验收标准（Acceptance Criteria）

- 节点契约
  - 给定有效 `task`，planner 节点返回 Promise 并解析出 `plan`；
  - reviewer 节点基于 `plan` 生成是否通过的信号（或反馈字段），失败时返回明确错误；
  - executor 节点基于 `task+plan` 产出 `<summary>` 与 `<exit confidence=.../>`。
- 生命周期
  - 在 3 种路径下正确结束：完成、失败、取消；
  - `timeoutMs` 到时应触发取消；
  - 取消/失败不产生悬挂的进行中流或工具调用（工具侧已取消）。
- 观测性
  - `events` 聚合包含 parseOutput 产物；
  - `sessionId` 与耗时可用于日志与调试。
- 渐进式集成
  - 在不引入 LangGraph 依赖的情况下，使用 `SequentialRuntime` 跑通；随后可替换为 LangGraph 且对外行为不变。

---

## 7) 后续小改进建议

- 在 `runPromptAgentStart.ts` 中把本地 `AbortController.signal` 贯穿到 `runClaudeStream` 与 SDK `query()`，确保 `cancel()` 能立即终止底层流。
- 为 `startBackgroundTask` 增加最小单元测试（完成、失败、超时、取消各 1 个）。
- 增加一个 `makeAgentNode` 的复用封装，减少节点样板。
- 对 Plan-Review-Do 的标签解析（`<plan>`, `<exit .../>`）做成纯函数，避免重复正则逻辑。
