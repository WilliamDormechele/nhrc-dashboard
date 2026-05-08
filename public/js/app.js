// js/app.js
// re_j5Kdk8Vh_D2y45R9BqCzbdwk6mze31gfi

window.currentUserProfile = null;
window.currentProjectCode = null;
window.currentUserDocUnsubscribe = null;
window.suppressSelfAccessChangeLogout = false;

window.presenceUnloadBound = false;

async function setUserPresenceOnline(uid) {
  if (!uid) return;

  try {
    await db.collection("users").doc(uid).set({
      isOnline: true,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error("Failed to set presence online:", error);
  }
}

async function setUserPresenceOffline(uid) {
  if (!uid) return;

  try {
    await db.collection("users").doc(uid).set({
      isOnline: false,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error("Failed to set presence offline:", error);
  }
}

function bindPresenceUnload(uid) {
  if (!uid || window.presenceUnloadBound) return;

  const markOffline = () => {
    try {
      const data = JSON.stringify({
        isOnline: false,
        lastSeen: new Date().toISOString()
      });

      // Best-effort only; Firestore SDK is not reliable during unload
      navigator.sendBeacon?.("/__/noop-presence", data);
    } catch (error) {
      console.error("Presence unload beacon failed:", error);
    }
  };

  window.addEventListener("beforeunload", markOffline);
  window.addEventListener("pagehide", markOffline);
  window.presenceUnloadBound = true;
}

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
      await setUserPresenceOffline(uid);
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
      await setUserPresenceOffline(uid);
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
      await setUserPresenceOffline(uid);
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
      if (window.suppressSelfAccessChangeLogout === true) {
        window.currentUserProfile = {
          ...window.currentUserProfile,
          assignedProjects: newProjects
        };
        return;
      }

      alert("Your project access has changed. Please sign in again to continue with updated access.");
      stopWatchingCurrentUserProfile();
      stopIdleTracking();
      await setUserPresenceOffline(uid);
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

const getAssignmentOverviewCallable = functions.httpsCallable("getAssignmentOverview");

let assignmentOverviewCache = null;

function assignmentEscapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function assignmentSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function assignmentNormalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function assignmentRoleLabel(role = "") {
  const labels = {
    field_worker: "Field Worker",
    field_supervisor: "Field Supervisor",
    field_headquarters: "Field Headquarters",

    director: "Director",
    project_pi: "Project PI",
    local_principal_investigator: "Local Principal Investigator",
    head_of_department: "Head of Department",
    project_manager: "Project Manager",
    project_coordinator: "Project Coordinator",
    data_collector: "Data Collector",

    administrator: "Administrator",
    developer: "Developer"
  };
  return labels[role] || role || "User";
}

function assignmentBuildMetaPill(icon, text) {
  return `<span class="assignment-meta-pill"><i class="${icon}"></i>${assignmentEscapeHtml(text)}</span>`;
}

async function showDashboardRefreshNotice() {
  if (typeof Swal === "undefined") return;

  await Swal.fire({
    icon: "info",
    title: "Data refresh schedule",
    html: `
      <div class="assignment-notice-grid">
        <div class="assignment-notice-card">
          <strong>Reports and queries</strong>
          <div>Updated every 60 minutes.</div>
        </div>
        <div class="assignment-notice-card">
          <strong>Dashboard</strong>
          <div>Updated daily at 10:00 PM</div>
        </div>
      </div>
    `,
    confirmButtonText: "Close",
    timer: 9000,
    timerProgressBar: true,
    showCloseButton: true
  });
}

function getAssignmentFilterElements() {
  return {
    filtersRow: document.getElementById("assignmentOverviewFilters"),
    districtWrap: document.getElementById("assignmentDistrictFilterWrap"),
    district: document.getElementById("assignmentDistrictFilter"),
    supervisorWrap: document.getElementById("assignmentSupervisorFilterWrap"),
    supervisor: document.getElementById("assignmentSupervisorFilter"),
    workerSearchWrap: document.getElementById("assignmentWorkerSearchWrap"),
    workerSearch: document.getElementById("assignmentWorkerSearch"),
    clearActionsWrap: document.querySelector("#assignmentOverviewFilters .assignment-filter-actions"),
    clearBtn: document.getElementById("clearAssignmentFiltersBtn"),
    title: document.getElementById("assignmentOverviewTitle"),
    subtitle: document.getElementById("assignmentOverviewSubtitle"),
    meta: document.getElementById("assignmentOverviewMeta"),
    body: document.getElementById("assignmentOverviewBody"),
    toggleBtn: document.getElementById("assignmentOverviewToggleBtn"),
    toggleText: document.getElementById("assignmentOverviewToggleText"),
    toggleIcon: document.getElementById("assignmentOverviewToggleIcon"),
    content: document.getElementById("assignmentOverviewContent")
  };
}

let assignmentOverviewExpanded = false;

function setAssignmentOverviewExpanded(expanded) {
  const {
    toggleBtn,
    toggleText,
    content
  } = getAssignmentFilterElements();

  assignmentOverviewExpanded = !!expanded;

  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", assignmentOverviewExpanded ? "true" : "false");
    toggleBtn.classList.toggle("expanded", assignmentOverviewExpanded);
  }

  if (toggleText) {
    toggleText.textContent = assignmentOverviewExpanded ? "Hide Assignments" : "Show Assignments";
  }

  if (content) {
    content.classList.toggle("expanded", assignmentOverviewExpanded);
    content.classList.toggle("collapsed", !assignmentOverviewExpanded);
    content.setAttribute("aria-hidden", assignmentOverviewExpanded ? "false" : "true");
  }
}

function setupAssignmentOverviewToggle() {
  const { toggleBtn } = getAssignmentFilterElements();
  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    setAssignmentOverviewExpanded(!assignmentOverviewExpanded);
  });

  setAssignmentOverviewExpanded(false);
}

function setAssignmentOverviewLoading(message = "Loading assignment overview...") {
  const { title, subtitle, meta, body } = getAssignmentFilterElements();

  if (title) title.textContent = "Team Assignment Overview";
  if (subtitle) subtitle.textContent = "Loading assignment relationships for the selected project...";
  if (meta) meta.innerHTML = "";
  if (body) {
    body.innerHTML = `<div class="placeholder-box">${assignmentEscapeHtml(message)}</div>`;
  }
}

function setAssignmentOverviewEmpty(message = "No assignment details are available for this view.") {
  const { meta, body } = getAssignmentFilterElements();
  if (meta) meta.innerHTML = "";
  if (body) {
    body.innerHTML = `<div class="assignment-empty-state">${assignmentEscapeHtml(message)}</div>`;
  }
}

function getCurrentAssignmentFilters() {
  const { district, supervisor, workerSearch } = getAssignmentFilterElements();

  return {
    district: district?.value || "",
    supervisor: supervisor?.value || "",
    workerSearch: (workerSearch?.value || "").trim().toLowerCase(),
    project: window.currentProjectCode || ""
  };
}

function populateAssignmentFilterOptions(data) {
  const {
    filtersRow,
    districtWrap,
    district,
    supervisorWrap,
    supervisor,
    workerSearchWrap,
    clearActionsWrap
  } = getAssignmentFilterElements();

  const roleView = data?.roleView || "";

  const showDistrict = roleView === "leadership";
  const showSupervisor = roleView === "leadership";
  const showWorkerSearch = roleView === "leadership" || roleView === "field_supervisor";
  const showAnyFilters = showDistrict || showSupervisor || showWorkerSearch;
  const showClearActions = showAnyFilters;

  if (filtersRow) filtersRow.style.display = showAnyFilters ? "" : "none";
  if (districtWrap) districtWrap.style.display = showDistrict ? "" : "none";
  if (supervisorWrap) supervisorWrap.style.display = showSupervisor ? "" : "none";
  if (workerSearchWrap) workerSearchWrap.style.display = showWorkerSearch ? "" : "none";
  if (clearActionsWrap) clearActionsWrap.style.display = showClearActions ? "" : "none";

  if (district) {
    const currentDistrict = district.value || "";
    const districts = [...new Set(assignmentSafeArray(data?.workers).map((item) => item.district).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    district.innerHTML = `<option value="">All districts</option>`;
    districts.forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      district.appendChild(option);
    });

    if ([...district.options].some((opt) => opt.value === currentDistrict)) {
      district.value = currentDistrict;
    }
  }

  if (supervisor) {
    const currentSupervisor = supervisor.value || "";
    const supervisors = assignmentSafeArray(data?.supervisors)
      .filter((item) => item.uid || item.email)
      .map((item) => ({
        value: item.uid || item.email || "",
        label: item.fullName
          ? `${item.fullName} (${item.email || "No email"})`
          : (item.email || "Unnamed supervisor")
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    supervisor.innerHTML = `<option value="">All supervisors</option>`;
    supervisors.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      supervisor.appendChild(option);
    });

    if ([...supervisor.options].some((opt) => opt.value === currentSupervisor)) {
      supervisor.value = currentSupervisor;
    }
  }
}

function filterAssignmentWorkers(workers = []) {
  const filters = getCurrentAssignmentFilters();

  return assignmentSafeArray(workers).filter((worker) => {
    const projectMatch =
      !filters.project ||
      assignmentSafeArray(worker.assignedProjects).includes(filters.project);

    const districtMatch =
      !filters.district ||
      String(worker.district || "") === filters.district;

    const supervisorMatch =
      !filters.supervisor ||
      String(worker.supervisorId || "") === filters.supervisor ||
      String(worker.supervisorEmail || "") === filters.supervisor;

    const searchBlob = [
      worker.fullName,
      worker.email,
      worker.supervisorName,
      worker.supervisorEmail,
      worker.district
    ].join(" ").toLowerCase();

    const workerSearchMatch =
      !filters.workerSearch || searchBlob.includes(filters.workerSearch);

    return projectMatch && districtMatch && supervisorMatch && workerSearchMatch;
  });
}

function renderFieldWorkerAssignmentView(data) {
  const { title, subtitle, meta, body } = getAssignmentFilterElements();
  const supervisor = data?.supervisor || null;
  const actor = data?.actor || {};

  if (title) title.textContent = "Your Supervisor";
  if (subtitle) subtitle.textContent = "Your assigned supervisor for the selected account profile.";
  if (meta) {
    meta.innerHTML = assignmentBuildMetaPill("fas fa-user", assignmentRoleLabel(actor.role));
  }

  if (!supervisor) {
    setAssignmentOverviewEmpty("No supervisor has been assigned to this field worker yet.");
    return;
  }

  body.innerHTML = `
    <div class="assignment-contact-card">
      <div class="assignment-contact-header">
        <div>
          <h4 class="assignment-contact-title">${assignmentEscapeHtml(supervisor.fullName || "Supervisor")}</h4>
          <div class="assignment-subtext">${assignmentEscapeHtml(supervisor.email || "No email available")}</div>
        </div>
        <span class="assignment-count-badge">
          <i class="fas fa-user-tie"></i> ${assignmentEscapeHtml(assignmentRoleLabel(supervisor.role))}
        </span>
      </div>

      <div class="assignment-project-tags">
        ${(assignmentSafeArray(supervisor.assignedProjects).length
          ? assignmentSafeArray(supervisor.assignedProjects).map((project) => `
            <span class="assignment-tag"><i class="fas fa-folder-open"></i>${assignmentEscapeHtml(project)}</span>
          `).join("")
          : `<span class="assignment-tag"><i class="fas fa-folder-open"></i>No projects listed</span>`)}
      </div>

      <div class="assignment-worker-item-meta">
        <span class="assignment-tag"><i class="fas fa-location-dot"></i>${assignmentEscapeHtml(supervisor.district || "Not assigned")}</span>
      </div>
    </div>
  `;
}

function renderSupervisorAssignmentView(data) {
  const { title, subtitle, meta, body } = getAssignmentFilterElements();
  const actor = data?.actor || {};
  const workers = filterAssignmentWorkers(data?.workers || []);

  if (title) title.textContent = "Assigned Field Workers";
  if (subtitle) subtitle.textContent = "Field workers assigned to you for the selected project.";
  if (meta) {
    meta.innerHTML = [
      assignmentBuildMetaPill("fas fa-user-tie", actor.fullName || "Supervisor"),
      assignmentBuildMetaPill("fas fa-users", `${workers.length} field workers`),
      assignmentBuildMetaPill("fas fa-folder-open", window.currentProjectCode || "All assigned projects")
    ].join("");
  }

  if (!workers.length) {
    setAssignmentOverviewEmpty("No field workers are currently assigned to you for the selected project.");
    return;
  }

  body.innerHTML = `
    <div class="assignment-summary-grid">
      <div class="assignment-summary-card">
        <div class="assignment-summary-label">Supervisor</div>
        <div class="assignment-summary-value">${assignmentEscapeHtml(actor.fullName || "-")}</div>
      </div>

      <div class="assignment-summary-card">
        <div class="assignment-summary-label">Field Workers</div>
        <div class="assignment-summary-value">${workers.length}</div>
      </div>

      <div class="assignment-summary-card">
        <div class="assignment-summary-label">Selected Project</div>
        <div class="assignment-summary-value">${assignmentEscapeHtml(window.currentProjectCode || "-")}</div>
      </div>
    </div>

    <div class="assignment-worker-grid">
      ${workers.map((worker) => `
        <div class="assignment-worker-card">
          <div class="assignment-worker-header">
            <div>
              <h4 class="assignment-worker-title">${assignmentEscapeHtml(worker.fullName || "Unnamed worker")}</h4>
              <div class="assignment-subtext">${assignmentEscapeHtml(worker.email || "No email")}</div>
            </div>
            <span class="assignment-count-badge">
              <i class="fas fa-location-dot"></i> ${assignmentEscapeHtml(worker.district || "Not assigned")}
            </span>
          </div>

          <div class="assignment-project-tags">
            ${(assignmentSafeArray(worker.assignedProjects).length
              ? assignmentSafeArray(worker.assignedProjects).map((project) => `
                <span class="assignment-tag"><i class="fas fa-folder-open"></i>${assignmentEscapeHtml(project)}</span>
              `).join("")
              : `<span class="assignment-tag"><i class="fas fa-folder-open"></i>No projects listed</span>`)}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderLeadershipAssignmentView(data) {
  const { title, subtitle, meta, body } = getAssignmentFilterElements();
  const allWorkers = filterAssignmentWorkers(data?.workers || []);
  const allSupervisors = assignmentSafeArray(data?.supervisors).filter((supervisor) => {
    const projectMatch =
      !window.currentProjectCode ||
      assignmentSafeArray(supervisor.assignedProjects).includes(window.currentProjectCode);

    const supervisorFilter = document.getElementById("assignmentSupervisorFilter")?.value || "";
    const matchesSupervisor =
      !supervisorFilter ||
      String(supervisor.uid || "") === supervisorFilter ||
      String(supervisor.email || "") === supervisorFilter;

    return projectMatch && matchesSupervisor;
  });

  if (title) title.textContent = "Supervisor, District and Field Worker Assignments";
  if (subtitle) subtitle.textContent = "Overview of district, supervisor and field worker assignments for the selected project.";
  if (meta) {
    const districtCount = new Set(allWorkers.map((worker) => worker.district || "Not assigned")).size;

    meta.innerHTML = [
      assignmentBuildMetaPill("fas fa-folder-open", window.currentProjectCode || "All assigned projects"),
      assignmentBuildMetaPill("fas fa-location-dot", `${districtCount} districts`),
      assignmentBuildMetaPill("fas fa-user-tie", `${allSupervisors.length} supervisors`),
      assignmentBuildMetaPill("fas fa-users", `${allWorkers.length} field workers`)
    ].join("");
  }

  if (!allWorkers.length && !allSupervisors.length) {
    setAssignmentOverviewEmpty("No assignment records are available for the selected project and filters.");
    return;
  }

  const districtMap = new Map();

  allWorkers.forEach((worker) => {
    const districtName = worker.district || "Not assigned";
    const supervisorKey = worker.supervisorId || worker.supervisorEmail || "unassigned";

    if (!districtMap.has(districtName)) {
      districtMap.set(districtName, {
        name: districtName,
        supervisors: new Map()
      });
    }

    const district = districtMap.get(districtName);

    if (!district.supervisors.has(supervisorKey)) {
      const supervisor =
        allSupervisors.find((item) =>
          item.uid === worker.supervisorId ||
          item.email === worker.supervisorEmail
        ) || {
          uid: "",
          fullName: worker.supervisorName || "Supervisor not assigned",
          email: worker.supervisorEmail || "",
          assignedProjects: []
        };

      district.supervisors.set(supervisorKey, {
        supervisor,
        workers: []
      });
    }

    district.supervisors.get(supervisorKey).workers.push(worker);
  });

  const sortedDistricts = [...districtMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  body.innerHTML = `
    <div class="assignment-summary-grid">
      <div class="assignment-summary-card">
        <div class="assignment-summary-label">Districts</div>
        <div class="assignment-summary-value">${sortedDistricts.length}</div>
      </div>

      <div class="assignment-summary-card">
        <div class="assignment-summary-label">Supervisors</div>
        <div class="assignment-summary-value">${allSupervisors.length}</div>
      </div>

      <div class="assignment-summary-card">
        <div class="assignment-summary-label">Field Workers</div>
        <div class="assignment-summary-value">${allWorkers.length}</div>
      </div>
    </div>

    <div class="assignment-district-grid">
      ${sortedDistricts.map((district) => {
        const supervisorGroups = [...district.supervisors.values()].sort((a, b) =>
          String(a.supervisor.fullName || "").localeCompare(String(b.supervisor.fullName || ""))
        );

        const workerCount = supervisorGroups.reduce((sum, group) => sum + group.workers.length, 0);

        return `
          <div class="assignment-district-card">
            <div class="assignment-district-header">
              <div>
                <h4 class="assignment-district-title">${assignmentEscapeHtml(district.name)}</h4>
                <div class="assignment-subtext">Supervisors and field workers assigned in this district</div>
              </div>
              <span class="assignment-count-badge">
                <i class="fas fa-users"></i> ${workerCount} field workers
              </span>
            </div>

            <div class="assignment-supervisor-grid">
              ${supervisorGroups.map((group) => `
                <div class="assignment-supervisor-card">
                  <div class="assignment-supervisor-header">
                    <div>
                      <h5 class="assignment-supervisor-title">${assignmentEscapeHtml(group.supervisor.fullName || "Supervisor not assigned")}</h5>
                      <div class="assignment-subtext">${assignmentEscapeHtml(group.supervisor.email || "No email")}</div>
                    </div>
                    <span class="assignment-count-badge">
                      <i class="fas fa-user-friends"></i> ${group.workers.length} workers
                    </span>
                  </div>

                  <div class="assignment-worker-list">
                    ${group.workers.map((worker) => `
                      <div class="assignment-worker-item">
                        <div class="assignment-worker-item-top">
                          <div>
                            <div class="assignment-worker-item-name">${assignmentEscapeHtml(worker.fullName || "Unnamed worker")}</div>
                            <div class="assignment-worker-item-email">${assignmentEscapeHtml(worker.email || "No email")}</div>
                          </div>
                        </div>

                        <div class="assignment-worker-item-meta">
                          ${(assignmentSafeArray(worker.assignedProjects).length
                            ? assignmentSafeArray(worker.assignedProjects).map((project) => `
                              <span class="assignment-tag"><i class="fas fa-folder-open"></i>${assignmentEscapeHtml(project)}</span>
                            `).join("")
                            : `<span class="assignment-tag"><i class="fas fa-folder-open"></i>No projects listed</span>`)}
                        </div>
                      </div>
                    `).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderAssignmentOverview() {
  const data = assignmentOverviewCache;
  if (!data) {
    setAssignmentOverviewEmpty("Assignment overview is not available yet.");
    return;
  }

  populateAssignmentFilterOptions(data);

  if (data.roleView === "field_worker") {
    renderFieldWorkerAssignmentView(data);
    return;
  }

  if (data.roleView === "field_supervisor") {
    renderSupervisorAssignmentView(data);
    return;
  }

  if (data.roleView === "leadership") {
    renderLeadershipAssignmentView(data);
    return;
  }

  setAssignmentOverviewEmpty("This role does not have assignment overview data.");
}

async function loadAssignmentOverview() {
  setAssignmentOverviewLoading();

  try {
    const response = await getAssignmentOverviewCallable();
    assignmentOverviewCache = response.data || null;
    renderAssignmentOverview();
  } catch (error) {
    console.error("Failed to load assignment overview:", error);
    setAssignmentOverviewEmpty("Failed to load assignment overview.");
  }
}

function setupAssignmentOverviewFilters() {
  const {
    district,
    supervisor,
    workerSearch,
    clearBtn
  } = getAssignmentFilterElements();

  if (district) {
    district.addEventListener("change", renderAssignmentOverview);
  }

  if (supervisor) {
    supervisor.addEventListener("change", renderAssignmentOverview);
  }

  if (workerSearch) {
    workerSearch.addEventListener("input", renderAssignmentOverview);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (district) district.value = "";
      if (supervisor) supervisor.value = "";
      if (workerSearch) workerSearch.value = "";
      renderAssignmentOverview();
    });
  }

  setupAssignmentOverviewToggle();
}

/**
 * Helper to show or hide elements.
 */
function setVisibleIf(elementId, shouldShow) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.toggle("hidden", !shouldShow);
}

function updateHdssOnlySections() {
  const assignmentPanel = document.getElementById("assignmentOverviewPanel");
  if (!assignmentPanel) return;

  const isHdssProject = String(window.currentProjectCode || "").toLowerCase() === "hdss";
  assignmentPanel.style.display = isHdssProject ? "" : "none";

  if (!isHdssProject) {
    assignmentOverviewCache = null;
  }
}

/**
 * Apply tab visibility and download visibility based on role.
 */
function applyRoleVisibility(role) {
  const permissions = getPermissions(role);

  setVisibleIf("reportsTabBtn", permissions.canViewReports);
  setVisibleIf("chatTabBtn", permissions.canViewChat);
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

      if (targetTab === "tab-chat" && getPermissions(window.currentUserProfile.role).canViewChat) {
        if (typeof window.openProjectChatTab === "function") {
          await window.openProjectChatTab();
        }
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
  projectSelect.addEventListener("change", async function () {
    const selectedProject = String(this.value || "").trim();

    window.currentProjectCode = selectedProject;

    await loadProject(selectedProject);
    updateHdssOnlySections();

    if (String(window.currentProjectCode || "").toLowerCase() === "hdss") {
      await loadAssignmentOverview();
    } else {
      assignmentOverviewCache = null;
    }

    if (typeof window.refreshChatContext === "function") {
      await window.refreshChatContext();
    }
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
 * Dashboard guided navigation helper for the Power BI iframe area.
 * Safe version: explains Power BI controls without trying to control the iframe internals.
 */
let dashboardGuideSteps = [];
let dashboardGuideIndex = 0;

function ensureDashboardGuideStyles() {
  if (document.getElementById("dashboardGuideStyles")) return;

  const style = document.createElement("style");
  style.id = "dashboardGuideStyles";
  style.textContent = `
    .dashboard-guide-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      z-index: 9998;
      display: none;
    }

    .dashboard-guide-highlight {
      position: fixed;
      border: 3px solid #3b82f6;
      border-radius: 14px;
      box-shadow:
        0 0 0 9999px rgba(15, 23, 42, 0.55),
        0 0 0 6px rgba(255,255,255,0.18);
      z-index: 9999;
      pointer-events: none;
      transition: all 0.22s ease;
    }

    .dashboard-guide-card {
      position: fixed;
      width: min(360px, calc(100vw - 24px));
      background: #ffffff;
      color: #0f172a;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28);
      padding: 18px 18px 14px;
      z-index: 10000;
      display: none;
    }

    .dashboard-guide-step {
      font-size: 12px;
      font-weight: 700;
      color: #2563eb;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .dashboard-guide-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #0f172a;
    }

    .dashboard-guide-text {
      font-size: 14px;
      line-height: 1.55;
      color: #334155;
      margin-bottom: 14px;
    }

    .dashboard-guide-actions {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }

    .dashboard-guide-actions-left,
    .dashboard-guide-actions-right {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .dashboard-guide-btn {
      border: none;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .dashboard-guide-btn-primary {
      background: #2563eb;
      color: #fff;
    }

    .dashboard-guide-btn-secondary {
      background: #e2e8f0;
      color: #0f172a;
    }

    .dashboard-guide-btn-ghost {
      background: transparent;
      color: #475569;
    }
  `;
  document.head.appendChild(style);
}

function ensureDashboardGuideDom() {
  ensureDashboardGuideStyles();

  let overlay = document.getElementById("dashboardGuideOverlay");
  let highlight = document.getElementById("dashboardGuideHighlight");
  let card = document.getElementById("dashboardGuideCard");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "dashboardGuideOverlay";
    overlay.className = "dashboard-guide-overlay";
    document.body.appendChild(overlay);
  }

  if (!highlight) {
    highlight = document.createElement("div");
    highlight.id = "dashboardGuideHighlight";
    highlight.className = "dashboard-guide-highlight";
    highlight.style.display = "none";
    document.body.appendChild(highlight);
  }

  if (!card) {
    card = document.createElement("div");
    card.id = "dashboardGuideCard";
    card.className = "dashboard-guide-card";
    card.innerHTML = `
      <div id="dashboardGuideStep" class="dashboard-guide-step">Step 1</div>
      <div id="dashboardGuideTitle" class="dashboard-guide-title">Guide</div>
      <div id="dashboardGuideText" class="dashboard-guide-text"></div>

      <div class="dashboard-guide-actions">
        <div class="dashboard-guide-actions-left">
          <button type="button" id="dashboardGuideSkipBtn" class="dashboard-guide-btn dashboard-guide-btn-ghost">Skip</button>
        </div>

        <div class="dashboard-guide-actions-right">
          <button type="button" id="dashboardGuideBackBtn" class="dashboard-guide-btn dashboard-guide-btn-secondary">Back</button>
          <button type="button" id="dashboardGuideNextBtn" class="dashboard-guide-btn dashboard-guide-btn-primary">Next</button>
        </div>
      </div>
    `;
    document.body.appendChild(card);
  }

  const skipBtn = document.getElementById("dashboardGuideSkipBtn");
  const backBtn = document.getElementById("dashboardGuideBackBtn");
  const nextBtn = document.getElementById("dashboardGuideNextBtn");

  if (skipBtn && !skipBtn.dataset.bound) {
    skipBtn.dataset.bound = "true";
    skipBtn.addEventListener("click", closeDashboardGuide);
  }

  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = "true";
    backBtn.addEventListener("click", () => {
      if (dashboardGuideIndex > 0) {
        dashboardGuideIndex -= 1;
        renderDashboardGuideStep();
      }
    });
  }

  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound = "true";
    nextBtn.addEventListener("click", () => {
      if (dashboardGuideIndex < dashboardGuideSteps.length - 1) {
        dashboardGuideIndex += 1;
        renderDashboardGuideStep();
      } else {
        closeDashboardGuide();
      }
    });
  }

  if (overlay && !overlay.dataset.bound) {
    overlay.dataset.bound = "true";
    overlay.addEventListener("click", closeDashboardGuide);
  }
}

function getGuideRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();

  return {
    top: Math.max(8, rect.top - 6),
    left: Math.max(8, rect.left - 6),
    width: Math.max(40, rect.width + 12),
    height: Math.max(40, rect.height + 12),
    bottom: rect.bottom + 6,
    right: rect.right + 6
  };
}

function placeDashboardGuideCard(targetRect) {
  const card = document.getElementById("dashboardGuideCard");
  if (!card || !targetRect) return;

  const spacing = 14;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  card.style.display = "block";
  card.style.visibility = "hidden";

  const cardRect = card.getBoundingClientRect();

  let top = targetRect.bottom + spacing;
  let left = targetRect.left;

  if (top + cardRect.height > viewportHeight - 12) {
    top = targetRect.top - cardRect.height - spacing;
  }

  if (top < 12) {
    top = 12;
  }

  if (left + cardRect.width > viewportWidth - 12) {
    left = viewportWidth - cardRect.width - 12;
  }

  if (left < 12) {
    left = 12;
  }

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
  card.style.visibility = "visible";
}

function renderDashboardGuideStep() {
  const overlay = document.getElementById("dashboardGuideOverlay");
  const highlight = document.getElementById("dashboardGuideHighlight");
  const card = document.getElementById("dashboardGuideCard");
  const stepEl = document.getElementById("dashboardGuideStep");
  const titleEl = document.getElementById("dashboardGuideTitle");
  const textEl = document.getElementById("dashboardGuideText");
  const backBtn = document.getElementById("dashboardGuideBackBtn");
  const nextBtn = document.getElementById("dashboardGuideNextBtn");
  const hintFooter = document.getElementById("powerBiHintFooter");

  if (!overlay || !highlight || !card || !stepEl || !titleEl || !textEl) return;
  if (!dashboardGuideSteps.length) return;

  const step = dashboardGuideSteps[dashboardGuideIndex];
  const targetEl = typeof step.target === "function" ? step.target() : step.target;
  const rect = getGuideRect(targetEl);

  overlay.style.display = "block";
  highlight.style.display = rect ? "block" : "none";
  card.style.display = "block";

  if (hintFooter) {
    hintFooter.style.display = step.showFooterHint ? "block" : "none";
  }

  if (rect) {
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    placeDashboardGuideCard(rect);
  } else {
    highlight.style.display = "none";
    card.style.top = "20px";
    card.style.left = "20px";
  }

  stepEl.textContent = `Step ${dashboardGuideIndex + 1} of ${dashboardGuideSteps.length}`;
  titleEl.textContent = step.title || "Guide";
  textEl.innerHTML = step.text || "";

  if (backBtn) {
    backBtn.disabled = dashboardGuideIndex === 0;
    backBtn.style.opacity = dashboardGuideIndex === 0 ? "0.55" : "1";
  }

  if (nextBtn) {
    nextBtn.textContent = dashboardGuideIndex === dashboardGuideSteps.length - 1 ? "Finish" : "Next";
  }
}

function closeDashboardGuide() {
  const overlay = document.getElementById("dashboardGuideOverlay");
  const highlight = document.getElementById("dashboardGuideHighlight");
  const card = document.getElementById("dashboardGuideCard");
  const hintFooter = document.getElementById("powerBiHintFooter");

  if (overlay) overlay.style.display = "none";
  if (highlight) highlight.style.display = "none";
  if (card) card.style.display = "none";
  if (hintFooter) hintFooter.style.display = "none";
}

function startDashboardGuide() {
  ensureDashboardGuideDom();

  dashboardGuideSteps = [
    {
      target: () => document.getElementById("projectSelect"),
      title: "Project selector",
      text: "Start here. Use this dropdown to switch between dashboards assigned to your account."
    },
    {
      target: () => document.querySelector('.tab-button[data-tab="tab-dashboard"]'),
      title: "Dashboard tab",
      text: "This tab will take you back to the main Power BI dashboard view at any time."
    },
    {
      target: () => document.querySelector(".download-actions"),
      title: "Quick downloads",
      text: "Use these buttons to download the dashboard PDF or PowerPoint when available."
    },
    {
      target: () => document.getElementById("dashboardHelpBar"),
      title: "Navigation help bar",
      text: "This area gives you quick reminders on where page navigation, zoom, and fit options are located."
    },
    {
      target: () => document.getElementById("dashboardFrameWrap"),
      title: "Power BI viewing area",
      text: "This is the embedded Power BI report.Scroll and interact with it directly."
    },
    {
      target: () => document.getElementById("dashboardFrameWrap"),
      title: "Page navigation, zoom, and fit controls",
      text: "Look at the <strong>bottom area of the Power BI viewer</strong>. That is where you will find page navigation arrows, page numbers, zoom controls, and fit or full screen options.",
      showFooterHint: true
    }
  ];

  dashboardGuideIndex = 0;
  renderDashboardGuideStep();
}

function setupDashboardGuideUI() {
  ensureDashboardGuideDom();

  const startBtn = document.getElementById("startDashboardGuideBtn");
  if (startBtn && !startBtn.dataset.bound) {
    startBtn.dataset.bound = "true";
    startBtn.addEventListener("click", startDashboardGuide);
  }

  window.addEventListener("resize", () => {
    const overlay = document.getElementById("dashboardGuideOverlay");
    if (overlay && overlay.style.display === "block") {
      renderDashboardGuideStep();
    }
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
    const previousUid = window.currentUserProfile?.uid || auth.currentUser?.uid || null;

    if (previousUid) {
      await setUserPresenceOffline(previousUid);
    }

    stopWatchingCurrentUserProfile();
    stopIdleTracking();
    window.currentUserProfile = null;
    window.currentProjectCode = null;
    assignmentOverviewCache = null;
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
    await setUserPresenceOnline(user.uid);
    bindPresenceUnload(user.uid);

    setupIdleTracking();
    resetIdleTimer();
    watchCurrentUserProfile(user.uid);
    console.log("Logged in profile:", profile);

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
    window.currentProjectCode = String(firstProject || "").trim();

    await loadProject(window.currentProjectCode);
    updateHdssOnlySections();

    if (String(window.currentProjectCode || "").toLowerCase() === "hdss") {
      await loadAssignmentOverview();
    }

    const permissions = getPermissions(profile.role);

    // Do not auto-initialize chat during login.
    // Chat will initialize only when the user opens the Chat tab.
    await logActivity("login", {
      page: "login"
    });

    startTabTimer("tab-dashboard");

    await showDashboardRefreshNotice();

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
  setupAssignmentOverviewFilters();

  // ✅ This activates the "Show Dashboard Guide" button
  setupDashboardGuideUI();

  if (typeof window.setupChatUI === "function") {
    window.setupChatUI();
  }

  // ✅ ADD THIS BLOCK
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await setUserPresenceOffline(
          window.currentUserProfile?.uid || auth.currentUser?.uid
        );
      } catch (e) {
        console.error("Presence update before logout failed:", e);
      }

      await auth.signOut();
    });
  }
});