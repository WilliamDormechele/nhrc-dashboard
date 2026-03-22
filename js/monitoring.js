// js/monitoring.js

let actionsChartInstance = null;
let projectsChartInstance = null;
let usersChartInstance = null;
let dailyChartInstance = null;
let rolesChartInstance = null;
let pagesChartInstance = null;

let monitoringAllLogs = [];
let monitoringUsersByEmail = {};
let monitoringSupervisors = [];
let monitoringFieldworkers = [];
let monitoringFilterOptionsLoaded = false;

const monitoringTableState = {
  currentPage: 1,
  pageSize: 25
};

/**
 * Destroy old chart instance before drawing a new one.
 */
function destroyChart(chartInstance) {
  if (chartInstance) {
    chartInstance.destroy();
  }
}

/**
 * Safe text formatter.
 */
function safeText(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

/**
 * True only for administrator and developer.
 */
function canMonitorAllProjects() {
  const role = window.currentUserProfile?.role || "";
  return role === "administrator" || role === "developer";
}

/**
 * Return project codes this monitoring user is allowed to see.
 */
function getAllowedMonitoringProjectCodes() {
  const allProjectCodes = Object.keys(window.projectRegistry || {});

  if (canMonitorAllProjects()) {
    return allProjectCodes;
  }

  const assignedProjects = Array.isArray(window.currentUserProfile?.assignedProjects)
    ? window.currentUserProfile.assignedProjects
    : [];

  return assignedProjects.filter((code) => allProjectCodes.includes(code));
}

/**
 * Split an array into chunks for Firestore "in" queries.
 */
function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

/**
 * Populate a select with options.
 */
function populateSelectOptions(selectId, items, placeholderText) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const currentValue = select.value || "";
  select.innerHTML = `<option value="">${placeholderText}</option>`;

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  if ([...select.options].some((opt) => opt.value === currentValue)) {
    select.value = currentValue;
  }
}

/**
 * Load users for monitoring filter relationships.
 */
async function loadMonitoringUsersAndFilters() {
  const snapshot = await db.collection("users").orderBy("fullName").get();

  monitoringUsersByEmail = {};
  monitoringSupervisors = [];
  monitoringFieldworkers = [];

  snapshot.forEach((doc) => {
    const user = { id: doc.id, ...doc.data() };
    const emailKey = (user.email || "").toLowerCase();

    if (emailKey) {
      monitoringUsersByEmail[emailKey] = user;
    }

    if (user.role === "field_supervisor") {
      monitoringSupervisors.push(user);
    }

    if (user.role === "field_worker") {
      monitoringFieldworkers.push(user);
    }
  });

  monitoringFilterOptionsLoaded = true;
}

/**
 * Return current main monitoring filters.
 */
function getMonitoringFilters() {
  return {
    project: document.getElementById("monitoringProjectFilter")?.value || "",
    supervisor: document.getElementById("monitoringSupervisorFilter")?.value || "",
    fieldworker: document.getElementById("monitoringFieldworkerFilter")?.value || ""
  };
}

/**
 * Return table-only advanced filters.
 */
function getMonitoringTableFilters() {
  return {
    action: document.getElementById("monitoringActionFilter")?.value || "",
    page: document.getElementById("monitoringPageFilter")?.value || "",
    startDate: document.getElementById("monitoringStartDate")?.value || "",
    endDate: document.getElementById("monitoringEndDate")?.value || "",
    searchText: (document.getElementById("monitoringSearchText")?.value || "").trim().toLowerCase()
  };
}

/**
 * Rebuild main monitoring dropdowns with hierarchy and project restriction.
 */
