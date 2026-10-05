from __future__ import annotations

from config import load_database_settings
from db import database_connection


def main() -> None:
    settings = load_database_settings()

    with database_connection(settings) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT current_database(), current_user,
                       current_setting('server_version')
                """
            )
            database_name, user_name, server_version = cursor.fetchone()

            cursor.execute(
                """
                SELECT source_project, status, completed_at,
                       records_received, records_inserted,
                       records_updated, records_deactivated
                FROM physio_hemab_wp2.vw_sync_status
                ORDER BY source_project
                """
            )
            sync_rows = cursor.fetchall()

            cursor.execute(
                """
                SELECT metric_code, metric_value
                FROM physio_hemab_wp2.vw_overview_metrics
                ORDER BY metric_code
                """
            )
            metrics = cursor.fetchall()

    print(f"database={database_name}")
    print(f"user={user_name}")
    print(f"postgres_version={server_version}")

    if not sync_rows:
        print("sync_status=no sync has run yet")
    else:
        for row in sync_rows:
            print(
                "sync_status="
                f"project={row[0]},status={row[1]},completed_at={row[2]},"
                f"received={row[3]},inserted={row[4]},"
                f"updated={row[5]},deactivated={row[6]}"
            )

    for metric_code, metric_value in metrics:
        print(f"metric={metric_code}:{metric_value}")


if __name__ == "__main__":
    main()
