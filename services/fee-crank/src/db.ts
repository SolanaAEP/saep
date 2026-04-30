import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS epoch_snapshots (
  epoch_id            BIGINT PRIMARY KEY,
  governance_root     BYTEA NOT NULL,
  fee_root            BYTEA NOT NULL,
  total_voting_power  NUMERIC NOT NULL,
  staker_count        INTEGER NOT NULL,
  snapshot_slot       BIGINT NOT NULL DEFAULT 0,
  governance_leaves   JSONB NOT NULL,
  fee_leaves          JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function createPool(databaseUrl: string): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  await pool.query(SCHEMA);
  return pool;
}

export interface StoredSnapshot {
  epochId: bigint;
  governanceRoot: Uint8Array;
  feeRoot: Uint8Array;
  totalVotingPower: bigint;
  stakerCount: number;
  snapshotSlot: bigint;
  governanceLeaves: { wallet: string; weight: string }[];
  feeLeaves: { wallet: string; amount: string; epochId: string }[];
}

export async function saveSnapshot(pool: pg.Pool, snap: StoredSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO epoch_snapshots
       (epoch_id, governance_root, fee_root, total_voting_power, staker_count, snapshot_slot, governance_leaves, fee_leaves)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (epoch_id) DO UPDATE SET
       governance_root = EXCLUDED.governance_root,
       fee_root = EXCLUDED.fee_root,
       total_voting_power = EXCLUDED.total_voting_power,
       staker_count = EXCLUDED.staker_count,
       snapshot_slot = EXCLUDED.snapshot_slot,
       governance_leaves = EXCLUDED.governance_leaves,
       fee_leaves = EXCLUDED.fee_leaves`,
    [
      snap.epochId.toString(),
      Buffer.from(snap.governanceRoot),
      Buffer.from(snap.feeRoot),
      snap.totalVotingPower.toString(),
      snap.stakerCount,
      snap.snapshotSlot.toString(),
      JSON.stringify(snap.governanceLeaves),
      JSON.stringify(snap.feeLeaves),
    ],
  );
}

export async function loadSnapshot(pool: pg.Pool, epochId: bigint): Promise<StoredSnapshot | null> {
  const { rows } = await pool.query(
    'SELECT * FROM epoch_snapshots WHERE epoch_id = $1',
    [epochId.toString()],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    epochId: BigInt(row.epoch_id),
    governanceRoot: Uint8Array.from(row.governance_root),
    feeRoot: Uint8Array.from(row.fee_root),
    totalVotingPower: BigInt(row.total_voting_power),
    stakerCount: row.staker_count,
    snapshotSlot: BigInt(row.snapshot_slot),
    governanceLeaves: row.governance_leaves,
    feeLeaves: row.fee_leaves,
  };
}

export async function loadSnapshotBySlot(pool: pg.Pool, slot: bigint): Promise<StoredSnapshot | null> {
  const { rows } = await pool.query(
    'SELECT * FROM epoch_snapshots WHERE snapshot_slot <= $1 ORDER BY snapshot_slot DESC LIMIT 1',
    [slot.toString()],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    epochId: BigInt(row.epoch_id),
    governanceRoot: Uint8Array.from(row.governance_root),
    feeRoot: Uint8Array.from(row.fee_root),
    totalVotingPower: BigInt(row.total_voting_power),
    stakerCount: row.staker_count,
    snapshotSlot: BigInt(row.snapshot_slot),
    governanceLeaves: row.governance_leaves,
    feeLeaves: row.fee_leaves,
  };
}

export async function loadLatestSnapshot(pool: pg.Pool): Promise<StoredSnapshot | null> {
  const { rows } = await pool.query(
    'SELECT * FROM epoch_snapshots ORDER BY epoch_id DESC LIMIT 1',
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    epochId: BigInt(row.epoch_id),
    governanceRoot: Uint8Array.from(row.governance_root),
    feeRoot: Uint8Array.from(row.fee_root),
    totalVotingPower: BigInt(row.total_voting_power),
    stakerCount: row.staker_count,
    snapshotSlot: BigInt(row.snapshot_slot),
    governanceLeaves: row.governance_leaves,
    feeLeaves: row.fee_leaves,
  };
}
