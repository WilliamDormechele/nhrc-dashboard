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
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.field_worker;
}