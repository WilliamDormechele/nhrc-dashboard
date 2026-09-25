from __future__ import annotations

from config import load_settings
from redcap_client import RedcapClient


def main() -> None:
    settings = load_settings()
    client = RedcapClient(
        api_url=settings.redcap_api_url,
        api_token=settings.redcap_api_token,
        timeout_seconds=settings.request_timeout_seconds,
    )

    metadata = client.export_metadata()

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
