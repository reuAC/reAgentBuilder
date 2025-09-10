import { BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { AgentStateType } from "./agent.js";
import type { InterceptorOutput } from "./interceptor.js";

// ============ 断点相关类型 ============
export interface BreakpointConfig {
  enabled: boolean;
  
  // 核心断点 - 最关键的两个位置
  core?: {
    // 开始断点：正式调用大模型的前一刻，观察最终的提示词
    beforeModelInvoke?: (messages: BaseMessage[], state: AgentStateType) => Promise<void>;
    // 结束断点：所有逻辑全部处理完成，观察最终状态
    afterAgentComplete?: (finalState: AgentStateType) => Promise<void>;
  };
  
  // 全局断点 - 对所有工具调用生效
  global?: {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<void>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<void>;
  };
  
  // 特定工具断点 - 针对特定工具的断点
  toolSpecific?: Map<string, {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<void>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<void>;
  }>;
  
  // 模型级别断点
  model?: {
    beforeCall?: (state: AgentStateType) => Promise<void>;
    afterCall?: (response: BaseMessage, state: AgentStateType) => Promise<void>;
  };
}