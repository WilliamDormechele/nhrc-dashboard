DROP VIEW IF EXISTS physio_hemab_wp2.vw_overview_metrics CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_data_quality_issues CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_data_collector_performance CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_data_collector_work CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_data_freshness CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_device_overdue_scenarios CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_return_window_options CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_device_component_completeness CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_device_weekly_flow CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_form_completion_by_facility CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_core_form_completion_by_participant CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_facility_target_attainment CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_recruitment_trend CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_sync_status CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_device_set_status CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_device_returns CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_device_distributions CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_form_completion CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_recruitment_by_facility CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_activity_diaries CASCADE;
DROP VIEW IF EXISTS physio_hemab_wp2.vw_participants CASCADE;

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
    r.last_seen_at,
    NULLIF(r.payload ->> 'crf_examiner', '') AS physical_examiner,
    COALESCE(
        (
            SELECT NULLIF(trim(a.data_collector), '')
            FROM physio_hemab_wp2.data_collector_assignments a
            WHERE a.source_project = 'main'
              AND a.record_id = r.record_id
              AND a.instrument = 'enrollment_form'
              AND a.repeat_instance = ''
            LIMIT 1
        ),
        'Unassigned'
    ) AS enrollment_data_collector,
    COALESCE(
        (
            SELECT NULLIF(trim(a.data_collector), '')
            FROM physio_hemab_wp2.data_collector_assignments a
            WHERE a.source_project = 'main'
              AND a.record_id = r.record_id
              AND a.instrument = 'maternal_record_book_baseline'
              AND a.repeat_instance = ''
            LIMIT 1
        ),
        'Unassigned'
    ) AS maternal_data_collector,
    COALESCE(
        (
            SELECT NULLIF(trim(a.data_collector), '')
            FROM physio_hemab_wp2.data_collector_assignments a
            WHERE a.source_project = 'main'
              AND a.record_id = r.record_id
              AND a.instrument = 'physical_examination_form'
              AND a.repeat_instance = ''
            LIMIT 1
        ),
        NULLIF(r.payload ->> 'crf_examiner', ''),
        'Unassigned'
    ) AS physical_data_collector
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
        WHEN substring(
            physio_hemab_wp2.choice_label(
                'main',
                'ad_call_numb',
                r.payload ->> 'ad_call_numb'
            )
            FROM '([0-9]+)'
        ) IS NOT NULL
        THEN substring(
            physio_hemab_wp2.choice_label(
                'main',
                'ad_call_numb',
                r.payload ->> 'ad_call_numb'
            )
            FROM '([0-9]+)'
        )::integer
        ELSE NULL
    END AS calls_made,
    (r.payload ->> 'activity_diary_complete') = '2' AS diary_complete,
    r.last_seen_at,
    COALESCE(
        NULLIF(trim(a.data_collector), ''),
        'Unassigned'
    ) AS data_collector
FROM physio_hemab_wp2.raw_records r
LEFT JOIN physio_hemab_wp2.vw_participants p
    ON p.record_id = r.record_id
LEFT JOIN physio_hemab_wp2.data_collector_assignments a
    ON a.source_project = 'main'
   AND a.record_id = r.record_id
   AND a.instrument = 'activity_diary'
   AND a.repeat_instance = COALESCE(r.repeat_instance, '')
WHERE r.source_project = 'main'
  AND r.is_active = TRUE
  AND r.repeat_instrument = 'activity_diary';

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_recruitment_by_facility AS
WITH recruitment AS (
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
    GROUP BY facility
)
SELECT
    COALESCE(ft.facility, r.facility) AS facility,
    COALESCE(r.participants_enrolled, 0)::integer AS participants_enrolled,
    COALESCE(r.enrollment_forms_complete, 0)::integer AS enrollment_forms_complete,
    COALESCE(r.maternal_record_books_complete, 0)::integer AS maternal_record_books_complete,
    COALESCE(r.physical_examinations_complete, 0)::integer AS physical_examinations_complete,
    r.first_enrollment_date,
    r.latest_enrollment_date,
    ft.study_arm,
    ft.recruitment_target,
    CASE
        WHEN ft.recruitment_target IS NULL THEN NULL
        ELSE GREATEST(ft.recruitment_target - COALESCE(r.participants_enrolled, 0), 0)
    END::integer AS participants_remaining,
    CASE
        WHEN ft.recruitment_target IS NULL OR ft.recruitment_target = 0 THEN NULL
        ELSE ROUND(
            100.0 * COALESCE(r.participants_enrolled, 0) / ft.recruitment_target,
            1
        )
    END AS target_attainment_pct,
    (ft.recruitment_target IS NOT NULL AND ft.study_arm IS NOT NULL) AS target_configured
