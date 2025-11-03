/**
 * Task flow V3 - Simplified 2-node workflow (planWithReview + execute)
 * 
 * Key changes:
 * 1. Only 2 nodes: planWithReview (with planner+reviewer agents) and execute (with executor agent)
 * 2. Internal multi-round agent dialogue is NOT recorded in state.messages (only logged)
 * 3. Each node adds user instruction message, then appends final assistant output
 * 4. State.plan extracted from planWithReview output, used by execute node
 * 5. Conditional routing: plan exists → execute, no plan → END
 */

import { addLog } from '../../logger.js';
import type { Message } from '../../types.js';
import { agentsConfig } from './agents-config.js';

// ------------- Types -------------

export type TaskRunHooks = {
  createTask: (prompt: string, options?: { agents?: Record<string, any> }) => { id: string };
  waitTask: (taskId: string) => Promise<{ id: string; status: string; output: string; error?: string | null }>;
};

export interface TaskRunState {
  messages: Message[];
  task: string;
  plan?: string;
}

// ------------- Message Serialization -------------

/**
 * Generate unique message ID
 */
let messageIdCounter = 0;
function generateMessageId(): number {
  return ++messageIdCounter;
}

/**
 * Serialize messages array into a single string
 */
function serializeMessages(messages: Message[]): string {
  return messages.map(msg => {
    if (msg.role === 'system') {
      return `<system>\n${msg.content}\n</system>`;
    } else if (msg.role === 'user') {
      return `<user>\n${msg.content}\n</user>`;
    } else {
      return `<assistant>\n${msg.content}\n</assistant>`;
    }
  }).join('\n\n');
}

// ------------- Node Functions -------------

/**
 * Node 1: planWithReview
 * Purpose: Get an approved plan through planner-reviewer collaboration
 * - Passes planner + reviewer agents to query
 * - Internal multi-round dialogue is NOT recorded in state.messages (only logged)
 * - Only final output is appended to state.messages
 * - Extracts <plan> if review passes
 */
export async function planWithReview(
  state: TaskRunState,
  hooks: TaskRunHooks
): Promise<TaskRunState> {
  console.log('🔵 Node: planWithReview - Started');
  addLog('[Node: planWithReview] Started');
  
  try {
    // 1. Build user message with task and instructions
    const userPrompt = `<task>${state.task}</task>

【重要】你的任务是制定计划，不是执行计划。

工作流程：
1. 使用 @planner 分析任务并制定详细的执行计划
2. 使用 @reviewer 审查该计划的可行性、完整性和风险
3. 如果 @reviewer 不通过，使用 @planner 根据反馈优化计划
4. 重复步骤 2-3 直到 @reviewer 通过

【禁止行为】
- 不要使用任何编辑工具（Write、Edit、Bash 等）
- 不要实际修改文件或执行代码
- 不要开始实施计划
- 你的工作仅限于规划和审查

【输出要求】
当 @reviewer 审查通过后，立即按以下格式输出并停止：

<plan>
[这里是审查通过的详细计划，包含具体步骤]
</plan>
<exit hasPlan=true/>

不要在输出 <exit hasPlan=true/> 后继续任何操作。`;

    // 2. Append this user message to state.messages
    state.messages.push({
      id: generateMessageId(),
      role: 'user',
      content: userPrompt
    });
    
    addLog(`[Node: planWithReview] Added user message, total messages: ${state.messages.length}`);
    
    // 3. Serialize messages for query
    const prompt = serializeMessages(state.messages);
    
    // 4. Prepare agents (planner + reviewer)
    const agentsParam = {
      planner: agentsConfig.planner,
      reviewer: agentsConfig.reviewer
    };
    
    addLog(`[Node: planWithReview] Calling query with planner+reviewer agents`);
    
    // 5. Create task and wait for completion
    const task = hooks.createTask(prompt, { agents: agentsParam });
    addLog(`[Node: planWithReview] Created task ${task.id}`);
    
    const completed = await hooks.waitTask(task.id);
    addLog(`[Node: planWithReview] Task completed with status=${completed.status}`);
    
    if (completed.status === 'completed' && completed.output) {
      const output = completed.output.trim();
      
      // 6. Append assistant's final output to state.messages
      state.messages.push({
        id: generateMessageId(),
        role: 'assistant',
        content: output
      });
      
      addLog(`[Node: planWithReview] Appended assistant output to messages`);
      
      // 7. Extract plan from output
      const exitMatch = output.match(/<exit\s+hasPlan=(?:true|"true")\s*\/>/i);
      const planMatch = output.match(/<plan>([\s\S]*?)<\/plan>/i);
      
      if (exitMatch && planMatch && planMatch[1]) {
        state.plan = planMatch[1].trim();
        console.log('✅ Node: planWithReview - Completed (plan generated)');
        addLog(`[Node: planWithReview] ✅ Plan extracted successfully (${state.plan.length} chars)`);
      } else {
        console.log('⚠️  Node: planWithReview - Completed (no plan)');
        addLog(`[Node: planWithReview] ⚠️ No approved plan found (hasPlan=false or missing <plan> tag)`);
      }
      
      return state;
    }
    
    // Task failed
    const reason = completed.error || 'Task failed without output';
    console.log(`❌ Node: planWithReview - Failed: ${reason}`);
    addLog(`[Node: planWithReview] ❌ Failed: ${reason}`);
    
    // Append error message
    state.messages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: `<exit hasPlan=false reason="${reason}"/>`
    });
    
    return state;
    
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ Node: planWithReview - Error: ${msg}`);
    addLog(`[Node: planWithReview] Error: ${msg}`);
    
    // Append error to messages
    state.messages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: `<exit hasPlan=false reason="${msg}"/>`
    });
    
    return state;
  }
}

/**
 * Node 2: execute
 * Purpose: Execute the approved plan using executor agent
 * - Receives task + plan from state
 * - Passes executor agent to query
 * - Appends execution instructions and results to state.messages
 */
export async function execute(
  state: TaskRunState,
  hooks: TaskRunHooks
): Promise<TaskRunState> {
  console.log('🔵 Node: execute - Started');
  addLog('[Node: execute] Started');
  
  if (!state.plan) {
    console.log('⚠️  Node: execute - Skipped (no plan)');
    addLog('[Node: execute] ❌ No plan available, skipping execution');
    return state;
  }
  
  try {
    // 1. Build user message with task, plan, and instructions
    const userPrompt = `<task>${state.task}</task>
