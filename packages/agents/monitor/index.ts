import { LogMonitor } from './LogMonitor.js';

export function createLogMonitor(
    logFilePath: string = 'debug.log',
    tailLines: number = 100,
    intervalSec: number = 30
): LogMonitor {
    return new LogMonitor(logFilePath, tailLines, intervalSec);
}

export { LogMonitor };

