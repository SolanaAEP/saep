diesel::table! {
    blocks (slot) {
        slot -> Int8,
        hash -> Text,
        parent_slot -> Nullable<Int8>,
        processed_at -> Timestamptz,
    }
}

diesel::table! {
    program_events (id) {
        id -> Int8,
        signature -> Text,
        slot -> Int8,
        program_id -> Text,
        event_name -> Text,
        data -> Jsonb,
        ingested_at -> Timestamptz,
    }
}

diesel::table! {
    reorg_log (id) {
        id -> Int8,
        slot -> Int8,
        old_hash -> Text,
        new_hash -> Text,
        detected_at -> Timestamptz,
    }
}

diesel::allow_tables_to_appear_in_same_query!(blocks, program_events, reorg_log);
