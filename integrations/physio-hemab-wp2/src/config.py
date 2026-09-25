from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class RedcapSettings:
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


def load_redcap_settings(*, require_record_id: bool = True) -> RedcapSettings:
    load_dotenv()

    record_id_field = os.getenv(
        "PHYSIO_HEMAB_REDCAP_RECORD_ID_FIELD",
        "",
    ).strip()

    if require_record_id and not record_id_field:
        raise RuntimeError(
            "Required environment variable is not set: "
            "PHYSIO_HEMAB_REDCAP_RECORD_ID_FIELD"
        )

    return RedcapSettings(
        api_url=_required("PHYSIO_HEMAB_REDCAP_API_URL"),
        api_token=_required("PHYSIO_HEMAB_REDCAP_API_TOKEN"),
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
