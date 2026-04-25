-- Event-led strategy-position snapshots for live treasury yield movements.

CREATE MATERIALIZED VIEW treasury_yield_position_directory AS
WITH movement AS (
    SELECT DISTINCT ON (
        jsonb_u8_array_to_bytea(data->'agent_did'),
        jsonb_u8_array_to_bytea(data->'strategy_id'),
        data->>'vault_mint'
    )
        jsonb_u8_array_to_bytea(data->'agent_did')   AS agent_did,
        jsonb_u8_array_to_bytea(data->'strategy_id') AS strategy_id,
        data->>'vault_mint'                          AS vault_mint,
        data->>'receipt_mint'                        AS receipt_mint,
        (data->>'principal_amount')::numeric         AS principal_amount,
        (data->>'receipt_amount')::numeric           AS receipt_amount,
        (data->>'realized_yield_amount')::numeric    AS realized_yield_amount,
        (data->>'deployed_amount')::numeric          AS deployed_amount,
        (data->>'idle_amount')::numeric              AS idle_amount,
        (data->>'accounting_slot')::bigint           AS accounting_slot,
        data->>'status'                              AS status,
        (event_name = 'YieldStrategyEmergencyUnwind') AS unwind_requested,
        event_name                                   AS last_event_name,
        (data->>'timestamp')::bigint                 AS updated_unix,
        now()                                        AS refreshed_at
    FROM program_events
    WHERE event_name IN (
        'YieldStrategyDeposit',
        'YieldStrategyWithdraw',
        'YieldStrategyEmergencyUnwind'
    )
      AND jsonb_typeof(data->'agent_did') = 'array'
      AND jsonb_typeof(data->'strategy_id') = 'array'
    ORDER BY
        jsonb_u8_array_to_bytea(data->'agent_did'),
        jsonb_u8_array_to_bytea(data->'strategy_id'),
        data->>'vault_mint',
        slot DESC,
        id DESC
)
SELECT * FROM movement;

CREATE UNIQUE INDEX treasury_yield_position_directory_pk_idx
    ON treasury_yield_position_directory (agent_did, strategy_id, vault_mint);
CREATE INDEX treasury_yield_position_directory_agent_idx
    ON treasury_yield_position_directory (agent_did, status);
CREATE INDEX treasury_yield_position_directory_strategy_idx
    ON treasury_yield_position_directory (strategy_id, status);
