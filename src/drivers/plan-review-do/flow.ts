
/**
 * PRD minimal flow (Analysis → Review → Do) with plain control flow.
 * NOTE: We will migrate to LangGraph TS StateGraph later without breaking API.
 */

import { streamText } from 'ai';
import * as z from 'zod';
import { ensureAiProvider } from '../../config/ai-provider.ts';
import { addLog } from '../../logger.ts';
import type {
  DoOutcome,
  PlanResult,
  ReviewOutcome,
  PRDStatus,
  TaskDecision,
  SubTask,
  ObservationReport,
  ReviewResult,
} from './types.ts';

// ------------- Helpers -------------

const STREAM_TIMEOUT_MS = 60_000;

async function callAiText(systemPrompt: string, userPayload: string, reasoningEnabled = true): Promise<string> {
  const { provider, modelName } = ensureAiProvider();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), STREAM_TIMEOUT_MS);
  try {
    const options: any = {
      model: provider.chat(modelName),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
      abortSignal: abortController.signal,
    };
    if (reasoningEnabled) {
      options.providerOptions = { openrouter: { reasoning: { effort: 'medium' } } };
    }
    const result: any = await streamText(options);
    let text = '';
    if (result && 'textStream' in result && result.textStream) {
      for await (const delta of result.textStream as AsyncIterable<string>) {
        if (delta) text += delta;
      }
      return text;
    }
    if (result && 'fullStream' in result && result.fullStream) {
      for await (const part of result.fullStream as AsyncIterable<any>) {
        const t = part?.textDelta ?? part?.delta?.text ?? part?.text;
        if (typeof t === 'string') text += t;
      }
      return text;
    }
    // Fallback
    return String(result?.toString?.() ?? '');
  } finally {
    clearTimeout(timer);
  }
}

// JSON helper using zod validation. Instructs model to emit strict JSON.
async function callAiJson<T extends z.ZodTypeAny>(
  schema: T,
  systemPrompt: string,
  userPayload: string,
  reasoningEnabled = true
): Promise<z.infer<T>> {
  const jsonGuard = `
You must respond with STRICT JSON only. No markdown, no commentary, no code fences.
The JSON must validate against this TypeScript-like schema (keys and value types only):
${schema.toString()}
`;
  const text = await callAiText(`${systemPrompt}\n\n${jsonGuard}`, userPayload, reasoningEnabled);
  let raw = text?.trim() || '';
  // Extract first top-level JSON object to be safe
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    raw = raw.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(raw);
    const validated = schema.parse(parsed);
    if (process.env.PRD_DEBUG_VERBOSE) {
      addLog(`[PRD][JSON] validated: ${JSON.stringify(validated).slice(0, 500)}`);
    }
    return validated as z.infer<T>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(`[PRD][JSON] parse/validate failed: ${msg}`);
    throw e;
  }
}

// ------------- Parsers -------------

function normalizeDecision(raw?: string): 'continue' | 'abort' | null {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return null;
  const yes = new Set([
    'continue','cont','yes','y','ok','okay','approved','approve','proceed','go','accept','accepted','pass'
  ]);
  const no = new Set([
    'abort','stop','reject','rejected','cancel','decline','no','n','disapprove','fail','failed'
  ]);
  if (yes.has(v)) return 'continue';
  if (no.has(v)) return 'abort';
  return null;
}

export function parsePlan(text: string): PlanResult {
  const norm = text ?? '';
  const planMatch = norm.match(/\bPLAN:\s*([\s\S]+?)(?:\n\n|$)/i);
  if (planMatch && planMatch[1]?.trim()) {
    return { hasPlan: true, plan: planMatch[1].trim() };
  }
  const noPlan = /\bNO[_\s-]?PLAN\b/i.test(norm);
  if (noPlan) {
    const reason = (norm.match(/\bREASON:\s*([\s\S]+?)(?:\n\n|$)/i)?.[1] || '').trim();
    return { hasPlan: false, reason: reason || 'no plan reason not provided' };
  }
  return { hasPlan: false, reason: 'unparsable' };
}

export function parseReview(text: string): ReviewOutcome {
  const norm = text ?? '';
  const m = norm.match(/\bDECISION:\s*([^\n]+)\b/i);
  const raw = (m?.[1] ?? '').trim().toLowerCase();
  const mapped = normalizeDecision(raw);
  const reason = (norm.match(/\bREASON:\s*([\s\S]+?)(?:\n\n|$)/i)?.[1] || '').trim();
  if (mapped === 'continue') return { decision: 'continue', reason };
  if (mapped === 'abort') return { decision: 'abort', reason: reason || 'review requested abort' };
  return { decision: 'abort', reason: 'unparsable' };
}

