from __future__ import annotations

import argparse
import hashlib
import json
import sys
from typing import Any

from psycopg.types.json import Jsonb

from config import (
    REDCAP_PROJECTS,
    load_database_settings,
    load_redcap_settings,
)
from db import database_connection
from redcap_client import RedcapClient


MAIN_DASHBOARD_FIELDS = [
    "record_id",
    "health_facility_enrollment",
    "enroll_studid",
    "enroll_registr_date",
    "enrollment_form_complete",
    "maternal_record_book_baseline_complete",
    "crf_date",
    "crf_facility",
    "crf_examiner",
    "physical_examination_form_complete",
    "ad_date",
    "call_date",
    "call_date_delay",
    "ad_call_numb",
    "activity_diary_complete",
]

DEVICE_DASHBOARD_FIELDS = [
    "record_id",
    "devices_date",
    "distribution_log_complete",
    "devices_war",
    "devices_paga",
    "devices_pungu",
    "devices_sirigu",
    "study_id_a1",
    "study_id_a2",
    "study_id_a3",
    "study_id_a4",
    "study_id_a5",
    "study_id_b1",
    "study_id_b2",
    "study_id_b3",
    "study_id_b4",
    "study_id_b5",
    "study_id_paga_a1",
    "study_id_paga_a2",
    "study_id_paga_a3",
    "study_id_paga_a4",
    "study_id_paga_a5",
    "study_id_paga_b1",
    "study_id_paga_b2",
    "study_id_paga_b3",
    "study_id_paga_b4",
    "study_id_paga_b5",
    "study_id_pungu_a1",
    "study_id_pungu_a2",
    "study_id_pungu_a3",
    "study_id_pungu_a4",
    "study_id_pungu_a5",
    "study_id_pungu_b1",
    "study_id_pungu_b2",
    "study_id_pungu_b3",
    "study_id_pungu_b4",
    "study_id_pungu_b5",
    "study_id_sirigu_a1",
    "study_id_sirigu_a2",
    "study_id_sirigu_a3",
    "study_id_sirigu_a4",
    "study_id_sirigu_a5",
    "study_id_sirigu_b",
    "study_id_sirigu_b2",
    "study_id_sirigu_b3",
    "study_id_sirigu_b4",
    "study_id_sirigu_b5",
    "date_devices_return",
    "devices_return",
    "return_log_complete",
    "set_a1",
    "set_a2",
    "set_a3",
    "set_a4",
    "set_a5",
    "set_b1",
    "set_b2",
    "set_b3",
    "set_b4",
    "set_b5",
]

SPECIAL_REDCAP_FIELDS = {
    "redcap_event_name",
    "redcap_repeat_instrument",
    "redcap_repeat_instance",
    "redcap_data_access_group",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchronize one or both Physio-HeMAB REDCap projects."
    )
    parser.add_argument(
        "project",
        choices=[*sorted(REDCAP_PROJECTS), "all"],
        help="REDCap project to synchronize.",
    )
    return parser.parse_args()


def dashboard_fields(project_key: str) -> list[str]:
    if project_key == "main":
        return MAIN_DASHBOARD_FIELDS
    if project_key == "devices":
        return DEVICE_DASHBOARD_FIELDS
    raise RuntimeError(f"Unsupported project key: {project_key}")


def minimize_record(
    record: dict[str, Any],
    requested_fields: list[str],
) -> dict[str, Any]:
    allowed = set(requested_fields)
    minimized: dict[str, Any] = {}

    for key, value in record.items():
        if key in SPECIAL_REDCAP_FIELDS or key in allowed:
            minimized[key] = value
            continue

        if "___" in key:
            base_field = key.split("___", 1)[0]
            if base_field in allowed:
                minimized[key] = value

    return minimized


def parse_choices(raw: str) -> dict[str, str]:
    choices: dict[str, str] = {}

    for item in str(raw or "").split("|"):
        item = item.strip()
        if not item or "," not in item:
            continue

        code, label = item.split(",", 1)
        choices[code.strip()] = label.strip()

    return choices


def stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def start_sync_run(connection, source_project: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO physio_hemab_wp2.sync_runs (source_project, status)
            VALUES (%s, 'running')
            RETURNING sync_run_id
            """,
            (source_project,),
        )
        sync_run_id = cursor.fetchone()[0]

    connection.commit()
    return sync_run_id


def finish_sync_run(
    connection,
    sync_run_id: int,
    status: str,
    records_received: int,
    records_inserted: int,
    records_updated: int,
    records_deactivated: int,
    error_message: str | None = None,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE physio_hemab_wp2.sync_runs
            SET completed_at = NOW(),
                status = %s,
                records_received = %s,
                records_inserted = %s,
                records_updated = %s,
                records_deactivated = %s,
                error_message = %s
            WHERE sync_run_id = %s
            """,
            (
                status,
                records_received,
                records_inserted,
                records_updated,
                records_deactivated,
                error_message,
                sync_run_id,
            ),
        )

    connection.commit()


def sync_metadata(
    connection,
    source_project: str,
    metadata: list[dict[str, Any]],
) -> None:
    with connection.cursor() as cursor:
        for field in metadata:
            field_name = str(field.get("field_name", "")).strip()
            if not field_name:
                continue

            cursor.execute(
                """
                INSERT INTO physio_hemab_wp2.redcap_metadata (
                    source_project,
                    field_name,
                    form_name,
                    field_type,
                    field_label,
                    choices,
                    raw_metadata,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (source_project, field_name)
                DO UPDATE SET
                    form_name = EXCLUDED.form_name,
                    field_type = EXCLUDED.field_type,
                    field_label = EXCLUDED.field_label,
                    choices = EXCLUDED.choices,
                    raw_metadata = EXCLUDED.raw_metadata,
                    updated_at = NOW()
                """,
                (
                    source_project,
                    field_name,
                    str(field.get("form_name", "") or ""),
                    str(field.get("field_type", "") or ""),
                    str(field.get("field_label", "") or ""),
                    Jsonb(
                        parse_choices(
                            str(field.get("select_choices_or_calculations", "") or "")
                        )
                    ),
                    Jsonb(field),
                ),
            )


def prepare_seen_table(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TEMP TABLE IF NOT EXISTS physio_hemab_wp2_sync_seen (
                source_project TEXT NOT NULL,
                record_id TEXT NOT NULL,
                event_name TEXT NOT NULL,
                repeat_instrument TEXT NOT NULL,
                repeat_instance TEXT NOT NULL,
                PRIMARY KEY (
                    source_project,
                    record_id,
                    event_name,
                    repeat_instrument,
                    repeat_instance
                )
            ) ON COMMIT PRESERVE ROWS
            """
        )
        cursor.execute("TRUNCATE physio_hemab_wp2_sync_seen")


def mark_seen(
    connection,
    *,
    source_project: str,
    record_id: str,
    event_name: str,
    repeat_instrument: str,
    repeat_instance: str,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO physio_hemab_wp2_sync_seen (
                source_project,
                record_id,
                event_name,
                repeat_instrument,
                repeat_instance
            )
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (
                source_project,
                record_id,
                event_name,
                repeat_instrument,
                repeat_instance,
            ),
        )


def upsert_record(
    connection,
    *,
    source_project: str,
    record_id: str,
    event_name: str,
    repeat_instrument: str,
    repeat_instance: str,
    payload: dict[str, Any],
    payload_hash: str,
    sync_run_id: int,
) -> str:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO physio_hemab_wp2.raw_records (
                source_project,
                record_id,
                event_name,
                repeat_instrument,
                repeat_instance,
                payload,
                payload_hash,
                is_active,
                deleted_at,
                last_sync_run_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, NULL, %s)
            ON CONFLICT (
                source_project,
                record_id,
                event_name,
                repeat_instrument,
                repeat_instance
            )
            DO UPDATE SET
                payload = EXCLUDED.payload,
                payload_hash = EXCLUDED.payload_hash,
                is_active = TRUE,
                deleted_at = NULL,
                last_seen_at = NOW(),
                last_sync_run_id = EXCLUDED.last_sync_run_id
            WHERE physio_hemab_wp2.raw_records.payload_hash
                  IS DISTINCT FROM EXCLUDED.payload_hash
            RETURNING (xmax = 0) AS inserted
            """,
            (
                source_project,
                record_id,
                event_name,
                repeat_instrument,
                repeat_instance,
                Jsonb(payload),
                payload_hash,
                sync_run_id,
            ),
        )
        row = cursor.fetchone()

        if row is None:
            cursor.execute(
                """
                UPDATE physio_hemab_wp2.raw_records
                SET is_active = TRUE,
                    deleted_at = NULL,
                    last_seen_at = NOW(),
                    last_sync_run_id = %s
                WHERE source_project = %s
                  AND record_id = %s
                  AND event_name = %s
                  AND repeat_instrument = %s
                  AND repeat_instance = %s
                """,
                (
                    sync_run_id,
                    source_project,
                    record_id,
                    event_name,
                    repeat_instrument,
                    repeat_instance,
                ),
            )
            return "unchanged"

    return "inserted" if row[0] else "updated"


