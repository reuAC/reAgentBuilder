# ReAgentBuilder

ReAgentBuilder is an enterprise-grade AI agent framework built on top of LangChain and LangGraph. It is designed to provide a robust foundation for applications requiring highly controllable, observable, and extensible AI agents. The framework integrates complete lifecycle management, a dynamic tool system, interceptors and breakpoints for debugging, concurrency control, sophisticated error handling, and performance monitoring.

[简体中文](./README-CN.md)

## Core Features

*   **Dynamic Tool Management**: Supports adding, querying, and replacing toolsets at runtime. It also allows an entire agent to be wrapped as a tool for another agent, enabling the composition of complex workflows.
*   **Interceptor System**: Provides the ability to inject custom logic at critical points in the agent's execution lifecycle (e.g., before model invocation, before/after tool execution, on task completion) to modify the data flow or perform additional actions.
*   **Breakpoint Debugging System**: Allows setting breakpoints at any key execution point to observe real-time state and debug logic, with asynchronous handling to avoid blocking the main process.
*   **Performance & Resource Management**: Includes a built-in performance monitoring module with timers, counters, and memory snapshot capabilities. Concurrency control, intelligent caching, and explicit resource cleanup mechanisms ensure application stability and efficiency.
*   **State Management & Persistence**: Leverages LangGraph's checkpointer mechanism to support multi-turn conversation memory and thread-safe state isolation. It uses an in-memory checkpointer by default and can be extended to persistent storage backends.
*   **Robust Error Handling**: Integrates a unified error handling system that categorizes errors, logs detailed context, and supports automatic retry strategies, enhancing system reliability.

## Technical Architecture

### Core Dependencies

*   **@langchain/core**: Provides core abstractions, message types, and tool definitions.
*   **@langchain/langgraph**: Manages the state graph and workflow execution.
*   **@langchain/openai, @langchain/anthropic**: Supports major large language models.
*   **zod**: Used for defining and validating tool input schemas.

### Module Structure

```
reagentbuilder/
├── src/
│   ├── types/              # Type Definitions (Agent, LLM, Interceptor, Breakpoint)
│   ├── core/               # Core Utilities (Logger, LLMFactory, Performance, ErrorHandler)
│   ├── agent/              # Agent Functionality (ReAgentBuilder, InterceptorManager, BreakpointManager)
│   └── utils/              # Common Utility Functions (currently empty)
└── ...
```

## Installation

### Prerequisites
*   Node.js >= 18.0.0

### Install Dependency
```bash
# Using npm
npm install reagentbuilder

# Using pnpm
pnpm add reagentbuilder

# Using yarn
yarn add reagentbuilder
```

## Quick Start

### Import Styles

#### Full Import (Recommended)
```typescript
import { ReAgentBuilder } from 'reagentbuilder';
import { LLMFactory, Logger, ErrorHandler } from 'reagentbuilder';
import type { AgentConfig, LLMConfig, InterceptorConfig, BreakpointConfig } from 'reagentbuilder';
```

#### Modular Import (Advanced)
This allows for potential bundle size reduction through tree-shaking in environments that support it.
```typescript
import { ReAgentBuilder } from 'reagentbuilder/agent';
import { Logger } from 'reagentbuilder/core';
import type { AgentConfig } from 'reagentbuilder/types';
```

### TypeScript Usage Example

```typescript
import { ReAgentBuilder } from 'reagentbuilder';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// 1. Define a tool
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
      a: z.number().describe('The first number'),
      b: z.number().describe('The second number'),
      operation: z.enum(['add', 'multiply']).describe('The operation to perform'),
    }),
    description: 'Performs basic mathematical calculations.',
  }
);

// 2. Configure and create an agent
const agent = new ReAgentBuilder({
  name: 'math-agent',
  systemPrompt: 'You are a mathematical assistant.',
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY,
  },
  tools: [calculatorTool],
  memory: true // Memory is enabled by default
});

// 3. Run the agent
async function main() {
  const result = await agent.run('Calculate the result of 15 multiplied by 8', 'thread-1');
  if (result) {
    const lastMessage = result.messages[result.messages.length - 1];
    console.log('Final Result:', lastMessage.content);
  }
}

main();
```

## Advanced Configuration

### Interceptors and Breakpoints

```typescript
import { ReAgentBuilder } from 'reagentbuilder';
import type { InterceptorConfig, BreakpointConfig } from 'reagentbuilder';

// Configure the interceptor system
const interceptorConfig: InterceptorConfig = {
  enabled: true,
  core: {
    beforeModelInvoke: async (messages, state) => {
      console.log('Interceptor: Modifying model input.');
      // Example: add a new message or modify an existing one
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

// Configure the breakpoint system
const breakpointConfig: BreakpointConfig = {
  enabled: true,
  core: {
    beforeModelInvoke: async (messages, state) => {
      console.log('Breakpoint: Observing model input.');
      // Perform asynchronous debugging operations here
    },
  },
};

// Create an agent with advanced configuration
const advancedAgent = new ReAgentBuilder({
  name: 'advanced-agent',
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY,
  },
  interceptors: interceptorConfig,
  breakpoints: breakpointConfig,
  concurrency: { // Customize concurrency limits
    interceptors: 5,
    breakpoints: 2,
  },
});
```

