import fs from 'fs';
import path from 'path';

/**
 * TaskLogger - 为每个 background task 创建独立的日志文件
 * 记录任务的完整生命周期：输入、事件、输出更新
 */
export class TaskLogger {
  private logsDir: string;
  private logStreams: Map<string, fs.WriteStream> = new Map();

  constructor(baseDir: string = process.cwd()) {
    this.logsDir = path.join(baseDir, 'logs');
    
    // 确保 logs 目录存在
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * 获取或创建任务的日志文件流
   */
  private getLogStream(taskId: string): fs.WriteStream {
    let stream = this.logStreams.get(taskId);
    if (!stream) {
      const logFile = path.join(this.logsDir, `${taskId}.log`);
      stream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
      this.logStreams.set(taskId, stream);
    }
    return stream;
  }

  /**
   * 写入日志条目（带时间戳）
   */
  private writeLog(taskId: string, event: string, data?: any) {
    const stream = this.getLogStream(taskId);
    const timestamp = new Date().toISOString();
    
    let logLine = `[${timestamp}] ${event}`;
    if (data !== undefined) {
      if (typeof data === 'string') {
        logLine += `: ${data}`;
      } else {
        logLine += `:\n${JSON.stringify(data, null, 2)}`;
      }
    }
    logLine += '\n';
    
    stream.write(logLine);
  }

  /**
   * 任务创建
   */
  logTaskCreated(taskId: string, kind: 'ai' | 'cli', prompt: string, metadata?: any) {
    this.writeLog(taskId, '='.repeat(80));
    this.writeLog(taskId, `TASK CREATED - ${kind.toUpperCase()}`);
    this.writeLog(taskId, '='.repeat(80));
    this.writeLog(taskId, 'Task ID', taskId);
    this.writeLog(taskId, 'Kind', kind);
    
    if (kind === 'ai') {
      this.writeLog(taskId, 'Prompt Length', `${prompt.length} chars`);
      this.writeLog(taskId, 'Prompt', prompt);
    } else {
      this.writeLog(taskId, 'Command', prompt);
    }
    
    if (metadata) {
      this.writeLog(taskId, 'Metadata', metadata);
    }
    
    this.writeLog(taskId, '');
  }

  /**
   * 任务状态变更
   */
  logStatusChange(taskId: string, fromStatus: string, toStatus: string) {
    this.writeLog(taskId, `STATUS CHANGE: ${fromStatus} → ${toStatus}`);
  }

  /**
   * 输出增量更新（流式）
   */
  logOutputChunk(taskId: string, chunk: string, totalLength: number) {
    this.writeLog(taskId, `OUTPUT CHUNK (+${chunk.length} chars, total: ${totalLength})`);
    // 只记录前 200 个字符避免日志过大
    const preview = chunk.length > 200 ? chunk.substring(0, 200) + '...' : chunk;
    this.writeLog(taskId, 'Content', preview);
  }

  /**
   * 任务完成
   */
  logTaskCompleted(taskId: string, output: string, exitCode?: number | null) {
    this.writeLog(taskId, '');
    this.writeLog(taskId, '='.repeat(80));
    this.writeLog(taskId, 'TASK COMPLETED');
    this.writeLog(taskId, '='.repeat(80));
    this.writeLog(taskId, 'Exit Code', exitCode ?? 'N/A');
    this.writeLog(taskId, 'Output Length', `${output.length} chars`);
    this.writeLog(taskId, 'Full Output', output);
    this.writeLog(taskId, '');
    
    // 关闭流
    this.closeStream(taskId);
  }

  /**
   * 任务失败
   */
  logTaskFailed(taskId: string, error: string, exitCode?: number | null) {
    this.writeLog(taskId, '');
    this.writeLog(taskId, '='.repeat(80));
    this.writeLog(taskId, '❌ TASK FAILED');
    this.writeLog(taskId, '='.repeat(80));
    this.writeLog(taskId, 'Exit Code', exitCode ?? 'N/A');
    this.writeLog(taskId, 'Error', error);
    this.writeLog(taskId, '');
    
    // 关闭流
    this.closeStream(taskId);
  }

  /**
   * 自定义事件
   */
  logEvent(taskId: string, event: string, data?: any) {
    this.writeLog(taskId, event, data);
  }

  /**
   * 关闭特定任务的日志流
   */
  private closeStream(taskId: string) {
    const stream = this.logStreams.get(taskId);
    if (stream) {
      stream.end();
      this.logStreams.delete(taskId);
    }
  }

  /**
   * 关闭所有日志流
   */
  closeAll() {
    for (const [taskId, stream] of this.logStreams.entries()) {
      stream.end();
    }
    this.logStreams.clear();
  }

  /**
   * 读取任务日志
   */
  readTaskLog(taskId: string): string | null {
    const logFile = path.join(this.logsDir, `${taskId}.log`);
    if (fs.existsSync(logFile)) {
      return fs.readFileSync(logFile, 'utf-8');
    }
    return null;
  }

  /**
   * 列出所有任务日志文件
   */
  listTaskLogs(): string[] {
    if (!fs.existsSync(this.logsDir)) {
      return [];
    }
    return fs.readdirSync(this.logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => file.replace('.log', ''));
  }

  /**
   * 清理旧日志（可选）
   */
  cleanOldLogs(daysToKeep: number = 7) {
    const now = Date.now();
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000;
    
    if (!fs.existsSync(this.logsDir)) {
      return;
    }
    
    const files = fs.readdirSync(this.logsDir);
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      
      const filePath = path.join(this.logsDir, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtime.getTime();
      
      if (age > maxAge) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

// 全局单例
let globalTaskLogger: TaskLogger | null = null;

export function getTaskLogger(): TaskLogger {
  if (!globalTaskLogger) {
    globalTaskLogger = new TaskLogger();
  }
  return globalTaskLogger;
}

export function closeTaskLogger() {
  if (globalTaskLogger) {
    globalTaskLogger.closeAll();
    globalTaskLogger = null;
  }
}
