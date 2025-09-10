# ReAgentBuilder

ReAgentBuilder 是一个基于 LangChain 和 LangGraph 构建的智能体框架，旨在为需要高度可控性、可观测性和扩展性的企业级 AI 应用提供坚实的基础。它集成了完整的生命周期管理、动态工具系统、拦截器与断点调试、并发控制、错误处理以及性能监控能力。

## 核心特性

*   **动态工具管理**: 支持在运行时动态添加、查询、替换工具集，并能将一个完整的智能体封装为另一个智能体的工具，实现复杂工作流的组合。
*   **拦截器系统**: 提供在智能体执行生命周期的关键节点（如模型调用前、工具执行前后、任务完成时）注入自定义逻辑的能力，以修改数据流或执行附加操作。
*   **断点调试系统**: 允许在执行过程中的任何关键点设置断点，用于观察实时状态、调试逻辑，且支持异步处理以避免阻塞主流程。
*   **性能与资源管理**: 内置全面的性能监控模块，提供计时器、计数器和内存快照功能。通过并发控制、智能缓存和显式的资源清理机制，确保应用的稳定性和效率。
*   **状态管理与持久化**: 利用 LangGraph 的检查点（Checkpointer）机制，支持多轮对话的上下文记忆和线程安全的状态隔离。默认使用内存存储，并可扩展至持久化后端。
*   **健壮的错误处理**: 集成了统一的错误处理系统，能够对错误进行分类、记录详细上下文，并支持自动重试策略，增强了系统的可靠性。

## 技术架构

### 核心依赖

*   **@langchain/core**: 提供核心抽象、消息类型和工具定义。
*   **@langchain/langgraph**: 负责状态图的构建和工作流管理。
*   **@langchain/openai, @langchain/anthropic**: 支持主流大型语言模型。
*   **zod**: 用于工具输入模式的定义和验证。

### 模块结构

```
reagentbuilder/
├── types/              # 类型定义模块 (Agent, LLM, Interceptor, Breakpoint)
├── core/               # 核心工具模块 (Logger, LLMFactory, Performance, ErrorHandler)
├── agent/              # Agent 功能模块 (ReAgentBuilder, InterceptorManager, BreakpointManager)
└── utils/              # 公共工具函数 (当前为空)
```

## 安装

### 环境要求
*   Node.js >= 16.0.0

### 安装依赖
```bash
# 使用 npm
npm install reagentbuilder

# 使用 pnpm
pnpm add reagentbuilder

# 使用 yarn
yarn add reagentbuilder
```

## 快速开始

### 导入方式

#### 完整导入 (推荐)
```typescript
import { ReAgentBuilder } from 'reagentbuilder';
import { LLMFactory, Logger, ErrorHandler } from 'reagentbuilder';
import type { AgentConfig, LLMConfig, InterceptorConfig, BreakpointConfig } from 'reagentbuilder';
```

#### 模块化导入 (高级)
要使用模块化路径导入，请确保项目构建配置（如 `package.json` 中的 `exports` 字段）能够正确解析这些子路径。
```typescript
import { ReAgentBuilder } from 'reagentbuilder/agent';
import { Logger } from 'reagentbuilder/core';
import type { AgentConfig } from 'reagentbuilder/types';
```

### 默认配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `memory` | `true` | 是否启用对话记忆。 |
| `systemPrompt` | `undefined` | 系统提示词。如果未设置，则不向模型传递任何系统级指令。 |
| `tools` | `[]` | 工具列表，默认为空数组。 |
| `interceptors.enabled` | `false` | 拦截器系统默认关闭。 |
| `breakpoints.enabled` | `false` | 断点系统默认关闭。 |
| `llm.*` | (依赖模型) | `temperature`、`maxTokens`等参数的默认值由底层LangChain模型提供。 |
| `concurrency.*`| `interceptors: 10`, `breakpoints: 5` | 拦截器和断点的最大并发数。 |

### TypeScript 使用示例

```typescript
import { ReAgentBuilder } from 'reagentbuilder';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// 1. 定义工具
const calculatorTool = tool(
  async (input: { a: number; b: number; operation: 'add' | 'multiply' }) => {
    const { a, b, operation } = input;
    switch (operation) {
      case 'add': return `${a} + ${b} = ${a + b}`;
      case 'multiply': return `${a} * ${b} = ${a * b}`;
      default: return 'Unsupported operation';
    }
  },
  {
    name: 'calculator',
    schema: z.object({
      a: z.number().describe('第一个数字'),
      b: z.number().describe('第二个数字'),
      operation: z.enum(['add', 'multiply']).describe('运算类型'),
    }),
    description: '执行基本的数学运算',
  }
);

// 2. 配置并创建智能体
const agent = new ReAgentBuilder({
  name: 'math-agent',
  systemPrompt: '你是一个数学计算助手。',
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY,
  },
  tools: [calculatorTool],
  memory: true // 显式启用记忆
});

// 3. 执行智能体
async function main() {
  const result = await agent.run('请计算 15 乘以 8 的结果', 'thread-1');
  if (result) {
    const lastMessage = result.messages[result.messages.length - 1];
    console.log('Final Result:', lastMessage.content);
  }
}

main();
```

