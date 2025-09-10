// ============ 高性能工具类 ============
export class PerformanceUtils {
  private static instance: PerformanceUtils;
  private idCounter = 0;
  private startTime = Date.now();
  private timestampCache = new Map<number, string>();
  private readonly TIMESTAMP_CACHE_SIZE = 100;
  
  private constructor() {}
  
  static getInstance(): PerformanceUtils {
    if (!PerformanceUtils.instance) {
      PerformanceUtils.instance = new PerformanceUtils();
    }
    return PerformanceUtils.instance;
  }
  
  // 高性能ID生成器 - 避免频繁的Date.now()调用
  generateId(prefix = 'id'): string {
    this.idCounter++;
    if (this.idCounter > 999999) this.idCounter = 1;
    return `${prefix}-${this.idCounter}-${performance.now().toFixed(0)}`;
  }
  
  // 高性能时间戳缓存
  getTimestamp(): string {
    const now = Date.now();
    const cacheKey = Math.floor(now / 1000); // 秒级缓存
    
    let cached = this.timestampCache.get(cacheKey);
    if (!cached) {
      cached = new Date(now).toISOString().slice(11, 23);
      this.timestampCache.set(cacheKey, cached);
      
      // 清理过期缓存
      if (this.timestampCache.size > this.TIMESTAMP_CACHE_SIZE) {
        const oldestKey = Math.min(...this.timestampCache.keys());
        this.timestampCache.delete(oldestKey);
      }
    }
    
    return cached;
  }
  
  // 高性能毫秒时间戳
  now(): number {
    return Date.now();
  }
  
  // 高性能持续时间计算
  duration(startTime: number): number {
    return Date.now() - startTime;
  }
  
  // 对象池管理器
  private objectPools = new Map<string, any[]>();
  
  getFromPool<T>(poolName: string, factory: () => T): T {
    let pool = this.objectPools.get(poolName);
    if (!pool) {
      pool = [];
      this.objectPools.set(poolName, pool);
    }
    
    return pool.pop() || factory();
  }
  
  returnToPool(poolName: string, obj: any): void {
    let pool = this.objectPools.get(poolName);
    if (pool && pool.length < 10) { // 限制池大小
      pool.push(obj);
    }
  }
  
  // 清理缓存
  cleanup(): void {
    this.timestampCache.clear();
    this.objectPools.clear();
    this.idCounter = 0;
  }
}

export const perfUtils = PerformanceUtils.getInstance();

