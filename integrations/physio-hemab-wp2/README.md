# Physio-HeMAB WP2 integration

This directory contains the integration layer for the Physio-HeMAB Work Package 2 dashboard.

## REDCap source projects

Physio-HeMAB WP2 uses two separate REDCap projects on the same REDCap server:

| Key | REDCap project | PID | Purpose |
| --- | --- | ---: | --- |
| `main` | HeMAB Ghana Main | 410 | Enrollment, Maternal Record Book, Physical Examination and Activity Diary |
| `devices` | HeMAB Ghana Devices | 411 | Device distribution and device return logs |

Both projects use the same stable, versionless REDCap API endpoint:

```text
https://redcap-test.uk-halle.de/api/
```

Each REDCap project requires its own API token. The token identifies the REDCap project, so the project browser URL with `index.php?pid=...` must not be used as the API URL.

## Local secret configuration

Create or edit this local file:

```text
D:\Git\nhrc-dashboard\.env
```

The repository already ignores `.env` files. Never commit the real token values.

Use:

```env
PHYSIO_HEMAB_MAIN_REDCAP_API_URL=https://redcap-test.uk-halle.de/api/
PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN=<PID 410 token>
PHYSIO_HEMAB_MAIN_REDCAP_RECORD_ID_FIELD=record_id

PHYSIO_HEMAB_DEVICES_REDCAP_API_URL=https://redcap-test.uk-halle.de/api/
PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN=<PID 411 token>
PHYSIO_HEMAB_DEVICES_REDCAP_RECORD_ID_FIELD=record_id
```

Do not paste either token into GitHub, the dashboard source, Power BI, chat messages, screenshots or documentation.

## Verified field maps

The supplied REDCap data dictionaries have been mapped into:

- `field-map.main.json`
- `field-map.devices.json`

The Main project currently contains these forms:

- `enrollment_form`
- `maternal_record_book_baseline`
- `physical_examination_form`
- `activity_diary`

The Devices project currently contains:

- `distribution_log`
- `return_log`

The Main data dictionary does not contain a dedicated data-collector field. The project team still needs to decide whether the dashboard should use an explicit REDCap field or approved REDCap user/audit information for data-collector attribution.

## Data flow

```text
PID 410 HeMAB Ghana Main --------\
                                  -> Python sync -> PostgreSQL -> Power BI -> NHRC Dashboard
PID 411 HeMAB Ghana Devices -----/
```

## Local setup

From:

```text
D:\Git\nhrc-dashboard\integrations\physio-hemab-wp2
```

run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Safe metadata inspection

These commands request REDCap metadata only. They do not print participant records.

Main project:

```powershell
python src\inspect_metadata.py main
```

Devices project:

```powershell
python src\inspect_metadata.py devices
```

## PostgreSQL

For local development, WP2 uses a free PostgreSQL 16 container on port `5437`, isolated from
the other NHRC repositories.

Add these values to the repository root `.env` file:

```env
PHYSIO_HEMAB_DB_HOST=127.0.0.1
PHYSIO_HEMAB_DB_PORT=5437
PHYSIO_HEMAB_DB_NAME=physio_hemab_wp2
PHYSIO_HEMAB_DB_USER=physio_hemab
PHYSIO_HEMAB_DB_PASSWORD=<choose a strong local password>
PHYSIO_HEMAB_DB_SSLMODE=disable
```

Then, from the WP2 integration directory, run:

```powershell
.\scripts\setup-db.ps1
```

The setup script starts PostgreSQL, waits for the health check, and applies both
`sql/schema.sql` and `sql/views.sql`.

The database stores only dashboard-required REDCap fields. Names, dates of birth,
telephone numbers, addresses and unrelated clinical variables are not requested by
the synchronizer and are not written to PostgreSQL.

## Synchronization

Main only:

```powershell
python src\sync.py main
```

Devices only:

```powershell
python src\sync.py devices
```

Both:

```powershell
python src\sync.py all
```

After PostgreSQL is initialized, run both REDCap sources:

```powershell
python src\sync.py all
python src\check_db.py
```

The reporting layer exposes Power BI-ready views for participants, activity diaries,
form completion, recruitment by facility, device distribution, device returns, current
device-set status, synchronization status and overview metrics.

