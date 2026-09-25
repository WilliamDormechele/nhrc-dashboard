# Physio-HeMAB WP2 integration

This directory contains the first safe integration layer for the Physio-HeMAB Work Package 2 dashboard.

## Current state

The existing NHRC Projects Dashboard remains unchanged on `main`. All WP2 work is isolated on the feature branch.

Implemented foundation:

- Physio-HeMAB WP2 project entry and dashboard shell
- REDCap API client
- PostgreSQL staging and synchronization schema
- synchronization audit table
- raw REDCap record staging with deterministic update detection
- REDCap metadata inspection utility
- field-mapping template for the agreed KPMs
- environment variable template containing names only

No real REDCap token, database password, participant data or Power BI credential is stored in GitHub.

## Planned data flow

```text
Physio-HeMAB REDCap
        |
        v
Python synchronization
        |
        v
PostgreSQL
        |
        v
Power BI
        |
        v
NHRC Projects Dashboard
```

## Before the first live connection

1. Confirm the Physio-HeMAB REDCap API URL.
2. Create or obtain a REDCap API token with the minimum required rights.
3. Confirm the REDCap record ID field.
4. Run `inspect_metadata.py` and review field names before exporting participant records.
5. Complete `field-map.example.json` using the actual REDCap field names.
6. Confirm where the PostgreSQL database will run.
7. Apply `sql/schema.sql` to the approved database.
8. Confirm whether device distribution/return information is in REDCap or another approved source.
9. Confirm the source for activity diary phone call counts.
10. Build the Power BI model only after the field mapping is verified.

## Local setup

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Add the environment variable names from `config.example.env` to the repository's existing local environment configuration and supply the real values locally. Do not commit the resulting environment file.

### Inspect REDCap metadata

This command requests metadata only. It does not print participant records.

```powershell
python src\inspect_metadata.py
```

### Create the PostgreSQL objects

Run the statements in:

```text
sql/schema.sql
```

against the approved PostgreSQL database.

### Run a synchronization

Only run this after the record ID field and database configuration have been verified.

```powershell
python src\sync.py
```

The synchronizer records each run in `physio_hemab_wp2.sync_runs` and upserts REDCap rows into `physio_hemab_wp2.raw_records`.

## KPMs to implement after field mapping

### Recruitment

- participants enrolled
- enrolled by facility
- enrolled by data collector
- weekly enrolment
- cumulative enrolment
- progress against facility and overall targets

Current agreed recruitment targets:

| Facility | Target |
| --- | ---: |
| Intervention Hospital | 60 |
| Intervention Center | 40 |
| Control Hospital | 60 |
| Control Center | 40 |
| **Total** | **200** |

### Forms

- Enrollment Form completion
- Maternal Record Book completion
- Physical Examination / Physicians Form completion

### Activity diary

- calls made
- expected diaries
- diaries completed on the expected date
- diaries completed late
- days late
- missing diaries
- performance by data collector
- performance by facility

### Devices

- device ID
- distribution date
- facility
- participant
- expected return date
- actual return date
- returned / not returned
- overdue devices

### Data quality

- missing required forms
- late forms
- incomplete records
- duplicate or inconsistent records
- records requiring follow-up

## Security

The dashboard repository is public. Never commit:

- REDCap API tokens
- participant-level exports
- database credentials
- Power BI credentials
- Firebase service-account files
- private keys

Participant-level data must remain in the approved research infrastructure. Only approved aggregate outputs should be exposed through public web hosting.