def deactivate_missing_records(connection, source_project: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE physio_hemab_wp2.raw_records r
            SET is_active = FALSE,
                deleted_at = COALESCE(r.deleted_at, NOW())
            WHERE r.source_project = %s
              AND r.is_active = TRUE
              AND NOT EXISTS (
                  SELECT 1
                  FROM physio_hemab_wp2_sync_seen s
                  WHERE s.source_project = r.source_project
                    AND s.record_id = r.record_id
                    AND s.event_name = r.event_name
                    AND s.repeat_instrument = r.repeat_instrument
                    AND s.repeat_instance = r.repeat_instance
              )
            """,
            (source_project,),
        )
        return cursor.rowcount


def sync_project(connection, project_key: str) -> bool:
    settings = load_redcap_settings(project_key, require_record_id=True)
    client = RedcapClient(
        api_url=settings.api_url,
        api_token=settings.api_token,
        timeout_seconds=settings.request_timeout_seconds,
    )

    records_received = 0
    records_inserted = 0
    records_updated = 0
    records_deactivated = 0
    sync_run_id: int | None = None

    try:
        sync_run_id = start_sync_run(connection, settings.project_key)

        metadata = client.export_metadata()
        sync_metadata(connection, settings.project_key, metadata)

        requested_fields = dashboard_fields(settings.project_key)
        records = client.export_records(fields=requested_fields)
        records_received = len(records)

        prepare_seen_table(connection)

        for record in records:
            record_id = str(record.get(settings.record_id_field, "")).strip()
            if not record_id:
                raise RuntimeError(
                    "A REDCap record did not contain the configured record ID field "
                    f"'{settings.record_id_field}'."
                )

            event_name = str(record.get("redcap_event_name", "") or "")
            repeat_instrument = str(
                record.get("redcap_repeat_instrument", "") or ""
            )
            repeat_instance = str(
                record.get("redcap_repeat_instance", "") or ""
            )

            minimized = minimize_record(record, requested_fields)

            mark_seen(
                connection,
                source_project=settings.project_key,
                record_id=record_id,
                event_name=event_name,
                repeat_instrument=repeat_instrument,
                repeat_instance=repeat_instance,
            )

            result = upsert_record(
                connection,
                source_project=settings.project_key,
                record_id=record_id,
                event_name=event_name,
                repeat_instrument=repeat_instrument,
                repeat_instance=repeat_instance,
                payload=minimized,
                payload_hash=stable_hash(minimized),
                sync_run_id=sync_run_id,
            )

            if result == "inserted":
                records_inserted += 1
            elif result == "updated":
                records_updated += 1

        records_deactivated = deactivate_missing_records(
            connection,
            settings.project_key,
        )

        connection.commit()

        finish_sync_run(
            connection,
            sync_run_id=sync_run_id,
            status="success",
            records_received=records_received,
            records_inserted=records_inserted,
            records_updated=records_updated,
            records_deactivated=records_deactivated,
        )

        print(
            f"{settings.project_label} sync completed: "
            f"received={records_received}, "
            f"inserted={records_inserted}, "
            f"updated={records_updated}, "
            f"deactivated={records_deactivated}."
        )
        return True

    except Exception as exc:
        connection.rollback()

        if sync_run_id is not None:
            finish_sync_run(
                connection,
                sync_run_id=sync_run_id,
                status="failed",
                records_received=records_received,
                records_inserted=records_inserted,
                records_updated=records_updated,
                records_deactivated=records_deactivated,
                error_message=str(exc)[:4000],
            )

        print(
            f"{settings.project_label} sync failed: {exc}",
            file=sys.stderr,
        )
        return False


def main() -> int:
    args = parse_args()
    database_settings = load_database_settings()

    selected_projects = (
        sorted(REDCAP_PROJECTS)
        if args.project == "all"
        else [args.project]
    )

    all_succeeded = True

    with database_connection(database_settings) as connection:
        for project_key in selected_projects:
            if not sync_project(connection, project_key):
                all_succeeded = False

    return 0 if all_succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
