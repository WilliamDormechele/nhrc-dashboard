from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore
from psycopg.rows import dict_row

from config import load_database_settings
from db import database_connection


PROJECT_CODE = "physio-hemab-wp2"
DEFAULT_FIREBASE_PROJECT = "nhrc-dashboard"
MAX_SNAPSHOT_BYTES = 800_000


def _serialise(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(key): _serialise(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialise(item) for item in value]
    return value


def _rows(connection, sql: str) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(sql)
        return [_serialise(dict(row)) for row in cursor.fetchall()]


def _scalar_config(connection, key: str, default: Any) -> Any:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT config_value #>> '{}'
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = %s
            """,
            (key,),
        )
        row = cursor.fetchone()

    if not row or row[0] in (None, "", "null"):
        return default

    raw = row[0]

    if isinstance(default, int):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return default

    return raw


def _local_facility_targets(connection) -> dict[str, dict[str, Any]]:
    rows = _rows(
        connection,
        """
        SELECT facility, study_arm, recruitment_target
        FROM physio_hemab_wp2.facility_targets
        WHERE is_active = TRUE
        ORDER BY facility
        """,
    )

    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        arm = str(row.get("study_arm") or "").strip()
        target = row.get("recruitment_target")
        if not arm or target in (None, ""):
            continue
        result[str(row["facility"])] = {
            "arm": arm,
            "target": int(target),
        }

    return result


def _build_snapshot(connection, project_document: dict[str, Any]) -> dict[str, Any]:
    participants = _rows(
        connection,
        """
        SELECT
            study_id,
            facility,
            enrollment_date,
            COALESCE(data_collector, 'Unassigned') AS data_collector,
            enrollment_complete,
            maternal_record_book_complete,
            physical_examination_complete,
            physical_examination_date,
            physical_examination_facility,
            physical_examiner
        FROM physio_hemab_wp2.vw_participants
        ORDER BY enrollment_date NULLS LAST, study_id
        """,
    )

    activity_diaries = _rows(
        connection,
        """
        SELECT
            study_id,
            facility,
            COALESCE(data_collector, 'Unassigned') AS data_collector,
            diary_instance,
            diary_date,
            same_day_interview,
            interview_date,
            delay_days,
            calls_made,
            diary_complete
        FROM physio_hemab_wp2.vw_activity_diaries
        ORDER BY diary_date NULLS LAST, study_id, diary_instance
        """,
    )

    device_distributions = _rows(
        connection,
        """
        SELECT
            distribution_date,
            distribution_instance,
            facility,
            device_set,
            study_id,
            distribution_form_complete
        FROM physio_hemab_wp2.vw_device_distributions
        ORDER BY distribution_date NULLS LAST, device_set, facility
        """,
    )

    device_returns = _rows(
        connection,
        """
        SELECT
            return_date,
            return_instance,
            device_set,
            components_returned,
            components_expected,
            all_components_returned,
            return_form_complete
        FROM physio_hemab_wp2.vw_device_returns
        ORDER BY return_date NULLS LAST, device_set
        """,
    )

    device_sets = _rows(
        connection,
        """
        SELECT
            device_set,
            latest_distribution_date,
            latest_facility,
            latest_study_id,
            latest_return_date,
            components_returned,
            components_expected,
            all_components_returned,
            current_status
        FROM physio_hemab_wp2.vw_device_set_status
        ORDER BY device_set
        """,
    )

    sync_rows = _rows(
        connection,
        """
        SELECT
            source_project,
            completed_at,
            status,
            records_received,
            records_inserted,
            records_updated,
            records_deactivated
        FROM physio_hemab_wp2.vw_sync_status
        ORDER BY source_project
        """,
    )

    sync_by_source = {
        str(row["source_project"]): row
        for row in sync_rows
    }

    completed_times = [
        str(row.get("completed_at"))
        for row in sync_rows
        if row.get("status") == "success" and row.get("completed_at")
    ]

    data_current_to = min(completed_times) if completed_times else datetime.now(
        timezone.utc
    ).isoformat()

    local_participant_target = _scalar_config(
        connection,
        "participant_target",
        200,
    )
    local_diary_expected = _scalar_config(
        connection,
        "activity_diaries_expected_per_participant",
        6,
    )
    local_return_window = _scalar_config(
        connection,
        "device_return_days_default",
        None,
    )
    local_targets = _local_facility_targets(connection)

    remote_config = project_document.get("wp2Config")
    if not isinstance(remote_config, dict):
        remote_config = {}

    participant_target = int(
        remote_config.get("participantTarget") or local_participant_target or 200
    )
    activity_diaries_expected = int(
        remote_config.get("activityDiariesExpectedPerParticipant")
        or local_diary_expected
        or 6
    )

    if "returnWindowDays" in remote_config:
        return_window_days = remote_config.get("returnWindowDays")
    else:
        return_window_days = local_return_window

    remote_targets = remote_config.get("facilityTargets")
    facility_targets = (
        remote_targets
        if isinstance(remote_targets, dict) and remote_targets
        else local_targets
    )

    source_status: dict[str, Any] = {}
    for key, pid in (("main", 410), ("devices", 411)):
        row = sync_by_source.get(key, {})
        status = str(row.get("status") or "unknown")
        source_status[key] = {
            "pid": pid,
            "status": status,
            "completedAt": row.get("completed_at") or "",
            "recordsReceived": int(row.get("records_received") or 0),
            "recordsInserted": int(row.get("records_inserted") or 0),
            "recordsUpdated": int(row.get("records_updated") or 0),
            "recordsDeactivated": int(row.get("records_deactivated") or 0),
            "message": "" if status == "success" else "Latest local REDCap sync was not successful",
        }

    snapshot = {
        "snapshotVersion": 1,
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "fetchedAt": data_current_to,
        "sourceStatus": source_status,
        "config": {
            "participantTarget": participant_target,
            "activityDiariesExpectedPerParticipant": activity_diaries_expected,
            "returnWindowDays": return_window_days,
            "returnWindowOptions": [1, 2, 3, 5, 7, 10, 14],
            "facilityTargets": facility_targets,
        },
        "participants": [
            {
                "studyId": row.get("study_id") or "",
                "facility": row.get("facility") or "",
                "enrollmentDate": row.get("enrollment_date") or "",
                "dataCollector": row.get("data_collector") or "Unassigned",
                "enrollmentComplete": bool(row.get("enrollment_complete")),
                "maternalRecordComplete": bool(
                    row.get("maternal_record_book_complete")
                ),
                "physicalExamComplete": bool(
                    row.get("physical_examination_complete")
                ),
                "physicalExamDate": row.get("physical_examination_date") or "",
                "physicalExamFacility": row.get("physical_examination_facility")
                or "",
                "physicalExaminer": row.get("physical_examiner") or "",
            }
            for row in participants
        ],
        "activityDiaries": [
            {
                "studyId": row.get("study_id") or "",
                "facility": row.get("facility") or "",
                "dataCollector": row.get("data_collector") or "Unassigned",
                "diaryInstance": row.get("diary_instance"),
                "diaryDate": row.get("diary_date") or "",
                "sameDayInterview": row.get("same_day_interview") or "",
                "interviewDate": row.get("interview_date") or "",
                "delayDays": row.get("delay_days"),
                "callsMade": row.get("calls_made"),
                "diaryComplete": bool(row.get("diary_complete")),
            }
            for row in activity_diaries
        ],
        "deviceDistributions": [
            {
                "distributionDate": row.get("distribution_date") or "",
                "distributionInstance": row.get("distribution_instance"),
                "facility": row.get("facility") or "",
                "deviceSet": row.get("device_set") or "",
                "studyId": row.get("study_id") or "",
                "formComplete": bool(row.get("distribution_form_complete")),
            }
            for row in device_distributions
        ],
        "deviceReturns": [
            {
                "returnDate": row.get("return_date") or "",
                "returnInstance": row.get("return_instance"),
                "deviceSet": row.get("device_set") or "",
                "componentsReturned": row.get("components_returned"),
                "componentsExpected": row.get("components_expected"),
                "allComponentsReturned": bool(row.get("all_components_returned")),
                "formComplete": bool(row.get("return_form_complete")),
            }
            for row in device_returns
        ],
        "deviceSets": [
            {
                "deviceSet": row.get("device_set") or "",
                "latestDistributionDate": row.get("latest_distribution_date")
                or "",
                "latestFacility": row.get("latest_facility") or "",
                "latestStudyId": row.get("latest_study_id") or "",
                "latestReturnDate": row.get("latest_return_date") or "",
                "componentsReturned": row.get("components_returned"),
                "componentsExpected": row.get("components_expected"),
                "allComponentsReturned": row.get("all_components_returned"),
                "currentStatus": row.get("current_status") or "Unknown",
            }
            for row in device_sets
        ],
    }

    size = len(
        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
    )
    if size > MAX_SNAPSHOT_BYTES:
        raise RuntimeError(
            f"Dashboard snapshot is {size:,} bytes, above the "
            f"{MAX_SNAPSHOT_BYTES:,}-byte safety limit. "
            "Switch to chunked snapshot publishing before continuing."
        )

    return snapshot


def _credentials_path() -> Path:
    configured = os.getenv("PHYSIO_HEMAB_FIREBASE_CREDENTIALS_FILE", "").strip()
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        return path.resolve()

    candidates = [
        Path.cwd() / "serviceAccountKey.json",
        Path.cwd() / "firebase-adminsdk.json",
        Path(__file__).resolve().parents[3] / "serviceAccountKey.json",
    ]

    for path in candidates:
        if path.exists():
            return path.resolve()

    raise RuntimeError(
        "Firebase credentials file not found. Set "
        "PHYSIO_HEMAB_FIREBASE_CREDENTIALS_FILE in the local .env "
        "to the path of the Firebase service-account JSON file."
    )


def _firestore_client():
    project_id = os.getenv(
        "PHYSIO_HEMAB_FIREBASE_PROJECT_ID",
        DEFAULT_FIREBASE_PROJECT,
    ).strip() or DEFAULT_FIREBASE_PROJECT

    credentials_path = _credentials_path()
    if not credentials_path.exists():
        raise RuntimeError(
            f"Firebase credentials file does not exist: {credentials_path}"
        )

    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            credentials.Certificate(str(credentials_path)),
            {"projectId": project_id},
        )

    return firestore.client()


def main() -> int:
    database_settings = load_database_settings()
    client = _firestore_client()
    project_ref = client.collection("projects").document(PROJECT_CODE)
    project_snapshot = project_ref.get()
    project_document = project_snapshot.to_dict() if project_snapshot.exists else {}

    with database_connection(database_settings) as connection:
        snapshot = _build_snapshot(connection, project_document or {})

    project_ref.set(
        {
            "code": PROJECT_CODE,
            "name": "Physio-HeMAB WP2",
            "description": (
                "Secure native Physio-HeMAB Work Package 2 operational "
                "monitoring dashboard."
            ),
            "dashboardMode": "native",
            "dashboardEmbedUrl": "projects/physio-hemab-wp2/index.html",
            "enabled": True,
            "wp2Snapshot": snapshot,
            "wp2SnapshotUpdatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    print("Physio-HeMAB WP2 Firestore snapshot published.")
    print(f"participants={len(snapshot['participants'])}")
    print(f"activity_diaries={len(snapshot['activityDiaries'])}")
    print(f"device_sets={len(snapshot['deviceSets'])}")
    print(f"data_current_to={snapshot['fetchedAt']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
