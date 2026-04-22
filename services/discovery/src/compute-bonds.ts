export type ComputeBondStatus =
  | 'reserved'
  | 'locked'
  | 'released'
  | 'slashed'
  | 'cancelled'
  | 'expired';

export type ComputeBondProvider = 'ionet' | 'akash';

export interface ComputeBondSummary {
  lease_id: string;
  agent_did: string;
  provider: ComputeBondProvider;
  gpu_hours: number;
  expires_at: number;
  slashable_until: number;
  task_id: string | null;
  status: ComputeBondStatus;
  status_reason: string | null;
  reserved_price_usd_micro: number | null;
  broker_pubkey: string;
  attestation_sig: string;
  created_at_ms: number;
  updated_at_ms: number;
  provider_status: string | null;
}

export interface ListComputeBondsQuery {
  agentDid?: string;
  taskId?: string;
  taskIds?: readonly string[];
  status?: ComputeBondStatus;
  provider?: ComputeBondProvider;
  limit?: number;
}

export interface ComputeBondClient {
  listBonds(query: ListComputeBondsQuery): Promise<ComputeBondSummary[]>;
}

export class HttpComputeBondClient implements ComputeBondClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listBonds(query: ListComputeBondsQuery): Promise<ComputeBondSummary[]> {
    const url = new URL('/bonds', this.baseUrl);
    if (query.agentDid) url.searchParams.set('agent_did', query.agentDid);
    if (query.taskId) url.searchParams.set('task_id', query.taskId);
    if (query.taskIds && query.taskIds.length > 0) {
      url.searchParams.set('task_ids', query.taskIds.join(','));
    }
    if (query.status) url.searchParams.set('status', query.status);
    if (query.provider) url.searchParams.set('provider', query.provider);
    if (query.limit !== undefined) url.searchParams.set('limit', String(query.limit));

    const res = await this.fetchImpl(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`compute bond broker request failed: ${res.status}`);
    }

    const json = (await res.json()) as { items?: ComputeBondSummary[] };
    return Array.isArray(json.items) ? json.items : [];
  }
}
