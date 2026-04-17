CREATE TABLE heartbeat_presence (
    agent_did       BYTEA       NOT NULL,
    capability_bit  SMALLINT    NOT NULL,
    last_seen_unix  BIGINT      NOT NULL,
    miss_count      INTEGER     NOT NULL DEFAULT 0,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_did, capability_bit)
);

CREATE INDEX idx_heartbeat_presence_last_seen
    ON heartbeat_presence (last_seen_unix DESC);
