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
const auth = read("public/js/auth.js");
const ui = read("public/js/ui.js");
const projects = read("public/js/projects.js");
const admin = read("public/js/admin.js");
const monitoring = read("public/js/monitoring.js");
const styles = read("public/css/styles.css");
const permissions = read("public/js/permissions.js");
const roleAccess = read("public/js/role-access.js");
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
  template.includes('<option value="" selected disabled>Select a project</option>') &&
    projects.includes('placeholder.textContent = "Select a project"') &&
    projects.includes("clearProjectSelectionView") &&
    app.includes('projectSelect.value = ""') &&
    app.includes('Welcome, ${displayName}'),
  "Explicit project-selection or welcome-name behavior is incomplete."
);

assert(
  template.includes('id="appBootOverlay"') &&
    template.includes('class="app-boot-spinner"') &&
    template.includes('id="auth-container" class="auth-container" style="display:none;"') &&
    !template.includes('id="systemInfoBar"') &&
    styles.includes(".app-boot-overlay") &&
    styles.includes("@keyframes nhrcSpin"),
  "Refresh-safe loading experience is incomplete."
);

assert(
  !template.includes("Getting Started") &&
    !template.includes("Sign in using your assigned account") &&
    !template.includes("Access your allocated projects and reports") &&
    template.includes("Email (Enter your email address)") &&
    !template.includes("Email (Enter your NHRC email and password)"),
  "Simplified sign-in copy is incomplete."
);

assert(
  styles.includes("#app-container.app-container") &&
    styles.includes("background: linear-gradient(180deg, #162a3a 0%, #112331 100%)") &&
    styles.includes("border-radius: 0;") &&
    styles.includes("#app-container + .footer") &&
    ui.includes("--nhrc-topbar-height"),
  "Integrated full-height side navigation is incomplete."
);

assert(
  projects.includes("enableNativeDashboardAutoHeight") &&
    projects.includes("ResizeObserver") &&
    projects.includes('dashboardFrameWrap.style.height = isNativeDashboard ? "auto" : ""') &&
    !projects.includes('dashboardFrameWrap.style.height = isNativeDashboard ? "88vh" : ""') &&
    projects.includes("native-dashboard-shell") &&
    styles.includes(".native-dashboard-container") &&
    styles.includes("#tab-dashboard.native-dashboard-shell"),
  "Native dashboard long-page flow is incomplete."
);

assert(
  template.includes('id="workspaceShell" class="workspace-shell"') &&
    template.includes('id="appSidebar" class="app-sidebar"') &&
    template.includes('id="sidebarToggleBtn"') &&
    template.includes('id="mobileSidebarBtn"') &&
    template.includes('class="project-switcher"') &&
    !template.includes('id="roleDisplay"') &&
    !template.includes('id="nameDisplay"') &&
    styles.includes(".workspace-shell.sidebar-collapsed") &&
    ui.includes("nhrcSidebarCollapsed"),
  "Executive side navigation or project workspace selector is incomplete."
);

assert(
  template.includes('src="js/ui.js?v=__APP_VERSION__"') &&
    auth.includes('setButtonBusy(loginBtn, true, "Signing in")') &&
    auth.includes('title: "Signing you in"') &&
    auth.includes('"Sign in unsuccessful"') &&
    app.includes('title: "Signing you out"') &&
    app.includes('"Signed out"') &&
    app.includes('window.NHRCUI?.setupSidebar()') &&
    styles.includes("#loginBtn:not(:disabled):hover") &&
    styles.includes(".swal2-popup.nhrc-toast"),
  "Sign in, sign out, hover or toast experience is incomplete."
);

assert(
  app.includes('Welcome, ${displayName} (${roleLabel})') &&
    ui.includes('project_pi: "Project PI"') &&
    ui.includes('.split("_")'),
  "Role presentation in the welcome greeting is incomplete."
);

assert(
  template.includes('src="js/role-access.js?v=__APP_VERSION__"') &&
    template.indexOf('src="js/role-access.js?v=__APP_VERSION__"') >
      template.indexOf('src="js/app.js?v=__APP_VERSION__"') &&
    roleAccess.includes("Role Access Matrix") &&
    roleAccess.includes("applyMatrixToUsers") &&
    roleAccess.includes("workspaceAccessNotice") &&
    roleAccess.includes("roleAccessUpdatedAt") &&
    admin.includes("window.RoleAccessAdmin?.matrixForRole(role)") &&
    worker.includes("roleAccess?.admin === true") &&
    styles.includes(".role-access-panel"),
  "Role access matrix integration is incomplete."
);

assert(
  template.includes('id="chatTabBtn" style="display:none;" aria-hidden="true"') &&
    template.includes('id="tab-chat" class="tab-content panel chat-tab-panel" style="display:none;" aria-hidden="true"') &&
    !template.includes('src="js/chat.js') &&
    permissions.includes("canViewChat: false"),
  "Live chat is not fully disabled."
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
    template.includes("Trend series") &&
    template.includes("All users — aggregate") &&
    monitoring.includes("MONITORING_TREND_COLOR") &&
    monitoring.includes("getMonitoringTrendSelection") &&
    monitoring.includes("executiveTrendOptions") &&
    monitoring.includes("Aggregate view across all users") &&
    monitoring.includes("Aggregate unique users active each day") &&
    !monitoring.includes("Top 6 active users") &&
    !monitoring.includes("monitoringTrendLegendOptions"),
  "Strategic Oversight executive trend filtering is incomplete."
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
    worker.includes("firebaseAdminConfigured") &&
    worker.includes("emailConfigured") &&
    worker.includes("safePatchMonitoringDirectory") &&
    worker.includes("timestampValue") &&
    workerConfig.includes('name = "nhrc-admin-ops"'),
  "Admin Worker security/email configuration is incomplete."
);

assert(
  workerDeploy.includes("FIREBASE_SERVICE_ACCOUNT_JSON") &&
    workerDeploy.includes("RESEND_API_KEY") &&
    workerDeploy.includes("Read-DotEnv") &&
    workerDeploy.includes("firebaseAdminConfigured") &&
    workerDeploy.includes("emailConfigured") &&
    workerDeploy.includes('wrangler@latest') &&
    workerDeploy.includes('"deploy", "--config"'),
  "Admin Worker deployment helper is incomplete."
);

console.log("NHRC dashboard core validation passed.");