export function parseDo(text: string): DoOutcome {
  const norm = text ?? '';
  const diff = norm.match(/```diff\n([\s\S]*?)```/i)?.[1];
  if (diff && diff.trim()) {
    return { codeDiff: diff.trim() };
  }
  const artifactsSection = norm.match(/\bARTIFACTS?:\s*([\s\S]+?)(?:\n\n|$)/i)?.[1];
  const artifacts = artifactsSection
    ? artifactsSection
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
    : undefined;
  const output = norm.match(/\bOUTPUT:\s*([\s\S]+?)(?:\n\n|$)/i)?.[1]?.trim();
  return { codeDiff: undefined, artifacts, output };
}

// ------------- Nodes (plain control flow, graph-friendly API) -------------

// Schemas for structured outputs
const PlanSchema = z.object({
  hasPlan: z.boolean(),
  plan: z.string().optional(),
  reason: z.string().optional(),
});

const ReviewSchema = z.object({
  decision: z.string(),
  reason: z.string().optional(),
});

const DoSchema = z.object({
  codeDiff: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  output: z.string().optional(),
});

export async function makeDecision(prompt: string, hooks: PRDRunHooks): Promise<PlanResult> {
  addLog('[PRD] Analysis started');
  
  try {
    // 使用 TaskManager 创建 Analysis 任务（复用 AI 配置）
    const analysisPrompt = `You are RequirementAnalysis. Analyze the following requirement and create a concise, step-by-step plan.

Requirement:
${prompt}

IMPORTANT: You MUST end your response with one of the following XML tags:
- If you successfully created a plan: <exit hasPlan="true" />
- If you cannot create a plan (unclear requirement, etc.): <exit hasPlan="false" reason="your reason here" />

Example output format:
1. Read the existing file
2. Analyze the structure
3. Make the changes
4. Generate the diff
<exit hasPlan="true" />

Or if you cannot:
I cannot create a plan because the requirement is unclear.
<exit hasPlan="false" reason="requirement unclear" />`;

    const task = hooks.createTask(analysisPrompt);
    addLog(`[PRD] Analysis: Created background task ${task.id}`);
    
    // 等待任务完成
    const completed = await hooks.waitTask(task.id);
    addLog(`[PRD] Analysis: Task ${task.id} completed with status=${completed.status}`);
    
    // 检查结果
    if (completed.status === 'completed' && completed.output) {
      const output = completed.output.trim();
      
      // 提取 <exit /> 标签
      const exitMatch = output.match(/<exit\s+hasPlan="(true|false)"(?:\s+reason="([^"]*)")?\s*\/>/i);
      
      if (!exitMatch) {
        addLog(`[PRD] Analysis: Missing <exit /> tag in output`);
        return { hasPlan: false, reason: 'Output does not contain required <exit /> tag' };
      }
      
      const hasPlan = exitMatch[1] === 'true';
      const reason = exitMatch[2] || undefined;
      
      if (!hasPlan) {
        addLog(`[PRD] Analysis: LLM reported hasPlan=false, reason=${reason}`);
        return { hasPlan: false, reason: reason || 'LLM could not create plan' };
      }
      
      // 提取 plan（移除 <exit /> 标签和其他 XML 噪音）
      let plan = output
        .replace(/<exit\s+[^>]*\/>/gi, '')  // 移除 exit 标签
        .replace(/<\/?(?:function_calls|invoke|parameter)[^>]*>/g, '')  // 移除工具调用噪音
        .trim();
      
      if (plan.length < 10) {
        addLog(`[PRD] Analysis: Plan too short after cleanup (${plan.length} chars)`);
        return { hasPlan: false, reason: 'Plan content too short' };
      }
      
      addLog(`[PRD] Analysis: Valid plan extracted (${plan.length} chars)`);
      return { hasPlan: true, plan };
    }
    
    // 任务失败
    const reason = completed.error || 'Task failed without output';
    addLog(`[PRD] Analysis: Task failed - ${reason}`);
    return { hasPlan: false, reason };
    
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(`[PRD] Analysis error: ${msg}`);
    return { hasPlan: false, reason: msg || 'analysis error' };
  }
}

