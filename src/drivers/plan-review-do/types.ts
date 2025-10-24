
/**
 * Plan-Review-DO Driver 内部类型定义
 */

export interface TaskDecision {
  definition: string;          // 任务定义调研
  history: string | null;      // 任务历史定位
  reflection: string | null;   // 任务反思调研
}

export interface SubTask {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  canParallel: boolean;
}

export interface ObservationReport {
  artifacts: string[];         // 产出的文件/代码
  requests: string[];          // Worker 的请求
  steps: string[];             // 执行步骤
}

export interface ReviewResult {
  decision: 'continue' | 'replan' | 'abort';
  reason: string;
  newPrompt?: string;          // 如果需要重新规划
}

// --- Step 2: Minimal PRD contracts used by current flow ---

export type PRDStatus = 'aborted_no_plan' | 'aborted_review' | 'done' | 'error';

export interface PlanResult {
  hasPlan: boolean;
  plan?: string;
  reason?: string;
}

export interface ReviewOutcome {
  decision: 'continue' | 'abort' | 'replan';
  reason?: string;
  suggestions?: string;  // For 'replan': actionable suggestions to improve the plan
}

export interface DoOutcome {
  codeDiff?: string;       // ```diff block
  artifacts?: string[];    // ARTIFACTS list
  output?: string;         // Generic output
}
