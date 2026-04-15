CREATE TABLE sync_cursor (
    program_id    TEXT PRIMARY KEY,
    last_sig      TEXT,
    last_slot     BIGINT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE program_events DROP CONSTRAINT program_events_slot_fkey;
