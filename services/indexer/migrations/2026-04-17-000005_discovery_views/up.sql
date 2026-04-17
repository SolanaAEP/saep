-- Discovery API materialized views per specs/discovery-api.md §Storage surface.
-- Two denormalized views fold event streams per (agent_did / task_id) for
-- search/filter substrate. Refreshed every 60s alongside reputation_rollup
-- (REFRESH MATERIALIZED VIEW CONCURRENTLY; requires unique PK index).

CREATE OR REPLACE FUNCTION jsonb_u8_array_to_bytea(arr jsonb) RETURNS bytea
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT decode(string_agg(lpad(to_hex(v::int), 2, '0'), '' ORDER BY ord), 'hex')
    FROM jsonb_array_elements_text(arr) WITH ORDINALITY AS t(v, ord)
$$;

CREATE MATERIALIZED VIEW agent_directory AS
WITH reg AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        data->>'operator'                          AS operator,
        (data->>'capability_mask')::numeric        AS capability_mask,
        (data->>'stake_amount')::numeric           AS stake_amount,
        (data->>'timestamp')::bigint               AS registered_unix
    FROM program_events
    WHERE event_name = 'AgentRegistered'
      AND jsonb_typeof(data->'agent_did') = 'array'
    ORDER BY data->'agent_did', slot DESC
),
manifest AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        (data->>'capability_mask')::numeric        AS capability_mask
    FROM program_events
    WHERE event_name = 'ManifestUpdated'
      AND jsonb_typeof(data->'agent_did') = 'array'
    ORDER BY data->'agent_did', slot DESC
),
stake AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        (data->>'new_total')::numeric              AS stake_amount
    FROM program_events
    WHERE event_name = 'StakeIncreased'
      AND jsonb_typeof(data->'agent_did') = 'array'
    ORDER BY data->'agent_did', slot DESC
),
slashed AS (
    SELECT
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        max((data->>'timestamp')::bigint)          AS slash_unix
    FROM program_events
    WHERE event_name = 'SlashExecuted'
      AND jsonb_typeof(data->'agent_did') = 'array'
    GROUP BY 1
),
status_evt AS (
    SELECT DISTINCT ON (data->'agent_did')
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        (data->>'new_status')::smallint            AS new_status,
        (data->>'timestamp')::bigint               AS status_unix
    FROM program_events
    WHERE event_name = 'StatusChanged'
      AND jsonb_typeof(data->'agent_did') = 'array'
    ORDER BY data->'agent_did', slot DESC
),
last_seen AS (
    SELECT
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        max((data->>'timestamp')::bigint)          AS last_active_unix
    FROM program_events
    WHERE event_name IN (
        'AgentRegistered', 'ManifestUpdated', 'StakeIncreased',
        'SlashProposed', 'SlashExecuted', 'SlashCancelled',
        'StatusChanged', 'WithdrawalRequested', 'WithdrawalExecuted'
    )
    AND jsonb_typeof(data->'agent_did') = 'array'
    GROUP BY 1
),
rep AS (
    SELECT
        agent_did,
        (sum(composite_score)::int / NULLIF(count(*), 0)) AS composite_score
    FROM reputation_rollup
    GROUP BY agent_did
)
SELECT
    reg.agent_did,
    reg.operator,
    COALESCE(manifest.capability_mask, reg.capability_mask)     AS capability_mask,
    COALESCE(stake.stake_amount, reg.stake_amount)              AS stake_amount,
    COALESCE(rep.composite_score, 0)                            AS reputation_composite,
    CASE
        WHEN slashed.slash_unix IS NOT NULL
             AND slashed.slash_unix >= COALESCE(status_evt.status_unix, 0)
            THEN 'slashed'
        WHEN status_evt.new_status = 1 THEN 'paused'
        WHEN status_evt.new_status = 2 THEN 'suspended'
        ELSE 'active'
    END                                                         AS status,
    NULL::text                                                  AS manifest_uri,
    COALESCE(last_seen.last_active_unix, reg.registered_unix)   AS last_active_unix,
    now()                                                       AS refreshed_at
FROM reg
LEFT JOIN manifest   USING (agent_did)
LEFT JOIN stake      USING (agent_did)
LEFT JOIN slashed    USING (agent_did)
LEFT JOIN status_evt USING (agent_did)
LEFT JOIN last_seen  USING (agent_did)
LEFT JOIN rep        USING (agent_did);

CREATE UNIQUE INDEX agent_directory_pk_idx ON agent_directory (agent_did);
CREATE INDEX agent_directory_capability_reputation_idx
    ON agent_directory (capability_mask, reputation_composite DESC);
CREATE INDEX agent_directory_status_reputation_idx
    ON agent_directory (status, reputation_composite DESC);
CREATE INDEX agent_directory_operator_idx ON agent_directory (operator);

CREATE MATERIALIZED VIEW task_directory AS
WITH created AS (
    SELECT DISTINCT ON (data->'task_id')
        jsonb_u8_array_to_bytea(data->'task_id')   AS task_id,
        data->>'client'                            AS creator,
        jsonb_u8_array_to_bytea(data->'agent_did') AS agent_did,
        (data->>'payment_amount')::numeric         AS reward_lamports,
        (data->>'deadline')::bigint                AS deadline_unix,
        (data->>'timestamp')::bigint               AS created_unix
    FROM program_events
    WHERE event_name = 'TaskCreated'
      AND jsonb_typeof(data->'task_id') = 'array'
    ORDER BY data->'task_id', slot DESC
),
latest AS (
    SELECT DISTINCT ON (data->'task_id')
        jsonb_u8_array_to_bytea(data->'task_id') AS task_id,
        event_name,
        (data->>'timestamp')::bigint             AS updated_unix
    FROM program_events
    WHERE event_name IN (
        'TaskCreated', 'TaskFunded', 'ResultSubmitted', 'TaskVerified',
        'TaskReleased', 'DisputeRaised', 'TaskCancelled', 'TaskExpired'
    )
    AND jsonb_typeof(data->'task_id') = 'array'
    ORDER BY data->'task_id', slot DESC
)
SELECT
    created.task_id,
    created.creator,
    created.agent_did,
    CASE latest.event_name
        WHEN 'TaskCreated'     THEN 'created'
        WHEN 'TaskFunded'      THEN 'funded'
        WHEN 'ResultSubmitted' THEN 'submitted'
        WHEN 'TaskVerified'    THEN 'verified'
        WHEN 'TaskReleased'    THEN 'released'
        WHEN 'DisputeRaised'   THEN 'disputed'
        WHEN 'TaskCancelled'   THEN 'cancelled'
        WHEN 'TaskExpired'     THEN 'expired'
    END                                           AS status,
    created.reward_lamports,
    NULL::numeric                                 AS capability_mask,
    created.created_unix                          AS created_at_unix,
    created.deadline_unix,
    latest.updated_unix                           AS updated_at_unix
FROM created
JOIN latest USING (task_id);

CREATE UNIQUE INDEX task_directory_pk_idx ON task_directory (task_id);
CREATE INDEX task_directory_status_created_idx
    ON task_directory (status, created_at_unix DESC);
CREATE INDEX task_directory_creator_created_idx
    ON task_directory (creator, created_at_unix DESC);
CREATE INDEX task_directory_agent_created_idx
    ON task_directory (agent_did, created_at_unix DESC);
CREATE INDEX task_directory_capability_reward_idx
    ON task_directory (capability_mask, reward_lamports DESC);
