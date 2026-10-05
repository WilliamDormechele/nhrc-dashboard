const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const projectConfig = read("public/data/project-config.js");
const projectsJs = read("public/js/projects.js");
const wp2Html = read("public/projects/physio-hemab-wp2/index.html");
const envTemplate = read("integrations/physio-hemab-wp2/config.example.env");
const mainFieldMap = read("integrations/physio-hemab-wp2/field-map.main.json");
const devicesFieldMap = read("integrations/physio-hemab-wp2/field-map.devices.json");
const schema = read("integrations/physio-hemab-wp2/sql/schema.sql");
const views = read("integrations/physio-hemab-wp2/sql/views.sql");
const syncPy = read("integrations/physio-hemab-wp2/src/sync.py");
const compose = read("integrations/physio-hemab-wp2/compose.yaml");

[
  "hemab:",
  "hdss:",
  "brave:"
].forEach((existingProject) => {
  assert(
    projectConfig.includes(existingProject),
    `Existing project configuration missing: ${existingProject}`
  );
});

assert(
  projectConfig.includes('"physio-hemab-wp2"'),
  "Physio-HeMAB WP2 project configuration is missing."
);

assert(
  projectConfig.includes('dashboardEmbedUrl: "projects/physio-hemab-wp2/index.html"'),
  "Physio-HeMAB WP2 dashboard shell is not configured."
);

assert(
  projectsJs.includes('const LOCAL_PROJECT_CODES = ["physio-hemab-wp2"]'),
  "Physio-HeMAB WP2 safe local project exposure is missing."
);

assert(
  wp2Html.includes("Participant target") && wp2Html.includes(">200<"),
  "Physio-HeMAB WP2 recruitment target is missing from the shell."
);

[
  "PHYSIO_HEMAB_MAIN_REDCAP_API_URL=",
  "PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN=",
  "PHYSIO_HEMAB_DEVICES_REDCAP_API_URL=",
  "PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN=",
  "PHYSIO_HEMAB_DB_HOST=",
  "PHYSIO_HEMAB_DB_PASSWORD="
].forEach((name) => {
  assert(envTemplate.includes(name), `Environment template missing: ${name}`);
});

assert(
  mainFieldMap.includes('"pid": 410') &&
    mainFieldMap.includes('"health_facility_enrollment"') &&
    mainFieldMap.includes('"ad_call_numb"'),
  "Main REDCap field mapping is incomplete."
);

assert(
  devicesFieldMap.includes('"pid": 411') &&
    devicesFieldMap.includes('"devices_date"') &&
    devicesFieldMap.includes('"devices_return"'),
  "Devices REDCap field mapping is incomplete."
);

assert(
  schema.includes("CREATE SCHEMA IF NOT EXISTS physio_hemab_wp2") &&
    schema.includes("redcap_metadata") &&
    schema.includes("is_active"),
  "Physio-HeMAB WP2 PostgreSQL schema is incomplete."
);

[
  "vw_participants",
  "vw_activity_diaries",
  "vw_recruitment_by_facility",
  "vw_form_completion",
  "vw_device_distributions",
  "vw_device_returns",
  "vw_device_set_status",
  "vw_sync_status",
  "vw_overview_metrics"
].forEach((viewName) => {
  assert(views.includes(viewName), `Reporting view missing: ${viewName}`);
});

assert(
  syncPy.includes("MAIN_DASHBOARD_FIELDS") &&
    syncPy.includes("DEVICE_DASHBOARD_FIELDS") &&
    syncPy.includes("minimize_record"),
  "REDCap data minimisation is missing from the synchronizer."
);

[
  "enroll_name",
  "enroll_birthday",
  "enroll_tel",
  "enroll_address"
].forEach((sensitiveField) => {
  assert(
    !syncPy.includes('"' + sensitiveField + '"'),
    `Sensitive participant field must not be synchronized: ${sensitiveField}`
  );
});

assert(
  compose.includes("postgres:16-alpine") &&
    compose.includes("physio-hemab-wp2-postgres"),
  "Local PostgreSQL service configuration is missing."
);

console.log("Physio-HeMAB WP2 structural validation passed.");
