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
const wp2DashboardJs = read("public/projects/physio-hemab-wp2/dashboard.js");
const wp2Styles = read("public/projects/physio-hemab-wp2/styles.css");
const firebaseConfigJs = read("public/js/firebase-config.js");
const nativeDeployScript = read("integrations/physio-hemab-wp2/scripts/deploy-native-dashboard.ps1");
const snapshotPublisher = read("integrations/physio-hemab-wp2/src/publish_firestore.py");
const syncPublishScript = read("integrations/physio-hemab-wp2/scripts/sync-and-publish.ps1");
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
  projectConfig.includes('dashboardMode: "native"'),
  "Physio-HeMAB WP2 must use the secure native dashboard mode."
);

[
  "Overview",
  "Recruitment",
  "Forms &amp; Completion",
  "Activity Diary",
  "Devices",
  "Data Quality",
  "Sync Status",
  "Performance &amp; Targets"
].forEach((sectionName) => {
  assert(
    wp2Html.includes(sectionName),
    `Native WP2 dashboard section missing: ${sectionName}`
  );
});

assert(
  wp2DashboardJs.includes("wp2Snapshot") &&
    wp2DashboardJs.includes("wp2Config") &&
    wp2DashboardJs.includes("setFacilityFilter") &&
    wp2DashboardJs.includes("setCollectorFilter") &&
    wp2DashboardJs.includes("returnWindowDays"),
  "Native WP2 dashboard interactions are incomplete."
);

assert(
  wp2Styles.includes("--navy: #17324d") &&
    wp2Styles.includes(".global-filters") &&
    wp2Styles.includes(".kpi-card.problem"),
  "Native WP2 executive styling is incomplete."
);

assert(
  firebaseConfigJs.includes("window.nhrcFirestore = db") &&
    wp2DashboardJs.includes("window.parent.nhrcFirestore"),
  "Same-origin authenticated Firestore bridge is missing."
);

assert(
  wp2DashboardJs.includes('collection("projects")') &&
    wp2DashboardJs.includes('doc("physio-hemab-wp2")') &&
    wp2DashboardJs.includes("wp2Snapshot"),
  "Native WP2 dashboard is not reading the project-scoped Firestore snapshot."
);

assert(
  snapshotPublisher.includes('PROJECT_CODE = "physio-hemab-wp2"') &&
    snapshotPublisher.includes("wp2Snapshot") &&
    snapshotPublisher.includes("MAX_SNAPSHOT_BYTES"),
  "Free-tier Firestore snapshot publisher is incomplete."
);

assert(
  nativeDeployScript.includes("src\\publish_firestore.py") &&
    !nativeDeployScript.includes("functions:secrets:set") &&
    !nativeDeployScript.includes("firebase deploy --only functions"),
  "Native deployment must use the free-tier Firestore snapshot path."
);

assert(
  syncPublishScript.includes("src\\sync.py") &&
    syncPublishScript.includes("src\\publish_firestore.py"),
  "Repeatable WP2 sync-and-publish script is incomplete."
);

[
  "enroll_name",
  "enroll_birthday",
  "enroll_tel",
  "enroll_address"
].forEach((sensitiveField) => {
  assert(
    !snapshotPublisher.includes('"' + sensitiveField + '"'),
    `Sensitive participant field must not be published to Firestore: ${sensitiveField}`
  );
});

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
  "vw_recruitment_trend",
  "vw_facility_target_attainment",
  "vw_core_form_completion_by_participant",
  "vw_form_completion_by_facility",
  "vw_device_weekly_flow",
  "vw_device_component_completeness",
  "vw_return_window_options",
  "vw_device_overdue_scenarios",
  "vw_data_freshness",
  "vw_data_collector_work",
  "vw_data_collector_performance",
  "vw_data_quality_issues",
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
