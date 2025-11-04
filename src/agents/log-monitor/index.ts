import { LogMonitor } from './LogMonitor.js';

/**
 * Factory function to create a LogMonitor instance
 * @param logFilePath - Path to log file (default: debug.log)
 * @param tailLines - Number of lines to monitor (default: 100)
 * @param intervalSec - Check interval in seconds (default: 30)
 */
export function createLogMonitor(
    logFilePath: string = 'debug.log',
    tailLines: number = 100,
    intervalSec: number = 30
): LogMonitor {
    return new LogMonitor(logFilePath, tailLines, intervalSec);
}

export { LogMonitor };
