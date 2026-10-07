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

const template = read("public/index.template.html");
const app = read("public/js/app.js");
const projects = read("public/js/projects.js");
const admin = read("public/js/admin.js");
const monitoring = read("public/js/monitoring.js");
const styles = read("public/css/styles.css");
const worker = read("integrations/admin-ops-worker/worker.js");
const workerConfig = read("integrations/admin-ops-worker/wrangler.toml");
const workerDeploy = read("integrations/admin-ops-worker/deploy.ps1");

assert(
  template.includes("Access to research projects, data, and insights") &&
    !template.includes("Secure access to research projects, data, and insights"),
  "Topbar subtitle was not updated."
);

assert(
  template.includes('class="topbar-user-greeting"') &&
    template.includes('class="btn btn-logout"') &&
    styles.includes(".btn-logout:hover"),
  "Professional user greeting/logout presentation is incomplete."
);

assert(
  projects.includes('placeholder.textContent = "Select a project"') &&
    projects.includes("clearProjectSelectionView") &&
    app.includes('projectSelect.value = ""') &&
    app.includes('Welcome, ${displayName}'),
  "Explicit project-selection or welcome-name behavior is incomplete."
);

[
  'callAdminOps("/users/set-active"',
  'callAdminOps("/users/soft-delete"',
  'callAdminOps("/users/restore"',
  'callAdminOps("/users/hard-delete"',
  'callAdminOps("/email/lifecycle"'
].forEach((needle) => {
  assert(admin.includes(needle), `Admin free-backend route missing: ${needle}`);
});

[
  'functions.httpsCallable("setUserActiveState")',
  'functions.httpsCallable("softDeleteUser")',
  'functions.httpsCallable("restoreDeletedUser")',
  'functions.httpsCallable("hardDeleteUser")',
  'functions.httpsCallable("sendUserLifecycleEmail")'
].forEach((needle) => {
  assert(!admin.includes(needle), `Paid Firebase callable dependency remains: ${needle}`);
});

assert(
  admin.includes("if (activeChanged)") &&
    admin.includes('userId: editingUserId') &&
    admin.includes("Updating access and notifying user"),
  "Edited-user activation state or lifecycle notification handling is incomplete."
);

assert(
  template.includes('id="monitoringTrendUserFilter"') &&
    monitoring.includes("MONITORING_TREND_COLORS") &&
    monitoring.includes("Top 6 active users") &&
    monitoring.includes("getMonitoringTrendUsers") &&
    monitoring.includes("monitoringTrendLegendOptions"),
  "Strategic Oversight professional trend filtering is incomplete."
);

[
  'url.pathname === "/users/set-active"',
  'url.pathname === "/users/soft-delete"',
  'url.pathname === "/users/restore"',
  'url.pathname === "/users/hard-delete"',
  'url.pathname === "/email/lifecycle"'
].forEach((needle) => {
  assert(worker.includes(needle), `Admin Worker endpoint missing: ${needle}`);
});

assert(
  worker.includes('["administrator", "developer"].includes(role)') &&
    worker.includes("FIREBASE_SERVICE_ACCOUNT_JSON") &&
    worker.includes("RESEND_API_KEY") &&
    worker.includes("timestampValue") &&
    workerConfig.includes('name = "nhrc-admin-ops"'),
  "Admin Worker security/email configuration is incomplete."
);

assert(
  workerDeploy.includes("FIREBASE_SERVICE_ACCOUNT_JSON") &&
    workerDeploy.includes("RESEND_API_KEY") &&
    workerDeploy.includes('wrangler@latest') &&
    workerDeploy.includes('"deploy", "--config"'),
  "Admin Worker deployment helper is incomplete."
);

console.log("NHRC dashboard core validation passed.");
