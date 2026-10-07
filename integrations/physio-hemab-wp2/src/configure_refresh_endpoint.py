from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

from publish_firestore import _firestore_client

PROJECT_CODE = "physio-hemab-wp2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Configure the Physio-HeMAB WP2 secure manual refresh endpoint."
    )
    parser.add_argument("--url", required=True, help="HTTPS Cloudflare Worker URL")
    return parser.parse_args()


def normalise_endpoint(raw_url: str) -> str:
    endpoint = raw_url.strip().rstrip("/")
    parsed = urlparse(endpoint)

    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise RuntimeError("Refresh endpoint must be a valid HTTPS URL.")

    if parsed.query or parsed.fragment:
        raise RuntimeError("Refresh endpoint must not contain a query string or fragment.")

    return endpoint


def main() -> int:
    args = parse_args()
    endpoint = normalise_endpoint(args.url)

    client = _firestore_client()
    client.collection("projects").document(PROJECT_CODE).set(
        {"wp2RefreshEndpoint": endpoint},
        merge=True,
    )

    print("Physio-HeMAB WP2 refresh endpoint configured.")
    print(f"Endpoint: {endpoint}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
