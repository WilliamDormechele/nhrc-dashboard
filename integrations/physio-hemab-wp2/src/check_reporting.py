from __future__ import annotations

from config import load_database_settings
from db import database_connection


def main() -> None:
    settings = load_database_settings()

    with database_connection(settings) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*)
                FROM physio_hemab_wp2.vw_participants
                """
            )
            print(f"participants={cursor.fetchone()[0]}")

            cursor.execute(
                """
                SELECT facility, participants_enrolled
                FROM physio_hemab_wp2.vw_recruitment_by_facility
                ORDER BY facility
                """
            )
            for facility, count in cursor.fetchall():
                print(f"recruitment_by_facility={facility}:{count}")

            cursor.execute(
                """
                SELECT form_name, expected, completed
                FROM physio_hemab_wp2.vw_form_completion
                ORDER BY form_name
                """
            )
            for form_name, expected, completed in cursor.fetchall():
                print(
                    f"form_completion={form_name}:"
                    f"expected={expected},completed={completed}"
                )

            cursor.execute(
                """
                SELECT
                    COUNT(*) AS diaries,
                    COUNT(*) FILTER (WHERE diary_complete) AS complete,
                    COUNT(*) FILTER (WHERE same_day_interview = 'Yes') AS same_day,
                    COUNT(*) FILTER (WHERE same_day_interview = 'No') AS delayed,
                    COALESCE(SUM(calls_made), 0) AS calls_made
                FROM physio_hemab_wp2.vw_activity_diaries
                """
            )
            diaries, complete, same_day, delayed, calls_made = cursor.fetchone()
            print(
                "activity_diaries="
                f"rows={diaries},complete={complete},same_day={same_day},"
                f"delayed={delayed},calls_made={calls_made}"
            )

            cursor.execute(
                """
                SELECT facility, COUNT(*)::integer
                FROM physio_hemab_wp2.vw_device_distributions
                GROUP BY facility
                ORDER BY facility
                """
            )
            rows = cursor.fetchall()
            if not rows:
                print("device_distributions=none")
            else:
                for facility, count in rows:
                    print(f"device_distributions={facility}:{count}")

            cursor.execute(
                """
                SELECT
                    COUNT(*)::integer,
                    COUNT(*) FILTER (WHERE all_components_returned)::integer,
                    COUNT(*) FILTER (WHERE NOT all_components_returned)::integer
                FROM physio_hemab_wp2.vw_device_returns
                """
            )
            returned, complete_returns, incomplete_returns = cursor.fetchone()
            print(
                "device_returns="
                f"sets={returned},complete={complete_returns},"
                f"incomplete={incomplete_returns}"
            )

            cursor.execute(
                """
                SELECT current_status, COUNT(*)::integer
                FROM physio_hemab_wp2.vw_device_set_status
                GROUP BY current_status
                ORDER BY current_status
                """
            )
            rows = cursor.fetchall()
            if not rows:
                print("device_set_status=none")
            else:
                for status, count in rows:
                    print(f"device_set_status={status}:{count}")

            cursor.execute(
                """
                SELECT source_project, status
                FROM physio_hemab_wp2.vw_sync_status
                ORDER BY source_project
                """
            )
            for source_project, status in cursor.fetchall():
                print(f"sync={source_project}:{status}")


if __name__ == "__main__":
    main()
