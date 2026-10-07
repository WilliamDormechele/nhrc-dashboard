// js/permissions.js

const ROLE_PERMISSIONS = {
  field_worker: {
    canViewDashboard: true,
    canViewReports: false,
    canDownloadReports: false,
    canViewQueries: false,
    canMonitorUsers: false,
    canManageUsers: false,
    canManageProjects: false
  },

  field_supervisor: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: false,
    canManageUsers: false,
    canManageProjects: false
  },

  field_headquarters: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  director: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  project_pi: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  local_principal_investigator: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  head_of_department: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  project_manager: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  project_coordinator: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  data_collector: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: false,
    canManageProjects: false
  },

  administrator: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: true,
    canManageProjects: true
  },

  developer: {
    canViewDashboard: true,
    canViewReports: true,
    canDownloadReports: true,
    canViewQueries: true,
    canMonitorUsers: true,
    canManageUsers: true,
    canManageProjects: true
  }
};

const ROLE_ACCESS_ROLES = [
  { key: "field_worker", label: "Field Worker" },
  { key: "field_supervisor", label: "Field Supervisor" },
  { key: "field_headquarters", label: "Field Headquarters" },
  { key: "data_collector", label: "Data Collector" },
  { key: "project_coordinator", label: "Project Coordinator" },
  { key: "project_manager", label: "Project Manager" },
  { key: "project_pi", label: "Project PI" },
  { key: "local_principal_investigator", label: "Local Principal Investigator" },
  { key: "head_of_department", label: "Head of Department" },
  { key: "director", label: "Director" },
  { key: "administrator", label: "Administrator", protected: true },
  { key: "developer", label: "Developer", protected: true }
];

const ROLE_ACCESS_FEATURES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "reports", label: "Reports" },
  { key: "queries", label: "Data Queries" },
  { key: "monitoring", label: "Strategic Oversight" },
  { key: "admin", label: "Admin" }
];

const ROLE_ACCESS_ENDPOINT =
  "https://nhrc-admin-ops.nhrc-dashboard-wp2.workers.dev";

let rolePermissionOverrides = {};
let roleAccessLoaded = false;

function roleAccessFromPermissionObject(permission = {}) {
  return {
    dashboard: permission.canViewDashboard === true,
    reports: permission.canViewReports === true,
    queries: permission.canViewQueries === true,
    monitoring: permission.canMonitorUsers === true,
    admin:
      permission.canManageUsers === true ||
      permission.canManageProjects === true
  };
}

function normalizeRoleAccessRow(value = {}) {
  return {
    dashboard: value?.dashboard === true,
    reports: value?.reports === true,
    queries: value?.queries === true,
    monitoring: value?.monitoring === true,
    admin: value?.admin === true
  };
}

function getDefaultRoleAccessMatrix() {
  const matrix = {};

  ROLE_ACCESS_ROLES.forEach(({ key }) => {
    matrix[key] = roleAccessFromPermissionObject(
      ROLE_PERMISSIONS[key] || ROLE_PERMISSIONS.field_worker
    );
  });

  return matrix;
}

function getRoleAccessMatrix() {
  const matrix = {};

  ROLE_ACCESS_ROLES.forEach(({ key }) => {
    const base = roleAccessFromPermissionObject(
      ROLE_PERMISSIONS[key] || ROLE_PERMISSIONS.field_worker
    );

    const override = rolePermissionOverrides[key];

    matrix[key] = override
      ? { ...base, ...normalizeRoleAccessRow(override) }
      : base;

    if (key === "administrator" || key === "developer") {
      matrix[key] = {
        dashboard: true,
        reports: true,
        queries: true,
        monitoring: true,
        admin: true
      };
    }
  });

  return matrix;
}

function applyRoleAccessMatrix(matrix = {}) {
  const next = {};

  ROLE_ACCESS_ROLES.forEach(({ key }) => {
    if (key === "administrator" || key === "developer") return;
    if (!matrix || typeof matrix[key] !== "object") return;
    next[key] = normalizeRoleAccessRow(matrix[key]);
  });

  rolePermissionOverrides = next;
  roleAccessLoaded = true;
}

async function loadRoleAccessMatrix({ force = false } = {}) {
  if (roleAccessLoaded && !force) {
    return getRoleAccessMatrix();
  }

  const currentUser = auth?.currentUser;
  if (!currentUser) {
    rolePermissionOverrides = {};
    roleAccessLoaded = false;
    return getRoleAccessMatrix();
  }

  try {
    const idToken = await currentUser.getIdToken(force);

    const response = await fetch(`${ROLE_ACCESS_ENDPOINT}/role-access`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Role access service returned ${response.status}.`);
    }

    const payload = await response.json();
    applyRoleAccessMatrix(payload?.permissions || {});
  } catch (error) {
    console.warn(
      "Role access matrix could not be loaded; using built-in defaults.",
      error
    );
    rolePermissionOverrides = {};
    roleAccessLoaded = true;
  }

  return getRoleAccessMatrix();
}

function getPermissions(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const base = {
    ...(ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.field_worker)
  };

  if (
    normalizedRole !== "administrator" &&
    normalizedRole !== "developer"
  ) {
    const override = rolePermissionOverrides[normalizedRole];

    if (override) {
      const access = normalizeRoleAccessRow(override);
      base.canViewDashboard = access.dashboard;
      base.canViewReports = access.reports;
      base.canDownloadReports = access.reports;
      base.canViewQueries = access.queries;
      base.canMonitorUsers = access.monitoring;
      base.canManageUsers = access.admin;
      base.canManageProjects = access.admin;
    }
  }

  return {
    ...base,
    canViewChat: false
  };
}

window.ROLE_ACCESS_ROLES = ROLE_ACCESS_ROLES;
window.ROLE_ACCESS_FEATURES = ROLE_ACCESS_FEATURES;
window.getDefaultRoleAccessMatrix = getDefaultRoleAccessMatrix;
window.getRoleAccessMatrix = getRoleAccessMatrix;
window.applyRoleAccessMatrix = applyRoleAccessMatrix;
window.loadRoleAccessMatrix = loadRoleAccessMatrix;
