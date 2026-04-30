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

  // 🔹 New roles (same as field_headquarters / project_manager)
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

function getPermissions(role) {
  const base = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.field_worker;
  return {
    canViewChat: true,
    ...base
  };
}