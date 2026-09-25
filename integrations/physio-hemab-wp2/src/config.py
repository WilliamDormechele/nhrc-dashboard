from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    redcap_api_url: str
    redcap_api_token: str
    redcap_record_id_field: str
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    db_sslmode: str
    sync_batch_size: int
    request_timeout_seconds: int


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is not set: {name}")
    return value


def load_settings() -> Settings:
    load_dotenv()

    return Settings(
        redcap_api_url=_required("PHYSIO_HEMAB_REDCAP_API_URL"),
        redcap_api_token=_required("PHYSIO_HEMAB_REDCAP_API_TOKEN"),
        redcap_record_id_field=_required("PHYSIO_HEMAB_REDCAP_RECORD_ID_FIELD"),
        db_host=_required("PHYSIO_HEMAB_DB_HOST"),
        db_port=int(os.getenv("PHYSIO_HEMAB_DB_PORT", "5432")),
        db_name=_required("PHYSIO_HEMAB_DB_NAME"),
        db_user=_required("PHYSIO_HEMAB_DB_USER"),
        db_password=_required("PHYSIO_HEMAB_DB_PASSWORD"),
        db_sslmode=os.getenv("PHYSIO_HEMAB_DB_SSLMODE", "prefer").strip() or "prefer",
        sync_batch_size=int(os.getenv("PHYSIO_HEMAB_SYNC_BATCH_SIZE", "500")),
        request_timeout_seconds=int(
            os.getenv("PHYSIO_HEMAB_REQUEST_TIMEOUT_SECONDS", "60")
        ),
    )
