/**
 * Looper Command Parser
 * 
 * Parses user input into structured commands for the Looper Agent.
 */

export type LooperCommandType = 'start' | 'stop' | 'status' | 'add_pending';

export interface LooperCommand {
  type: LooperCommandType;
  task?: string;
}

/**
 * Parse user input into a LooperCommand
 * Supports both JSON format and natural language
 */
export const parseCommand = (userInput: string): LooperCommand => {
  // Try JSON parsing first
  try {
    const parsed = JSON.parse(userInput);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as LooperCommand;
    }
  } catch {
    // Not JSON, continue to natural language parsing
  }

  // Natural language parsing
  const input = userInput.trim().toLowerCase();

  if (input === 'stop' || input.includes('停止') || input.includes('终止')) {
    return { type: 'stop' };
  }

  if (input === 'status' || input.includes('状态') || input.includes('进度')) {
    return { type: 'status' };
  }

  // Default: treat as start command with task description
  return {
    type: 'start',
    task: userInput.trim(),
  };
};
