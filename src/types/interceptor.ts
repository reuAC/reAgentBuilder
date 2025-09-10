import { BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { AgentStateType, ToolResult, ProcessedToolCall } from "./agent.js";

// ============ 拦截器相关类型 ============
export type InterceptorInput = ToolCall | ProcessedToolCall;
export type InterceptorOutput = string | ToolResult;

export interface InterceptorShortCircuitResult {
  shortCircuit: true;
  result: InterceptorOutput;
}

export interface InterceptorNormalResult {
  shortCircuit: false;
  modifiedInput: InterceptorInput;
}

export type InterceptorResult = InterceptorShortCircuitResult | InterceptorNormalResult;

export interface InterceptorConfig {
  enabled: boolean;
  
  // 核心拦截器 - 最关键的两个位置
  core?: {
    // 开始拦截器：正式调用大模型的前一刻，修改提示词的最后机会
    beforeModelInvoke?: (messages: BaseMessage[], state: AgentStateType) => Promise<BaseMessage[]>;
    // 结束拦截器：所有逻辑全部处理完成，最终对大模型输出的总体处理
    afterAgentComplete?: (finalState: AgentStateType) => Promise<AgentStateType>;
  };
  
  // 全局拦截器 - 对所有工具调用生效
  global?: {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorResult>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorOutput>;
  };
  
  // 特定工具拦截器 - 针对特定工具的拦截
  toolSpecific?: Map<string, {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorResult>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorOutput>;
  }>;
}