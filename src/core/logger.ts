import { perfUtils } from './performance.js';

// ============ 日志管理类 ============
export class Logger {
  private static instance: Logger;
  private logLevel: 'debug' | 'info' | 'warn' | 'error';
  private readonly levelPriority = { debug: 0, info: 1, warn: 2, error: 3 };
  private currentLevelPriority: number;
  
  // 全局上下文
  private globalContext: Record<string, any> = {};
  
  // 日志统计
  private logStats = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    dropped: 0
  };
  
  private logBuffer: Array<{ level: string; message: string; args: unknown[]; timestamp: number }> = [];
  private bufferSize = 0;
  private readonly maxBufferSize = 50; // 缓冲区最大条目数
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushInterval = 100; // 100ms后强制刷新
  
  private constructor() {
    this.logLevel = 'info';
    this.currentLevelPriority = this.levelPriority[this.logLevel];
  }
  
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }
  
  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    return this.levelPriority[level] >= this.currentLevelPriority;
  }
  
  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.logLevel = level;
    this.currentLevelPriority = this.levelPriority[level];
  }
  
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    
    this.flushTimer = setTimeout(() => {
      this.flushBuffer();
      this.flushTimer = null;
    }, this.flushInterval);
  }
  
  private flushBuffer(): void {
    if (this.bufferSize === 0) return;
    
    for (const entry of this.logBuffer.slice(0, this.bufferSize)) {
      const timestamp = perfUtils.getTimestamp();
      const prefix = `[${timestamp}] ${entry.level}`;
      
      if (entry.level === '⚠️ [WARN]' || entry.level === '❌ [ERROR]') {
        console.error(`${prefix} ${entry.message}`, ...entry.args);
      } else {
        console.log(`${prefix} ${entry.message}`, ...entry.args);
      }
    }
    
    this.bufferSize = 0;
  }
  
  private addToBuffer(level: string, message: string, args: unknown[]): void {
    // 如果缓冲区满了，立即刷新
    if (this.bufferSize >= this.maxBufferSize) {
      this.flushBuffer();
    }
    
    this.logBuffer[this.bufferSize] = {
      level,
      message,
      args,
      timestamp: perfUtils.now()
    };
    this.bufferSize++;
    
    this.scheduleFlush();
  }
  
  debug(message: string, context?: Record<string, any>, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      this.logStats.debug++;
      this.addToBuffer('🔍 [DEBUG]', this.formatMessage(message, context), args);
    }
  }
  
  info(message: string, context?: Record<string, any>, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      this.logStats.info++;
      this.addToBuffer('ℹ️ [INFO]', this.formatMessage(message, context), args);
    }
  }
  
  warn(message: string, context?: Record<string, any>, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      this.logStats.warn++;
      const timestamp = perfUtils.getTimestamp();
      const formattedMessage = this.formatMessage(message, context);
      console.warn(`[${timestamp}] ⚠️ [WARN] ${formattedMessage}`, ...args);
    }
  }
  
  error(message: string, context?: Record<string, any>, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      this.logStats.error++;
      const timestamp = perfUtils.getTimestamp();
      const formattedMessage = this.formatMessage(message, context);
      console.error(`[${timestamp}] ❌ [ERROR] ${formattedMessage}`, ...args);
    }
  }
  
  // 格式化消息，包含上下文信息
  private formatMessage(message: string, context?: Record<string, any>): string {
    if (!context && Object.keys(this.globalContext).length === 0) {
      return message;
    }
    
    const mergedContext = { ...this.globalContext, ...context };
    const contextParts: string[] = [];
    
    if (mergedContext.component) contextParts.push(`[${mergedContext.component}]`);
    if (mergedContext.operation) contextParts.push(`(${mergedContext.operation})`);
    if (mergedContext.requestId) contextParts.push(`{${mergedContext.requestId}}`);
    
    const contextStr = contextParts.length > 0 ? contextParts.join(' ') + ' ' : '';
    return `${contextStr}${message}`;
  }
  
  // 设置全局上下文
  setGlobalContext(context: Record<string, any>): void {
    this.globalContext = { ...this.globalContext, ...context };
  }
  
  // 清空全局上下文
  clearGlobalContext(): void {
    this.globalContext = {};
  }
  
  // 带上下文的日志记录器
  withContext(context: Record<string, any>) {
    return {
      debug: (message: string, ...args: unknown[]) => 
        this.debug(message, context, ...args),
      info: (message: string, ...args: unknown[]) => 
        this.info(message, context, ...args),
      warn: (message: string, ...args: unknown[]) => 
        this.warn(message, context, ...args),
      error: (message: string, ...args: unknown[]) => 
        this.error(message, context, ...args)
    };
  }
  
  // 获取日志统计
  getStats(): Record<string, number> {
    return { ...this.logStats };
  }
  
  // 重置统计
  resetStats(): void {
    this.logStats = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      dropped: 0
    };
  }
  
  flush(): void {
    this.flushBuffer();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
  
  // 清理资源
  cleanup(): void {
    this.flush();
    this.resetStats();
    this.clearGlobalContext();
  }
}

export const logger = Logger.getInstance();