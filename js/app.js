// js/app.js

window.currentUserProfile = null;
window.currentProjectCode = null;

window.currentUserDocUnsubscribe = null;

function stopWatchingCurrentUserProfile() {
  if (typeof window.currentUserDocUnsubscribe === "function") {
    window.currentUserDocUnsubscribe();
    window.currentUserDocUnsubscribe = null;
  }
}

function watchCurrentUserProfile(uid) {
  stopWatchingCurrentUserProfile();

  window.currentUserDocUnsubscribe = db.collection("users").doc(uid).onSnapshot(async (snapshot) => {
    if (!snapshot.exists) {
      alert("Your account record was removed. You will now be signed out.");
      stopWatchingCurrentUserProfile();
      stopIdleTracking();
      await auth.signOut();
      return;
    }

    const data = snapshot.data() || {};
    const inactive = data.isActive === false;
    const deleted = data.isDeleted === true;

    if (inactive || deleted) {
      alert("Your access has been disabled. Please contact the administrator.");
      stopWatchingCurrentUserProfile();
      stopIdleTracking();
      await auth.signOut();
      return;
    }

    // Force logout if role changes during active session
    if (
      window.currentUserProfile &&
      window.currentUserProfile.role &&
      data.role &&
      window.currentUserProfile.role !== data.role
    ) {
      alert("Your role has changed. Please sign in again to continue with updated access.");
      stopWatchingCurrentUserProfile();
      stopIdleTracking();
      await auth.signOut();
      return;
    }

    // Optional: also force logout if assigned projects change
    const oldProjects = Array.isArray(window.currentUserProfile?.assignedProjects)
      ? [...window.currentUserProfile.assignedProjects].sort()
      : [];
    const newProjects = Array.isArray(data.assignedProjects)
      ? [...data.assignedProjects].sort()
      : [];

    if (JSON.stringify(oldProjects) !== JSON.stringify(newProjects)) {
      alert("Your project access has changed. Please sign in again to continue with updated access.");
      stopWatchingCurrentUserProfile();
      stopIdleTracking();
      await auth.signOut();
      return;
    }
  }, (error) => {
    console.error("User profile watch error:", error);
  });
}

const authContainer = document.getElementById("auth-container");
const appContainer = document.getElementById("app-container");
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");
const roleDisplay = document.getElementById("roleDisplay");
const nameDisplay = document.getElementById("nameDisplay");
const projectSelect = document.getElementById("projectSelect");
const systemInfoBar = document.getElementById("systemInfoBar");

/**
 * Helper to show or hide elements.
 */
function setVisibleIf(elementId, shouldShow) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.toggle("hidden", !shouldShow);
}

/**
 * Apply tab visibility and download visibility based on role.
 */
function applyRoleVisibility(role) {
  const permissions = getPermissions(role);

  setVisibleIf("reportsTabBtn", permissions.canViewReports);
  setVisibleIf("queriesTabBtn", permissions.canViewQueries);
  setVisibleIf("monitoringTabBtn", permissions.canMonitorUsers);
  setVisibleIf("adminTabBtn", permissions.canManageUsers || permissions.canManageProjects);

  setVisibleIf("downloadPdfBtn", permissions.canDownloadReports);
  setVisibleIf("downloadPptBtn", permissions.canDownloadReports);
}

/**
 * Activate one tab and deactivate others.
 */
function activateTab(tabId, clickedButton) {
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });

  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.remove("active");
  });

  document.getElementById(tabId).classList.add("active");
  clickedButton.classList.add("active");
}

/**
 * Set up all tab switching.
 */
function setupTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", async function () {
      const targetTab = this.dataset.tab;

      activateTab(targetTab, this);
      await switchTrackedTab(targetTab);

      // Lazy load admin and monitoring content only when needed
      if (targetTab === "tab-monitoring" && getPermissions(window.currentUserProfile.role).canMonitorUsers) {
        await loadMonitoringData();
      }

      if (
        targetTab === "tab-admin" &&
        (getPermissions(window.currentUserProfile.role).canManageUsers ||
          getPermissions(window.currentUserProfile.role).canManageProjects)
      ) {
        if (typeof window.renderProjectCheckboxesForAdmin === "function") {
          window.renderProjectCheckboxesForAdmin([]);
        }

        if (typeof window.loadSupervisorOptions === "function") {
          await window.loadSupervisorOptions("");
        }

        if (typeof window.updateSupervisorFieldVisibility === "function") {
          window.updateSupervisorFieldVisibility();
        }

        if (typeof window.loadMonitoringDirectorySyncStatus === "function") {
          await window.loadMonitoringDirectorySyncStatus();
        }

        if (typeof window.loadUsersForAdmin === "function") {
          await window.loadUsersForAdmin();
        }

        if (typeof window.loadProjectsForAdmin === "function") {
          await window.loadProjectsForAdmin();
        }
      }
    });
  });
}