## Security

This GitHub repository is public. Never commit:

- REDCap API tokens
- participant-level exports
- database passwords
- Power BI credentials
- Firebase service-account files
- private keys

Participant-level data must remain within the approved research infrastructure.


## Privacy-preserving record audit

After metadata access succeeds, validate the returned record structure without printing names,
dates of birth, telephone numbers, addresses, study IDs or other participant-level values.

Main project:

```powershell
python src\audit_records.py main
```

Devices project:

```powershell
python src\audit_records.py devices
```

The audit prints only aggregate counts and field-presence information. Do not paste full
REDCap record exports into chat or commit them to the repository.


The audit also decodes REDCap checkbox exports (for example `devices_war___...`)
and reports only aggregate selected-choice counts. It also reports repeating-instrument
structure so that the transformation logic can distinguish participant rows from
repeating Activity Diary rows.


## Reporting validation

Before connecting Power BI, validate the populated reporting views without exposing participant-level values:

```powershell
python src\check_reporting.py
```

This reports only aggregate recruitment, form-completion, Activity Diary, device and sync counts.


## Project configuration for advanced KPIs

Three advanced dashboard capabilities are implemented with explicit configuration rather than hard-coded assumptions.

### Facility-specific target attainment

The four named facilities are present in `physio_hemab_wp2.facility_targets`, but the study source material does not identify which facility receives each 60/40/60/40 target. Configure the approved mapping before publishing target-attainment visuals.

Example:

```powershell
python src\configure_project.py facility-target --facility "Paga District Hospital" --arm Intervention --target 60
```

Or copy `facility-targets.example.csv`, fill the approved mappings, and load them:

```powershell
python src\configure_project.py facility-targets-csv .\facility-targets.local.csv
```

### Data-collector performance

Physical Examination performance can use the REDCap `crf_examiner` field automatically. Enrollment, Maternal Record Book and Activity Diary attribution can be configured without changing REDCap by using the assignment table.

Example:

```powershell
python src\configure_project.py collector --record-id 1 --instrument activity_diary --instance 1 --name "Collector Name"
```

For bulk attribution, copy `data-collector-assignments.example.csv` and load it:

```powershell
python src\configure_project.py collectors-csv .\data-collector-assignments.local.csv
```

Actual collector-assignment files should remain local and must not be committed.

### Selectable device return window

The dashboard exposes return-window options of 1, 2, 3, 5, 7, 10 and 14 days through `vw_return_window_options` and `vw_device_overdue_scenarios`.

Power BI can use `return_window_days` or `return_window` from the scenario view as a single-select slicer. In addition, the current Device Set Status view supports a project-level selected policy.

Set the operational return window, for example 3 days:

```powershell
python src\configure_project.py return-window --days 3
```

The configured value calculates:

- expected return date
- overdue status
- due-today status
- within-window status
- returned status

This avoids hard-coding an unapproved return rule while still allowing a single project policy to drive the dashboard.

### Configuration status

```powershell
python src\configure_project.py show
```

This reports facility-target configuration, collector attribution coverage and available return-window options without exposing participant data.


## Native Firebase dashboard deployment

The production user-facing Physio-HeMAB WP2 dashboard is a native Firebase dashboard rather than a Power BI embed.

This preserves the existing NHRC Firebase login as the only user authentication step. Power BI authentication is not required.

Because the Firebase project is being used without billing, the production path does **not** use Cloud Functions or Secret Manager. REDCap remains local to the trusted sync workstation and only a privacy-minimised dashboard snapshot is published to the existing Firestore project document.

### Production flow

```text
Local trusted workstation
        ↓
REDCap PID 410 + PID 411
        ↓
privacy-minimised local sync
        ↓
PostgreSQL reporting views
        ↓
publish_firestore.py
        ↓
Firestore projects/physio-hemab-wp2.wp2Snapshot
        ↓
NHRC Firebase login
        ↓
native Physio-HeMAB dashboard
```

The browser never receives REDCap API tokens or PostgreSQL credentials.

The published snapshot excludes participant name, date of birth, telephone number, address and unrelated clinical variables.

### One-time local Firebase publisher credential

