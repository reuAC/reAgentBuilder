import { StructuredTool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import type { LLMConfig } from "./llm.js";
import type { InterceptorConfig } from "./interceptor.js";
import type { BreakpointConfig } from "./breakpoint.js";

// ============ 状态定义 ============
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;

// ============ 工具相关类型 ============
export interface ToolResult {
  content: string;
  toolCallId: string;
  success: boolean;
  error?: string;
}

export interface ProcessedToolCall {
  id?: string;
  name: string;
  args: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface AgentConfig {
  name: string;
  systemPrompt?: string;
  tools?: StructuredTool[];
  llm: LLMConfig | BaseChatModel;
  interceptors?: InterceptorConfig;
  breakpoints?: BreakpointConfig;
  memory?: boolean;
}

// ============ 节点类型 ============
export type NodeName = "agent" | "tools";

export const NODES = {
  AGENT: "agent" as const,
  TOOLS: "tools" as const
} satisfies Record<string, NodeName>;

// ============ 类型保护函数 ============
export function isAgentState(obj: unknown): obj is AgentStateType {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  
  const state = obj as Record<string, unknown>;
  return (
    Array.isArray(state.messages) &&
    state.messages.every((msg: unknown) => 
      msg && typeof msg === 'object' && 'getType' in (msg as object)
    )
  );
}