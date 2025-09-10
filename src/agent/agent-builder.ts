import { StateGraph, START } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { BaseMessage, AIMessage, HumanMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import { StructuredTool, tool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ToolCall } from "@langchain/core/messages/tool";
import { z } from "zod";
import {
  AgentState,
  AgentStateType,
  AgentConfig,
  InterceptorConfig,
  BreakpointConfig,
  InterceptorInput,
  InterceptorOutput,
  InterceptorResult,
  NodeName,
  NODES,
  LLMConfig,
  isAgentState
} from "../types/index.js";
import { logger, LLMFactory, perfUtils, perfMonitor, errorHandler, ErrorHandler, ErrorType, ErrorSeverity } from "../core/index.js";
import { InterceptorManager } from "./interceptor-manager.js";
import { BreakpointManager } from "./breakpoint-manager.js";

// ============ 智能体构建器 ============
export class ReAgentBuilder {
  private config: AgentConfig;
  private interceptorManager: InterceptorManager;
  private breakpointManager: BreakpointManager;
  private llm!: BaseChatModel;
  private workflow!: StateGraph<typeof AgentState.State>;
  private toolMap: Map<string, StructuredTool> = new Map();
  
  private messageCache = new Map<string, BaseMessage[]>();
  private readonly MAX_CACHE_SIZE = 50;
  private cleanupHandlers: (() => void | Promise<void>)[] = [];

  constructor(config: AgentConfig & { 
    concurrency?: { 
      interceptors?: number; 
      breakpoints?: number; 
    } 
  } = {} as any) {
    if (!config) {
      throw ErrorHandler.createError(
        '智能体配置不能为空',
        ErrorType.CONFIGURATION,
        ErrorSeverity.CRITICAL,
        { component: 'ReAgentBuilder', operation: 'constructor' }
      );
    }
    if (!config.name) {
      throw ErrorHandler.createError(
        '必须提供智能体名称（name）',
        ErrorType.CONFIGURATION,
        ErrorSeverity.HIGH,
        { component: 'ReAgentBuilder', operation: 'constructor' }
      );
    }
    if (!config.llm) {
      throw ErrorHandler.createError(
        '必须提供LLM配置（llm）',
        ErrorType.CONFIGURATION,
        ErrorSeverity.CRITICAL,
        { component: 'ReAgentBuilder', operation: 'constructor' }
      );
    }

    this.config = {
      memory: config.memory !== undefined ? config.memory : true,
      ...config
    };
    
    const interceptorConcurrency = config.concurrency?.interceptors || 10;
    const breakpointConcurrency = config.concurrency?.breakpoints || 5;
    
    this.interceptorManager = new InterceptorManager(
      config.interceptors || { enabled: false },
      interceptorConcurrency
    );
    this.breakpointManager = new BreakpointManager(
      config.breakpoints || { enabled: false },
      breakpointConcurrency
    );
    
    this.initializeLLM();
    this.setupTools();
    this.buildWorkflow();
    
    perfMonitor.startMonitoring();
    perfMonitor.incrementCounter('agent.created');
  }

  private initializeLLM() {
    if (this.config.llm instanceof BaseChatModel) {
      this.llm = this.config.llm as BaseChatModel;
    } else {
      this.llm = LLMFactory.create(this.config.llm as LLMConfig);
    }
  }

  private setupTools() {
    if (this.config.tools) {
      this.config.tools.forEach(tool => {
        this.toolMap.set(tool.name, tool);
      });
    }
  }

  private async callModel(state: AgentStateType) {
    await this.breakpointManager.breakBeforeModelCall(state);

    const messages = [...state.messages];
    const hasSystemMessage = messages.some(msg => msg.getType() === 'system');
    if (this.config.systemPrompt && !hasSystemMessage) {
      messages.unshift(new SystemMessage(this.config.systemPrompt));
    }

    let finalMessages = await this.interceptorManager.interceptBeforeModelInvoke(messages, state);

    await this.breakpointManager.breakBeforeModelInvoke(finalMessages, state);

    const tools = Array.from(this.toolMap.values());
    const modelWithTools = tools.length > 0 ? this.llm?.bindTools?.(tools) || this.llm : this.llm;
    if (!modelWithTools) {
      throw new Error('模型初始化失败');
    }
    const response = await modelWithTools.invoke(finalMessages);

    logger.info(`[${this.config.name}] 🔍 模型完整返回:`, {
      type: response.getType(),
      content: response.content,
      tool_calls: (response as AIMessage).tool_calls || [],
      tool_calls_count: ((response as AIMessage).tool_calls || []).length
    });

    await this.breakpointManager.breakAfterModelCall(response, state);

    return { messages: [response] };
  }

  private async executeTools(state: AgentStateType) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMessage.tool_calls || [];
    
    if (toolCalls.length === 0) {
      return { messages: [] };
    }
    
    const validToolCalls: ToolCall[] = [];
    const invalidToolCalls: ToolCall[] = [];
    
    for (const toolCall of toolCalls) {
      if (this.toolMap.has(toolCall.name)) {
        validToolCalls.push(toolCall);
      } else {
        invalidToolCalls.push(toolCall);
      }
    }
    
    // 如果存在无效工具，先记录错误
    if (invalidToolCalls.length > 0) {
      logger.warn(`检测到 ${invalidToolCalls.length} 个无效工具调用: ${invalidToolCalls.map(tc => tc.name).join(', ')}`);
    }
    
    const allToolMessages: ToolMessage[] = [];
    
    // 处理无效工具调用，快速生成错误消息
    for (const [index, toolCall] of invalidToolCalls.entries()) {
      const executionId = toolCall.id || perfUtils.generateId(`invalid-${index}`);
      const errorMessage = `Unknown tool: ${toolCall.name}`;
      
      allToolMessages.push(new ToolMessage({
        content: errorMessage,
        tool_call_id: executionId,
      }));
    }
    
    // 只对有效工具执行并行处理
    if (validToolCalls.length === 0) {
      return { messages: allToolMessages };
    }
    
    const toolExecutionTasks = validToolCalls.map(async (toolCall, index): Promise<ToolMessage> => {
      const executionId = toolCall.id || perfUtils.generateId(`exec-${index}`);
      const timerName = `tool.${toolCall.name}`;
      
      perfMonitor.startTimer(timerName);
      perfMonitor.incrementCounter('tool.executions');
      perfMonitor.incrementCounter(`tool.${toolCall.name}.executions`);
      
      try {
        let globalInterceptResult = await this.interceptorManager.interceptBeforeToolCall(toolCall, state);
        
        try {
          await this.breakpointManager.breakBeforeToolCall(toolCall, state);
        } catch (error) {
          logger.warn(`全局工具前断点失败: ${error}`);
        }
        
        let finalInterceptResult = globalInterceptResult;
        if (!globalInterceptResult.shortCircuit) {
          finalInterceptResult = await this.interceptorManager.interceptSpecificToolCall(globalInterceptResult.modifiedInput as ToolCall, state);
        }
        
        try {
          await this.breakpointManager.breakBeforeSpecificToolCall(toolCall, state);
        } catch (error) {
          logger.warn(`特定工具前断点失败: ${error}`);
        }
        
        let result: InterceptorOutput;
        
        if (finalInterceptResult.shortCircuit) {
          result = finalInterceptResult.result;
          logger.info(`[${this.config.name}] 工具调用被短路: ${toolCall.name} (ID: ${executionId})`);
        } else {
          const tool = this.toolMap.get(toolCall.name)!;
          
          logger.info(`[${this.config.name}] 并行执行工具: ${toolCall.name} (ID: ${executionId})`);
          const modifiedToolCall = finalInterceptResult.modifiedInput as ToolCall;
          result = await tool.invoke(modifiedToolCall.args);
        }
        
        const specificProcessedResult = await this.interceptorManager.interceptSpecificToolResult(result, toolCall, state);
        
        try {
          await this.breakpointManager.breakAfterSpecificToolCall(specificProcessedResult, toolCall, state);
        } catch (error) {
          logger.warn(`特定工具后断点失败: ${error}`);
        }
        
        const finalResult = await this.interceptorManager.interceptAfterToolCall(specificProcessedResult, toolCall as ToolCall, state);
        
        try {
          await this.breakpointManager.breakAfterToolCall(finalResult, toolCall, state);
        } catch (error) {
          logger.warn(`全局工具后断点失败: ${error}`);
        }
        
        const duration = perfMonitor.endTimer(timerName);
        perfMonitor.recordToolExecution(toolCall.name, duration, true);
        perfMonitor.incrementCounter('tool.successes');
      
        return new ToolMessage({
          content: String(finalResult),
          tool_call_id: executionId,
        });
        
      } catch (error) {
        const errorMessage = `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(`工具执行失败 (ID: ${executionId}): ${errorMessage}`);
        
        const duration = perfMonitor.endTimer(timerName);
        perfMonitor.recordToolExecution(toolCall.name, duration, false);
        perfMonitor.incrementCounter('tool.failures');
        perfMonitor.recordError(`tool.${toolCall.name}.error`);
        
        return new ToolMessage({
          content: errorMessage,
          tool_call_id: executionId,
        });
      }
    });
    
    logger.info(`[${this.config.name}] 开始并行执行 ${validToolCalls.length} 个有效工具...`);
    const executionResults = await Promise.allSettled(toolExecutionTasks);
    
    const toolMessages: ToolMessage[] = [...allToolMessages]; // 包含无效工具的错误消息
    const errorMessages: ToolMessage[] = [...allToolMessages.filter(msg => 
      String(msg.content).startsWith('Unknown tool:'))];
    
    executionResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        toolMessages.push(result.value);
        
        const contentStr = String(result.value.content);
        if (contentStr.startsWith('Error executing tool')) {
          errorMessages.push(result.value);
        }
      } else {
        const toolCall = validToolCalls[index]; // 使用validToolCalls
        const errorMessage = `Critical error executing tool ${toolCall?.name || 'unknown'}: ${result.reason}`;
        logger.error(`工具并行执行严重失败: ${errorMessage}`);
        
        const errorToolMessage = new ToolMessage({
          content: errorMessage,
          tool_call_id: toolCall?.id || perfUtils.generateId(`error-${index}`),
        });
        
        toolMessages.push(errorToolMessage);
        errorMessages.push(errorToolMessage);
      }
    });
    
    const totalTools = toolCalls.length; // 包括无效工具
    const successCount = toolMessages.length - errorMessages.length;
    logger.info(`[${this.config.name}] 并行执行完成: 成功 ${successCount}/${totalTools}, 失败 ${errorMessages.length}/${totalTools}`);
    
    if (errorMessages.length > Math.floor(totalTools / 2)) {
      logger.warn(`检测到过多工具错误 (${errorMessages.length}/${totalTools})，可能存在系统性问题`);
    }
    
    return { messages: toolMessages };
  }

  private shouldContinue(state: AgentStateType): NodeName | "end" {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && "tool_calls" in lastMessage && (lastMessage as AIMessage).tool_calls?.length) {
      return NODES.TOOLS;
    }
    return "end";
  }

  private buildWorkflow() {
    this.workflow = new StateGraph(AgentState);

    this.workflow.addNode(NODES.AGENT as any, this.callModel.bind(this));
    this.workflow.addNode(NODES.TOOLS as any, this.executeTools.bind(this));

    this.workflow.addEdge(START, NODES.AGENT as any);
    this.workflow.addConditionalEdges(NODES.AGENT as any, this.shouldContinue.bind(this));
    this.workflow.addEdge(NODES.TOOLS as any, NODES.AGENT as any);
  }
  
  private cacheMessages(key: string, messages: BaseMessage[]): void {
    if (this.messageCache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.messageCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.messageCache.delete(oldestKey);
      }
    }
    this.messageCache.set(key, messages);
  }
  
  private getCachedMessages(key: string): BaseMessage[] | undefined {
    return this.messageCache.get(key);
  }
  
  private clearMessageCache(): void {
    this.messageCache.clear();
  }

  async run(userInput: string | BaseMessage[], threadId?: string) {
    perfMonitor.startTimer('agent.run');
    perfMonitor.incrementCounter('agent.runs');
    
    const memory = this.config.memory ? new MemorySaver() : undefined;
    const app = this.workflow.compile({ 
      checkpointer: memory 
    });
    
    const config = threadId ? { configurable: { thread_id: threadId } } : {};
    
    const messages = Array.isArray(userInput) 
      ? userInput 
      : [new HumanMessage(userInput)];
    
    const input = { messages };
    
    logger.info(`[${this.config.name}] 开始执行...`);
    
    const stream = await app.stream(input, {
      ...config,
      streamMode: "values" as const,
    });
    
    let finalState: AgentStateType | null = null;
    
    for await (const chunk of stream) {
      if (isAgentState(chunk)) {
        finalState = chunk;
        const lastMessage = finalState.messages[finalState.messages.length - 1];
        
        if (lastMessage?.content) {
          logger.info(`[${this.config.name}] 消息: ${typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content)}`);
        }
        
        if (lastMessage && "tool_calls" in lastMessage) {
          const aiMessage = lastMessage as AIMessage;
          if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
            logger.info(`[${this.config.name}] 工具调用: ${aiMessage.tool_calls.map(tc => tc.name).join(', ')}`);
          }
        }
      }
    }
    
    if (finalState) {
      finalState = await this.interceptorManager.interceptAfterAgentComplete(finalState);
      
      await this.breakpointManager.breakAfterAgentComplete(finalState);
      
      const duration = perfMonitor.endTimer('agent.run');
      perfMonitor.incrementCounter('agent.run.success');
      logger.debug(`智能体运行完成，耗时: ${duration.toFixed(2)}ms`);
    } else {
      perfMonitor.endTimer('agent.run');
      perfMonitor.incrementCounter('agent.run.failure');
      perfMonitor.recordError('agent.run.no_final_state');
    }
    
    return finalState;
  }

  getLLMInfo(): string {
    const modelInfo = this.llm && 'model' in this.llm ? (this.llm as any).model : 'unknown';
    return `${this.config.name} 使用的模型: ${modelInfo}`;
  }
  
  async cleanup(): Promise<void> {
    try {
      logger.debug(`清理智能体资源: ${this.config.name}`);
      
      await Promise.allSettled([
        this.interceptorManager.cleanup(),
        this.breakpointManager.cleanup(),
        (async () => {
          if (this.llm && 'cleanup' in this.llm && typeof (this.llm as any).cleanup === 'function') {
            await (this.llm as any).cleanup();
          }
        })(),
        // 执行自定义清理处理器
        ...this.cleanupHandlers.map(handler => Promise.resolve(handler())),
        // 清理所有映射和缓存
        (async () => {
          this.toolMap.clear();
          this.clearMessageCache();
          this.cleanupHandlers.length = 0; // 清空数组但保持引用
        })(),
        // 清理工具类缓存
        (async () => {
          perfUtils.cleanup();
          perfMonitor.cleanup();
        })(),
        // 最后刷新日志
        (async () => {
          logger.flush();
        })()
      ]);
      
      // 强制垃圾回收
      if (global.gc) {
        global.gc();
      }
      
      logger.debug(`智能体资源清理完成: ${this.config.name}`);
    } catch (error) {
      logger.error(`清理智能体资源失败: ${this.config.name}`, { error: String(error) });
    }
  }

  getConcurrencyStatus(): {
    activeInterceptors: number;
    activeBreakpoints: number;
    toolMapSize: number;
  } {
    return {
      activeInterceptors: this.interceptorManager.getActiveTaskCount(),
      activeBreakpoints: this.breakpointManager.getActiveBreakpointCount(),
      toolMapSize: this.toolMap.size
    };
  }
  
  getPerformanceReport(): any {
    const report = perfMonitor.getReport();
    report.agent = {
      name: this.config.name,
      toolsCount: this.toolMap.size,
      concurrency: this.getConcurrencyStatus(),
      memoryCache: {
        size: this.messageCache.size,
        maxSize: this.MAX_CACHE_SIZE
      }
    };
    return report;
  }
  
  resetPerformanceStats(): void {
    perfMonitor.reset();
    logger.info(`[${this.config.name}] 性能统计已重置`);
  }

  // 将 ReAgentBuilder 转换为标准的 @langchain/core/tools 工具
  toTool(name: string, description: string): StructuredTool {
    return tool(
      async (input) => {
        const typedInput = input as { prompt: string };
        try {
          logger.debug(`[${this.config.name}] 作为工具被调用，用户提示: ${typedInput.prompt}`);
          
          const result = await this.run(typedInput.prompt);
          if (result) {
            const lastMessage = result.messages[result.messages.length - 1];
            return String(lastMessage.content || '');
          }
          return '无响应';
        } catch (error) {
          const errorMessage = `ReAgentBuilder工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMessage, { error: String(error) });
          return errorMessage;
        }
      },
      {
        name,
        schema: z.object({
          prompt: z.string().describe("用户提示词，传递给智能体进行处理")
        }),
        description,
      }
    );
  }

  // 实时添加工具
  addTool(tool: StructuredTool): void {
    if (!tool || !tool.name) {
      throw ErrorHandler.createError(
        '工具不能为空且必须有名称',
        ErrorType.VALIDATION,
        ErrorSeverity.HIGH,
        { component: 'ReAgentBuilder', operation: 'addTool', toolName: tool?.name }
      );
    }
    
    if (this.toolMap.has(tool.name)) {
      logger.warn(`工具 ${tool.name} 已存在，将被覆盖`, { 
        component: 'ReAgentBuilder', 
        operation: 'addTool',
        agentName: this.config.name,
        toolName: tool.name 
      });
    }
    
    this.toolMap.set(tool.name, tool);
    logger.debug(`成功添加工具: ${tool.name}`, { 
      component: 'ReAgentBuilder',
      operation: 'addTool',
      agentName: this.config.name,
      toolName: tool.name
    });
    
    perfMonitor.incrementCounter('tools.added');
  }

  // 获取当前工具
  getTool(toolName?: string): StructuredTool | StructuredTool[] | undefined {
    if (toolName) {
      const tool = this.toolMap.get(toolName);
      if (!tool) {
        logger.debug(`[${this.config.name}] 工具 ${toolName} 未找到`);
      }
      return tool;
    }
    
    return Array.from(this.toolMap.values());
  }

  // 传入数组覆盖当前工具设置
  setTool(tools: StructuredTool[]): void {
    if (!Array.isArray(tools)) {
      throw ErrorHandler.createError(
        '工具列表必须是数组',
        ErrorType.VALIDATION,
        ErrorSeverity.HIGH,
        { component: 'ReAgentBuilder', operation: 'setTool', toolsType: typeof tools }
      );
    }
    
    const oldToolCount = this.toolMap.size;
    this.toolMap.clear();
    
    const context = { 
      component: 'ReAgentBuilder', 
      operation: 'setTool',
      agentName: this.config.name 
    };
    
    for (const tool of tools) {
      if (!tool || !tool.name) {
        logger.warn('跳过无效工具', { ...context, invalidTool: tool });
        continue;
      }
      
      this.toolMap.set(tool.name, tool);
    }
    
    const newToolCount = this.toolMap.size;
    logger.info(`工具设置已更新: ${oldToolCount} -> ${newToolCount} 个工具`, context);
    
    perfMonitor.incrementCounter('tools.set');
    
    if (newToolCount === 0) {
      logger.warn('当前没有可用工具', context);
    }
  }
}