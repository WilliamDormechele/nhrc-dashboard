CREATE SCHEMA IF NOT EXISTS physio_hemab_wp2;

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.sync_runs (
    sync_run_id BIGSERIAL PRIMARY KEY,
    source_project TEXT NOT NULL CHECK (source_project IN ('main', 'devices')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    records_received INTEGER NOT NULL DEFAULT 0,
    records_inserted INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    records_deactivated INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

ALTER TABLE physio_hemab_wp2.sync_runs
    ADD COLUMN IF NOT EXISTS records_deactivated INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_sync_runs_project_time
    ON physio_hemab_wp2.sync_runs(source_project, started_at DESC);

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.redcap_metadata (
    source_project TEXT NOT NULL CHECK (source_project IN ('main', 'devices')),
    field_name TEXT NOT NULL,
    form_name TEXT NOT NULL DEFAULT '',
    field_type TEXT NOT NULL DEFAULT '',
    field_label TEXT NOT NULL DEFAULT '',
    choices JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_project, field_name)
);

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.raw_records (
    raw_record_id BIGSERIAL PRIMARY KEY,
    source_project TEXT NOT NULL CHECK (source_project IN ('main', 'devices')),
    record_id TEXT NOT NULL,
    event_name TEXT NOT NULL DEFAULT '',
    repeat_instrument TEXT NOT NULL DEFAULT '',
    repeat_instance TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_run_id BIGINT REFERENCES physio_hemab_wp2.sync_runs(sync_run_id),
    UNIQUE (
        source_project,
        record_id,
        event_name,
        repeat_instrument,
        repeat_instance
    )
);

ALTER TABLE physio_hemab_wp2.raw_records
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE physio_hemab_wp2.raw_records
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_raw_records_source_record
    ON physio_hemab_wp2.raw_records(source_project, record_id);

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_raw_records_last_seen_at
    ON physio_hemab_wp2.raw_records(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_raw_records_active
    ON physio_hemab_wp2.raw_records(source_project, is_active);

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.kpm_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_project TEXT NOT NULL DEFAULT 'main'
        CHECK (source_project IN ('main', 'devices', 'combined')),
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

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.dashboard_config (
    config_key TEXT PRIMARY KEY,
    config_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO physio_hemab_wp2.dashboard_config (config_key, config_value)
VALUES
    ('participant_target', '200'::jsonb),
    ('activity_diaries_expected_per_participant', '6'::jsonb)
ON CONFLICT (config_key) DO NOTHING;


CREATE TABLE IF NOT EXISTS physio_hemab_wp2.facility_targets (
    facility TEXT PRIMARY KEY,
    study_arm TEXT CHECK (study_arm IN ('Intervention', 'Control')),
    recruitment_target INTEGER CHECK (recruitment_target > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO physio_hemab_wp2.facility_targets (facility)
VALUES
    ('War Memorial Hospital'),
    ('Paga District Hospital'),
    ('Pungu Central'),
    ('Martyrs of Uganda Health Centre, Sirigu')
ON CONFLICT (facility) DO NOTHING;

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.data_collector_assignments (
    source_project TEXT NOT NULL CHECK (source_project IN ('main', 'devices')),
    record_id TEXT NOT NULL,
    instrument TEXT NOT NULL DEFAULT '',
    repeat_instance TEXT NOT NULL DEFAULT '',
    data_collector TEXT NOT NULL,
    assignment_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (assignment_source IN ('manual', 'redcap_field', 'redcap_audit', 'derived')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (
        source_project,
        record_id,
        instrument,
        repeat_instance
    )
);

CREATE INDEX IF NOT EXISTS idx_physio_hemab_wp2_collector_assignments_collector
    ON physio_hemab_wp2.data_collector_assignments(data_collector);

CREATE TABLE IF NOT EXISTS physio_hemab_wp2.device_return_policy_options (
    return_window_days INTEGER PRIMARY KEY CHECK (return_window_days > 0),
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

INSERT INTO physio_hemab_wp2.device_return_policy_options (
    return_window_days,
    label,
    sort_order
)
VALUES
    (1, '1 day', 1),
    (2, '2 days', 2),
    (3, '3 days', 3),
    (5, '5 days', 4),
    (7, '7 days', 5),
    (10, '10 days', 6),
    (14, '14 days', 7)
ON CONFLICT (return_window_days) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

INSERT INTO physio_hemab_wp2.dashboard_config (config_key, config_value)
VALUES
    ('sync_stale_minutes', '15'::jsonb)
ON CONFLICT (config_key) DO NOTHING;


INSERT INTO physio_hemab_wp2.dashboard_config (config_key, config_value)
VALUES ('device_return_days_default', 'null'::jsonb)
ON CONFLICT (config_key) DO NOTHING;
