import { BaseChatModel } from "@langchain/core/language_models/chat_models";

// ============ LLM配置类型 ============
export type LLMProvider = 'openai' | 'anthropic' | 'azure' | 'custom';

export interface BaseLLMConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  timeout?: number;
  maxRetries?: number;
}

export interface OpenAILLMConfig extends BaseLLMConfig {
  provider: 'openai';
  apiKey: string;
  baseURL?: string;
  organization?: string;
}

export interface AnthropicLLMConfig extends BaseLLMConfig {
  provider: 'anthropic';
  apiKey: string;
  baseURL?: string;
}

export interface AzureLLMConfig extends BaseLLMConfig {
  provider: 'azure';
  apiKey: string;
  azureEndpoint: string;
  apiVersion: string;
  deploymentName: string;
}

export interface CustomLLMConfig extends BaseLLMConfig {
  provider: 'custom';
  instance: BaseChatModel;
}

export type LLMConfig = OpenAILLMConfig | AnthropicLLMConfig | AzureLLMConfig | CustomLLMConfig;