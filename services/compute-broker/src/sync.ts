import type { ComputeBondRecord } from '@saep/sdk';

export interface ComputeBondSnapshotSync {
  syncSnapshots(
    records: readonly ComputeBondRecord[],
    options?: { providerStatuses?: ReadonlyMap<string, string | null> },
  ): Promise<void>;
}

export class HttpIndexerSnapshotSync implements ComputeBondSnapshotSync {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async syncSnapshots(
    records: readonly ComputeBondRecord[],
    options?: { providerStatuses?: ReadonlyMap<string, string | null> },
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const url = new URL('/compute-bonds/snapshots', this.baseUrl);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: records.map((record) => ({
          lease_id: record.lease_id,
          agent_did: record.agent_did,
          provider: record.provider,
          gpu_hours: record.gpu_hours,
          expires_at: record.expires_at,
          slashable_until: record.slashable_until,
          task_id: record.task_id,
          status: record.status,
          status_reason: record.status_reason,
          reserved_price_usd_micro: record.reserved_price_usd_micro,
          broker_pubkey: record.broker_pubkey,
          attestation_sig: record.attestation_sig,
          created_at_ms: record.created_at_ms,
          updated_at_ms: record.updated_at_ms,
          provider_status: options?.providerStatuses?.get(record.lease_id) ?? null,
        })),
      }),
    });

    if (!res.ok) {
      throw new Error(`indexer snapshot sync failed: ${res.status}`);
    }
  }
}