/**
 * Project dropdown change handler.
 */
function setupProjectChange() {
  projectSelect.addEventListener("change", function () {
    loadProject(this.value);
  });
}

/**
 * Track dashboard file downloads.
 */
function setupDownloadTracking() {
  document.getElementById("downloadPdfBtn").addEventListener("click", async function (e) {
    const permissions = getPermissions(window.currentUserProfile.role);

    if (!permissions.canDownloadReports) {
      e.preventDefault();
      alert("You do not have permission to download dashboard files.");
      return;
    }

    await logActivity("download_dashboard_pdf", {
      page: "dashboard",
      target: this.href
    });
  });

  document.getElementById("downloadPptBtn").addEventListener("click", async function (e) {
    const permissions = getPermissions(window.currentUserProfile.role);

    if (!permissions.canDownloadReports) {
      e.preventDefault();
      alert("You do not have permission to download dashboard files.");
      return;
    }

    await logActivity("download_dashboard_ppt", {
      page: "dashboard",
      target: this.href
    });
  });
}

/**
 * Show the logged-in application area.
 */
function showApp(profile) {
  authContainer.style.display = "none";
  appContainer.style.display = "block";
  logoutBtn.style.display = "inline-block";

  userEmailDisplay.textContent = profile.email;
  roleDisplay.value = profile.role || "";
  nameDisplay.value = profile.fullName || "";

  systemInfoBar.textContent = `Signed in as ${profile.fullName || profile.email} • Role: ${profile.role}`;
}

/**
 * Show the login area.
 */
function showLogin() {
  authContainer.style.display = "block";
  appContainer.style.display = "none";
  logoutBtn.style.display = "none";
  userEmailDisplay.textContent = "Not signed in";
  systemInfoBar.textContent = "Secure access enabled. Please sign in.";
}

/**
 * Auth state listener.
 */
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    stopWatchingCurrentUserProfile();
    stopIdleTracking();
    window.currentUserProfile = null;
    window.currentProjectCode = null;
    showLogin();
    return;
  }

  try {
    const profile = await fetchUserProfile(user.uid);

    if (!profile.isActive) {
      alert("Your account has been deactivated. Please contact the administrator.");
      await auth.signOut();
      return;
    }

    if (!Array.isArray(profile.assignedProjects) || profile.assignedProjects.length === 0) {
      alert("No project has been assigned to your account yet.");
      await auth.signOut();
      return;
    }

    window.currentUserProfile = profile;
    setupIdleTracking();
    resetIdleTimer();
    watchCurrentUserProfile(user.uid);
    console.log("Logged in profile:", profile);

    // Load projects from Firestore first, fallback to local config if Firestore is empty
    await loadProjectsRegistry();

    showApp(profile);
    applyRoleVisibility(profile.role);

    populateProjectSelect(profile.assignedProjects);

    const firstProject = profile.assignedProjects.find((code) => window.projectRegistry[code]);
    if (!firstProject) {
      alert("None of your assigned projects are currently configured.");
      await auth.signOut();
      return;
    }

    projectSelect.value = firstProject;
    loadProject(firstProject);

    await logActivity("login", {
      page: "login"
    });

    startTabTimer("tab-dashboard");

    // Prepare monitoring widgets only if allowed.
    // Admin widgets should be loaded only when the Admin tab is opened.
    const permissions = getPermissions(profile.role);

    if (permissions.canMonitorUsers) {
      await loadMonitoringData();
    }

  } catch (error) {
    console.error(error);
    alert(error.message);
    await auth.signOut();
  }
});

/**
 * Run all UI setup once the page is ready.
 */
window.addEventListener("DOMContentLoaded", function () {
  setupAuthUI();
  setupTabs();
  setupProjectChange();
  setupDownloadTracking();
  setupAdminUI();
  setupMonitoringUI();
});