import { BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import {
  AgentStateType,
  InterceptorConfig,
  InterceptorInput,
  InterceptorOutput,
  InterceptorResult,
} from "../types/index.js";
import { logger, perfUtils, errorHandler, ErrorHandler, ErrorType, ErrorSeverity } from "../core/index.js";

// ============ 拦截器管理类 ============
export class InterceptorManager {
  private config: InterceptorConfig;
  private readonly executionLocks = new Map<string, Promise<any>>();
  private readonly concurrencyLimit: number;
  private activeTasks = new Set<string>();
  
  private readonly isEnabled: boolean;
  private readonly hasCoreBeforeModel: boolean;
  private readonly hasCoreAfterComplete: boolean;
  private readonly hasGlobalBefore: boolean;
  private readonly hasGlobalAfter: boolean;
  private readonly hasToolSpecific: boolean;

  constructor(config: InterceptorConfig, concurrencyLimit: number = 10) {
    if (!config) {
      throw ErrorHandler.createError(
        '拦截器配置不能为空',
        ErrorType.CONFIGURATION,
        ErrorSeverity.HIGH,
        { component: 'InterceptorManager', operation: 'constructor' }
      );
    }
    
    this.config = config;
    this.concurrencyLimit = concurrencyLimit;
    
    // 预计算配置状态
    this.isEnabled = config.enabled;
    this.hasCoreBeforeModel = !!(config.core?.beforeModelInvoke);
    this.hasCoreAfterComplete = !!(config.core?.afterAgentComplete);
    this.hasGlobalBefore = !!(config.global?.beforeToolCall);
    this.hasGlobalAfter = !!(config.global?.afterToolCall);
    this.hasToolSpecific = !!(config.toolSpecific && config.toolSpecific.size > 0);
  }

  private async acquireLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.executionLocks.has(key)) {
      try {
        await this.executionLocks.get(key);
      } catch {
        // 忽略其他任务的错误，继续执行当前任务
      }
    }

    if (this.activeTasks.size >= this.concurrencyLimit) {
      logger.warn(`拦截器并发限制达到上限 (${this.concurrencyLimit})，等待释放...`);
      await this.waitForFreeSlot();
    }

    const taskPromise = this.executeWithLock(key, task);
    this.executionLocks.set(key, taskPromise);
    
    try {
      return await taskPromise;
    } finally {
      this.executionLocks.delete(key);
    }
  }

  private async executeWithLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.activeTasks.add(key);
    try {
      return await task();
    } catch (error) {
      // 确保错误被正确抛出
      throw error;
    } finally {
      this.activeTasks.delete(key);
    }
  }

  private async waitForFreeSlot(): Promise<void> {
    const checkInterval = 50;
    const maxWaitTime = 5000;
    let waitTime = 0;
    
    while (this.activeTasks.size >= this.concurrencyLimit && waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waitTime += checkInterval;
    }
    
    if (waitTime >= maxWaitTime) {
      logger.warn('拦截器等待超时，强制继续执行');
    }
  }

  async interceptBeforeModelInvoke(messages: BaseMessage[], state: AgentStateType): Promise<BaseMessage[]> {
    if (!this.isEnabled || !this.hasCoreBeforeModel) {
      return messages;
    }

    const lockKey = perfUtils.generateId('core-before-model');
    return await this.acquireLock(lockKey, async () => {
      return await errorHandler.wrapAsync(
        async () => {
          logger.debug('核心开始拦截 - 修改大模型输入', { component: 'InterceptorManager', operation: 'beforeModelInvoke' });
          return await this.config.core!.beforeModelInvoke!(messages, state);
        },
        { component: 'InterceptorManager', operation: 'beforeModelInvoke' }
      ).catch(error => {
        logger.error('核心开始拦截器出错', { component: 'InterceptorManager', error: String(error) });
        return messages;
      });
    });
  }

  async interceptAfterAgentComplete(finalState: AgentStateType): Promise<AgentStateType> {
    if (!this.isEnabled || !this.hasCoreAfterComplete) {
      return finalState;
    }

    const lockKey = perfUtils.generateId('core-after-complete');
    return await this.acquireLock(lockKey, async () => {
      try {
        logger.debug('核心结束拦截 - 修改最终输出');
        return await this.config.core!.afterAgentComplete!(finalState);
      } catch (error) {
        logger.error('核心结束拦截器出错', { error: String(error) });
        return finalState;
      }
    });
  }

  async interceptBeforeToolCall(toolCall: ToolCall, state: AgentStateType): Promise<InterceptorResult> {
    if (!this.isEnabled || !this.hasGlobalBefore) {
      return {
        shortCircuit: false,
        modifiedInput: toolCall
      };
    }

    const lockKey = `global-before-tool-${toolCall.name}-${toolCall.id || perfUtils.generateId('tool')}`;
    return await this.acquireLock(lockKey, async () => {
      try {
        logger.debug(`全局工具拦截 - 修改工具调用: ${toolCall.name}`);
        return await this.config.global!.beforeToolCall!(toolCall, state);
      } catch (error) {
        logger.error('全局工具拦截器出错', { error: String(error) });
        return {
          shortCircuit: false,
          modifiedInput: toolCall
        };
      }
    });
  }

  async interceptAfterToolCall(result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType): Promise<InterceptorOutput> {
    if (!this.isEnabled || !this.hasGlobalAfter) {
      return result;
    }

    const lockKey = `global-after-tool-${toolCall.name}-${toolCall.id || perfUtils.generateId('tool')}`;
    return await this.acquireLock(lockKey, async () => {
      try {
        logger.debug(`全局工具结果拦截 - 修改工具结果: ${toolCall.name}`);
        return await this.config.global!.afterToolCall!(result, toolCall, state);
      } catch (error) {
        logger.error('全局工具结果拦截器出错', { error: String(error) });
        return result;
      }
    });
  }

  async interceptSpecificToolCall(toolCall: ToolCall, state: AgentStateType): Promise<InterceptorResult> {
    if (!this.isEnabled || !this.hasToolSpecific) {
      return {
        shortCircuit: false,
        modifiedInput: toolCall
      };
    }
    
    const toolName = toolCall.name;
    const toolInterceptor = this.config.toolSpecific?.get(toolName);
    
    if (!toolInterceptor?.beforeToolCall) {
      return {
        shortCircuit: false,
        modifiedInput: toolCall
      };
    }

    const lockKey = `specific-before-tool-${toolName}-${toolCall.id || perfUtils.generateId('tool')}`;
    return await this.acquireLock(lockKey, async () => {
      try {
        logger.debug(`特定工具拦截 - 修改工具调用: ${toolName}`);
        return await toolInterceptor.beforeToolCall!(toolCall, state);
      } catch (error) {
        logger.error('特定工具拦截器出错', { error: String(error) });
        return {
          shortCircuit: false,
          modifiedInput: toolCall
        };
      }
    });
  }

  async interceptSpecificToolResult(result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType): Promise<InterceptorOutput> {
    if (!this.isEnabled || !this.hasToolSpecific) {
      return result;
    }
    
    const toolName = toolCall.name;
    const toolInterceptor = this.config.toolSpecific?.get(toolName);
    
    if (!toolInterceptor?.afterToolCall) {
      return result;
    }

    const lockKey = `specific-after-tool-${toolName}-${toolCall.id || perfUtils.generateId('tool')}`;
    return await this.acquireLock(lockKey, async () => {
      try {
        logger.debug(`特定工具结果拦截 - 修改工具结果: ${toolName}`);
        return await toolInterceptor.afterToolCall!(result, toolCall, state);
      } catch (error) {
        logger.error('特定工具结果拦截器出错', { error: String(error) });
        return result;
      }
    });
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  async cleanup(): Promise<void> {
    const activeTaskCount = this.activeTasks.size;
    if (activeTaskCount > 0) {
      logger.warn(`清理拦截器时仍有 ${activeTaskCount} 个活跃任务`);
    }
    
    const maxWaitTime = 3000;
    let waitTime = 0;
    
    while (this.activeTasks.size > 0 && waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitTime += 100;
    }
    
    if (this.activeTasks.size > 0) {
      logger.warn(`拦截器清理超时，强制清理 ${this.activeTasks.size} 个任务`);
    }
    
    this.executionLocks.clear();
    this.activeTasks.clear();
    
    // 清理配置对象中的Map引用
    if (this.config.toolSpecific) {
      this.config.toolSpecific.clear();
    }
    
    logger.debug('拦截器资源清理完成');
  }
}