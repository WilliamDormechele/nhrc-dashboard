# Physio-HeMAB WP2 integration

This directory contains the integration layer for the Physio-HeMAB Work Package 2 dashboard.

## REDCap source projects

Physio-HeMAB WP2 uses two separate REDCap projects on the same REDCap server:

| Key | REDCap project | PID | Purpose |
| --- | --- | ---: | --- |
| `main` | HeMAB Ghana Main | 410 | Enrollment, Maternal Record Book, Physical Examination and Activity Diary |
| `devices` | HeMAB Ghana Devices | 411 | Device distribution and device return logs |

Both projects use the same REDCap API endpoint:

```text
https://redcap-test.uk-halle.de/redcap_v17.3.12/api/
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
PHYSIO_HEMAB_MAIN_REDCAP_API_URL=https://redcap-test.uk-halle.de/redcap_v17.3.12/api/
PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN=<PID 410 token>
PHYSIO_HEMAB_MAIN_REDCAP_RECORD_ID_FIELD=record_id

PHYSIO_HEMAB_DEVICES_REDCAP_API_URL=https://redcap-test.uk-halle.de/redcap_v17.3.12/api/
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

Apply:

```text
sql/schema.sql
```

to the approved PostgreSQL database.

The schema stores the two REDCap projects separately using `source_project`. This is necessary because both projects can use overlapping REDCap record IDs.

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

Do not run record synchronization until the API permissions, database location and field mapping have been verified.

## Security

This GitHub repository is public. Never commit:

- REDCap API tokens
- participant-level exports
- database passwords
- Power BI credentials
- Firebase service-account files
- private keys

Participant-level data must remain within the approved research infrastructure.
