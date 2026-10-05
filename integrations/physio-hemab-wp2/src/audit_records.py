from __future__ import annotations

import argparse
from collections import Counter

from config import REDCAP_PROJECTS, load_redcap_settings
from redcap_client import RedcapClient


SENSITIVE_FIELDS = {
    "enroll_name",
    "enroll_birthday",
    "enroll_tel",
    "enroll_address",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Audit Physio-HeMAB REDCap record structure without printing "
            "participant-level values."
        )
    )
    parser.add_argument(
        "project",
        choices=sorted(REDCAP_PROJECTS),
        help="Physio-HeMAB REDCap project to audit.",
    )
    return parser.parse_args()


def nonblank(value: object) -> bool:
    return str(value or "").strip() != ""


def main() -> None:
    args = parse_args()
    settings = load_redcap_settings(args.project, require_record_id=True)
    client = RedcapClient(
        api_url=settings.api_url,
        api_token=settings.api_token,
        timeout_seconds=settings.request_timeout_seconds,
    )

    records = client.export_records()

    print(
        f"# {settings.project_label} "
        f"(PID {settings.pid}, key={settings.project_key})"
    )
    print(f"records_exported={len(records)}")

    if not records:
        print("No records returned.")
        return

    all_fields = set()
    for row in records:
        all_fields.update(row.keys())

    # Never print participant-level values. Only field names and aggregate counts.
    safe_fields = sorted(field for field in all_fields if field not in SENSITIVE_FIELDS)
    print(f"fields_returned={len(all_fields)}")
    print("completion_fields=" + ",".join(
        field for field in safe_fields if field.endswith("_complete")
    ))

    if settings.project_key == "main":
        facility_field = "health_facility_enrollment"
        facilities = Counter(
            str(row.get(facility_field, "")).strip()
            for row in records
            if nonblank(row.get(facility_field))
        )
        print("facility_code_counts=" + ",".join(
            f"{key}:{value}" for key, value in sorted(facilities.items())
        ))

        forms = [
            "enrollment_form_complete",
            "maternal_record_book_baseline_complete",
            "physical_examination_form_complete",
            "activity_diary_complete",
        ]
        for field in forms:
            counts = Counter(
                str(row.get(field, "")).strip()
                for row in records
                if nonblank(row.get(field))
            )
            print(
                f"{field}_counts="
                + ",".join(f"{key}:{value}" for key, value in sorted(counts.items()))
            )

        print(
            "activity_diary_rows_with_date="
            + str(sum(nonblank(row.get("ad_date")) for row in records))
        )
        print(
            "activity_diary_rows_with_call_count="
            + str(sum(nonblank(row.get("ad_call_numb")) for row in records))
        )

    elif settings.project_key == "devices":
        print(
            "distribution_rows_with_date="
            + str(sum(nonblank(row.get("devices_date")) for row in records))
        )
        print(
            "return_rows_with_date="
            + str(sum(nonblank(row.get("date_devices_return")) for row in records))
        )

        for field in ["devices_war", "devices_paga", "devices_pungu", "devices_sirigu"]:
            print(
                f"{field}_rows_nonblank="
                + str(sum(nonblank(row.get(field)) for row in records))
            )

        print(
            "device_return_rows_nonblank="
            + str(sum(nonblank(row.get("devices_return")) for row in records))
        )


if __name__ == "__main__":
    main()
