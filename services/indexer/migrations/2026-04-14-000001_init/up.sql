CREATE TABLE blocks (
    slot          BIGINT PRIMARY KEY,
    hash          TEXT NOT NULL,
    parent_slot   BIGINT,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX blocks_parent_slot_idx ON blocks (parent_slot);

CREATE TABLE program_events (
    id           BIGSERIAL PRIMARY KEY,
    signature    TEXT NOT NULL,
    slot         BIGINT NOT NULL REFERENCES blocks(slot) ON DELETE CASCADE,
    program_id   TEXT NOT NULL,
    event_name   TEXT NOT NULL,
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (signature, event_name)
);

CREATE INDEX program_events_program_id_idx ON program_events (program_id);
CREATE INDEX program_events_slot_idx       ON program_events (slot);
CREATE INDEX program_events_event_name_idx ON program_events (event_name);

CREATE TABLE reorg_log (
    id            BIGSERIAL PRIMARY KEY,
    slot          BIGINT NOT NULL,
    old_hash      TEXT NOT NULL,
    new_hash      TEXT NOT NULL,
    detected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reorg_log_slot_idx ON reorg_log (slot);
