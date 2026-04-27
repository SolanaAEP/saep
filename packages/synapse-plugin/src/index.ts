export { createSynapsePlugin, type SynapsePlugin, type CreatePluginOptions } from './plugin.js';
export { createSynapseClient, isSynapseClient } from './client.js';
export { buildSynapseTools, type ToolContext } from './tools.js';
export { MemoryNonceStore } from './nonce-store.js';
export { TaskFeed, type TaskFeedHandler, type TaskFeedOptions } from './feed/index.js';
export { zodToJsonSchema } from './schema-util.js';
export type { SynapsePluginOptions, NonceEntry, NonceStore } from './types.js';
export type {
  SynapseClient,
  SynapseClientOptions,
  SynapseRpcClient,
  SynapseWsClient,
  SynapseToolDefinition,
  SynapseAgentConfig,
  SynapseTaskEvent,
  SynapseEventType,
} from './synapse-types.js';
