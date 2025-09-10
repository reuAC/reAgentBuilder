// ============ ReAgent Framework 主入口文件 ============

// 导出核心类
export { ReAgentBuilder, InterceptorManager, BreakpointManager } from './agent/index.js';

// 导出核心工具
export { 
  logger, 
  Logger,
  LLMFactory,
  LLMConfigBuilder,
  PerformanceUtils,
  PerformanceMonitor,
  ErrorHandler,
  ReAgentError,
  ErrorType,
  ErrorSeverity,
  perfUtils,
  perfMonitor,
  errorHandler
} from './core/index.js';

// 导出所有类型定义
export * from './types/index.js';

// 导出版本信息
export const version = '1.0.0';

// 导出默认实例
export { logger as default } from './core/index.js';