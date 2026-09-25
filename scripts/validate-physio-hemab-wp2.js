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
    schema.includes("source_project"),
  "Physio-HeMAB WP2 two-project PostgreSQL schema is missing."
);

console.log("Physio-HeMAB WP2 structural validation passed.");
