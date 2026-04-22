type QueryFn = (text: string, values?: unknown[]) => Promise<unknown[]>;

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
  taskId?: string;
  taskIds?: readonly string[];
  status?: ComputeBondStatus;
  provider?: ComputeBondProvider;
  limit?: number;
}

interface RawComputeBondRow {
  lease_id: string;
  agent_did: string;
  provider: ComputeBondProvider;
  gpu_hours: number;
  expires_at: string | number;
  slashable_until: string | number;
  task_id_hex: string | null;
  status: ComputeBondStatus;
  status_reason: string | null;
  reserved_price_usd_micro: string | number | null;
  broker_pubkey: string;
  attestation_sig: string;
  created_at_ms: string | number;
  updated_at_ms: string | number;
  provider_status: string | null;
}

function asNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function mapRow(row: RawComputeBondRow): ComputeBondSummary {
  return {
    lease_id: row.lease_id,
    agent_did: row.agent_did,
    provider: row.provider,
    gpu_hours: row.gpu_hours,
    expires_at: asNumber(row.expires_at),
    slashable_until: asNumber(row.slashable_until),
    task_id: row.task_id_hex,
    status: row.status,
    status_reason: row.status_reason,
    reserved_price_usd_micro:
      row.reserved_price_usd_micro == null ? null : asNumber(row.reserved_price_usd_micro),
    broker_pubkey: row.broker_pubkey,
    attestation_sig: row.attestation_sig,
    created_at_ms: asNumber(row.created_at_ms),
    updated_at_ms: asNumber(row.updated_at_ms),
    provider_status: row.provider_status,
  };
}

export async function loadComputeBondMapForTaskIds(
  query: QueryFn,
  taskIds: readonly string[],
): Promise<Map<string, ComputeBondSummary[]>> {
  if (taskIds.length === 0) {
    return new Map();
  }

  const rows = (await query(
    `SELECT lease_id,
            agent_did,
            provider,
            gpu_hours,
            expires_at,
            slashable_until,
            task_id_hex,
            status,
            status_reason,
            reserved_price_usd_micro,
            broker_pubkey,
            attestation_sig,
            created_at_ms,
            updated_at_ms,
            provider_status
     FROM compute_bond_snapshots
     WHERE task_id_hex = ANY($1::text[])
     ORDER BY updated_at_ms DESC, lease_id ASC`,
    [[...new Set(taskIds)]],
  )) as RawComputeBondRow[];

  const grouped = new Map<string, ComputeBondSummary[]>();
  for (const row of rows) {
    const summary = mapRow(row);
    if (!summary.task_id) continue;
    const existing = grouped.get(summary.task_id);
    if (existing) {
      existing.push(summary);
      continue;
    }
    grouped.set(summary.task_id, [summary]);
  }
  return grouped;
}

export async function listPersistedComputeBonds(
  query: QueryFn,
  filters: ListComputeBondsQuery,
): Promise<ComputeBondSummary[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.taskId) {
    conditions.push(`task_id_hex = $${idx++}`);
    values.push(filters.taskId);
  } else if (filters.taskIds && filters.taskIds.length > 0) {
    conditions.push(`task_id_hex = ANY($${idx++}::text[])`);
    values.push([...new Set(filters.taskIds)]);
  } else {
    return [];
  }

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.provider) {
    conditions.push(`provider = $${idx++}`);
    values.push(filters.provider);
  }
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));

  const rows = (await query(
    `SELECT lease_id,
            agent_did,
            provider,
            gpu_hours,
            expires_at,
            slashable_until,
            task_id_hex,
            status,
            status_reason,
            reserved_price_usd_micro,
            broker_pubkey,
            attestation_sig,
            created_at_ms,
            updated_at_ms,
            provider_status
     FROM compute_bond_snapshots
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at_ms DESC, lease_id ASC
     LIMIT $${idx}`,
    [...values, limit],
  )) as RawComputeBondRow[];

  return rows.map(mapRow);
}
