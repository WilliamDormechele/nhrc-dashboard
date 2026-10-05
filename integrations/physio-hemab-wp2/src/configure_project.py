from __future__ import annotations

import argparse
import csv
from pathlib import Path

from config import load_database_settings
from db import database_connection


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Configure operational mappings for the Physio-HeMAB WP2 dashboard."
    )
    sub = p.add_subparsers(dest="command", required=True)

    target = sub.add_parser("facility-target", help="Set one facility target.")
    target.add_argument("--facility", required=True)
    target.add_argument("--arm", required=True, choices=["Intervention", "Control"])
    target.add_argument("--target", required=True, type=int)

    targets_csv = sub.add_parser(
        "facility-targets-csv",
        help="Load facility targets from a CSV file.",
    )
    targets_csv.add_argument("path")

    collector = sub.add_parser(
        "collector",
        help="Assign a data collector to one REDCap task.",
    )
    collector.add_argument("--record-id", required=True)
    collector.add_argument(
        "--instrument",
        required=True,
        choices=[
            "enrollment_form",
            "maternal_record_book_baseline",
            "physical_examination_form",
            "activity_diary",
        ],
    )
    collector.add_argument("--instance", default="")
    collector.add_argument("--name", required=True)

    collectors_csv = sub.add_parser(
        "collectors-csv",
        help="Load data-collector assignments from a CSV file.",
    )
    collectors_csv.add_argument("path")

    return_window = sub.add_parser(
        "return-window",
        help="Set the project default device return window in days.",
    )
    return_window.add_argument("--days", required=True, type=int)

    sub.add_parser("show", help="Show aggregate configuration status.")
    return p


def set_facility_target(connection, facility: str, arm: str, target: int) -> None:
    if target <= 0:
        raise ValueError("Target must be greater than zero.")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO physio_hemab_wp2.facility_targets (
                facility,
                study_arm,
                recruitment_target,
                is_active,
                updated_at
            )
            VALUES (%s, %s, %s, TRUE, NOW())
            ON CONFLICT (facility)
            DO UPDATE SET
                study_arm = EXCLUDED.study_arm,
                recruitment_target = EXCLUDED.recruitment_target,
                is_active = TRUE,
                updated_at = NOW()
            """,
            (facility.strip(), arm, target),
        )


def set_collector(
    connection,
    record_id: str,
    instrument: str,
    repeat_instance: str,
    name: str,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO physio_hemab_wp2.data_collector_assignments (
                source_project,
                record_id,
                instrument,
                repeat_instance,
                data_collector,
                assignment_source,
                updated_at
            )
            VALUES ('main', %s, %s, %s, %s, 'manual', NOW())
            ON CONFLICT (
                source_project,
                record_id,
                instrument,
                repeat_instance
            )
            DO UPDATE SET
                data_collector = EXCLUDED.data_collector,
                assignment_source = 'manual',
                updated_at = NOW()
            """,
            (
                record_id.strip(),
                instrument.strip(),
                repeat_instance.strip(),
                name.strip(),
            ),
        )


def load_targets_csv(connection, path: str) -> int:
    rows = 0
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            facility = str(row.get("facility", "")).strip()
            arm = str(row.get("study_arm", "")).strip()
            target = str(row.get("recruitment_target", "")).strip()

            if not facility or not arm or not target:
                continue

            if arm not in {"Intervention", "Control"}:
                raise ValueError(f"Invalid study_arm for {facility}: {arm}")

            set_facility_target(connection, facility, arm, int(target))
            rows += 1
    return rows


def load_collectors_csv(connection, path: str) -> int:
    rows = 0
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            record_id = str(row.get("record_id", "")).strip()
            instrument = str(row.get("instrument", "")).strip()
            repeat_instance = str(row.get("repeat_instance", "")).strip()
            name = str(row.get("data_collector", "")).strip()

            if not record_id or not instrument or not name:
                continue

            set_collector(
                connection,
                record_id=record_id,
                instrument=instrument,
                repeat_instance=repeat_instance,
                name=name,
            )
            rows += 1
    return rows


def set_return_window(connection, days: int) -> None:
    if days <= 0:
        raise ValueError("Return window must be greater than zero days.")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO physio_hemab_wp2.dashboard_config (
                config_key,
                config_value,
                updated_at
            )
            VALUES ('device_return_days_default', to_jsonb(%s::integer), NOW())
            ON CONFLICT (config_key)
            DO UPDATE SET
                config_value = EXCLUDED.config_value,
                updated_at = NOW()
            """,
            (days,),
        )


def show(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT facility, study_arm, recruitment_target, target_configured
            FROM physio_hemab_wp2.vw_facility_target_attainment
            ORDER BY facility
            """
        )
        print("Facility target configuration:")
        for facility, arm, target, configured in cursor.fetchall():
            print(
                f"  {facility}: arm={arm or 'Not set'}, "
                f"target={target if target is not None else 'Not set'}, "
                f"configured={configured}"
            )

        cursor.execute(
            """
            SELECT data_collector, COUNT(*)::integer
            FROM physio_hemab_wp2.vw_data_collector_work
            GROUP BY data_collector
            ORDER BY data_collector
            """
        )
        print("Data-collector attribution:")
        for collector, count in cursor.fetchall():
            print(f"  {collector}: {count} task(s)")

        cursor.execute(
            """
            SELECT return_window_days, label
            FROM physio_hemab_wp2.vw_return_window_options
            ORDER BY sort_order
            """
        )
        print("Selectable device return windows:")
        print("  " + ", ".join(label for _, label in cursor.fetchall()))

        cursor.execute(
            """
            SELECT config_value #>> '{}'
            FROM physio_hemab_wp2.dashboard_config
            WHERE config_key = 'device_return_days_default'
            """
        )
        row = cursor.fetchone()
        configured_days = row[0] if row and row[0] not in {None, "null"} else "Not set"
        print(f"Default return window: {configured_days}")


def main() -> int:
    args = parser().parse_args()
    settings = load_database_settings()

    with database_connection(settings) as connection:
        if args.command == "facility-target":
            set_facility_target(
                connection,
                facility=args.facility,
                arm=args.arm,
                target=args.target,
            )
            connection.commit()
            print("Facility target saved.")

        elif args.command == "facility-targets-csv":
            count = load_targets_csv(connection, args.path)
            connection.commit()
            print(f"Loaded {count} facility target row(s).")

        elif args.command == "collector":
            set_collector(
                connection,
                record_id=args.record_id,
                instrument=args.instrument,
                repeat_instance=args.instance,
                name=args.name,
            )
            connection.commit()
            print("Data-collector assignment saved.")

        elif args.command == "collectors-csv":
            count = load_collectors_csv(connection, args.path)
            connection.commit()
            print(f"Loaded {count} data-collector assignment row(s).")

        elif args.command == "return-window":
            set_return_window(connection, args.days)
            connection.commit()
            print(f"Default device return window saved: {args.days} day(s).")

        elif args.command == "show":
            show(connection)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