// ============ 性能监控类 ============
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  
  // 性能指标收集
  private metrics = {
    // 计时器
    timers: new Map<string, { start: number; count: number; total: number; min: number; max: number }>(),
    
    // 计数器
    counters: new Map<string, number>(),
    
    // 内存使用
    memorySnapshots: [] as Array<{ timestamp: number; usage: NodeJS.MemoryUsage }>,
    
    // 错误统计
    errors: new Map<string, { count: number; lastOccurred: number }>(),
    
    // 工具执行统计
    toolExecutions: new Map<string, { count: number; totalTime: number; successRate: number; failures: number }>()
  };
  
  private readonly MAX_SNAPSHOTS = 100;
  private monitoring = false;
  private monitorInterval?: NodeJS.Timeout;
  
  private constructor() {}
  
  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }
  
  // 启动性能监控
  startMonitoring(intervalMs = 5000): void {
    if (this.monitoring) return;
    
    this.monitoring = true;
    this.monitorInterval = setInterval(() => {
      this.captureMemorySnapshot();
    }, intervalMs);
    
    console.log('性能监控已启动');
  }
  
  // 停止性能监控
  stopMonitoring(): void {
    if (!this.monitoring) return;
    
    this.monitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
    
    console.log('性能监控已停止');
  }
  
  // 开始计时
  startTimer(name: string): void {
    const now = performance.now();
    let timer = this.metrics.timers.get(name);
    
    if (!timer) {
      timer = { start: now, count: 0, total: 0, min: Infinity, max: 0 };
      this.metrics.timers.set(name, timer);
    }
    
    timer.start = now;
  }
  
  // 结束计时
  endTimer(name: string): number {
    const now = performance.now();
    const timer = this.metrics.timers.get(name);
    
    if (!timer) {
      console.warn(`计时器 ${name} 未找到`);
      return 0;
    }
    
    const duration = now - timer.start;
    timer.count++;
    timer.total += duration;
    timer.min = Math.min(timer.min, duration);
    timer.max = Math.max(timer.max, duration);
    
    return duration;
  }
  
  // 增加计数器
  incrementCounter(name: string, value = 1): void {
    const current = this.metrics.counters.get(name) || 0;
    this.metrics.counters.set(name, current + value);
  }
  
  // 记录错误
  recordError(type: string): void {
    const error = this.metrics.errors.get(type) || { count: 0, lastOccurred: 0 };
    error.count++;
    error.lastOccurred = Date.now();
    this.metrics.errors.set(type, error);
  }
  
  // 记录工具执行结果
  recordToolExecution(toolName: string, duration: number, success: boolean): void {
    let tool = this.metrics.toolExecutions.get(toolName);
    
    if (!tool) {
      tool = { count: 0, totalTime: 0, successRate: 1.0, failures: 0 };
      this.metrics.toolExecutions.set(toolName, tool);
    }
    
    tool.count++;
    tool.totalTime += duration;
    
    if (!success) {
      tool.failures++;
    }
    
    tool.successRate = (tool.count - tool.failures) / tool.count;
  }
  
  // 捕获内存快照
  private captureMemorySnapshot(): void {
    const usage = process.memoryUsage();
    this.metrics.memorySnapshots.push({
      timestamp: Date.now(),
      usage
    });
    
    // 保持快照数量在限制内
    if (this.metrics.memorySnapshots.length > this.MAX_SNAPSHOTS) {
      this.metrics.memorySnapshots.shift();
    }
  }
  
  // 获取性能报告
  getReport(): any {
    const report: any = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      
      // 计时器统计
      timers: {},
      
      // 计数器
      counters: Object.fromEntries(this.metrics.counters),
      
      // 内存统计
      memory: {
        current: process.memoryUsage(),
        snapshots: this.metrics.memorySnapshots.length,
        trend: this.getMemoryTrend()
      },
      
      // 错误统计
      errors: Object.fromEntries(this.metrics.errors),
      
      // 工具执行统计
      tools: {}
    };
    
    // 处理计时器数据
    for (const [name, timer] of this.metrics.timers) {
      if (timer.count > 0) {
        report.timers[name] = {
          count: timer.count,
          total: Math.round(timer.total * 100) / 100,
          average: Math.round((timer.total / timer.count) * 100) / 100,
          min: Math.round(timer.min * 100) / 100,
          max: Math.round(timer.max * 100) / 100
        };
      }
    }
    
    // 处理工具数据
    for (const [name, tool] of this.metrics.toolExecutions) {
      report.tools[name] = {
        executions: tool.count,
        totalTime: Math.round(tool.totalTime * 100) / 100,
        averageTime: tool.count > 0 ? Math.round((tool.totalTime / tool.count) * 100) / 100 : 0,
        successRate: Math.round(tool.successRate * 10000) / 100, // 百分比
        failures: tool.failures
      };
    }
    
    return report;
  }
  
  // 获取内存趋势
  private getMemoryTrend(): string {
    if (this.metrics.memorySnapshots.length < 2) return 'insufficient_data';
    
    const recent = this.metrics.memorySnapshots.slice(-5);
    const first = recent[0].usage.heapUsed;
    const last = recent[recent.length - 1].usage.heapUsed;
    
    const change = ((last - first) / first) * 100;
    
    if (change > 5) return 'increasing';
    if (change < -5) return 'decreasing';
    return 'stable';
  }
  
  // 清理所有指标
  reset(): void {
    this.metrics.timers.clear();
    this.metrics.counters.clear();
    this.metrics.memorySnapshots.length = 0;
    this.metrics.errors.clear();
    this.metrics.toolExecutions.clear();
    
    console.log('性能指标已重置');
  }
  
  // 清理资源
  cleanup(): void {
    this.stopMonitoring();
    this.reset();
  }
}

export const perfMonitor = PerformanceMonitor.getInstance();