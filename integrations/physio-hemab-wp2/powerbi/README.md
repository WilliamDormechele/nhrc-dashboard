# Physio-HeMAB WP2 Power BI model

This guide defines the first Power BI Desktop model for the Physio-HeMAB WP2 dashboard.

## Connection

For the local development database:

- Server: `127.0.0.1:5437`
- Database: `physio_hemab_wp2`
- Data connectivity mode: **DirectQuery** for near-real-time local testing
- Credentials: use the PostgreSQL credentials stored locally in `D:\Git\nhrc-dashboard\.env`

Do not put database passwords, REDCap tokens or participant identifiers in this repository.

> Important: a report published to the Power BI Service cannot reach `127.0.0.1` on the developer machine directly. Publishing will later require an approved gateway or a hosted PostgreSQL endpoint.

## Load these reporting views

Use only the reporting views below, not `raw_records`.

| View | Purpose |
| --- | --- |
| `physio_hemab_wp2.vw_overview_metrics` | Overview cards |
| `physio_hemab_wp2.vw_participants` | Recruitment and participant-level operational status |
| `physio_hemab_wp2.vw_recruitment_by_facility` | Recruitment by facility |
| `physio_hemab_wp2.vw_form_completion` | Expected vs completed forms |
| `physio_hemab_wp2.vw_activity_diaries` | Diary timeliness and call workload |
| `physio_hemab_wp2.vw_device_distributions` | Distribution log |
| `physio_hemab_wp2.vw_device_returns` | Return/component completeness |
| `physio_hemab_wp2.vw_device_set_status` | Current device-set status |
| `physio_hemab_wp2.vw_sync_status` | Data freshness and sync health |

## Overview cards

Create cards for:

- Participant target
- Participants enrolled
- Recruitment percentage
- Maternal Record Books complete
- Physical Examinations complete
- Activity Diaries complete
- Activity Diaries same day
- Activity Diaries delayed
- Activity Diary calls made
- Last successful Main sync
- Last successful Devices sync

### Suggested DAX measures

```DAX
Participant Target =
CALCULATE(
    MAX(vw_overview_metrics[metric_value]),
    vw_overview_metrics[metric_code] = "participant_target"
)
```

```DAX
Participants Enrolled =
CALCULATE(
    MAX(vw_overview_metrics[metric_value]),
    vw_overview_metrics[metric_code] = "participants_enrolled"
)
```

```DAX
Recruitment % =
DIVIDE([Participants Enrolled], [Participant Target], 0)
```

```DAX
Activity Diaries Complete =
CALCULATE(
    MAX(vw_overview_metrics[metric_value]),
    vw_overview_metrics[metric_code] = "activity_diaries_complete"
)
```

```DAX
Activity Diary Calls Made =
CALCULATE(
    MAX(vw_overview_metrics[metric_value]),
    vw_overview_metrics[metric_code] = "activity_diary_calls_made"
)
```

## Recruitment page

Use `vw_participants` and `vw_recruitment_by_facility`.

Recommended visuals:

1. Enrolled participants by facility
2. Cumulative enrollment by date
3. Enrollment form completion by facility
4. Maternal Record Book completion by facility
5. Physical Examination completion by facility

Do not add facility-specific target bars until the project team confirms which named Ghana facility maps to each 60/40 intervention/control target.

## Forms & Completion page

Use `vw_form_completion`.

Recommended columns:

- Form
- Expected
- Completed
- Missing = Expected - Completed
- Completion %

```DAX
Forms Missing =
SUM(vw_form_completion[expected]) - SUM(vw_form_completion[completed])
```

```DAX
Form Completion % =
DIVIDE(
    SUM(vw_form_completion[completed]),
    SUM(vw_form_completion[expected]),
    0
)
```

## Activity Diary page

Use `vw_activity_diaries`.

Recommended visuals:

1. Diaries complete
2. Same-day interviews
3. Delayed interviews
4. Delay days distribution
5. Calls made
6. Diary completion by facility
7. Diary instance 1 through 6 completion

Do not attribute Activity Diary performance to a data collector until an approved data-collector source is defined.

## Devices page

Use `vw_device_distributions`, `vw_device_returns` and `vw_device_set_status`.

Recommended visuals:

1. Current status of A1-A5 and B1-B5
2. Latest facility for each distributed set
3. Distribution date
4. Return date
5. Components returned / expected
6. Sets with incomplete returned components

Do not calculate overdue devices until an expected-return-date field or explicit return-time rule is approved.

## Data quality page

Initial rules supported by the current model:

- missing Enrollment Form completion
- missing Maternal Record Book completion
- missing Physical Examination completion
- missing Activity Diary instances relative to six expected per participant
- delayed Activity Diary interviews
- return-log row without return date
- returned device set with fewer components than expected
- stale or failed REDCap sync

## Sync Status page

Use `vw_sync_status`.

Display:

- source project
- last sync start
- last sync completion
- status
- rows received
- inserted
- updated
- deactivated
- error message

## Privacy boundary

Power BI should connect only to the reporting views. Do not import `raw_records.payload`.

The synchronization layer intentionally excludes participant name, date of birth, telephone number and address from PostgreSQL.
