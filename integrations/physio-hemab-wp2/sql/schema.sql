CREATE SCHEMA IF NOT EXISTS physio_hemab_wp2;

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.sync_runs (
    sync_run_id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    records_received INTEGER NOT NULL DEFAULT 0,
    records_inserted INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.raw_records (
    raw_record_id BIGSERIAL PRIMARY KEY,
    record_id TEXT NOT NULL,
    event_name TEXT NOT NULL DEFAULT '',
    repeat_instrument TEXT NOT NULL DEFAULT '',
    repeat_instance TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_run_id BIGINT REFERENCES physio_hemab_wp2.sync_runs(sync_run_id),
    UNIQUE (record_id, event_name, repeat_instrument, repeat_instance)
);

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_raw_records_record_id
    ON physio_hemab_wp2.raw_records(record_id);

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_raw_records_last_seen_at
    ON physio_hemab_wp2.raw_records(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.kpm_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metric_code TEXT NOT NULL,
    facility TEXT NOT NULL DEFAULT '',
    data_collector TEXT NOT NULL DEFAULT '',
    metric_value NUMERIC,
    numerator NUMERIC,
    denominator NUMERIC,
    source_sync_run_id BIGINT REFERENCES physio_hemab_wp2.sync_runs(sync_run_id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_kpm_snapshots_metric_time
    ON physio_hemab_wp2.kpm_snapshots(metric_code, captured_at DESC);
