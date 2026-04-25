DROP MATERIALIZED VIEW IF EXISTS task_directory;

CREATE MATERIALIZED VIEW task_directory AS
WITH created AS (
    SELECT DISTINCT ON (data->'task_id')
        jsonb_u8_array_to_bytea(data->'task_id')  AS task_id,
        data->>'creator'                          AS creator,
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
