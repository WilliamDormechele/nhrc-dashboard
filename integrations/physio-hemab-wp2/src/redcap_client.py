from __future__ import annotations

from typing import Any, Iterable

import requests


class RedcapClient:
    def __init__(self, api_url: str, api_token: str, timeout_seconds: int = 60) -> None:
        # Keep a trailing slash. Some REDCap/Apache deployments treat
        # POST /api and POST /api/ differently.
        self.api_url = api_url.rstrip("/") + "/"
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

        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RuntimeError(
                f"REDCap API HTTP error {response.status_code} at {response.url}. "
                "Check the API endpoint path and project API access."
            ) from exc

        data = response.json()

        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(f"REDCap API error: {data['error']}")

        return data

    def export_metadata(self) -> list[dict[str, Any]]:
        data = self._post({"content": "metadata"})
        if not isinstance(data, list):
            raise RuntimeError("Unexpected REDCap metadata response format.")
        return data

    def export_records(
        self,
        *,
        fields: Iterable[str] | None = None,
    ) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "content": "record",
            "type": "flat",
            "rawOrLabel": "raw",
            "rawOrLabelHeaders": "raw",
            "exportCheckboxLabel": "false",
            "exportSurveyFields": "false",
            "exportDataAccessGroups": "true",
        }

        if fields:
            for index, field in enumerate(dict.fromkeys(fields)):
                payload[f"fields[{index}]"] = field

        data = self._post(payload)

        if not isinstance(data, list):
            raise RuntimeError("Unexpected REDCap record response format.")

        return data