export async function reviewPlan(plan: string, hooks: PRDRunHooks): Promise<ReviewOutcome> {
  addLog('[PRD] Review started');
  
  try {
    // 使用 TaskManager 创建 Review 任务
    const reviewPrompt = `You are PlanReviewer. Review the following plan for quality and feasibility.

Plan to review:
${plan}

Review Criteria:
1. Completeness: Does the plan include all necessary steps?
2. Correctness: Are the steps logically sound and in the right order?
3. Feasibility: Can these steps be executed by an AI assistant?
4. Clarity: Is each step clearly defined with actionable details?
5. Dependencies: Are step dependencies properly sequenced?

IMPORTANT: You MUST end your response with one of the following XML tags:

- If the plan is approved: <exit decision="continue" />
- If the plan has fatal issues that cannot be fixed: <exit decision="abort" reason="brief issue description" />
- If the plan needs revision but is fixable: <exit decision="replan" reason="what's wrong" suggestions="how to fix it" />

Examples:

Approved plan:
The plan is well-structured with clear steps and proper ordering.
<exit decision="continue" />

Fatal issues:
The requirement is impossible to fulfill because it requires access to external APIs we don't have.
<exit decision="abort" reason="requires unavailable external API access" />

Needs revision:
The plan is missing a critical verification step and the order is incorrect.
<exit decision="replan" reason="missing verification step, wrong order" suggestions="add verification as final step, move step 3 before step 2" />`;

    const task = hooks.createTask(reviewPrompt);
    addLog(`[PRD] Review: Created background task ${task.id}`);
    
    // 等待任务完成
    const completed = await hooks.waitTask(task.id);
    addLog(`[PRD] Review: Task ${task.id} completed with status=${completed.status}`);
    
    // 检查结果
    if (completed.status === 'completed' && completed.output) {
      const output = completed.output.trim();
      
      // 提取 <exit /> 标签
      const exitMatch = output.match(/<exit\s+decision="(continue|abort|replan)"(?:\s+reason="([^"]*)")?(?:\s+suggestions="([^"]*)")?\s*\/>/i);
      
      if (!exitMatch) {
        addLog(`[PRD] Review: Missing <exit /> tag in output`);
        // 保守策略：无法解析时默认 abort
        return { decision: 'abort', reason: 'Review output missing required <exit /> tag' };
      }
      
      const decision = (exitMatch[1] || 'abort').toLowerCase() as 'continue' | 'abort' | 'replan';
      const reason = exitMatch[2] || undefined;
      const suggestions = exitMatch[3] || undefined;
      
      addLog(`[PRD] Review: Decision=${decision}, reason=${reason || 'none'}, suggestions=${suggestions || 'none'}`);
      
      return { decision, reason, suggestions };
    }
    
    // 任务失败
    const reason = completed.error || 'Review task failed without output';
    addLog(`[PRD] Review: Task failed - ${reason}`);
    return { decision: 'abort', reason };
    
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(`[PRD] Review error: ${msg}`);
    return { decision: 'abort', reason: msg || 'review error' };
  }
}

export async function doStage(plan: string, hooks: PRDRunHooks): Promise<DoOutcome> {
  addLog('[PRD] Do started (currently pass-through)');
  
  // TODO: 未来在这里使用 hooks.createTask() 创建 Do 任务
  // const doTask = hooks.createTask(`Execute this plan:\n${plan}`);
  // const result = await hooks.waitTask(doTask.id);
  // 解析 result.output 为 codeDiff/artifacts/output
  
  // 当前直接返回空输出
  return { output: 'Do stage not implemented yet' };
}

// Placeholders to keep API compatible for future Coach/Dispatcher/Observer elaboration
export async function dispatch(_decision: TaskDecision): Promise<SubTask[]> { return []; }
export async function observe(_workers: any[]): Promise<ObservationReport> { return { artifacts: [], requests: [], steps: [] }; }
export async function review(_report: ObservationReport): Promise<ReviewResult> { return { decision: 'abort', reason: 'not-used' }; }

// ------------- Orchestration entry -------------

export interface PRDRunState {
  prompt: string;
  status: PRDStatus;
  reason?: string;
  plan?: string;
  review?: ReviewOutcome;
  doOutput?: DoOutcome;
}

export type PRDRunHooks = {
  onNode?: (name: 'analysis' | 'review' | 'do', message: string) => void;
  onPlan?: (plan: string) => void;
  createTask: (prompt: string) => { id: string };
  waitTask: (taskId: string) => Promise<{ id: string; status: string; output: string; error?: string | null }>;
};

async function runPRDOrchestrator(prompt: string, hooks: PRDRunHooks): Promise<PRDRunState> {
  const state: PRDRunState = { prompt, status: 'error' };
  try {
    hooks.onNode?.('analysis', 'Analysis: deriving plan...');
    const planRes = await makeDecision(prompt, hooks);
    if (!planRes.hasPlan || !planRes.plan) {
      state.status = 'aborted_no_plan';
      state.reason = planRes.reason || 'no plan';
      return state;
    }
    state.plan = planRes.plan;
    // Emit plan as soon as it's available
    try { if (planRes.plan) hooks.onPlan?.(planRes.plan); } catch {}

    hooks.onNode?.('review', 'Review: validating plan...');
    const rev = await reviewPlan(planRes.plan, hooks);
    state.review = rev;
    
    // Handle review decision
    if (rev.decision === 'abort') {
      state.status = 'aborted_review';
      state.reason = rev.reason || 'review aborted';
      return state;
    }
    
    if (rev.decision === 'replan') {
      // TODO: Future enhancement - loop back to Analysis with suggestions
      // For now, treat 'replan' as abort
      state.status = 'aborted_review';
      state.reason = `Review requested replan: ${rev.reason || 'unknown'}. Suggestions: ${rev.suggestions || 'none'}`;
      addLog(`[PRD] Replan requested but not implemented yet. Aborting. ${state.reason}`);
      return state;
    }
    
    // rev.decision === 'continue', proceed to Do

    hooks.onNode?.('do', 'Do: executing plan...');
    const done = await doStage(planRes.plan, hooks);
    state.doOutput = done;
    state.status = 'done';
    return state;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(`[PRD] run error: ${msg}`);
    state.status = 'error';
    state.reason = msg;
    return state;
  }
}