The local publisher uses a Firebase/Google service-account JSON credential stored only on the trusted sync workstation.

Keep the file outside Git or use a Git-ignored filename such as:

```text
D:\Git\nhrc-dashboard\serviceAccountKey.json
```

Then add the local path to the ignored `.env`:

```text
PHYSIO_HEMAB_FIREBASE_CREDENTIALS_FILE=D:\Git\nhrc-dashboard\serviceAccountKey.json
PHYSIO_HEMAB_FIREBASE_PROJECT_ID=nhrc-dashboard
```

Do not commit the credential file.

### Deploy

After the one-time Firebase publisher credential is available:

```powershell
cd D:\Git\nhrc-dashboard
git pull --ff-only origin feature/physio-hemab-wp2
.\integrations\physio-hemab-wp2\scripts\deploy-native-dashboard.ps1
```

The combined deployment script:

1. validates the WP2 integration;
2. installs Python dependencies;
3. starts/upgrades the local PostgreSQL reporting layer;
4. synchronizes both REDCap projects locally;
5. publishes the privacy-minimised snapshot to Firestore;
6. regenerates the versioned site index;
7. deploys Firebase Hosting only.

No Cloud Functions or Secret Manager deployment is required.

### Routine data refresh

After the site has been deployed, update the live dashboard without redeploying Hosting:

```powershell
cd D:\Git\nhrc-dashboard\integrations\physio-hemab-wp2
.\scripts\sync-and-publish.ps1
```

This refreshes REDCap locally and updates the Firestore snapshot. The dashboard then reads the newest snapshot through the already authenticated Firestore client.

### Native dashboard capabilities

The native dashboard includes:

- Overview
- Recruitment
- Forms & Completion
- Activity Diary
- Devices
- Data Quality & Follow-up
- Sync Status
- Performance & Targets
- synchronized Facility, Data Collector and date filters
- chart-click cross-filtering
- row-click cross-filtering
- weekly/cumulative recruitment
- form completion by facility
- weekly device distribution vs return
- selectable device return-window scenarios
- REDCap data freshness and source status
- data-collector performance
- target-configuration gap protection
- administrator configuration for approved targets and return policy

The dashboard intentionally does not guess the named-facility 60/40/60/40 target mapping. Administrators can enter the approved mapping from the Performance & Targets page when it is known.

The Power BI report can remain as a private analytical/design copy, but it is not required for end-user dashboard access.



### Five-minute automatic refresh

The production refresh model is near-real-time on the free Firebase setup:

```text
Windows Scheduled Task every 5 minutes
        ↓
sync-and-publish.ps1
        ↓
REDCap PID 410 + PID 411
        ↓
local PostgreSQL reporting views
        ↓
Firestore wp2Snapshot
        ↓
Firestore onSnapshot listener
        ↓
open dashboard re-renders automatically
```

Install or refresh the Windows task with:

```powershell
cd D:\Git\nhrc-dashboard
.\integrations\physio-hemab-wp2\scripts\install-auto-refresh-task.ps1
```

The task is named:

```text
NHRC Physio-HeMAB WP2 - 5 Minute Sync
```

It runs every five minutes while the Windows user is signed in, including while the workstation is locked. The sync runner uses a named mutex and the Scheduled Task is configured to ignore overlapping instances.

The live dashboard uses a Firestore `onSnapshot` listener. When a new snapshot is published, users who already have the dashboard open receive the update automatically without refreshing the browser.

Automatic refresh therefore depends on:

- this Windows workstation being powered on;
- the Windows user session remaining signed in;
- Docker Desktop/PostgreSQL being available;
- internet access to REDCap and Firebase.

A local status log is written to:

```text
D:\Git\nhrc-dashboard\logs\physio-hemab-wp2-auto-sync.log
```

### Toggle filtering

Interactive charts and tables use true toggle semantics:

- click a chart bar once to apply its filter;
- click the same bar again to remove that filter;
- click a table row once to apply its represented Facility/Data Collector filters;
- click the same row again to remove them;
- click an active filter chip to remove only that filter;
- use **Clear filters** to remove all Facility, Data Collector and date filters.

Filter comparisons are normalized so harmless whitespace or case differences do not prevent repeat-click removal.
