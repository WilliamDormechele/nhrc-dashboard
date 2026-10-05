CREATE OR REPLACE FUNCTION physio_hemab_wp2.choice_label(
    p_source_project TEXT,
    p_field_name TEXT,
    p_code TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT choices ->> p_code
            FROM physio_hemab_wp2.redcap_metadata
            WHERE source_project = p_source_project
              AND field_name = p_field_name
        ),
        NULLIF(p_code, ''),
        ''
    );
$$;

CREATE OR REPLACE FUNCTION physio_hemab_wp2.choice_code(
    p_source_project TEXT,
    p_field_name TEXT,
    p_label TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT key
    FROM physio_hemab_wp2.redcap_metadata m
    CROSS JOIN LATERAL jsonb_each_text(m.choices) AS c(key, value)
    WHERE m.source_project = p_source_project
      AND m.field_name = p_field_name
      AND lower(trim(c.value)) = lower(trim(p_label))
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION physio_hemab_wp2.choice_count(
    p_source_project TEXT,
    p_field_name TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $choice_count$
    SELECT COUNT(*)::INTEGER
    FROM physio_hemab_wp2.redcap_metadata m
    CROSS JOIN LATERAL jsonb_each_text(m.choices)
    WHERE m.source_project = p_source_project
      AND m.field_name = p_field_name;
$choice_count$;

CREATE OR REPLACE FUNCTION physio_hemab_wp2.canonical_facility(
    p_facility TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $canonical_facility$
    SELECT CASE trim(COALESCE(p_facility, ''))
        WHEN 'Paga Hospital' THEN 'Paga District Hospital'
        WHEN 'Paga District Hospital' THEN 'Paga District Hospital'
        WHEN 'Pungu Central' THEN 'Pungu Central'
        WHEN 'War Memorial Hospital' THEN 'War Memorial Hospital'
        WHEN 'Martiers of Uganda Health Centre Sirigu' THEN 'Martyrs of Uganda Health Centre, Sirigu'
        WHEN 'Martyrs of Uganda Health Centre, Sirigu' THEN 'Martyrs of Uganda Health Centre, Sirigu'
        ELSE NULLIF(trim(COALESCE(p_facility, '')), '')
    END;
$canonical_facility$;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_participants AS
SELECT
    r.record_id,
    NULLIF(r.payload ->> 'enroll_studid', '') AS study_id,
    NULLIF(r.payload ->> 'health_facility_enrollment', '') AS facility_code,
    physio_hemab_wp2.canonical_facility(
        physio_hemab_wp2.choice_label(
            'main',
            'health_facility_enrollment',
            r.payload ->> 'health_facility_enrollment'
        )
    ) AS facility,
    NULLIF(r.payload ->> 'enroll_registr_date', '')::date AS enrollment_date,
    (r.payload ->> 'enrollment_form_complete') = '2' AS enrollment_complete,
    (r.payload ->> 'maternal_record_book_baseline_complete') = '2'
        AS maternal_record_book_complete,
    (r.payload ->> 'physical_examination_form_complete') = '2'
        AS physical_examination_complete,
    NULLIF(r.payload ->> 'crf_date', '')::date AS physical_examination_date,
    physio_hemab_wp2.canonical_facility(
        physio_hemab_wp2.choice_label(
            'main',
            'crf_facility',
            r.payload ->> 'crf_facility'
        )
    ) AS physical_examination_facility,
    r.last_seen_at
FROM physio_hemab_wp2.raw_records r
WHERE r.source_project = 'main'
  AND r.is_active = TRUE
  AND COALESCE(r.repeat_instrument, '') = '';

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_activity_diaries AS
SELECT
    r.record_id,
    p.study_id,
    p.facility,
    NULLIF(r.repeat_instance, '')::integer AS diary_instance,
    NULLIF(r.payload ->> 'ad_date', '')::date AS diary_date,
    physio_hemab_wp2.choice_label(
        'main',
        'call_date',
        r.payload ->> 'call_date'
    ) AS same_day_interview,
    NULLIF(r.payload ->> 'call_date_delay', '')::date AS interview_date,
    CASE
        WHEN physio_hemab_wp2.choice_label(
            'main',
            'call_date',
            r.payload ->> 'call_date'
        ) = 'Yes' THEN 0
        WHEN NULLIF(r.payload ->> 'call_date_delay', '') IS NOT NULL
             AND NULLIF(r.payload ->> 'ad_date', '') IS NOT NULL
        THEN (
            (r.payload ->> 'call_date_delay')::date
            - (r.payload ->> 'ad_date')::date
        )
        ELSE NULL
    END AS delay_days,
    CASE
        WHEN NULLIF(r.payload ->> 'ad_call_numb', '') ~ '^[0-9]+$'
        THEN (r.payload ->> 'ad_call_numb')::integer
        ELSE NULL
    END AS calls_made,
    (r.payload ->> 'activity_diary_complete') = '2' AS diary_complete,
    r.last_seen_at
FROM physio_hemab_wp2.raw_records r
LEFT JOIN physio_hemab_wp2.vw_participants p
    ON p.record_id = r.record_id
WHERE r.source_project = 'main'
  AND r.is_active = TRUE
  AND r.repeat_instrument = 'activity_diary';

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_recruitment_by_facility AS
SELECT
    facility,
    COUNT(*)::integer AS participants_enrolled,
    COUNT(*) FILTER (WHERE enrollment_complete)::integer AS enrollment_forms_complete,
    COUNT(*) FILTER (WHERE maternal_record_book_complete)::integer
        AS maternal_record_books_complete,
    COUNT(*) FILTER (WHERE physical_examination_complete)::integer
        AS physical_examinations_complete,
    MIN(enrollment_date) AS first_enrollment_date,
    MAX(enrollment_date) AS latest_enrollment_date
FROM physio_hemab_wp2.vw_participants
GROUP BY facility;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_form_completion AS
WITH participant_counts AS (
    SELECT
        COUNT(*)::integer AS participants,
        COUNT(*) FILTER (WHERE enrollment_complete)::integer AS enrollment_complete,
        COUNT(*) FILTER (WHERE maternal_record_book_complete)::integer AS maternal_complete,
        COUNT(*) FILTER (WHERE physical_examination_complete)::integer AS physical_complete
    FROM physio_hemab_wp2.vw_participants
),
diary_counts AS (
    SELECT
        COUNT(*) FILTER (WHERE diary_complete)::integer AS diaries_complete
    FROM physio_hemab_wp2.vw_activity_diaries
),
config AS (
    SELECT
        COALESCE(
            (
                SELECT (config_value #>> '{}')::integer
                FROM physio_hemab_wp2.dashboard_config
                WHERE config_key = 'activity_diaries_expected_per_participant'
            ),
            6
        ) AS diaries_per_participant
)
SELECT
    'Enrollment Form'::text AS form_name,
    p.participants AS expected,
    p.enrollment_complete AS completed
FROM participant_counts p
UNION ALL
SELECT
    'Maternal Record Book',
    p.participants,
    p.maternal_complete
FROM participant_counts p
UNION ALL
SELECT
    'Physical Examination',
    p.participants,
    p.physical_complete
FROM participant_counts p
UNION ALL
SELECT
    'Activity Diary',
    p.participants * c.diaries_per_participant,
    d.diaries_complete
FROM participant_counts p
CROSS JOIN diary_counts d
CROSS JOIN config c;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_device_distributions AS
WITH mappings(facility, checkbox_field, set_label, study_id_field) AS (
    VALUES
        ('War Memorial Hospital', 'devices_war', 'A1', 'study_id_a1'),
        ('War Memorial Hospital', 'devices_war', 'A2', 'study_id_a2'),
        ('War Memorial Hospital', 'devices_war', 'A3', 'study_id_a3'),
        ('War Memorial Hospital', 'devices_war', 'A4', 'study_id_a4'),
        ('War Memorial Hospital', 'devices_war', 'A5', 'study_id_a5'),
        ('War Memorial Hospital', 'devices_war', 'B1', 'study_id_b1'),
        ('War Memorial Hospital', 'devices_war', 'B2', 'study_id_b2'),
        ('War Memorial Hospital', 'devices_war', 'B3', 'study_id_b3'),
        ('War Memorial Hospital', 'devices_war', 'B4', 'study_id_b4'),
        ('War Memorial Hospital', 'devices_war', 'B5', 'study_id_b5'),
        ('Paga District Hospital', 'devices_paga', 'A1', 'study_id_paga_a1'),
        ('Paga District Hospital', 'devices_paga', 'A2', 'study_id_paga_a2'),
        ('Paga District Hospital', 'devices_paga', 'A3', 'study_id_paga_a3'),
        ('Paga District Hospital', 'devices_paga', 'A4', 'study_id_paga_a4'),
        ('Paga District Hospital', 'devices_paga', 'A5', 'study_id_paga_a5'),
        ('Paga District Hospital', 'devices_paga', 'B1', 'study_id_paga_b1'),
        ('Paga District Hospital', 'devices_paga', 'B2', 'study_id_paga_b2'),
        ('Paga District Hospital', 'devices_paga', 'B3', 'study_id_paga_b3'),
        ('Paga District Hospital', 'devices_paga', 'B4', 'study_id_paga_b4'),
        ('Paga District Hospital', 'devices_paga', 'B5', 'study_id_paga_b5'),
        ('Pungu Central', 'devices_pungu', 'A1', 'study_id_pungu_a1'),
        ('Pungu Central', 'devices_pungu', 'A2', 'study_id_pungu_a2'),
        ('Pungu Central', 'devices_pungu', 'A3', 'study_id_pungu_a3'),
        ('Pungu Central', 'devices_pungu', 'A4', 'study_id_pungu_a4'),
        ('Pungu Central', 'devices_pungu', 'A5', 'study_id_pungu_a5'),
        ('Pungu Central', 'devices_pungu', 'B1', 'study_id_pungu_b1'),
        ('Pungu Central', 'devices_pungu', 'B2', 'study_id_pungu_b2'),
        ('Pungu Central', 'devices_pungu', 'B3', 'study_id_pungu_b3'),
        ('Pungu Central', 'devices_pungu', 'B4', 'study_id_pungu_b4'),
        ('Pungu Central', 'devices_pungu', 'B5', 'study_id_pungu_b5'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'A1', 'study_id_sirigu_a1'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'A2', 'study_id_sirigu_a2'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'A3', 'study_id_sirigu_a3'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'A4', 'study_id_sirigu_a4'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'A5', 'study_id_sirigu_a5'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'B1', 'study_id_sirigu_b'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'B2', 'study_id_sirigu_b2'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'B3', 'study_id_sirigu_b3'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'B4', 'study_id_sirigu_b4'),
        ('Martyrs of Uganda Health Centre, Sirigu', 'devices_sirigu', 'B5', 'study_id_sirigu_b5')
)
SELECT
    r.raw_record_id,
    r.record_id AS redcap_record_id,
    NULLIF(r.repeat_instance, '')::integer AS distribution_instance,
    NULLIF(r.payload ->> 'devices_date', '')::date AS distribution_date,
    m.facility,
    m.set_label AS device_set,
    NULLIF(r.payload ->> m.study_id_field, '') AS study_id,
    (r.payload ->> 'distribution_log_complete') = '2' AS distribution_form_complete,
    r.last_seen_at
FROM physio_hemab_wp2.raw_records r
CROSS JOIN mappings m
CROSS JOIN LATERAL (
    SELECT physio_hemab_wp2.choice_code(
        'devices',
        m.checkbox_field,
        m.set_label
    ) AS choice_code
) c
WHERE r.source_project = 'devices'
  AND r.is_active = TRUE
  AND r.repeat_instrument = 'distribution_log'
  AND c.choice_code IS NOT NULL
  AND r.payload ->> (m.checkbox_field || '___' || c.choice_code) = '1';

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_device_returns AS
WITH mappings(set_label, component_field) AS (
    VALUES
        ('A1', 'set_a1'),
        ('A2', 'set_a2'),
        ('A3', 'set_a3'),
        ('A4', 'set_a4'),
        ('A5', 'set_a5'),
        ('B1', 'set_b1'),
        ('B2', 'set_b2'),
        ('B3', 'set_b3'),
        ('B4', 'set_b4'),
        ('B5', 'set_b5')
)
SELECT
    r.raw_record_id,
    r.record_id AS redcap_record_id,
    NULLIF(r.repeat_instance, '')::integer AS return_instance,
    NULLIF(r.payload ->> 'date_devices_return', '')::date AS return_date,
    m.set_label AS device_set,
    component_counts.components_returned,
    physio_hemab_wp2.choice_count('devices', m.component_field)
        AS components_expected,
    component_counts.components_returned
        = physio_hemab_wp2.choice_count('devices', m.component_field)
        AS all_components_returned,
    (r.payload ->> 'return_log_complete') = '2' AS return_form_complete,
    r.last_seen_at
FROM physio_hemab_wp2.raw_records r
CROSS JOIN mappings m
CROSS JOIN LATERAL (
    SELECT physio_hemab_wp2.choice_code(
        'devices',
        'devices_return',
        m.set_label
    ) AS choice_code
) c
CROSS JOIN LATERAL (
    SELECT COUNT(*)::integer AS components_returned
    FROM jsonb_each_text(r.payload) AS p(key, value)
    WHERE p.key LIKE m.component_field || '___%'
      AND p.value = '1'
) component_counts
WHERE r.source_project = 'devices'
  AND r.is_active = TRUE
  AND r.repeat_instrument = 'return_log'
  AND c.choice_code IS NOT NULL
  AND r.payload ->> ('devices_return___' || c.choice_code) = '1';

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_device_set_status AS
WITH sets AS (
    SELECT DISTINCT device_set
    FROM (
        SELECT device_set FROM physio_hemab_wp2.vw_device_distributions
        UNION ALL
        SELECT device_set FROM physio_hemab_wp2.vw_device_returns
    ) x
),
latest_distribution AS (
    SELECT DISTINCT ON (device_set)
        device_set,
        distribution_date,
        facility,
        study_id,
        distribution_form_complete
    FROM physio_hemab_wp2.vw_device_distributions
    ORDER BY device_set, distribution_date DESC NULLS LAST, distribution_instance DESC
),
latest_return AS (
    SELECT DISTINCT ON (device_set)
        device_set,
        return_date,
        components_returned,
        components_expected,
        all_components_returned,
        return_form_complete
    FROM physio_hemab_wp2.vw_device_returns
    ORDER BY device_set, return_date DESC NULLS LAST, return_instance DESC
)
SELECT
    s.device_set,
    d.distribution_date AS latest_distribution_date,
    d.facility AS latest_facility,
    d.study_id AS latest_study_id,
    r.return_date AS latest_return_date,
    r.components_returned,
    r.components_expected,
    r.all_components_returned,
    CASE
        WHEN d.distribution_date IS NULL AND r.return_date IS NOT NULL THEN 'Returned'
        WHEN d.distribution_date IS NOT NULL
             AND (r.return_date IS NULL OR d.distribution_date > r.return_date)
        THEN 'Distributed'
        WHEN r.return_date IS NOT NULL
             AND d.distribution_date IS NOT NULL
             AND r.return_date >= d.distribution_date
        THEN 'Returned'
        ELSE 'Unknown'
    END AS current_status
FROM sets s
LEFT JOIN latest_distribution d USING (device_set)
LEFT JOIN latest_return r USING (device_set);

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_sync_status AS
SELECT DISTINCT ON (source_project)
    source_project,
    sync_run_id,
    started_at,
    completed_at,
    status,
    records_received,
    records_inserted,
    records_updated,
    records_deactivated,
    error_message
FROM physio_hemab_wp2.sync_runs
ORDER BY source_project, started_at DESC;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_overview_metrics AS
WITH target AS (
    SELECT COALESCE(
        (
            SELECT (config_value #>> '{}')::integer
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = 'participant_target'
        ),
        200
    ) AS participant_target
),
participant AS (
    SELECT
        COUNT(*)::integer AS enrolled,
        COUNT(*) FILTER (WHERE maternal_record_book_complete)::integer AS maternal_complete,
        COUNT(*) FILTER (WHERE physical_examination_complete)::integer AS physical_complete
    FROM physio_hemab_wp2.vw_participants
),
diary AS (
    SELECT
        COUNT(*) FILTER (WHERE diary_complete)::integer AS diary_complete,
        COUNT(*) FILTER (WHERE same_day_interview = 'Yes')::integer AS diary_same_day,
        COUNT(*) FILTER (WHERE same_day_interview = 'No')::integer AS diary_delayed,
        COALESCE(SUM(calls_made), 0)::integer AS calls_made
    FROM physio_hemab_wp2.vw_activity_diaries
)
SELECT 'participant_target'::text AS metric_code, t.participant_target::numeric AS metric_value
FROM target t
UNION ALL
SELECT 'participants_enrolled', p.enrolled::numeric FROM participant p
UNION ALL
SELECT 'maternal_record_books_complete', p.maternal_complete::numeric FROM participant p
UNION ALL
SELECT 'physical_examinations_complete', p.physical_complete::numeric FROM participant p
UNION ALL
SELECT 'activity_diaries_complete', d.diary_complete::numeric FROM diary d
UNION ALL
SELECT 'activity_diaries_same_day', d.diary_same_day::numeric FROM diary d
UNION ALL
SELECT 'activity_diaries_delayed', d.diary_delayed::numeric FROM diary d
UNION ALL
SELECT 'activity_diary_calls_made', d.calls_made::numeric FROM diary d;
