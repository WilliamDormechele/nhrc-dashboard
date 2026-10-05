from __future__ import annotations

import argparse
from collections import Counter
from typing import Any

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


def parse_choices(raw: str) -> dict[str, str]:
    choices: dict[str, str] = {}
    for item in str(raw or "").split("|"):
        item = item.strip()
        if not item or "," not in item:
            continue
        code, label = item.split(",", 1)
        choices[code.strip()] = label.strip()
    return choices


def metadata_by_field(metadata: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(field.get("field_name", "")).strip(): field
        for field in metadata
        if str(field.get("field_name", "")).strip()
    }


def choice_label_map(metadata_field: dict[str, Any] | None) -> dict[str, str]:
    if not metadata_field:
        return {}
    return parse_choices(str(metadata_field.get("select_choices_or_calculations", "")))


def render_counter(counter: Counter[str], labels: dict[str, str] | None = None) -> str:
    labels = labels or {}
    parts: list[str] = []
    for key, value in sorted(counter.items(), key=lambda pair: str(pair[0])):
        label = labels.get(str(key), str(key))
        parts.append(f"{label}:{value}")
    return ",".join(parts)


def checkbox_key_counts(
    records: list[dict[str, Any]],
    base_field: str,
) -> Counter[str]:
    prefix = f"{base_field}___"
    counts: Counter[str] = Counter()

    for row in records:
        for key, value in row.items():
            if not key.startswith(prefix):
                continue
            if str(value or "").strip() == "1":
                counts[key[len(prefix):]] += 1

    return counts


def repeat_structure(records: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for row in records:
        instrument = str(row.get("redcap_repeat_instrument", "") or "").strip()
        event_name = str(row.get("redcap_event_name", "") or "").strip()

        if instrument:
            key = f"repeat:{instrument}"
        elif event_name:
            key = f"event:{event_name}:nonrepeat"
        else:
            key = "nonrepeat"

        counts[key] += 1
    return counts


def main() -> None:
    args = parse_args()
    settings = load_redcap_settings(args.project, require_record_id=True)
    client = RedcapClient(
        api_url=settings.api_url,
        api_token=settings.api_token,
        timeout_seconds=settings.request_timeout_seconds,
    )

    metadata = client.export_metadata()
    metadata_map = metadata_by_field(metadata)
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

    safe_fields = sorted(field for field in all_fields if field not in SENSITIVE_FIELDS)
    print(f"fields_returned={len(all_fields)}")
    print("record_structure=" + render_counter(repeat_structure(records)))
    print("completion_fields=" + ",".join(
        field for field in safe_fields if field.endswith("_complete")
    ))

    if settings.project_key == "main":
        facility_field = "health_facility_enrollment"
        facility_labels = choice_label_map(metadata_map.get(facility_field))
        facilities = Counter(
            str(row.get(facility_field, "")).strip()
            for row in records
            if nonblank(row.get(facility_field))
        )
        print(
            "facility_counts="
            + render_counter(facilities, facility_labels)
        )

        forms = [
            "enrollment_form_complete",
            "maternal_record_book_baseline_complete",
            "physical_examination_form_complete",
            "activity_diary_complete",
        ]
        completion_labels = {
            "0": "Incomplete",
            "1": "Unverified",
            "2": "Complete",
        }

        for field in forms:
            counts = Counter(
                str(row.get(field, "")).strip()
                for row in records
                if nonblank(row.get(field))
            )
            print(
                f"{field}_counts="
                + render_counter(counts, completion_labels)
            )

        print(
            "activity_diary_rows_with_date="
            + str(sum(nonblank(row.get("ad_date")) for row in records))
        )
        print(
            "activity_diary_rows_with_call_count="
            + str(sum(nonblank(row.get("ad_call_numb")) for row in records))
        )

        call_date_labels = choice_label_map(metadata_map.get("call_date"))
        call_date_counts = Counter(
            str(row.get("call_date", "")).strip()
            for row in records
            if nonblank(row.get("call_date"))
        )
        print(
            "activity_diary_same_day_interview_counts="
            + render_counter(call_date_counts, call_date_labels)
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

        distribution_fields = [
            "devices_war",
            "devices_paga",
            "devices_pungu",
            "devices_sirigu",
        ]

        for field in distribution_fields:
            counts = checkbox_key_counts(records, field)
            labels = choice_label_map(metadata_map.get(field))
            print(
                f"{field}_selected_counts="
                + render_counter(counts, labels)
            )

        returned_sets = checkbox_key_counts(records, "devices_return")
        returned_labels = choice_label_map(metadata_map.get("devices_return"))
        print(
            "devices_return_selected_counts="
            + render_counter(returned_sets, returned_labels)
        )

        for field in [
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
        ]:
            counts = checkbox_key_counts(records, field)
            if not counts:
                continue
            labels = choice_label_map(metadata_map.get(field))
            print(
                f"{field}_component_counts="
                + render_counter(counts, labels)
            )


if __name__ == "__main__":
    main()
