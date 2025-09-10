import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { 
  LLMConfig, 
  OpenAILLMConfig, 
  AnthropicLLMConfig, 
  AzureLLMConfig, 
  CustomLLMConfig, 
  LLMProvider 
} from "../types/llm.js";
import { logger } from "./logger.js";

// ============ LLM工厂类 ============
export class LLMFactory {
  static create(config: LLMConfig): BaseChatModel {
    this.validateConfig(config);
    logger.debug(`创建 LLM 实例: ${config.provider}`);

    switch (config.provider) {
      case 'openai':
        return this.createOpenAI(config);
      case 'anthropic':
        return this.createAnthropic(config);
      case 'azure':
        return this.createAzure(config);
      case 'custom':
        return this.validateAndReturnCustom(config);
      default:
        const error = `不支持的LLM提供商: ${(config as any).provider || 'unknown'}`;
        logger.error(error);
        throw new Error(error);
    }
  }
  
  private static validateConfig(config: LLMConfig): void {
    if (!config) {
      throw new Error('LLM配置不能为空');
    }
    
    if (!config.provider) {
      throw new Error('必须指定LLM提供商（provider）');
    }
    
    if (!config.model && config.provider !== 'custom') {
      throw new Error('必须指定模型名称（model）');
    }
    
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw new Error('temperature 必须在 0-2 范围内');
    }
    
    if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
      throw new Error('topP 必须在 0-1 范围内');
    }
    
    if (config.maxTokens !== undefined && config.maxTokens <= 0) {
      throw new Error('maxTokens 必须大于 0');
    }
  }

  private static createOpenAI(config: OpenAILLMConfig): ChatOpenAI {
    if (!config.apiKey) {
      throw new Error('OpenAI配置必须提供apiKey');
    }
    if (!config.model) {
      throw new Error('OpenAI配置必须提供model');
    }

    return new ChatOpenAI({
      model: config.model,
      apiKey: config.apiKey,
      configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    });
  }

  private static createAnthropic(config: AnthropicLLMConfig): ChatAnthropic {
    if (!config.apiKey) {
      throw new Error('Anthropic配置必须提供apiKey');
    }
    if (!config.model) {
      throw new Error('Anthropic配置必须提供model');
    }

    return new ChatAnthropic({
      model: config.model,
      anthropicApiKey: config.apiKey,
      anthropicApiUrl: config.baseURL,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
    });
  }

  private static createAzure(config: AzureLLMConfig): ChatOpenAI {
    if (!config.apiKey) {
      throw new Error('Azure配置必须提供apiKey');
    }
    if (!config.azureEndpoint) {
      throw new Error('Azure配置必须提供azureEndpoint');
    }
    if (!config.apiVersion) {
      throw new Error('Azure配置必须提供apiVersion');
    }
    if (!config.deploymentName) {
      throw new Error('Azure配置必须提供deploymentName');
    }

    return new ChatOpenAI({
      model: config.deploymentName,
      openAIApiKey: config.apiKey,
      configuration: {
        baseURL: config.azureEndpoint,
        defaultQuery: { 'api-version': config.apiVersion },
        defaultHeaders: {
          'api-key': config.apiKey
        }
      },
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
  }

  private static validateAndReturnCustom(config: CustomLLMConfig): BaseChatModel {
    if (!config.instance) {
      throw new Error('自定义LLM配置必须提供instance');
    }
    if (!(config.instance instanceof BaseChatModel)) {
      throw new Error('自定义LLM实例必须是BaseChatModel的实例');
    }
    return config.instance;
  }

  static configBuilder() {
    return new LLMConfigBuilder();
  }
}

// ============ LLM配置构建器 ============
export class LLMConfigBuilder {
  private config: Partial<LLMConfig> = {};

  provider(provider: LLMProvider): this {
    this.config.provider = provider;
    return this;
  }

  model(model: string): this {
    this.config.model = model;
    return this;
  }

  apiKey(key: string): this {
    if ('apiKey' in this.config) {
      (this.config as OpenAILLMConfig | AnthropicLLMConfig | AzureLLMConfig).apiKey = key;
    }
    return this;
  }

  baseURL(url: string): this {
    if ('baseURL' in this.config) {
      (this.config as OpenAILLMConfig | AnthropicLLMConfig).baseURL = url;
    }
    return this;
  }

  temperature(temp: number): this {
    this.config.temperature = temp;
    return this;
  }

  maxTokens(tokens: number): this {
    this.config.maxTokens = tokens;
    return this;
  }

  azureConfig(endpoint: string, apiVersion: string, deploymentName: string): this {
    if (this.config.provider === 'azure') {
      (this.config as AzureLLMConfig).azureEndpoint = endpoint;
      (this.config as AzureLLMConfig).apiVersion = apiVersion;
      (this.config as AzureLLMConfig).deploymentName = deploymentName;
    }
    return this;
  }

  build(): LLMConfig {
    if (!this.config.provider) {
      throw new Error('构建器错误：必须指定provider');
    }
    
    if (this.config.provider !== 'custom' && !this.config.model) {
      throw new Error('构建器错误：必须指定model');
    }
    
    switch (this.config.provider) {
      case 'openai':
        if (!(this.config as OpenAILLMConfig).apiKey) {
          throw new Error('构建器错误：OpenAI配置必须提供apiKey');
        }
        break;
      case 'anthropic':
        if (!(this.config as AnthropicLLMConfig).apiKey) {
          throw new Error('构建器错误：Anthropic配置必须提供apiKey');
        }
        break;
      case 'azure':
        const azureConfig = this.config as AzureLLMConfig;
        if (!azureConfig.apiKey) {
          throw new Error('构建器错误：Azure配置必须提供apiKey');
        }
        if (!azureConfig.azureEndpoint) {
          throw new Error('构建器错误：Azure配置必须提供azureEndpoint');
        }
        if (!azureConfig.apiVersion) {
          throw new Error('构建器错误：Azure配置必须提供apiVersion');
        }
        if (!azureConfig.deploymentName) {
          throw new Error('构建器错误：Azure配置必须提供deploymentName');
        }
        break;
      case 'custom':
        if (!(this.config as CustomLLMConfig).instance) {
          throw new Error('构建器错误：自定义配置必须提供instance');
        }
        break;
    }
    
    return this.config as LLMConfig;
  }
}