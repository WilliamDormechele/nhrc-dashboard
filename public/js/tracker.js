// js/tracker.js

let activeTabName = "tab-dashboard";
let tabStartTime = null;

/**
 * Write an activity log to Firestore.
 * This supports:
 * - login
 * - logout
 * - project_opened
 * - tab_opened
 * - download_dashboard_pdf
 * - download_dashboard_ppt
 * - download_report
 * - download_query
 * - tab_duration
 */
async function logActivity(action, extra = {}) {
  try {
    if (!window.currentUserProfile) return;

    await db.collection("activity_logs").add({
      uid: window.currentUserProfile.uid,
      fullName: window.currentUserProfile.fullName || "",
      email: window.currentUserProfile.email || "",
      role: window.currentUserProfile.role || "",
      assignedProjects: window.currentUserProfile.assignedProjects || [],
      currentProject: window.currentProjectCode || null,

      action: action,
      page: extra.page || null,
      target: extra.target || null,
      durationSeconds: extra.durationSeconds || null,

      userAgent: navigator.userAgent,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}

/**
 * Start timing a tab.
 */
function startTabTimer(tabName) {
  activeTabName = tabName;
  tabStartTime = Date.now();
}

/**
 * End timing for current tab and save to Firestore.
 */
async function endTabTimer() {
  if (!tabStartTime || !window.currentUserProfile) return;

  const durationSeconds = Math.round((Date.now() - tabStartTime) / 1000);

  await logActivity("tab_duration", {
    page: activeTabName,
    durationSeconds
  });

  tabStartTime = Date.now();
}

/**
 * Safe helper to register tab switching.
 */
async function switchTrackedTab(newTabName) {
  await endTabTimer();
  startTabTimer(newTabName);

  await logActivity("tab_opened", {
    page: newTabName
  });
}