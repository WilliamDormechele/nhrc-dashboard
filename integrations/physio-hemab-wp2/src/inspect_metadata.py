from __future__ import annotations

import argparse

from config import REDCAP_PROJECTS, load_redcap_settings
from redcap_client import RedcapClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect REDCap metadata without exporting participant records."
    )
    parser.add_argument(
        "project",
        choices=sorted(REDCAP_PROJECTS),
        help="Physio-HeMAB REDCap project to inspect.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_redcap_settings(args.project, require_record_id=False)

    client = RedcapClient(
        api_url=settings.api_url,
        api_token=settings.api_token,
        timeout_seconds=settings.request_timeout_seconds,
    )

    metadata = client.export_metadata()

    print(
        f"# {settings.project_label} "
        f"(PID {settings.pid}, key={settings.project_key})"
    )
    print("field_name\tform_name\tfield_type\tfield_label")

    for field in metadata:
        print(
            "\t".join(
                [
                    str(field.get("field_name", "")),
                    str(field.get("form_name", "")),
                    str(field.get("field_type", "")),
                    str(field.get("field_label", "")).replace("\t", " "),
                ]
            )
        )


if __name__ == "__main__":
    main()