### JavaScript (ES Module) 使用示例

```javascript
// main.js
// 确保 package.json 中已设置 "type": "module"
import { ReAgentBuilder } from 'reagentbuilder';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// 1. 定义工具
const weatherTool = tool(
  async (input) => {
    const weatherData = { '北京': '晴天', '上海': '多云' };
    return weatherData[input.city] || `无法获取${input.city}的天气`;
  },
  {
    name: 'weather',
    schema: z.object({ city: z.string().describe('城市名称') }),
    description: '查询指定城市的天气信息',
  }
);

// 2. 配置并创建智能体
const agent = new ReAgentBuilder({
  name: 'js-demo-agent',
  systemPrompt: '你是一个智能助手。',
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY,
  },
  tools: [weatherTool],
});

// 3. 执行智能体
async function main() {
  const result = await agent.run('查询北京的天气', 'thread-js-1');
  if (result) {
    const lastMessage = result.messages[result.messages.length - 1];
    console.log('Final Result:', lastMessage.content);
  }
}

main();
```

## 高级配置

### 拦截器与断点配置

```typescript
import { ReAgentBuilder } from 'reagentbuilder';
import type { InterceptorConfig, BreakpointConfig } from 'reagentbuilder';

// 配置拦截器系统
const interceptorConfig: InterceptorConfig = {
  enabled: true,
  core: {
    beforeModelInvoke: async (messages, state) => {
      console.log('Interceptor: Modifying model input.');
      return messages;
    },
  },
  global: {
    beforeToolCall: async (toolCall, state) => {
      console.log(`Interceptor: Before calling tool: ${toolCall.name}`);
      return { shortCircuit: false, modifiedInput: toolCall };
    },
  },
};

// 配置断点系统
const breakpointConfig: BreakpointConfig = {
  enabled: true,
  core: {
    beforeModelInvoke: async (messages, state) => {
      console.log('Breakpoint: Observing model input.');
      // 可以在此处执行异步调试操作
    },
  },
};

// 创建具有高级配置的智能体
const advancedAgent = new ReAgentBuilder({
  name: 'advanced-agent',
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY,
  },
  interceptors: interceptorConfig,
  breakpoints: breakpointConfig,
  concurrency: { // 自定义并发限制
    interceptors: 5,
    breakpoints: 2,
  },
});
```

## 工具管理

### 动态添加与设置工具
```typescript
// 动态添加一个工具
agent.addTool(weatherTool);

// 批量设置工具，这将覆盖所有现有工具
agent.setTool([calculatorTool, weatherTool]);
```

### 查询工具
```typescript
// 获取所有工具
const allTools = agent.getTool(); // 返回 StructuredTool[]

// 获取指定名称的工具
const specificTool = agent.getTool('calculator'); // 返回 StructuredTool | undefined
```

### 将智能体转换为工具
此功能允许创建分层的智能体架构。
```typescript
// 1. 创建一个子智能体
const translatorAgent = new ReAgentBuilder({
  name: 'translator',
  systemPrompt: '你是一个专业的翻译引擎。',
  llm: { provider: 'openai', model: 'gpt-4', apiKey: '...' },
});

// 2. 将子智能体转换为一个工具
const translatorTool = translatorAgent.toTool(
  'translator',
  '一个可以将文本在中文和英文之间互译的工具。'
);

// 3. 将此工具添加到主智能体
const mainAgent = new ReAgentBuilder(/* ... */);
mainAgent.addTool(translatorTool);

// 现在 mainAgent 可以调用 translator 工具来执行翻译任务
await mainAgent.run("使用 translator 工具将 'hello world' 翻译成中文。");
```

## 支持的 LLM 提供商

框架通过 `LLMConfig` 接口支持多种 LLM 提供商。

### OpenAI (及兼容 API)
适用于 OpenAI 官方 API、Ollama、vLLM、阿里云通义千问等兼容服务。

```typescript
const openAIConfig = {
  provider: 'openai',
  model: 'gpt-4-turbo',
  apiKey: 'sk-...',
  baseURL: 'https://api.openai.com/v1', // 可选，用于指向兼容 API
};
```

### Anthropic
```typescript
const anthropicConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20240620',
  apiKey: '...',
};
```

