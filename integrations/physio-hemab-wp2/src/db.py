from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg

from config import Settings


@contextmanager
def database_connection(settings: Settings) -> Iterator[psycopg.Connection]:
    connection = psycopg.connect(
        host=settings.db_host,
        port=settings.db_port,
        dbname=settings.db_name,
        user=settings.db_user,
        password=settings.db_password,
        sslmode=settings.db_sslmode,
    )

    try:
        yield connection
    finally:
        connection.close()
