-- Treasury yield control-plane snapshots.
--
-- The first M2 yield slice intentionally keeps deployment accounting event-led:
-- treasury_standard emits strategy/config/accounting events, and Discovery reads
-- these materialized snapshots. External venue CPIs can later harden the event
-- source without changing this public read surface.

CREATE MATERIALIZED VIEW yield_strategy_directory AS
WITH registered AS (
    SELECT DISTINCT ON (data->'strategy_id')
        jsonb_u8_array_to_bytea(data->'strategy_id') AS strategy_id,
        data->>'venue'                               AS venue,
        data->>'strategy_program'                    AS strategy_program,
        data->>'underlying_mint'                     AS underlying_mint,
        data->>'receipt_mint'                        AS receipt_mint,
        (data->>'max_allocation_bps')::int           AS max_allocation_bps,
        data->>'risk_tier'                           AS risk_tier,
        data->>'status'                              AS registered_status,
        data->>'name'                                AS name,
        data->>'metadata_uri'                        AS metadata_uri,
        (data->>'timestamp')::bigint                 AS registered_unix
    FROM program_events
    WHERE event_name = 'YieldStrategyRegistered'
      AND jsonb_typeof(data->'strategy_id') = 'array'
    ORDER BY data->'strategy_id', slot DESC, id DESC
),
status_evt AS (
    SELECT DISTINCT ON (data->'strategy_id')
        jsonb_u8_array_to_bytea(data->'strategy_id') AS strategy_id,
        data->>'status'                              AS status,
        (data->>'timestamp')::bigint                 AS status_unix
    FROM program_events
    WHERE event_name = 'YieldStrategyStatusSet'
      AND jsonb_typeof(data->'strategy_id') = 'array'
    ORDER BY data->'strategy_id', slot DESC, id DESC
)
SELECT
    registered.strategy_id,
    registered.venue,
    registered.strategy_program,
    registered.underlying_mint,
    registered.receipt_mint,
    registered.max_allocation_bps,
    registered.risk_tier,
    COALESCE(status_evt.status, registered.registered_status) AS status,
    registered.name,
    registered.metadata_uri,
    registered.registered_unix,
    status_evt.status_unix,
    now()                                                     AS refreshed_at
FROM registered
LEFT JOIN status_evt USING (strategy_id);

CREATE UNIQUE INDEX yield_strategy_directory_pk_idx
    ON yield_strategy_directory (strategy_id);
CREATE INDEX yield_strategy_directory_status_venue_idx
    ON yield_strategy_directory (status, venue, risk_tier);

CREATE MATERIALIZED VIEW treasury_yield_directory AS
WITH config AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did')   AS agent_did,
        jsonb_u8_array_to_bytea(data->'strategy_id') AS strategy_id,
        (data->>'allocation_bps')::int               AS allocation_bps,
        data->>'status'                              AS config_status,
        (data->>'timestamp')::bigint                 AS config_unix
    FROM program_events
    WHERE event_name = 'TreasuryYieldConfigSet'
      AND jsonb_typeof(data->'agent_did') = 'array'
      AND jsonb_typeof(data->'strategy_id') = 'array'
    ORDER BY data->'agent_did', slot DESC, id DESC
),
unwind AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        (data->>'timestamp')::bigint               AS unwind_unix
    FROM program_events
    WHERE event_name = 'TreasuryYieldUnwindRequested'
      AND jsonb_typeof(data->'agent_did') = 'array'
    ORDER BY data->'agent_did', slot DESC, id DESC
),
accounting AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        (data->>'idle_amount')::numeric            AS idle_amount,
        (data->>'deployed_amount')::numeric        AS deployed_amount,
        (data->>'realized_yield_amount')::numeric  AS realized_yield_amount,
        (data->>'accounting_slot')::bigint         AS accounting_slot,
        data->>'status'                            AS accounting_status,
        (data->>'timestamp')::bigint               AS accounting_unix
    FROM program_events
    WHERE event_name = 'TreasuryYieldAccountingRecorded'
      AND jsonb_typeof(data->'agent_did') = 'array'
    ORDER BY data->'agent_did', slot DESC, id DESC
)
SELECT
    config.agent_did,
    config.strategy_id,
    config.allocation_bps,
    CASE
        WHEN unwind.unwind_unix IS NOT NULL
             AND unwind.unwind_unix >= GREATEST(config.config_unix, COALESCE(accounting.accounting_unix, 0))
            THEN 'unwinding'
        ELSE COALESCE(accounting.accounting_status, config.config_status)
    END                                      AS status,
    COALESCE(
        unwind.unwind_unix IS NOT NULL
        AND unwind.unwind_unix >= GREATEST(config.config_unix, COALESCE(accounting.accounting_unix, 0)),
        false
    )                                        AS unwind_requested,
    COALESCE(accounting.idle_amount, 0)      AS idle_amount,
    COALESCE(accounting.deployed_amount, 0)  AS deployed_amount,
    COALESCE(accounting.realized_yield_amount, 0)
                                             AS realized_yield_amount,
    accounting.accounting_slot,
    config.config_unix,
    unwind.unwind_unix,
    accounting.accounting_unix,
    now()                                    AS refreshed_at
FROM config
LEFT JOIN unwind USING (agent_did)
LEFT JOIN accounting USING (agent_did);

CREATE UNIQUE INDEX treasury_yield_directory_pk_idx
    ON treasury_yield_directory (agent_did);
CREATE INDEX treasury_yield_directory_strategy_status_idx
    ON treasury_yield_directory (strategy_id, status);
CREATE INDEX treasury_yield_directory_status_idx
    ON treasury_yield_directory (status);
