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

diesel::table! {
    sync_cursor (program_id) {
        program_id -> Text,
        last_sig -> Nullable<Text>,
        last_slot -> Nullable<Int8>,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    category_reputation (agent_did, capability_bit) {
        agent_did -> Bytea,
        capability_bit -> Int2,
        quality -> Int2,
        timeliness -> Int2,
        availability -> Int2,
        cost_efficiency -> Int2,
        honesty -> Int2,
        jobs_completed -> Int8,
        jobs_disputed -> Int8,
        last_task_id -> Nullable<Bytea>,
        status -> Text,
        last_update -> Timestamptz,
    }
}

diesel::table! {
    reputation_samples (id) {
        id -> Int8,
        signature -> Text,
        slot -> Int8,
        agent_did -> Bytea,
        capability_bit -> Int2,
        task_id -> Bytea,
        completed -> Bool,
        quality_delta -> Int2,
        timeliness_delta -> Int2,
        correctness -> Int2,
        judge_kind -> Text,
        execution_root -> Bytea,
        ingested_at -> Timestamptz,
    }
}

diesel::table! {
    retro_eligibility (operator) {
        operator -> Bytea,
        net_fees_micro_usdc -> Int8,
        wash_excluded_micro_usdc -> Int8,
        personhood_tier -> Text,
        personhood_multiplier -> Numeric,
        cold_start_multiplier -> Numeric,
        estimated_allocation -> Nullable<Numeric>,
        epoch_first_seen -> Int4,
        last_updated -> Timestamptz,
    }
}

diesel::table! {
    retro_fee_samples (id) {
        id -> Int8,
        signature -> Text,
        slot -> Int8,
        operator -> Bytea,
        agent_did -> Bytea,
        task_id -> Bytea,
        client -> Bytea,
        epoch -> Int4,
        fee_micro_usdc -> Int8,
        wash_flag -> Nullable<Text>,
        ingested_at -> Timestamptz,
    }
}

diesel::allow_tables_to_appear_in_same_query!(
    blocks,
    category_reputation,
    program_events,
    reorg_log,
    reputation_samples,
    retro_eligibility,
    retro_fee_samples,
    sync_cursor,
);
