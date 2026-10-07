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
                SELECT facility, study_arm, recruitment_target,
                       participants_enrolled, target_attainment_pct,
                       target_configured
                FROM physio_hemab_wp2.vw_facility_target_attainment
                ORDER BY facility
                """
            )
            for facility, arm, target, enrolled, attainment, configured in cursor.fetchall():
                print(
                    "facility_target_attainment="
                    f"{facility}:arm={arm},target={target},enrolled={enrolled},"
                    f"attainment={attainment},configured={configured}"
                )

            cursor.execute(
                """
                SELECT data_collector, facility, tasks_recorded, tasks_completed,
                       delayed_diaries, call_attempts, task_completion_pct
                FROM physio_hemab_wp2.vw_data_collector_performance
                ORDER BY data_collector, facility
                """
            )
            for row in cursor.fetchall():
                print(
                    "collector_performance="
                    f"collector={row[0]},facility={row[1]},tasks={row[2]},"
                    f"completed={row[3]},delayed={row[4]},calls={row[5]},"
                    f"completion_pct={row[6]}"
                )

            cursor.execute(
                """
                SELECT issue_type, issue_count, severity
                FROM physio_hemab_wp2.vw_data_quality_issues
                ORDER BY severity, issue_type
                """
            )
            for issue_type, count, severity in cursor.fetchall():
                print(f"data_quality_issue={issue_type}:{count}:{severity}")

            cursor.execute(
                """
                SELECT return_window_days,
                       COUNT(*) FILTER (WHERE is_overdue)::integer
                FROM physio_hemab_wp2.vw_device_overdue_scenarios
                GROUP BY return_window_days
                ORDER BY return_window_days
                """
            )
            for days, overdue in cursor.fetchall():
                print(f"overdue_scenario={days}_days:{overdue}")

            cursor.execute(
                """
                SELECT source_project, status, ROUND(age_minutes::numeric, 1), is_stale
                FROM physio_hemab_wp2.vw_data_freshness
                ORDER BY source_project
                """
            )
            for source_project, status, age_minutes, is_stale in cursor.fetchall():
                print(
                    f"freshness={source_project}:status={status},"
                    f"age_minutes={age_minutes},stale={is_stale}"
                )

            cursor.execute(
                """
                SELECT metric_code, metric_value
                FROM physio_hemab_wp2.vw_overview_metrics
                ORDER BY metric_code
                """
            )
            for metric_code, metric_value in cursor.fetchall():
                print(f"advanced_metric={metric_code}:{metric_value}")

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
