from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg

from config import DatabaseSettings


@contextmanager
def database_connection(
    settings: DatabaseSettings,
) -> Iterator[psycopg.Connection]:
    connection = psycopg.connect(
        host=settings.host,
        port=settings.port,
        dbname=settings.name,
        user=settings.user,
        password=settings.password,
        sslmode=settings.sslmode,
    )

    try:
        yield connection
    finally:
        connection.close()