FROM physio_hemab_wp2.facility_targets ft
FULL OUTER JOIN recruitment r
    ON r.facility = ft.facility
WHERE COALESCE(ft.is_active, TRUE) = TRUE
ORDER BY facility;

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
),
policy AS (
    SELECT CASE
        WHEN config_value IS NULL OR config_value = 'null'::jsonb THEN NULL
        ELSE (config_value #>> '{}')::integer
    END AS return_window_days
    FROM physio_hemab_wp2.dashboard_config
    WHERE config_key = 'device_return_days_default'
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
    END AS current_status,
    p.return_window_days,
    CASE
        WHEN p.return_window_days IS NULL OR d.distribution_date IS NULL THEN NULL
        ELSE d.distribution_date + p.return_window_days
    END AS expected_return_date,
    CASE
        WHEN p.return_window_days IS NULL THEN NULL
        WHEN d.distribution_date IS NULL THEN FALSE
        WHEN (
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
            END
        ) <> 'Distributed' THEN FALSE
        ELSE CURRENT_DATE > (d.distribution_date + p.return_window_days)
    END AS is_overdue,
    CASE
        WHEN p.return_window_days IS NULL THEN 'Return window not configured'
        WHEN d.distribution_date IS NULL THEN 'No distribution date'
        WHEN r.return_date IS NOT NULL
             AND r.return_date >= d.distribution_date THEN 'Returned'
        WHEN CURRENT_DATE > (d.distribution_date + p.return_window_days) THEN 'Overdue'
        WHEN CURRENT_DATE = (d.distribution_date + p.return_window_days) THEN 'Due today'
        ELSE 'Within return window'
    END AS return_status
FROM sets s
LEFT JOIN latest_distribution d USING (device_set)
LEFT JOIN latest_return r USING (device_set)
CROSS JOIN policy p;

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

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_recruitment_trend AS
WITH weekly AS (
    SELECT
        date_trunc('week', enrollment_date)::date AS week_start,
        COUNT(*)::integer AS weekly_enrolled
    FROM physio_hemab_wp2.vw_participants
    WHERE enrollment_date IS NOT NULL
    GROUP BY 1
)
SELECT
    week_start,
    weekly_enrolled,
    SUM(weekly_enrolled) OVER (ORDER BY week_start)::integer AS cumulative_enrolled
FROM weekly
ORDER BY week_start;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_facility_target_attainment AS
SELECT
    ft.facility,
    ft.study_arm,
    ft.recruitment_target,
    COALESCE(r.participants_enrolled, 0)::integer AS participants_enrolled,
    CASE
        WHEN ft.recruitment_target IS NULL THEN NULL
        ELSE GREATEST(ft.recruitment_target - COALESCE(r.participants_enrolled, 0), 0)
    END::integer AS participants_remaining,
    CASE
        WHEN ft.recruitment_target IS NULL OR ft.recruitment_target = 0 THEN NULL
        ELSE ROUND(
            100.0 * COALESCE(r.participants_enrolled, 0) / ft.recruitment_target,
            1
        )
    END AS target_attainment_pct,
    (ft.recruitment_target IS NOT NULL AND ft.study_arm IS NOT NULL) AS target_configured
FROM physio_hemab_wp2.facility_targets ft
LEFT JOIN physio_hemab_wp2.vw_recruitment_by_facility r
    ON r.facility = ft.facility
WHERE ft.is_active = TRUE
ORDER BY ft.facility;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_core_form_completion_by_participant AS
SELECT
    record_id,
    study_id,
    facility,
    enrollment_complete,
    maternal_record_book_complete,
    physical_examination_complete,
    (
        enrollment_complete::integer
        + maternal_record_book_complete::integer
        + physical_examination_complete::integer
    )::integer AS core_forms_complete,
    3::integer AS core_forms_expected,
    (
        enrollment_complete
        AND maternal_record_book_complete
        AND physical_examination_complete
    ) AS all_core_forms_complete
FROM physio_hemab_wp2.vw_participants;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_form_completion_by_facility AS
WITH diaries_per_participant AS (
    SELECT COALESCE(
        (
            SELECT (config_value #>> '{}')::integer
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = 'activity_diaries_expected_per_participant'
        ),
        6
    ) AS n
),
participant_forms AS (
    SELECT facility, 'Enrollment Form'::text AS form_name,
           COUNT(*)::integer AS expected,
           COUNT(*) FILTER (WHERE enrollment_complete)::integer AS completed
    FROM physio_hemab_wp2.vw_participants
    GROUP BY facility
    UNION ALL
    SELECT facility, 'Maternal Record Book',
           COUNT(*)::integer,
           COUNT(*) FILTER (WHERE maternal_record_book_complete)::integer
    FROM physio_hemab_wp2.vw_participants
    GROUP BY facility
    UNION ALL
    SELECT facility, 'Physical Examination',
           COUNT(*)::integer,
           COUNT(*) FILTER (WHERE physical_examination_complete)::integer
    FROM physio_hemab_wp2.vw_participants
    GROUP BY facility
),
diaries AS (
    SELECT
        p.facility,
        'Activity Diary'::text AS form_name,
        (COUNT(DISTINCT p.record_id) * d.n)::integer AS expected,
        COUNT(a.record_id) FILTER (WHERE a.diary_complete)::integer AS completed
    FROM physio_hemab_wp2.vw_participants p
    CROSS JOIN diaries_per_participant d
    LEFT JOIN physio_hemab_wp2.vw_activity_diaries a
        ON a.record_id = p.record_id
    GROUP BY p.facility, d.n
)
SELECT
    facility,
    form_name,
    expected,
    completed,
    GREATEST(expected - completed, 0)::integer AS missing,
    CASE WHEN expected = 0 THEN NULL
         ELSE ROUND(100.0 * completed / expected, 1)
    END AS completion_pct
FROM (
    SELECT * FROM participant_forms
    UNION ALL
    SELECT * FROM diaries
) x;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_device_weekly_flow AS
WITH distributions AS (
    SELECT
        date_trunc('week', distribution_date)::date AS week_start,
        COUNT(*)::integer AS device_sets_distributed
    FROM physio_hemab_wp2.vw_device_distributions
    WHERE distribution_date IS NOT NULL
    GROUP BY 1
),
returns AS (
    SELECT
        date_trunc('week', return_date)::date AS week_start,
        COUNT(*)::integer AS device_sets_returned
    FROM physio_hemab_wp2.vw_device_returns
    WHERE return_date IS NOT NULL
    GROUP BY 1
)
SELECT
    COALESCE(d.week_start, r.week_start) AS week_start,
    COALESCE(d.device_sets_distributed, 0)::integer AS device_sets_distributed,
    COALESCE(r.device_sets_returned, 0)::integer AS device_sets_returned
FROM distributions d
FULL OUTER JOIN returns r USING (week_start)
ORDER BY week_start;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_device_component_completeness AS
SELECT
    COUNT(*)::integer AS returned_set_records,
    COUNT(*) FILTER (WHERE all_components_returned)::integer AS complete_return_records,
    COUNT(*) FILTER (WHERE NOT all_components_returned)::integer AS incomplete_return_records,
    COALESCE(SUM(components_returned), 0)::integer AS components_returned,
    COALESCE(SUM(components_expected), 0)::integer AS components_expected,
    CASE
        WHEN COALESCE(SUM(components_expected), 0) = 0 THEN NULL
        ELSE ROUND(
            100.0 * SUM(components_returned) / SUM(components_expected),
            1
        )
    END AS component_completeness_pct
FROM physio_hemab_wp2.vw_device_returns;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_return_window_options AS
SELECT
    return_window_days,
    label,
    sort_order
FROM physio_hemab_wp2.device_return_policy_options
ORDER BY sort_order;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_device_overdue_scenarios AS
SELECT
    o.return_window_days,
    o.label AS return_window,
    s.device_set,
    s.current_status,
    s.latest_facility,
    s.latest_study_id,
    s.latest_distribution_date,
    s.latest_return_date,
    CASE
        WHEN s.latest_distribution_date IS NULL THEN NULL
        ELSE s.latest_distribution_date + o.return_window_days
    END AS expected_return_date,
    CASE
        WHEN s.current_status <> 'Distributed' OR s.latest_distribution_date IS NULL THEN FALSE
        ELSE CURRENT_DATE > (s.latest_distribution_date + o.return_window_days)
    END AS is_overdue,
    CASE
        WHEN s.current_status = 'Returned' THEN 'Returned'
        WHEN s.latest_distribution_date IS NULL THEN 'No distribution date'
        WHEN CURRENT_DATE > (s.latest_distribution_date + o.return_window_days) THEN 'Overdue'
        WHEN CURRENT_DATE = (s.latest_distribution_date + o.return_window_days) THEN 'Due today'
        ELSE 'Within return window'
    END AS return_status
FROM physio_hemab_wp2.vw_device_set_status s
CROSS JOIN physio_hemab_wp2.device_return_policy_options o;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_data_freshness AS
WITH threshold AS (
    SELECT COALESCE(
        (
            SELECT (config_value #>> '{}')::integer
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = 'sync_stale_minutes'
        ),
        15
    ) AS stale_minutes
)
SELECT
    s.source_project,
    s.status,
    s.completed_at,
    EXTRACT(EPOCH FROM (NOW() - s.completed_at)) / 60.0 AS age_minutes,
    t.stale_minutes,
    (
        s.status <> 'success'
        OR s.completed_at IS NULL
        OR EXTRACT(EPOCH FROM (NOW() - s.completed_at)) / 60.0 > t.stale_minutes
    ) AS is_stale
FROM physio_hemab_wp2.vw_sync_status s
CROSS JOIN threshold t;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_data_collector_work AS
WITH participant_tasks AS (
    SELECT
        p.record_id,
        p.study_id,
        p.facility,
        'Enrollment Form'::text AS task_type,
        ''::text AS repeat_instance,
        p.enrollment_complete AS completed,
        NULL::boolean AS delayed,
        NULL::integer AS calls_made,
        NULL::integer AS delay_days,
        NULL::text AS derived_collector
    FROM physio_hemab_wp2.vw_participants p
    UNION ALL
    SELECT
        p.record_id, p.study_id, p.facility,
        'Maternal Record Book', '',
        p.maternal_record_book_complete,
        NULL, NULL, NULL, NULL
    FROM physio_hemab_wp2.vw_participants p
    UNION ALL
    SELECT
        p.record_id, p.study_id, p.facility,
        'Physical Examination', '',
        p.physical_examination_complete,
        NULL, NULL, NULL,
        p.physical_examiner
    FROM physio_hemab_wp2.vw_participants p
),
diary_tasks AS (
    SELECT
        a.record_id,
        a.study_id,
        a.facility,
        'Activity Diary'::text AS task_type,
        COALESCE(a.diary_instance::text, '') AS repeat_instance,
        a.diary_complete AS completed,
        (a.same_day_interview = 'No') AS delayed,
        a.calls_made,
        a.delay_days,
        NULL::text AS derived_collector
    FROM physio_hemab_wp2.vw_activity_diaries a
),
all_tasks AS (
    SELECT * FROM participant_tasks
    UNION ALL
    SELECT * FROM diary_tasks
)
SELECT
    t.record_id,
    t.study_id,
    t.facility,
    t.task_type,
    t.repeat_instance,
    COALESCE(
        NULLIF(trim(a.data_collector), ''),
        NULLIF(trim(t.derived_collector), ''),
        'Unassigned'
    ) AS data_collector,
    CASE
        WHEN NULLIF(trim(a.data_collector), '') IS NOT NULL THEN a.assignment_source
        WHEN NULLIF(trim(t.derived_collector), '') IS NOT NULL THEN 'redcap_field'
        ELSE 'unassigned'
    END AS attribution_source,
    t.completed,
    t.delayed,
    t.calls_made,
    t.delay_days
FROM all_tasks t
LEFT JOIN physio_hemab_wp2.data_collector_assignments a
    ON a.source_project = 'main'
   AND a.record_id = t.record_id
   AND a.instrument = CASE
        WHEN t.task_type = 'Enrollment Form' THEN 'enrollment_form'
        WHEN t.task_type = 'Maternal Record Book' THEN 'maternal_record_book_baseline'
        WHEN t.task_type = 'Physical Examination' THEN 'physical_examination_form'
        WHEN t.task_type = 'Activity Diary' THEN 'activity_diary'
        ELSE ''
   END
   AND a.repeat_instance = t.repeat_instance;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_data_collector_performance AS
SELECT
    data_collector,
    facility,
    COUNT(*)::integer AS tasks_recorded,
    COUNT(*) FILTER (WHERE completed)::integer AS tasks_completed,
    COUNT(*) FILTER (WHERE delayed)::integer AS delayed_diaries,
    COALESCE(SUM(calls_made), 0)::integer AS call_attempts,
    ROUND(AVG(delay_days) FILTER (WHERE delay_days IS NOT NULL), 1) AS average_delay_days,
    ROUND(100.0 * COUNT(*) FILTER (WHERE completed) / NULLIF(COUNT(*), 0), 1)
        AS task_completion_pct
FROM physio_hemab_wp2.vw_data_collector_work
GROUP BY data_collector, facility
ORDER BY data_collector, facility;

CREATE OR REPLACE VIEW physio_hemab_wp2.vw_data_quality_issues AS
WITH config AS (
    SELECT COALESCE(
        (
            SELECT (config_value #>> '{}')::integer
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = 'activity_diaries_expected_per_participant'
        ),
        6
    ) AS diaries_per_participant
),
participant AS (
    SELECT
        COUNT(*)::integer AS participants,
        COUNT(*) FILTER (WHERE NOT enrollment_complete)::integer AS enrollment_missing,
        COUNT(*) FILTER (WHERE NOT maternal_record_book_complete)::integer AS maternal_missing,
        COUNT(*) FILTER (WHERE NOT physical_examination_complete)::integer AS physical_missing
    FROM physio_hemab_wp2.vw_participants
),
diary AS (
    SELECT
        COUNT(*) FILTER (WHERE diary_complete)::integer AS complete_diaries,
        COUNT(*) FILTER (WHERE same_day_interview = 'No')::integer AS delayed_diaries
    FROM physio_hemab_wp2.vw_activity_diaries
),
device AS (
    SELECT
        COUNT(*) FILTER (WHERE NOT all_components_returned)::integer AS incomplete_returns
    FROM physio_hemab_wp2.vw_device_returns
),
return_dates AS (
    SELECT COUNT(*)::integer AS missing_return_dates
    FROM physio_hemab_wp2.raw_records
    WHERE source_project = 'devices'
      AND is_active = TRUE
      AND repeat_instrument = 'return_log'
      AND NULLIF(payload ->> 'date_devices_return', '') IS NULL
),
sync_issues AS (
    SELECT COUNT(*)::integer AS failed_or_stale_syncs
    FROM physio_hemab_wp2.vw_data_freshness
    WHERE is_stale = TRUE
),
collector AS (
    SELECT COUNT(*)::integer AS unassigned_tasks
    FROM physio_hemab_wp2.vw_data_collector_work
    WHERE data_collector = 'Unassigned'
),
targets AS (
    SELECT COUNT(*)::integer AS unconfigured_facility_targets
    FROM physio_hemab_wp2.vw_facility_target_attainment
    WHERE target_configured = FALSE
)
SELECT 'Outstanding Activity Diaries'::text AS issue_type,
       GREATEST(p.participants * c.diaries_per_participant - d.complete_diaries, 0)::integer AS issue_count,
       'High'::text AS severity
FROM participant p CROSS JOIN diary d CROSS JOIN config c
UNION ALL
SELECT 'Delayed Interviews', d.delayed_diaries, 'Medium'
FROM diary d
UNION ALL
SELECT 'Incomplete Device Returns', dv.incomplete_returns, 'High'
FROM device dv
UNION ALL
SELECT 'Return Logs Missing Return Date', rd.missing_return_dates, 'High'
FROM return_dates rd
UNION ALL
SELECT 'Incomplete Enrollment Forms', p.enrollment_missing, 'High'
FROM participant p
UNION ALL
SELECT 'Incomplete Maternal Record Books', p.maternal_missing, 'High'
FROM participant p
UNION ALL
SELECT 'Incomplete Physical Examinations', p.physical_missing, 'High'
FROM participant p
UNION ALL
SELECT 'Stale or Failed Data Sync', s.failed_or_stale_syncs, 'Critical'
FROM sync_issues s
UNION ALL
SELECT 'Unassigned Data-Collector Tasks', c.unassigned_tasks, 'Medium'
FROM collector c
UNION ALL
SELECT 'Facility Targets Not Configured', t.unconfigured_facility_targets, 'Medium'
FROM targets t;

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
        COUNT(DISTINCT facility)::integer AS recruiting_facilities,
        COUNT(*) FILTER (WHERE enrollment_complete)::integer AS enrollment_complete,
        COUNT(*) FILTER (WHERE maternal_record_book_complete)::integer AS maternal_complete,
        COUNT(*) FILTER (WHERE physical_examination_complete)::integer AS physical_complete,
        COUNT(*) FILTER (
            WHERE enrollment_complete
              AND maternal_record_book_complete
              AND physical_examination_complete
        )::integer AS core_complete
    FROM physio_hemab_wp2.vw_participants
),
facility AS (
    SELECT COUNT(*) FILTER (WHERE is_active)::integer AS total_facilities
    FROM physio_hemab_wp2.facility_targets
),
diary AS (
    SELECT
        COUNT(*) FILTER (WHERE diary_complete)::integer AS diary_complete,
        COUNT(*) FILTER (WHERE same_day_interview = 'Yes')::integer AS diary_same_day,
        COUNT(*) FILTER (WHERE same_day_interview = 'No')::integer AS diary_delayed,
        COALESCE(SUM(calls_made), 0)::integer AS calls_made,
        ROUND(AVG(calls_made) FILTER (WHERE calls_made IS NOT NULL), 2) AS avg_calls,
        ROUND(AVG(delay_days) FILTER (WHERE delay_days IS NOT NULL), 2) AS avg_delay,
        MAX(delay_days) FILTER (WHERE delay_days IS NOT NULL) AS max_delay
    FROM physio_hemab_wp2.vw_activity_diaries
),
device AS (
    SELECT
        returned_set_records,
        complete_return_records,
        incomplete_return_records,
        components_returned,
        components_expected,
        component_completeness_pct
    FROM physio_hemab_wp2.vw_device_component_completeness
),
config AS (
    SELECT COALESCE(
        (
            SELECT (config_value #>> '{}')::integer
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = 'activity_diaries_expected_per_participant'
        ),
        6
    ) AS diaries_per_participant
),
collector AS (
    SELECT COUNT(*)::integer AS unassigned_tasks
    FROM physio_hemab_wp2.vw_data_collector_work
    WHERE data_collector = 'Unassigned'
),
target_config AS (
    SELECT COUNT(*)::integer AS unconfigured_targets
    FROM physio_hemab_wp2.vw_facility_target_attainment
    WHERE target_configured = FALSE
),
overdue AS (
    SELECT
        COUNT(*) FILTER (WHERE is_overdue = TRUE)::integer AS overdue_devices,
        MAX(return_window_days) AS configured_return_window_days
    FROM physio_hemab_wp2.vw_device_set_status
),
freshness AS (
    SELECT
        COUNT(*) FILTER (WHERE is_stale)::integer AS stale_sources,
        MAX(age_minutes) AS max_data_age_minutes
    FROM physio_hemab_wp2.vw_data_freshness
)
SELECT 'participant_target'::text AS metric_code, t.participant_target::numeric AS metric_value
FROM target t
UNION ALL SELECT 'participants_enrolled', p.enrolled::numeric FROM participant p
UNION ALL SELECT 'participants_remaining', GREATEST(t.participant_target-p.enrolled,0)::numeric FROM target t CROSS JOIN participant p
UNION ALL SELECT 'recruitment_pct', ROUND(100.0*p.enrolled/NULLIF(t.participant_target,0),1) FROM target t CROSS JOIN participant p
UNION ALL SELECT 'recruiting_facilities', p.recruiting_facilities::numeric FROM participant p
UNION ALL SELECT 'total_facilities', f.total_facilities::numeric FROM facility f
UNION ALL SELECT 'enrollment_forms_complete', p.enrollment_complete::numeric FROM participant p
UNION ALL SELECT 'maternal_record_books_complete', p.maternal_complete::numeric FROM participant p
UNION ALL SELECT 'physical_examinations_complete', p.physical_complete::numeric FROM participant p
UNION ALL SELECT 'participants_core_forms_complete', p.core_complete::numeric FROM participant p
UNION ALL SELECT 'activity_diaries_complete', d.diary_complete::numeric FROM diary d
UNION ALL SELECT 'activity_diaries_expected', (p.enrolled*c.diaries_per_participant)::numeric FROM participant p CROSS JOIN config c
UNION ALL SELECT 'activity_diaries_outstanding', GREATEST(p.enrolled*c.diaries_per_participant-d.diary_complete,0)::numeric FROM participant p CROSS JOIN config c CROSS JOIN diary d
UNION ALL SELECT 'activity_diary_completion_pct', ROUND(100.0*d.diary_complete/NULLIF(p.enrolled*c.diaries_per_participant,0),1) FROM participant p CROSS JOIN config c CROSS JOIN diary d
UNION ALL SELECT 'activity_diaries_same_day', d.diary_same_day::numeric FROM diary d
UNION ALL SELECT 'activity_diaries_delayed', d.diary_delayed::numeric FROM diary d
UNION ALL SELECT 'activity_diary_on_time_pct', ROUND(100.0*d.diary_same_day/NULLIF(d.diary_complete,0),1) FROM diary d
UNION ALL SELECT 'activity_diary_delayed_pct', ROUND(100.0*d.diary_delayed/NULLIF(d.diary_complete,0),1) FROM diary d
UNION ALL SELECT 'activity_diary_calls_made', d.calls_made::numeric FROM diary d
UNION ALL SELECT 'activity_diary_avg_calls', d.avg_calls::numeric FROM diary d
UNION ALL SELECT 'activity_diary_avg_delay_days', d.avg_delay::numeric FROM diary d
UNION ALL SELECT 'activity_diary_max_delay_days', d.max_delay::numeric FROM diary d
UNION ALL SELECT 'device_return_records', dv.returned_set_records::numeric FROM device dv
UNION ALL SELECT 'device_complete_return_records', dv.complete_return_records::numeric FROM device dv
UNION ALL SELECT 'device_incomplete_return_records', dv.incomplete_return_records::numeric FROM device dv
UNION ALL SELECT 'device_components_returned', dv.components_returned::numeric FROM device dv
UNION ALL SELECT 'device_components_expected', dv.components_expected::numeric FROM device dv
UNION ALL SELECT 'device_component_completeness_pct', dv.component_completeness_pct::numeric FROM device dv
UNION ALL SELECT 'unassigned_collector_tasks', c.unassigned_tasks::numeric FROM collector c
UNION ALL SELECT 'unconfigured_facility_targets', tc.unconfigured_targets::numeric FROM target_config tc
UNION ALL SELECT 'overdue_devices', o.overdue_devices::numeric FROM overdue o
UNION ALL SELECT 'configured_return_window_days', o.configured_return_window_days::numeric FROM overdue o
UNION ALL SELECT 'stale_data_sources', f.stale_sources::numeric FROM freshness f
UNION ALL SELECT 'max_data_age_minutes', ROUND(f.max_data_age_minutes::numeric,1) FROM freshness f;
