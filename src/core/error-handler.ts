import { logger } from './logger.js';
import { perfMonitor } from './performance.js';

// ============ 统一错误处理类 ============
export enum ErrorType {
  CONFIGURATION = 'CONFIGURATION',
  VALIDATION = 'VALIDATION',
  RUNTIME = 'RUNTIME',
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  RESOURCE = 'RESOURCE',
  PERMISSION = 'PERMISSION',
  CRITICAL = 'CRITICAL'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ErrorContext {
  component?: string;
  operation?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
  stackTrace?: string;
  timestamp?: number;
  originalError?: string;
  attempt?: number;
  maxRetries?: number;
  toolName?: string;
  toolsType?: string;
  agentName?: string;
  invalidTool?: any;
  errorType?: string;
  errorSeverity?: string;
  duration?: number;
  logStats?: Record<string, number>;
  errorStats?: Record<string, any>;
}

export class ReAgentError extends Error {
  public readonly type: ErrorType;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly code?: string;
  public readonly retryable: boolean;
  public readonly timestamp: number;
  
  constructor(
    message: string,
    type: ErrorType = ErrorType.RUNTIME,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context: ErrorContext = {},
    code?: string,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'ReAgentError';
    this.type = type;
    this.severity = severity;
    this.context = {
      ...context,
      timestamp: Date.now(),
      stackTrace: this.stack
    };
    this.code = code;
    this.retryable = retryable;
    this.timestamp = Date.now();
    
    // 保持正确的原型链
    Object.setPrototypeOf(this, ReAgentError.prototype);
  }
  
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      severity: this.severity,
      context: this.context,
      code: this.code,
      retryable: this.retryable,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
  
  toString(): string {
    const parts = [
      `[${this.type}:${this.severity}]`,
      this.code ? `[${this.code}]` : '',
      this.message,
      this.context.component ? `(Component: ${this.context.component})` : '',
      this.context.operation ? `(Operation: ${this.context.operation})` : ''
    ].filter(Boolean);
    
    return parts.join(' ');
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorCounts = new Map<string, number>();
  private lastErrors = new Map<string, number>();
  private readonly maxSimilarErrors = 10;
  private readonly similarErrorWindow = 60000; // 1分钟
  
  private constructor() {}
  
  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }
  
  // 创建错误
  static createError(
    message: string,
    type: ErrorType = ErrorType.RUNTIME,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context: ErrorContext = {},
    code?: string,
    retryable: boolean = false
  ): ReAgentError {
    return new ReAgentError(message, type, severity, context, code, retryable);
  }
  
  // 处理错误
  handleError(error: Error | ReAgentError, context: ErrorContext = {}): ReAgentError {
    let reAgentError: ReAgentError;
    
    if (error instanceof ReAgentError) {
      // 合并上下文
      reAgentError = new ReAgentError(
        error.message,
        error.type,
        error.severity,
        { ...error.context, ...context },
        error.code,
        error.retryable
      );
    } else {
      // 转换普通错误
      reAgentError = new ReAgentError(
        error.message,
        ErrorType.RUNTIME,
        ErrorSeverity.MEDIUM,
        { ...context, originalError: error.name },
        undefined,
        false
      );
    }
    
    // 防重复错误
    if (this.shouldSuppressDuplicateError(reAgentError)) {
      return reAgentError;
    }
    
    // 记录错误
    this.logError(reAgentError);
    
    // 性能监控
    perfMonitor.recordError(`${reAgentError.type}.${reAgentError.severity}`);
    perfMonitor.incrementCounter('errors.total');
    perfMonitor.incrementCounter(`errors.${reAgentError.type.toLowerCase()}`);
    
    return reAgentError;
  }
  
  private shouldSuppressDuplicateError(error: ReAgentError): boolean {
    const errorKey = `${error.type}:${error.message}`;
    const now = Date.now();
    
    const lastTime = this.lastErrors.get(errorKey) || 0;
    const count = this.errorCounts.get(errorKey) || 0;
    
    if (now - lastTime < this.similarErrorWindow && count >= this.maxSimilarErrors) {
      return true;
    }
    
    this.lastErrors.set(errorKey, now);
    this.errorCounts.set(errorKey, count + 1);
    
    // 清理过期的错误计数
    if (now - lastTime > this.similarErrorWindow) {
      this.errorCounts.set(errorKey, 1);
    }
    
    return false;
  }
  
  private logError(error: ReAgentError): void {
    const logMessage = `${error.toString()}`;
    const logDetails = {
      type: error.type,
      severity: error.severity,
      context: error.context,
      code: error.code,
      retryable: error.retryable
    };
    
    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(logMessage, logDetails);
        break;
      case ErrorSeverity.HIGH:
        logger.error(logMessage, logDetails);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(logMessage, logDetails);
        break;
      case ErrorSeverity.LOW:
        logger.debug(logMessage, logDetails);
        break;
    }
  }
  
  // 包装异步函数，自动错误处理
  async wrapAsync<T>(
    fn: () => Promise<T>,
    context: ErrorContext,
    errorType: ErrorType = ErrorType.RUNTIME,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
    }
  }
  
  // 包装同步函数，自动错误处理
  wrap<T>(
    fn: () => T,
    context: ErrorContext,
    errorType: ErrorType = ErrorType.RUNTIME,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
  ): T {
    try {
      return fn();
    } catch (error) {
      throw this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
    }
  }
  
  // 重试机制
  async retry<T>(
    fn: () => Promise<T>,
    context: ErrorContext,
    maxRetries: number = 3,
    delayMs: number = 1000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: Error | null = null;
    let currentDelay = delayMs;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        const reAgentError = this.handleError(lastError, {
          ...context,
          attempt: attempt + 1,
          maxRetries
        });
        
        if (attempt === maxRetries - 1 || !reAgentError.retryable) {
          throw reAgentError;
        }
        
        logger.warn(`重试操作 (${attempt + 1}/${maxRetries})，${currentDelay}ms后重试`, {
          operation: context.operation,
          error: reAgentError.message
        });
        
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay *= backoffMultiplier;
      }
    }
    
    throw this.handleError(lastError!, context);
  }
  
  // 获取错误统计
  getErrorStats(): Record<string, any> {
    const stats: Record<string, any> = {
      totalUniqueErrors: this.errorCounts.size,
      errorCounts: Object.fromEntries(this.errorCounts),
      recentErrors: []
    };
    
    const now = Date.now();
    for (const [errorKey, lastTime] of this.lastErrors.entries()) {
      if (now - lastTime < this.similarErrorWindow) {
        stats.recentErrors.push({
          error: errorKey,
          lastOccurred: new Date(lastTime).toISOString(),
          count: this.errorCounts.get(errorKey) || 0
        });
      }
    }
    
    return stats;
  }
  
  // 清理错误统计
  clearErrorStats(): void {
    this.errorCounts.clear();
    this.lastErrors.clear();
    logger.debug('错误统计已清理');
  }
}

export const errorHandler = ErrorHandler.getInstance();