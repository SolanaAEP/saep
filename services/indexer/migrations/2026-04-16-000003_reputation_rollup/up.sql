CREATE TABLE category_reputation (
    agent_did         BYTEA       NOT NULL,
    capability_bit    SMALLINT    NOT NULL,
    quality           SMALLINT    NOT NULL DEFAULT 0,
    timeliness        SMALLINT    NOT NULL DEFAULT 0,
    availability      SMALLINT    NOT NULL DEFAULT 0,
    cost_efficiency   SMALLINT    NOT NULL DEFAULT 0,
    honesty           SMALLINT    NOT NULL DEFAULT 0,
    jobs_completed    BIGINT      NOT NULL DEFAULT 0,
    jobs_disputed     BIGINT      NOT NULL DEFAULT 0,
    last_task_id      BYTEA,
    status            TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'retired', 'slashed')),
    last_update       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_did, capability_bit)
);

CREATE INDEX category_reputation_capability_idx
    ON category_reputation (capability_bit, status);
CREATE INDEX category_reputation_last_update_idx
    ON category_reputation (last_update DESC);

CREATE TABLE reputation_samples (
    id                BIGSERIAL PRIMARY KEY,
    signature         TEXT        NOT NULL,
    slot              BIGINT      NOT NULL,
    agent_did         BYTEA       NOT NULL,
    capability_bit    SMALLINT    NOT NULL,
    task_id           BYTEA       NOT NULL,
    completed         BOOLEAN     NOT NULL,
    quality_delta     SMALLINT    NOT NULL DEFAULT 0,
    timeliness_delta  SMALLINT    NOT NULL DEFAULT 0,
    correctness       SMALLINT    NOT NULL DEFAULT 0,
    judge_kind        TEXT        NOT NULL
                       CHECK (judge_kind IN ('Circuit', 'Arbiter', 'Client')),
    execution_root    BYTEA       NOT NULL,
    ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (signature, task_id, agent_did, capability_bit)
);

CREATE INDEX reputation_samples_agent_idx
    ON reputation_samples (agent_did, capability_bit, ingested_at DESC);
CREATE INDEX reputation_samples_task_idx ON reputation_samples (task_id);
CREATE INDEX reputation_samples_slot_idx ON reputation_samples (slot);

CREATE MATERIALIZED VIEW reputation_rollup AS
SELECT
    agent_did,
    capability_bit,
    quality,
    timeliness,
    availability,
    cost_efficiency,
    honesty,
    jobs_completed,
    jobs_disputed,
    (quality::int + timeliness + availability + cost_efficiency + honesty) / 5
        AS composite_score,
    last_update
FROM category_reputation
WHERE status = 'active';

CREATE UNIQUE INDEX reputation_rollup_pk_idx
    ON reputation_rollup (agent_did, capability_bit);
CREATE INDEX reputation_rollup_leaderboard_idx
    ON reputation_rollup (capability_bit, composite_score DESC);
CREATE INDEX reputation_rollup_agent_idx ON reputation_rollup (agent_did);
