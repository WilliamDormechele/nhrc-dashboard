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
                error_message = %s
            WHERE sync_run_id = %s
            """,
            (
                status,
                records_received,
                records_inserted,
                records_updated,
                error_message,
                sync_run_id,
            ),
        )
    connection.commit()


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
                last_sync_run_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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
        return "unchanged"

    return "inserted" if row[0] else "updated"


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
    sync_run_id: int | None = None

    try:
        sync_run_id = start_sync_run(connection, settings.project_key)
        records = client.export_records()
        records_received = len(records)

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

            result = upsert_record(
                connection,
                source_project=settings.project_key,
                record_id=record_id,
                event_name=event_name,
                repeat_instrument=repeat_instrument,
                repeat_instance=repeat_instance,
                payload=record,
                payload_hash=stable_hash(record),
                sync_run_id=sync_run_id,
            )

            if result == "inserted":
                records_inserted += 1
            elif result == "updated":
                records_updated += 1

        connection.commit()

        finish_sync_run(
            connection,
            sync_run_id=sync_run_id,
            status="success",
            records_received=records_received,
            records_inserted=records_inserted,
            records_updated=records_updated,
        )

        print(
            f"{settings.project_label} sync completed: "
            f"received={records_received}, "
            f"inserted={records_inserted}, "
            f"updated={records_updated}."
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
