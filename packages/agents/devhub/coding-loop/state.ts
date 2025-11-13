/**
 * Looper State Management
 * 
 * Defines the state machine and data structures for the Looper Agent.
 */

export enum LooperStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
}

export enum LooperSubStatus {
  WAITING_CODER = 'WAITING_CODER',
  WAITING_REVIEW = 'WAITING_REVIEW',
  JUDGE = 'JUDGE',
}

export interface LooperState {
  status: LooperStatus;
  subStatus?: LooperSubStatus;
  currentTask: string;
  iteration: number;
  maxIterations: number;
  shouldStop: boolean;
  pendingQueue: string[];
}

export const createInitialState = (): LooperState => ({
  status: LooperStatus.IDLE,
  subStatus: undefined,
  currentTask: '',
  iteration: 0,
  maxIterations: 5,
  shouldStop: false,
  pendingQueue: [],
});

export const canStartLoop = (state: LooperState): boolean => {
  return state.status === LooperStatus.IDLE;
};

export const shouldTerminate = (state: LooperState): boolean => {
  return (
    state.shouldStop ||
    state.iteration >= state.maxIterations
  );
};
