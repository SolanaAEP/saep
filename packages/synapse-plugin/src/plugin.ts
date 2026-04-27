import { createHandlerContext, type DiscoveryBackend } from '@saep/handlers';
import type { SynapseClient, SynapseAgentConfig, SynapseToolDefinition } from './synapse-types.js';
import type { SynapsePluginOptions, NonceStore } from './types.js';
import { createSynapseClient, isSynapseClient } from './client.js';
import { buildSynapseTools } from './tools.js';
import { MemoryNonceStore } from './nonce-store.js';
import { TaskFeed, type TaskFeedOptions } from './feed/index.js';

export interface SynapsePlugin {
  tools: SynapseToolDefinition[];
  client: SynapseClient;
  nonceStore: NonceStore;
  feed: TaskFeed;
  register(agentName: string, capabilities: string[]): Promise<{ sessionId: string }>;
  close(): Promise<void>;
}

export interface CreatePluginOptions extends SynapsePluginOptions {
  nonceStore?: NonceStore;
  discovery?: DiscoveryBackend;
  feedOptions?: TaskFeedOptions;
}

export function createSynapsePlugin(opts: CreatePluginOptions): SynapsePlugin {
  const cluster = opts.cluster ?? 'devnet';
  const ctx = createHandlerContext(cluster, opts.connection, opts.wallet);

  const client: SynapseClient = isSynapseClient(opts.synapse)
    ? opts.synapse
    : createSynapseClient(opts.synapse);

  const nonceStore = opts.nonceStore ?? new MemoryNonceStore();

  let discovery: DiscoveryBackend | undefined = opts.discovery;
  if (!discovery && opts.discoveryUrl) {
    discovery = createHttpDiscovery(opts.discoveryUrl);
  }

  const tools = buildSynapseTools(opts, ctx, nonceStore, discovery);
  const feed = new TaskFeed(client.ws, opts.feedOptions);

  return {
    tools,
    client,
    nonceStore,
    feed,

    async register(agentName: string, capabilities: string[]) {
      const config: SynapseAgentConfig = {
        agentId: ctx.operator.toBase58(),
        name: agentName,
        capabilities,
        tools,
      };
      const result = await client.registerAgent(config);
      return { sessionId: result.sessionId };
    },

    async close() {
      feed.stop();
      await client.close();
    },
  };
}

function createHttpDiscovery(baseUrl: string): DiscoveryBackend {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return {
    async search(params) {
      const url = new URL('tasks', base);
      if (params.capability !== undefined) url.searchParams.set('capability', String(params.capability));
      if (params.statuses?.length) url.searchParams.set('status', params.statuses.join(','));
      if (params.minReward !== undefined) url.searchParams.set('min_reward', String(params.minReward));
      url.searchParams.set('limit', String(params.limit));
      url.searchParams.set('page', '1');

      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`discovery request failed (${res.status})`);

      const body = (await res.json()) as { items?: { task_id_hex: string }[] };
      return body.items ?? [];
    },
  };
}
