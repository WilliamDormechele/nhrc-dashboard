"""Resolve dashboard-only fields against REDCap metadata, never guess choice codes."""
import re

OPTIONAL_DIARY_FIELDS = {
    "ad_call_number", "ad_call_numb", "ad_dc_interview",
    "call_date", "call_date_delay",
}


def metadata_fields(metadata):
    return {str(m.get("field_name", "")).strip(): m for m in metadata if m.get("field_name")}


def choice_map(field):
    result = {}
    for item in str(field.get("select_choices_or_calculations") or "").split("|"):
        if "," in item:
            code, label = item.split(",", 1)
            result[code.strip()] = label.strip()
    return result


def select_fields(project, expected, metadata):
    fields = metadata_fields(metadata)
    forms = {m.get("form_name") for m in metadata}
    selected = []
    missing = []
    for name in expected:
        present = name in fields or (name.endswith("_complete") and name[:-9] in forms)
        if present:
            selected.append(name)
        elif project != "main" or name not in OPTIONAL_DIARY_FIELDS:
            missing.append(name)
    if missing:
        raise RuntimeError("Required REDCap dashboard fields missing: " + ", ".join(missing))
    if project == "main" and not ({"ad_call_number", "ad_call_numb"} & set(selected)):
        raise RuntimeError("Activity Diary call-attempt field not found in REDCap metadata.")
    return selected


def decode_choice(row, name, field):
    """Return (answered, label). Blank and ambiguous choices are not zero."""
    if not field:
        return False, None
    choices = choice_map(field)
    if field.get("field_type") == "checkbox":
        codes = [k for k in choices if str(row.get(name+"___"+k, "")) == "1"]
        return bool(codes), choices[codes[0]] if len(codes) == 1 else None
    raw = row.get(name)
    if raw is None or str(raw).strip() == "":
        return False, None
    raw = str(raw).strip()
    if choices:
        return True, choices.get(raw)
    if field.get("field_type") == "yesno":
        return True, {"0": "No", "1": "Yes"}.get(raw)
    return True, raw if field.get("field_type") == "text" else None


def diary_metrics(row, fields):
    count = None
    for name in ("ad_call_number", "ad_call_numb"):
        answered, label = decode_choice(row, name, fields.get(name))
        if answered:
            match = re.fullmatch(r"\s*(\d+)\s*(?:calls?|attempts?|times?)?\s*", label or "", re.I)
            count = int(match.group(1)) if match else None
            break
    _, interview_type = decode_choice(row, "ad_dc_interview", fields.get("ad_dc_interview"))
    return {"dashboard_calls_made": count, "dashboard_interview_type": interview_type}


def validate_project_identity(data, expected_pid, expected_title):
    if isinstance(data, list) and len(data) == 1:
        data = data[0]
    if not isinstance(data, dict) or str(data.get("project_id", "")) != str(expected_pid):
        raise RuntimeError(f"REDCap project identity mismatch; expected PID {expected_pid}.")
    if str(data.get("project_title", "")).strip().casefold() != expected_title.strip().casefold():
        raise RuntimeError(f"REDCap project title mismatch for PID {expected_pid}.")
    production = data.get("in_production")
    if production is not None and str(production).lower() not in {"1", "true"}:
        raise RuntimeError(f"REDCap PID {expected_pid} is not in production mode.")
