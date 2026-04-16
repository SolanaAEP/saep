CREATE TABLE retro_eligibility (
    operator                   BYTEA       PRIMARY KEY,
    net_fees_micro_usdc        BIGINT      NOT NULL DEFAULT 0,
    wash_excluded_micro_usdc   BIGINT      NOT NULL DEFAULT 0,
    personhood_tier            TEXT        NOT NULL DEFAULT 'none'
                                CHECK (personhood_tier IN ('none', 'basic', 'verified')),
    personhood_multiplier      NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
    cold_start_multiplier      NUMERIC(4, 3) NOT NULL DEFAULT 1.0,
    estimated_allocation       NUMERIC(20, 6),
    epoch_first_seen           INT         NOT NULL,
    last_updated               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX retro_eligibility_net_fees_idx
    ON retro_eligibility (net_fees_micro_usdc DESC);
CREATE INDEX retro_eligibility_tier_idx
    ON retro_eligibility (personhood_tier);

CREATE TABLE retro_fee_samples (
    id                    BIGSERIAL PRIMARY KEY,
    signature             TEXT        NOT NULL,
    slot                  BIGINT      NOT NULL,
    operator              BYTEA       NOT NULL,
    agent_did             BYTEA       NOT NULL,
    task_id               BYTEA       NOT NULL,
    client                BYTEA       NOT NULL,
    epoch                 INT         NOT NULL,
    fee_micro_usdc        BIGINT      NOT NULL,
    wash_flag             TEXT
                            CHECK (wash_flag IN ('self_task', 'circular', 'burst', 'below_min')),
    ingested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (signature, task_id)
);

CREATE INDEX retro_fee_samples_operator_idx
    ON retro_fee_samples (operator, epoch);
CREATE INDEX retro_fee_samples_epoch_idx
    ON retro_fee_samples (epoch);
CREATE INDEX retro_fee_samples_client_idx
    ON retro_fee_samples (client);
