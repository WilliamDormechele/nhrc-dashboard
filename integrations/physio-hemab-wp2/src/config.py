from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


REDCAP_PROJECTS = {
    "main": {
        "label": "HeMAB Ghana Main",
        "pid": "410",
        "prefix": "PHYSIO_HEMAB_MAIN",
    },
    "devices": {
        "label": "HeMAB Ghana Devices",
        "pid": "411",
        "prefix": "PHYSIO_HEMAB_DEVICES",
    },
}


@dataclass(frozen=True)
class RedcapSettings:
    project_key: str
    project_label: str
    pid: str
    api_url: str
    api_token: str
    record_id_field: str
    request_timeout_seconds: int


@dataclass(frozen=True)
class DatabaseSettings:
    host: str
    port: int
    name: str
    user: str
    password: str
    sslmode: str


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is not set: {name}")
    return value


def load_redcap_settings(
    project_key: str,
    *,
    require_record_id: bool = True,
) -> RedcapSettings:
    load_dotenv()

    project_key = project_key.strip().lower()
    project = REDCAP_PROJECTS.get(project_key)

    if not project:
        valid = ", ".join(sorted(REDCAP_PROJECTS))
        raise RuntimeError(
            f"Unknown Physio-HeMAB REDCap project '{project_key}'. "
            f"Expected one of: {valid}."
        )

    prefix = project["prefix"]
    record_id_name = f"{prefix}_REDCAP_RECORD_ID_FIELD"
    record_id_field = os.getenv(record_id_name, "").strip()

    if require_record_id and not record_id_field:
        raise RuntimeError(
            f"Required environment variable is not set: {record_id_name}"
        )

    return RedcapSettings(
        project_key=project_key,
        project_label=project["label"],
        pid=project["pid"],
        api_url=_required(f"{prefix}_REDCAP_API_URL"),
        api_token=_required(f"{prefix}_REDCAP_API_TOKEN"),
        record_id_field=record_id_field,
        request_timeout_seconds=int(
            os.getenv("PHYSIO_HEMAB_REQUEST_TIMEOUT_SECONDS", "60")
        ),
    )


def load_database_settings() -> DatabaseSettings:
    load_dotenv()

    return DatabaseSettings(
        host=_required("PHYSIO_HEMAB_DB_HOST"),
        port=int(os.getenv("PHYSIO_HEMAB_DB_PORT", "5432")),
        name=_required("PHYSIO_HEMAB_DB_NAME"),
        user=_required("PHYSIO_HEMAB_DB_USER"),
        password=_required("PHYSIO_HEMAB_DB_PASSWORD"),
        sslmode=os.getenv("PHYSIO_HEMAB_DB_SSLMODE", "prefer").strip() or "prefer",
    )
