/**
 * Task Event Types
 * 
 * Represents events emitted by background tasks and agents.
 */

export type TaskEventLevel = 'debug' | 'info' | 'warning' | 'error';

export interface TaskEvent {
    level: TaskEventLevel;
    message: string;
    ts: number;
}