async function runPRDWithLangGraph(prompt: string, hooks: PRDRunHooks): Promise<PRDRunState> {
  // Dynamically import to keep optional
  const mod: any = await import('@langchain/langgraph');
  const Annotation = mod.Annotation;
  const StateGraph = mod.StateGraph;

  // Define typed-ish state via Annotation; keep types light
  const StateAnnotation = Annotation.Root({
    prompt: Annotation(),
    plan: Annotation(),
    reviewDecision: Annotation(),
    reviewReason: Annotation(),
    doOutput: Annotation(),
    status: Annotation(),
    reason: Annotation(),
  });

  const analysis = async (s: any) => {
    hooks.onNode?.('analysis', 'Analysis: deriving plan...');
    const res = await makeDecision(s.prompt as string, hooks);
    if (!res.hasPlan || !res.plan) {
      return { status: 'aborted_no_plan' as PRDStatus, reason: res.reason ?? 'no plan' };
    }
    try { hooks.onPlan?.(res.plan as string); } catch {}
    return { plan: res.plan };
  };

  const review = async (s: any) => {
    if (!s.plan) return {};
    hooks.onNode?.('review', 'Review: validating plan...');
    const r = await reviewPlan(s.plan as string, hooks);
    
    // Handle all three decision types
    if (r.decision === 'abort') {
      return { 
        reviewDecision: 'abort' as const, 
        reviewReason: r.reason, 
        status: 'aborted_review' as PRDStatus, 
        reason: r.reason 
      };
    }
    
    if (r.decision === 'replan') {
      // TODO: Future enhancement - loop back to Analysis
      // For now, treat as abort with replan info
      const replanMsg = `Review requested replan: ${r.reason || 'unknown'}. Suggestions: ${r.suggestions || 'none'}`;
      addLog(`[PRD] Replan requested but not implemented yet. Aborting. ${replanMsg}`);
      return { 
        reviewDecision: 'abort' as const, 
        reviewReason: replanMsg, 
        status: 'aborted_review' as PRDStatus, 
        reason: replanMsg 
      };
    }
    
    // r.decision === 'continue'
    return { reviewDecision: 'continue' as const, reviewReason: r.reason };
  };

  const doNode = async (s: any) => {
    if (!s.plan) return {};
    hooks.onNode?.('do', 'Do: executing plan...');
    const out = await doStage(s.plan as string, hooks);
    return { doOutput: out, status: 'done' as PRDStatus };
  };

  const routeAfterAnalysis = (s: any) => {
    return s.plan ? 'review' : '__end__';
  };

  const routeAfterReview = (s: any) => {
    return s.reviewDecision === 'continue' ? 'do' : '__end__';
  };

  const graph = new StateGraph(StateAnnotation)
    .addNode('analysis', analysis)
    .addNode('review', review)
    .addNode('do', doNode)
    .addEdge('__start__', 'analysis')
    .addConditionalEdges('analysis', routeAfterAnalysis, ['review', '__end__'])
    .addConditionalEdges('review', routeAfterReview, ['do', '__end__'])
    .addEdge('do', '__end__')
    .compile();

  const finalState: any = await graph.invoke({
    prompt,
    status: 'error' as PRDStatus,
  });

  const result: PRDRunState = {
    prompt,
    status: finalState.status ?? (finalState.plan ? 'done' : 'aborted_no_plan'),
    reason: finalState.reason,
    plan: finalState.plan,
    review: finalState.reviewDecision ? { decision: finalState.reviewDecision, reason: finalState.reviewReason } : undefined,
    doOutput: finalState.doOutput,
  };
  return result;
}

export async function runTask(prompt: string, hooks: PRDRunHooks): Promise<PRDRunState> {
  // Prefer LangGraph if available; otherwise fallback to orchestrator
  try {
    return await runPRDWithLangGraph(prompt, hooks);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(`[PRD] LangGraph path unavailable, falling back. ${msg}`);
    return await runPRDOrchestrator(prompt, hooks);
  }
}

// Backward-compat alias (temporary)
export const runPRD = runTask;
