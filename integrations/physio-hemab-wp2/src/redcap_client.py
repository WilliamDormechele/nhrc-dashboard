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
            allow_redirects=False,
        )

        if 300 <= response.status_code < 400:
            raise RuntimeError("REDCap API redirect refused; use the verified HTTPS API endpoint.")
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RuntimeError(
                f"REDCap API HTTP error {response.status_code} during {payload.get('content', 'request')}. "
                "Check the API endpoint path and project API access."
            ) from exc

        data = response.json()

        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(f"REDCap API rejected {payload.get('content', 'request')}. Check the project token, rights and requested fields.")

        return data

    def verify_project(self, expected_pid: str, expected_title: str) -> None:
        data = self._post({"content": "project"})
        if isinstance(data, list) and len(data) == 1:
            data = data[0]
        if not isinstance(data, dict) or str(data.get("project_id", "")) != str(expected_pid):
            raise RuntimeError(f"REDCap project identity mismatch; expected PID {expected_pid}.")
        if str(data.get("project_title", "")).strip().casefold() != expected_title.strip().casefold():
            raise RuntimeError(f"REDCap project title mismatch for PID {expected_pid}.")
        production = data.get("in_production")
        if production is not None and str(production).lower() not in {"1", "true"}:
            raise RuntimeError(f"REDCap PID {expected_pid} is not in production mode.")

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
