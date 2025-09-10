import { BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import {
  AgentStateType,
  BreakpointConfig,
  InterceptorOutput
} from "../types/index.js";
import { logger, perfUtils } from "../core/index.js";

// ============ 断点管理类 ============
export class BreakpointManager {
  private config: BreakpointConfig;
  private readonly executionQueue = new Map<string, Promise<void>>();
  private readonly concurrentBreakpoints = new Set<string>();
  private readonly maxConcurrentBreakpoints: number;
  
  private readonly isEnabled: boolean;
  private readonly hasCoreBeforeModel: boolean;
  private readonly hasCoreAfterComplete: boolean;
  private readonly hasModelBefore: boolean;
  private readonly hasModelAfter: boolean;
  private readonly hasGlobalBefore: boolean;
  private readonly hasGlobalAfter: boolean;
  private readonly hasToolSpecific: boolean;

  constructor(config: BreakpointConfig, maxConcurrentBreakpoints: number = 5) {
    this.config = config;
    this.maxConcurrentBreakpoints = maxConcurrentBreakpoints;
    
    // 预计算配置状态
    this.isEnabled = config.enabled;
    this.hasCoreBeforeModel = !!(config.core?.beforeModelInvoke);
    this.hasCoreAfterComplete = !!(config.core?.afterAgentComplete);
    this.hasModelBefore = !!(config.model?.beforeCall);
    this.hasModelAfter = !!(config.model?.afterCall);
    this.hasGlobalBefore = !!(config.global?.beforeToolCall);
    this.hasGlobalAfter = !!(config.global?.afterToolCall);
    this.hasToolSpecific = !!(config.toolSpecific && config.toolSpecific.size > 0);
  }

  private async enqueueBreakpoint<T>(key: string, breakpointFn: () => Promise<T>): Promise<T | void> {
    if (this.concurrentBreakpoints.size >= this.maxConcurrentBreakpoints) {
      logger.debug(`断点并发限制达到上限 (${this.maxConcurrentBreakpoints})，跳过断点: ${key}`);
      return;
    }

    if (this.executionQueue.has(key)) {
      logger.debug(`断点已在执行队列中，跳过重复断点: ${key}`);
      return;
    }

    const breakpointPromise = this.executeBreakpoint(key, breakpointFn);
    this.executionQueue.set(key, breakpointPromise.then(() => undefined));

    try {
      return await breakpointPromise;
    } finally {
      this.executionQueue.delete(key);
    }
  }

  private async executeBreakpoint<T>(key: string, breakpointFn: () => Promise<T>): Promise<T | void> {
    this.concurrentBreakpoints.add(key);
    
    try {
      const timeout = 2000;
      let timeoutId: NodeJS.Timeout;
      
      const result = await Promise.race([
        breakpointFn(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`断点执行超时: ${key}`)), timeout);
        })
      ]);
      
      // 清理超时定时器
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      logger.warn(`断点执行失败 [${key}]: ${error instanceof Error ? error.message : String(error)}`);
      return;
    } finally {
      this.concurrentBreakpoints.delete(key);
    }
  }

  async breakBeforeModelInvoke(messages: BaseMessage[], state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasCoreBeforeModel) return;

    const key = perfUtils.generateId('core-before-model');
    await this.enqueueBreakpoint(key, async () => {
      logger.debug('核心开始断点 - 观察大模型输入');
      await this.config.core!.beforeModelInvoke!(messages, state);
    });
  }

  async breakAfterAgentComplete(finalState: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasCoreAfterComplete) return;

    const key = perfUtils.generateId('core-after-complete');
    await this.enqueueBreakpoint(key, async () => {
      logger.debug('核心结束断点 - 观察最终状态');
      await this.config.core!.afterAgentComplete!(finalState);
    });
  }

  async breakBeforeModelCall(state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasModelBefore) return;

    const key = perfUtils.generateId('model-before-call');
    await this.enqueueBreakpoint(key, async () => {
      logger.debug('模型调用前断点');
      await this.config.model!.beforeCall!(state);
    });
  }

  async breakAfterModelCall(response: BaseMessage, state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasModelAfter) return;

    const key = perfUtils.generateId('model-after-call');
    await this.enqueueBreakpoint(key, async () => {
      logger.debug('模型调用后断点');
      await this.config.model!.afterCall!(response, state);
    });
  }

  async breakBeforeToolCall(toolCall: ToolCall, state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasGlobalBefore) return;

    const key = `global-before-tool-${toolCall.name}-${toolCall.id || perfUtils.generateId('tool')}`;
    await this.enqueueBreakpoint(key, async () => {
      logger.debug(`全局工具调用前断点: ${toolCall.name}`);
      await this.config.global!.beforeToolCall!(toolCall, state);
    });
  }

  async breakAfterToolCall(result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasGlobalAfter) return;

    const key = `global-after-tool-${toolCall.name}-${toolCall.id || perfUtils.generateId('tool')}`;
    await this.enqueueBreakpoint(key, async () => {
      logger.debug(`全局工具调用后断点: ${toolCall.name}`);
      await this.config.global!.afterToolCall!(result, toolCall, state);
    });
  }

  async breakBeforeSpecificToolCall(toolCall: ToolCall, state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasToolSpecific) return;
    
    const toolName = String(toolCall.name || 'unknown');
    const toolBreakpoint = this.config.toolSpecific?.get(toolName);
    
    if (!toolBreakpoint?.beforeToolCall) return;

    const key = `specific-before-tool-${toolName}-${toolCall.id || perfUtils.generateId('tool')}`;
    await this.enqueueBreakpoint(key, async () => {
      logger.debug(`特定工具调用前断点: ${toolName}`);
      await toolBreakpoint.beforeToolCall!(toolCall, state);
    });
  }

  async breakAfterSpecificToolCall(result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType): Promise<void> {
    if (!this.isEnabled || !this.hasToolSpecific) return;
    
    const toolName = String(toolCall.name || 'unknown');
    const toolBreakpoint = this.config.toolSpecific?.get(toolName);
    
    if (!toolBreakpoint?.afterToolCall) return;

    const key = `specific-after-tool-${toolName}-${toolCall.id || perfUtils.generateId('tool')}`;
    await this.enqueueBreakpoint(key, async () => {
      logger.debug(`特定工具调用后断点: ${toolName}`);
      await toolBreakpoint.afterToolCall!(result, toolCall, state);
    });
  }

  getActiveBreakpointCount(): number {
    return this.concurrentBreakpoints.size;
  }

  async cleanup(): Promise<void> {
    const activeBreakpointCount = this.concurrentBreakpoints.size;
    if (activeBreakpointCount > 0) {
      logger.warn(`清理断点管理器时仍有 ${activeBreakpointCount} 个活跃断点`);
    }
    
    const maxWaitTime = 2000;
    let waitTime = 0;
    
    while (this.concurrentBreakpoints.size > 0 && waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitTime += 100;
    }
    
    if (this.concurrentBreakpoints.size > 0) {
      logger.warn(`断点管理器清理超时，强制清理 ${this.concurrentBreakpoints.size} 个断点`);
    }
    
    this.executionQueue.clear();
    this.concurrentBreakpoints.clear();
    
    // 清理配置对象中的Map引用
    if (this.config.toolSpecific) {
      this.config.toolSpecific.clear();
    }
    
    logger.debug('断点管理器资源清理完成');
  }
}