## Tool Management

### Dynamic Tool Handling
```typescript
// Dynamically add a new tool
agent.addTool(weatherTool);

// Set a new list of tools, overwriting all existing ones
agent.setTool([calculatorTool, weatherTool]);
```

### Querying Tools
```typescript
// Get all tools
const allTools = agent.getTool(); // Returns StructuredTool[]

// Get a tool by name
const specificTool = agent.getTool('calculator'); // Returns StructuredTool | undefined
```

### Agent as a Tool
This powerful feature enables a hierarchical agent architecture.
```typescript
// 1. Create a sub-agent for a specific task
const translatorAgent = new ReAgentBuilder({
  name: 'translator',
  systemPrompt: 'You are a professional translation engine.',
  llm: { provider: 'openai', model: 'gpt-4', apiKey: '...' },
});

// 2. Convert the sub-agent into a tool
const translatorTool = translatorAgent.toTool(
  'translator',
  'A tool that translates text between English and Chinese.'
);

// 3. Add the new tool to the main agent
const mainAgent = new ReAgentBuilder(/* ... */);
mainAgent.addTool(translatorTool);

// Now, the main agent can delegate translation tasks to the sub-agent
await mainAgent.run("Use the translator tool to translate 'hello world' into Chinese.");
```

## Supported LLM Providers

The framework supports multiple LLM providers via the `LLMConfig` interface.

### OpenAI (and compatible APIs)
Suitable for the official OpenAI API, as well as compatible services like Ollama, vLLM, etc.

```typescript
const openAIConfig = {
  provider: 'openai',
  model: 'gpt-4-turbo',
  apiKey: 'sk-...',
  baseURL: 'https://api.openai.com/v1', // Optional: for pointing to a compatible API
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
  model: 'gpt-4', // Identifier, actual model is determined by deploymentName
  apiKey: '...',
  azureEndpoint: 'https://your-resource.openai.azure.com',
  apiVersion: '2024-02-01',
  deploymentName: 'your-deployment-name',
};
```

### Custom Model Instance
You can pass any instance that extends `BaseChatModel`.
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

## API Reference

### `ReAgentBuilder` Class

#### `constructor(config: AgentConfig)`

#### Main Methods

| Method | Description | Return Value |
|---|---|---|
| `run(input, threadId?)` | Asynchronously runs the agent. | `Promise<AgentStateType | null>` |
| `addTool(tool)` | Adds a tool to the agent. | `void` |
| `getTool(name?)` | Retrieves one or all tools. | `StructuredTool \| StructuredTool[] \| undefined` |
| `setTool(tools)` | Overwrites the existing tool list. | `void` |
| `toTool(name, desc)` | Converts the agent instance into a `StructuredTool`. | `StructuredTool` |
| `getLLMInfo()` | Gets information about the currently used model. | `string` |
| `getPerformanceReport()` | Retrieves a detailed performance metrics report. | `object` |
| `getConcurrencyStatus()`| Gets the current status of concurrent tasks. | `object` |
| `cleanup()` | Cleans up all internal resources, such as caches and timers. | `Promise<void>` |

---

### Core Interfaces

Abridged definitions for key configuration interfaces. For full details, please refer to the type definition files.

#### `AgentConfig`
```typescript
interface AgentConfig {
  name: string;
  systemPrompt?: string;
  tools?: StructuredTool[];
  llm: LLMConfig | BaseChatModel;
  interceptors?: InterceptorConfig;
  breakpoints?: BreakpointConfig;
  memory?: boolean; // Default: true
  concurrency?: {
    interceptors?: number; // Default: 10
    breakpoints?: number;  // Default: 5
  };
}
```

## Performance Monitoring

### Get Performance Report
```javascript
const report = agent.getPerformanceReport();
console.log('Performance Report:', JSON.stringify(report, null, 2));
```

### Get Concurrency Status
```javascript
const status = agent.getConcurrencyStatus();
console.log('Concurrency Status:', status);
// Example Output: { activeInterceptors: 0, activeBreakpoints: 0, toolMapSize: 2 }
```

## Contributing
Contributions from the community are welcome. Before submitting a pull request, please ensure you follow the existing code style, add relevant tests, and update documentation where necessary.

## License
This project is licensed under the [Apache-2.0 License](LICENSE).