### Azure OpenAI
```typescript
const azureConfig = {
  provider: 'azure',
  model: 'gpt-4',
  apiKey: '...',
  azureEndpoint: 'https://your-resource.openai.azure.com',
  apiVersion: '2024-02-01',
  deploymentName: 'your-deployment-name',
};
```

### 自定义模型实例
您可以传入任何 `BaseChatModel` 的实例。
```typescript
import { ChatOpenAI } from '@langchain/openai';

const customModel = new ChatOpenAI({
  model: 'gpt-4',
  apiKey: '...',
});

const customConfig = {
  provider: 'custom',
  model: 'custom-model-identifier',
  instance: customModel,
};
```

## API 参考

### `ReAgentBuilder` 类

#### `constructor(config: AgentConfig)`

#### 主要方法

| 方法 | 描述 | 返回值 |
|------|------|--------|
| `run(input, threadId?)` | 异步执行智能体。 | `Promise<AgentStateType | null>` |
| `addTool(tool)` | 向智能体添加一个工具。 | `void` |
| `getTool(name?)` | 获取一个或所有工具。 | `StructuredTool \| StructuredTool[] \| undefined` |
| `setTool(tools)` | 批量设置工具，覆盖现有列表。 | `void` |
| `toTool(name, desc)` | 将智能体实例转换为一个 `StructuredTool`。 | `StructuredTool` |
| `getLLMInfo()` | 获取当前使用的模型信息。 | `string` |
| `getPerformanceReport()` | 获取详细的性能指标报告。 | `object` |
| `getConcurrencyStatus()` | 获取当前的并发任务状态。 | `object` |
| `cleanup()` | 清理所有内部资源，如缓存和定时器。 | `Promise<void>` |

---

### 核心接口

#### `AgentConfig`
```typescript
interface AgentConfig {
  name: string;
  systemPrompt?: string;
  tools?: StructuredTool[];
  llm: LLMConfig | BaseChatModel;
  interceptors?: InterceptorConfig;
  breakpoints?: BreakpointConfig;
  memory?: boolean; // 默认: true
  concurrency?: {
    interceptors?: number; // 默认: 10
    breakpoints?: number;  // 默认: 5
  };
}
```

#### `InterceptorConfig`
```typescript
import { BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { AgentStateType, InterceptorResult, InterceptorOutput } from "./types";

interface InterceptorConfig {
  enabled: boolean;
  core?: {
    beforeModelInvoke?: (messages: BaseMessage[], state: AgentStateType) => Promise<BaseMessage[]>;
    afterAgentComplete?: (finalState: AgentStateType) => Promise<AgentStateType>;
  };
  global?: {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorResult>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorOutput>;
  };
  toolSpecific?: Map<string, {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorResult>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<InterceptorOutput>;
  }>;
}
```

#### `BreakpointConfig`
```typescript
interface BreakpointConfig {
  enabled: boolean;
  core?: {
    beforeModelInvoke?: (messages: BaseMessage[], state: AgentStateType) => Promise<void>;
    afterAgentComplete?: (finalState: AgentStateType) => Promise<void>;
  };
  global?: {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<void>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<void>;
  };
  toolSpecific?: Map<string, {
    beforeToolCall?: (toolCall: ToolCall, state: AgentStateType) => Promise<void>;
    afterToolCall?: (result: InterceptorOutput, toolCall: ToolCall, state: AgentStateType) => Promise<void>;
  }>;
  model?: {
    beforeCall?: (state: AgentStateType) => Promise<void>;
    afterCall?: (response: BaseMessage, state: AgentStateType) => Promise<void>;
  };
}
```

## 性能与监控

### 获取性能报告
```javascript
const report = agent.getPerformanceReport();
console.log('Performance Report:', JSON.stringify(report, null, 2));

/*
{
  "timestamp": "...",
  "uptime": 10.123,
  "timers": {
    "agent.run": { "count": 1, "total": 1500.25, "average": 1500.25, ... }
  },
  "counters": {
    "agent.runs": 1,
    "tool.executions": 2
  },
  // ... 省略
}
*/
```

### 获取并发状态
```javascript
const status = agent.getConcurrencyStatus();
console.log('Concurrency Status:', status);

/*
{
  "activeInterceptors": 0,
  "activeBreakpoints": 0,
  "toolMapSize": 2
}
*/
```

## 错误处理
框架内置了统一的 `ErrorHandler`，可自动捕获、分类和记录在智能体执行期间发生的错误。它提供了丰富的上下文信息，并能防止重复的错误日志刷屏，以帮助快速定位问题。

## 贡献
欢迎社区贡献。请在提交 Pull Request 前，确保遵循现有的代码风格，添加相应的测试，并更新相关文档。