CREATE TABLE compute_bond_snapshots (
    lease_id TEXT PRIMARY KEY,
    agent_did TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('ionet', 'akash')),
    gpu_hours INTEGER NOT NULL CHECK (gpu_hours > 0),
    expires_at BIGINT NOT NULL CHECK (expires_at > 0),
    slashable_until BIGINT NOT NULL CHECK (slashable_until > 0),
    task_id_hex TEXT NULL CHECK (task_id_hex IS NULL OR task_id_hex ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL CHECK (
        status IN ('reserved', 'locked', 'released', 'slashed', 'cancelled', 'expired')
    ),
    status_reason TEXT NULL,
    reserved_price_usd_micro BIGINT NULL,
    broker_pubkey TEXT NOT NULL,
    attestation_sig TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms > 0),
    provider_status TEXT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX compute_bond_snapshots_task_status_idx
    ON compute_bond_snapshots (task_id_hex, status, updated_at_ms DESC);
CREATE INDEX compute_bond_snapshots_provider_status_idx
    ON compute_bond_snapshots (provider, status, updated_at_ms DESC);
CREATE INDEX compute_bond_snapshots_updated_idx
    ON compute_bond_snapshots (updated_at_ms DESC);