function rebuildMonitoringFilterDropdowns() {
  const projectFilter = document.getElementById("monitoringProjectFilter");
  const supervisorFilter = document.getElementById("monitoringSupervisorFilter");
  const fieldworkerFilter = document.getElementById("monitoringFieldworkerFilter");

  if (!projectFilter || !supervisorFilter || !fieldworkerFilter) return;

  const currentProject = projectFilter.value || "";
  const currentSupervisor = supervisorFilter.value || "";
  const currentFieldworker = fieldworkerFilter.value || "";

  const allowedProjectCodes = getAllowedMonitoringProjectCodes();

  const projectItems = Object.values(window.projectRegistry || {})
    .filter((project) => allowedProjectCodes.includes(project.code))
    .map((project) => ({
      value: project.code,
      label: `${project.name} (${project.code})`
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const projectPlaceholder = canMonitorAllProjects() ? "All projects" : "All assigned projects";
  populateSelectOptions("monitoringProjectFilter", projectItems, projectPlaceholder);

  if ([...projectFilter.options].some((opt) => opt.value === currentProject)) {
    projectFilter.value = currentProject;
  }

  const selectedProject = projectFilter.value || "";

  const supervisorsForProject = monitoringSupervisors.filter((supervisor) => {
    const supervisorProjects = Array.isArray(supervisor.assignedProjects) ? supervisor.assignedProjects : [];
    const matchesAllowed = supervisorProjects.some((code) => allowedProjectCodes.includes(code));

    if (!matchesAllowed) return false;
    if (!selectedProject) return true;

    return supervisorProjects.includes(selectedProject);
  });

  const supervisorItems = supervisorsForProject
    .map((supervisor) => ({
      value: supervisor.email || "",
      label: supervisor.fullName
        ? `${supervisor.fullName} (${supervisor.email || ""})`
        : (supervisor.email || supervisor.id)
    }))
    .filter((item) => item.value)
    .sort((a, b) => a.label.localeCompare(b.label));

  populateSelectOptions("monitoringSupervisorFilter", supervisorItems, "All supervisors");

  if ([...supervisorFilter.options].some((opt) => opt.value === currentSupervisor)) {
    supervisorFilter.value = currentSupervisor;
  }

  const selectedSupervisor = supervisorFilter.value || "";

  const fieldworkersForFilters = monitoringFieldworkers.filter((worker) => {
    const workerProjects = Array.isArray(worker.assignedProjects) ? worker.assignedProjects : [];
    const matchesAllowed = workerProjects.some((code) => allowedProjectCodes.includes(code));

    if (!matchesAllowed) return false;

    const matchesProject =
      !selectedProject || workerProjects.includes(selectedProject);

    const matchesSupervisor =
      !selectedSupervisor ||
      ((worker.supervisorEmail || "").toLowerCase() === selectedSupervisor.toLowerCase());

    return matchesProject && matchesSupervisor;
  });

  const fieldworkerItems = fieldworkersForFilters
    .map((worker) => ({
      value: worker.email || "",
      label: worker.fullName
        ? `${worker.fullName} (${worker.email || ""})`
        : (worker.email || worker.id)
    }))
    .filter((item) => item.value)
    .sort((a, b) => a.label.localeCompare(b.label));

  populateSelectOptions("monitoringFieldworkerFilter", fieldworkerItems, "All fieldworkers");

  if ([...fieldworkerFilter.options].some((opt) => opt.value === currentFieldworker)) {
    fieldworkerFilter.value = currentFieldworker;
  }
}

/**
 * Rebuild table-only filter options from currently visible monitoring logs.
 */
function rebuildMonitoringTableFilterDropdowns(logs) {
  const actionItems = [...new Set(logs.map((log) => log.action).filter(Boolean))]
    .sort()
    .map((action) => ({ value: action, label: action }));

  const pageItems = [...new Set(logs.map((log) => log.page).filter(Boolean))]
    .sort()
    .map((page) => ({ value: page, label: page }));

  populateSelectOptions("monitoringActionFilter", actionItems, "All actions");
  populateSelectOptions("monitoringPageFilter", pageItems, "All pages");
}

/**
 * Apply project restriction + project/supervisor/fieldworker hierarchy.
 */
function applyMonitoringFilters(logs) {
  const filters = getMonitoringFilters();
  const allowedProjectCodes = getAllowedMonitoringProjectCodes();

  return logs.filter((log) => {
    const logEmail = (log.email || "").toLowerCase();
    const logProject = log.currentProject || "";
    const userProfile = monitoringUsersByEmail[logEmail] || {};
    const workerSupervisorEmail = (userProfile.supervisorEmail || "").toLowerCase();

    const withinAllowedProjects =
      !!logProject && allowedProjectCodes.includes(logProject);

    if (!withinAllowedProjects) return false;

    const matchesProject =
      !filters.project || logProject === filters.project;

    const matchesSupervisor =
      !filters.supervisor ||
      logEmail === filters.supervisor.toLowerCase() ||
      workerSupervisorEmail === filters.supervisor.toLowerCase();

    const matchesFieldworker =
      !filters.fieldworker ||
      logEmail === filters.fieldworker.toLowerCase();

    return matchesProject && matchesSupervisor && matchesFieldworker;
  });
}

/**
 * Apply table-only advanced filters.
 */
function applyMonitoringTableFilters(logs) {
  const filters = getMonitoringTableFilters();

  return logs.filter((log) => {
    const logDate = log.createdAt && log.createdAt.toDate ? log.createdAt.toDate() : null;
    const logDateOnly = logDate ? logDate.toISOString().slice(0, 10) : "";

    const matchesAction =
      !filters.action || log.action === filters.action;

    const matchesPage =
      !filters.page || log.page === filters.page;

    const matchesStartDate =
      !filters.startDate || (logDateOnly && logDateOnly >= filters.startDate);

    const matchesEndDate =
      !filters.endDate || (logDateOnly && logDateOnly <= filters.endDate);

    const searchBlob = [
      log.fullName,
      log.email,
      log.role,
      log.currentProject,
      log.action,
      log.page,
      log.target,
      String(log.durationSeconds || "")
    ].join(" ").toLowerCase();

    const matchesSearch =
      !filters.searchText || searchBlob.includes(filters.searchText);

    return matchesAction && matchesPage && matchesStartDate && matchesEndDate && matchesSearch;
  });
}

/**
 * Query activity logs in a way that respects Firestore rules.
 *
 * - admin/developer: broad date query
 * - field_headquarters: project-scoped queries only
 */
async function fetchMonitoringLogs(startTimestamp) {
  const allowedProjectCodes = getAllowedMonitoringProjectCodes();

  if (canMonitorAllProjects()) {
    const snapshot = await db
      .collection("activity_logs")
      .where("createdAt", ">=", startTimestamp)
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    const logs = [];
    snapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    return logs;
  }

  if (allowedProjectCodes.length === 0) {
    return [];
  }

  const chunks = chunkArray(allowedProjectCodes, 10);
  const snapshots = await Promise.all(
    chunks.map((projectChunk) =>
      db.collection("activity_logs")
        .where("currentProject", "in", projectChunk)
        .where("createdAt", ">=", startTimestamp)
        .orderBy("currentProject")
        .orderBy("createdAt", "desc")
        .limit(500)
        .get()
    )
  );

  const logsMap = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.forEach((doc) => {
      logsMap.set(doc.id, { id: doc.id, ...doc.data() });
    });
  });

  return [...logsMap.values()].sort((a, b) => {
    const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Load activity logs from Firestore for the selected time window.
 */
async function loadMonitoringData() {
  const days = parseInt(document.getElementById("monitoringDays").value, 10);
  const tbody = document.getElementById("monitoringTableBody");
  tbody.innerHTML = `<tr><td colspan="8">Loading activity logs...</td></tr>`;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startTimestamp = firebase.firestore.Timestamp.fromDate(startDate);

  try {
    await loadProjectsRegistry();

    if (!monitoringFilterOptionsLoaded) {
      await loadMonitoringUsersAndFilters();
    }

    rebuildMonitoringFilterDropdowns();

    const logs = await fetchMonitoringLogs(startTimestamp);

    monitoringAllLogs = logs;
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="8">Failed to load monitoring data.</td></tr>`;
  }
}

/**
 * Re-render monitoring view.
 *
 * Main monitoring filters affect:
 * - stats
 * - charts
 * - table
 *
 * Table-only advanced filters affect:
 * - Recent Activity Logs only
 */
function renderFilteredMonitoringView() {
  rebuildMonitoringFilterDropdowns();

  const primaryFilteredLogs = applyMonitoringFilters(monitoringAllLogs);

  renderMonitoringSummary(primaryFilteredLogs);
  renderMonitoringCharts(primaryFilteredLogs);

  rebuildMonitoringTableFilterDropdowns(primaryFilteredLogs);

  const tableFilteredLogs = applyMonitoringTableFilters(primaryFilteredLogs);
  renderMonitoringTable(tableFilteredLogs);
}

/**
 * Update summary cards.
 */
function renderMonitoringSummary(logs) {
  const loginCount = logs.filter((x) => x.action === "login").length;

  const downloadCount = logs.filter((x) =>
    ["download_dashboard_pdf", "download_dashboard_ppt", "download_report", "download_query"].includes(x.action)
  ).length;

  const uniqueUsers = new Set(logs.map((x) => x.email).filter(Boolean)).size;

  const totalDurationSeconds = logs
    .filter((x) => x.action === "tab_duration" && typeof x.durationSeconds === "number")
    .reduce((sum, item) => sum + item.durationSeconds, 0);

  const totalMinutes = Math.round(totalDurationSeconds / 60);

  document.getElementById("statLogins").textContent = loginCount;
  document.getElementById("statDownloads").textContent = downloadCount;
  document.getElementById("statUsers").textContent = uniqueUsers;
  document.getElementById("statMinutes").textContent = totalMinutes;
}

/**
 * Render paginated monitoring logs table.
 */
function renderMonitoringTable(logs) {
  const tbody = document.getElementById("monitoringTableBody");
  const countEl = document.getElementById("monitoringLogsCount");
  const pageInfoEl = document.getElementById("monitoringPageInfo");
  const prevBtn = document.getElementById("monitoringPrevPageBtn");
  const nextBtn = document.getElementById("monitoringNextPageBtn");

  tbody.innerHTML = "";

  const pageSize = parseInt(document.getElementById("monitoringPageSize")?.value || "25", 10);
  monitoringTableState.pageSize = pageSize;

  const totalRows = logs.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  if (monitoringTableState.currentPage > totalPages) {
    monitoringTableState.currentPage = totalPages;
  }
  if (monitoringTableState.currentPage < 1) {
    monitoringTableState.currentPage = 1;
  }

  const startIndex = (monitoringTableState.currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageLogs = logs.slice(startIndex, endIndex);

  countEl.textContent = `${totalRows} record${totalRows === 1 ? "" : "s"}`;
  pageInfoEl.textContent = `Page ${monitoringTableState.currentPage} of ${totalPages}`;

  prevBtn.disabled = monitoringTableState.currentPage <= 1;
  nextBtn.disabled = monitoringTableState.currentPage >= totalPages;

  if (pageLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">No activity logs found for the selected filters.</td></tr>`;
    return;
  }

  pageLogs.forEach((log) => {
    const tr = document.createElement("tr");

    const dateText = log.createdAt && log.createdAt.toDate
      ? log.createdAt.toDate().toLocaleString()
      : "";

    tr.innerHTML = `
      <td>${safeText(dateText)}</td>
      <td>${safeText(log.fullName || log.email)}</td>
      <td>${safeText(log.role)}</td>
      <td>${safeText(log.currentProject)}</td>
      <td>${safeText(log.action)}</td>
      <td>${safeText(log.page)}</td>
      <td>${safeText(log.target)}</td>
      <td>${safeText(log.durationSeconds)}</td>
    `;

    tbody.appendChild(tr);
  });
}

/**
 * Count values by a field.
 */
function countBy(logs, accessor) {
  const counts = {};
  logs.forEach((item) => {
    const key = accessor(item) || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/**
 * Return top N entries from counts.
 */
function topEntriesFromCounts(counts, limit = 10) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/**
 * Render all monitoring charts.
 */
function renderMonitoringCharts(logs) {
  renderActionsChart(logs);
  renderProjectsChart(logs);
  renderUsersChart(logs);
  renderDailyChart(logs);
  renderRolesChart(logs);
  renderPagesChart(logs);
}

/**
 * Activity by action.
 */
function renderActionsChart(logs) {
  const counts = countBy(logs, (x) => x.action);
  const entries = topEntriesFromCounts(counts, 8);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(actionsChartInstance);
  actionsChartInstance = new Chart(document.getElementById("actionsChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Count", data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/**
 * Activity by project.
 */
function renderProjectsChart(logs) {
  const counts = countBy(logs, (x) => x.currentProject || "No Project");
  const entries = topEntriesFromCounts(counts, 8);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(projectsChartInstance);
  projectsChartInstance = new Chart(document.getElementById("projectsChart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

/**
 * Top active users.
 */
function renderUsersChart(logs) {
  const counts = countBy(logs, (x) => x.fullName || x.email || "Unknown");
  const entries = topEntriesFromCounts(counts, 10);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(usersChartInstance);
  usersChartInstance = new Chart(document.getElementById("usersChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Actions", data: values }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

/**
 * Daily activity trend.
 */
function renderDailyChart(logs) {
  const counts = {};

  logs.forEach((log) => {
    if (!log.createdAt || !log.createdAt.toDate) return;
    const day = log.createdAt.toDate().toISOString().slice(0, 10);
    counts[day] = (counts[day] || 0) + 1;
  });

  const labels = Object.keys(counts).sort();
  const values = labels.map((label) => counts[label]);

  destroyChart(dailyChartInstance);
  dailyChartInstance = new Chart(document.getElementById("dailyChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Daily Activity", data: values, tension: 0.25 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

/**
 * Activity by role.
 */
function renderRolesChart(logs) {
  const counts = countBy(logs, (x) => x.role || "Unknown");

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  destroyChart(rolesChartInstance);
  rolesChartInstance = new Chart(document.getElementById("rolesChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Actions", data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/**
 * Most visited pages.
 */
function renderPagesChart(logs) {
  const counts = countBy(logs, (x) => x.page || "Unknown");
  const entries = topEntriesFromCounts(counts, 10);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(pagesChartInstance);
  pagesChartInstance = new Chart(document.getElementById("pagesChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Visits", data: values }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

/**
 * Reset top-level filters.
 */
function clearMonitoringFilters() {
  document.getElementById("monitoringProjectFilter").value = "";
  document.getElementById("monitoringSupervisorFilter").value = "";
  document.getElementById("monitoringFieldworkerFilter").value = "";

  document.getElementById("monitoringActionFilter").value = "";
  document.getElementById("monitoringPageFilter").value = "";
  document.getElementById("monitoringStartDate").value = "";
  document.getElementById("monitoringEndDate").value = "";
  document.getElementById("monitoringSearchText").value = "";
  document.getElementById("monitoringPageSize").value = "25";

  monitoringTableState.currentPage = 1;
  renderFilteredMonitoringView();
}

/**
 * Go to previous table page.
 */
function goToPreviousMonitoringPage() {
  monitoringTableState.currentPage -= 1;
  renderFilteredMonitoringView();
}

/**
 * Go to next table page.
 */
function goToNextMonitoringPage() {
  monitoringTableState.currentPage += 1;
  renderFilteredMonitoringView();
}

/**
 * Wire up event listeners.
 */
function setupMonitoringUI() {
  document.getElementById("refreshMonitoringBtn").addEventListener("click", loadMonitoringData);
  document.getElementById("monitoringDays").addEventListener("change", loadMonitoringData);

  document.getElementById("monitoringProjectFilter").addEventListener("change", () => {
    document.getElementById("monitoringSupervisorFilter").value = "";
    document.getElementById("monitoringFieldworkerFilter").value = "";
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringSupervisorFilter").addEventListener("change", () => {
    document.getElementById("monitoringFieldworkerFilter").value = "";
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringFieldworkerFilter").addEventListener("change", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringActionFilter").addEventListener("change", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringPageFilter").addEventListener("change", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringStartDate").addEventListener("change", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringEndDate").addEventListener("change", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringSearchText").addEventListener("input", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringPageSize").addEventListener("change", () => {
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringPrevPageBtn").addEventListener("click", goToPreviousMonitoringPage);
  document.getElementById("monitoringNextPageBtn").addEventListener("click", goToNextMonitoringPage);

  const clearBtn = document.getElementById("clearMonitoringFiltersBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearMonitoringFilters);
  }
}