<plan>${state.plan}</plan>

请使用 @executor 完成用户任务，任务完成后严格按以下格式输出：
<summary>...</summary>
<exit confidence=0.8/>`;

    // 2. Append this user message to state.messages
    state.messages.push({
      id: generateMessageId(),
      role: 'user',
      content: userPrompt
    });
    
    addLog(`[Node: execute] Added user message, total messages: ${state.messages.length}`);
    
    // 3. Serialize messages for query
    const prompt = serializeMessages(state.messages);
    
    // 4. Prepare agents (executor only)
    const agentsParam = {
      executor: agentsConfig.executor
    };
    
    addLog(`[Node: execute] Calling query with executor agent`);
    
    // 5. Create task and wait for completion
    const task = hooks.createTask(prompt, { agents: agentsParam });
    addLog(`[Node: execute] Created task ${task.id}`);
    
    const completed = await hooks.waitTask(task.id);
    addLog(`[Node: execute] Task completed with status=${completed.status}`);
    
    if (completed.status === 'completed' && completed.output) {
      const output = completed.output.trim();
      
      // 6. Append assistant's output to state.messages
      state.messages.push({
        id: generateMessageId(),
        role: 'assistant',
        content: output
      });
      
      addLog(`[Node: execute] ✅ Execution completed and appended to messages`);
      
      // Extract confidence if present (allow optional quotes around number)
      const exitMatch = output.match(/<exit\s+confidence=["']?([\d.]+)["']?\s*\/>/i);
      if (exitMatch && exitMatch[1]) {
        const confidence = parseFloat(exitMatch[1]);
        console.log(`✅ Node: execute - Completed (confidence: ${confidence})`);
        addLog(`[Node: execute] Confidence: ${confidence}`);
      }
      
      return state;
    }
    
    // Task failed
    const reason = completed.error || 'Execution failed without output';
    console.log(`❌ Node: execute - Failed: ${reason}`);
    addLog(`[Node: execute] ❌ Failed: ${reason}`);
    
    // Append error message
    state.messages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: `<summary>Execution failed: ${reason}</summary><exit confidence=0/>`
    });
    
    return state;
    
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`❌ Node: execute - Error: ${msg}`);
    addLog(`[Node: execute] Error: ${msg}`);
    
    // Append error to messages
    state.messages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: `<summary>Error: ${msg}</summary><exit confidence=0/>`
    });
    
    return state;
  }
}

/**
 * Conditional routing function
 * Determines if execution should proceed based on whether a plan exists
 */
export function shouldExecute(state: TaskRunState): 'execute' | '__end__' {
  if (state.plan && state.plan.trim().length > 0) {
    console.log('🔀 Router: Plan exists → execute node');
    addLog('[Router] Plan exists, routing to execute node');
    return 'execute';
  }
  
  console.log('🔀 Router: No plan → END');
  addLog('[Router] No plan available, routing to END');
  return '__end__';
}

// ------------- Public API -------------

/**
 * Run the complete task workflow
 * This is a simple orchestrator that calls the nodes in sequence
 */
export async function runTask(task: string, hooks: TaskRunHooks): Promise<TaskRunState> {
  const initialState: TaskRunState = {
    messages: [],
    task,
    plan: undefined
  };
  
  console.log('🚀 Workflow: Starting Plan-Review-Execute');
  addLog('[Workflow] Starting task workflow');
  
  // Node 1: planWithReview
  let state = await planWithReview(initialState, hooks);
  
  // Conditional routing
  const nextNode = shouldExecute(state);
  
  if (nextNode === 'execute') {
    // Node 2: execute
    state = await execute(state, hooks);
  }
  
  console.log('🏁 Workflow: Completed');
  addLog('[Workflow] Task workflow completed');
  return state;
}
