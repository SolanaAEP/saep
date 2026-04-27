/**
 * Synapse client SDK type stubs.
 * Coded against @oobe-protocol-labs/synapse-client-sdk v2.0.0 interface.
 * When the real SDK is installed, these types align with its exports.
 */

export interface SynapseToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface SynapseAgentConfig {
  agentId: string;
  name: string;
  capabilities: string[];
  tools: SynapseToolDefinition[];
  metadata?: Record<string, unknown>;
}

export interface SynapseRpcClient {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
}

export interface SynapseWsClient {
  subscribe(channel: string, handler: (data: unknown) => void): () => void;
  unsubscribe(channel: string): void;
  connected(): boolean;
  reconnect(): Promise<void>;
}

export interface SynapseClient {
  rpc: SynapseRpcClient;
  ws: SynapseWsClient;
  registerAgent(config: SynapseAgentConfig): Promise<{ registered: boolean; sessionId: string }>;
  close(): Promise<void>;
}

export interface SynapseClientOptions {
  rpcUrl: string;
  wsUrl?: string;
  apiKey?: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export type SynapseEventType =
  | 'task:created'
  | 'task:funded'
  | 'task:bid_opened'
  | 'task:awarded'
  | 'task:submitted'
  | 'task:verified'
  | 'task:disputed'
  | 'task:released';

export interface SynapseTaskEvent {
  type: SynapseEventType;
  taskId: string;
  taskAddress: string;
  timestamp: number;
  payload: Record<string, unknown>;
}
