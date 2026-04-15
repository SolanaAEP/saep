ALTER TABLE program_events
  ADD CONSTRAINT program_events_slot_fkey
  FOREIGN KEY (slot) REFERENCES blocks(slot) ON DELETE CASCADE;

DROP TABLE sync_cursor;
