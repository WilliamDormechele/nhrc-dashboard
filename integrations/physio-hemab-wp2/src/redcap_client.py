from __future__ import annotations

from typing import Any

import requests


class RedcapClient:
    def __init__(self, api_url: str, api_token: str, timeout_seconds: int = 60) -> None:
        self.api_url = api_url.rstrip("/")
        self.api_token = api_token
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()

    def _post(self, payload: dict[str, Any]) -> Any:
        request_payload = {
            "token": self.api_token,
            "format": "json",
            "returnFormat": "json",
            **payload,
        }

        response = self.session.post(
            self.api_url,
            data=request_payload,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()

        data = response.json()

        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(f"REDCap API error: {data['error']}")

        return data

    def export_metadata(self) -> list[dict[str, Any]]:
        data = self._post({"content": "metadata"})
        if not isinstance(data, list):
            raise RuntimeError("Unexpected REDCap metadata response format.")
        return data

    def export_records(self) -> list[dict[str, Any]]:
        data = self._post(
            {
                "content": "record",
                "type": "flat",
                "rawOrLabel": "raw",
                "rawOrLabelHeaders": "raw",
                "exportCheckboxLabel": "false",
                "exportSurveyFields": "false",
                "exportDataAccessGroups": "true",
            }
        )

        if not isinstance(data, list):
            raise RuntimeError("Unexpected REDCap record response format.")

        return data
