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
 * Split an array into chunks for Firestore "in" / "array-contains-any" queries.
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
 *
 * Admin/developer:
 * - can read all users
 *
 * Field headquarters:
 * - can only read users tied to their allowed assigned projects
 * - this matches the stricter Firestore rules
 */
async function loadMonitoringUsersAndFilters() {
  monitoringUsersByEmail = {};
  monitoringSupervisors = [];
  monitoringFieldworkers = [];

  // Admin / developer: can read the full users collection
  if (canMonitorAllProjects()) {
    const snapshot = await db.collection("users").orderBy("fullName").get();

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

    monitoringSupervisors.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    monitoringFieldworkers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    monitoringFilterOptionsLoaded = true;
    return;
  }

  // Field headquarters: read from monitoring_directory only
  const allowedProjectCodes = getAllowedMonitoringProjectCodes();

  if (!allowedProjectCodes.length) {
    monitoringFilterOptionsLoaded = true;
    return;
  }

  const projectChunks = chunkArray(allowedProjectCodes, 10);

  const snapshots = await Promise.all(
    projectChunks.map((projectChunk) =>
      db.collection("monitoring_directory")
        .where("isActive", "==", true)
        .where("assignedProjects", "array-contains-any", projectChunk)
        .get()
    )
  );

  const userMap = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.forEach((doc) => {
      const user = { id: doc.id, ...doc.data() };
      userMap.set(doc.id, user);
    });
  });

  [...userMap.values()].forEach((user) => {
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

  monitoringSupervisors.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  monitoringFieldworkers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  monitoringFilterOptionsLoaded = true;
}
  // Field headquarters must read from monitoring_directory, not users
  const allowedProjectCodes = getAllowedMonitoringProjectCodes();

  if (!allowedProjectCodes.length) {
    monitoringFilterOptionsLoaded = true;
    return;
  }

  const projectChunks = chunkArray(allowedProjectCodes, 10);

  const snapshots = await Promise.all(
    projectChunks.map((projectChunk) =>
      db.collection("monitoring_directory")
        .where("isActive", "==", true)
        .where("assignedProjects", "array-contains-any", projectChunk)
        .get()
    )
  );

  const userMap = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.forEach((doc) => {
      const user = { id: doc.id, ...doc.data() };
      userMap.set(doc.id, user);
    });
  });

  [...userMap.values()].forEach((user) => {
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

  monitoringSupervisors.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  monitoringFieldworkers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
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
 * Rebuild table-only dropdowns from currently visible primary-filtered logs.
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
 *
 * Supervisor filter includes:
 * - the supervisor's own activity
 * - all fieldworkers assigned to that supervisor
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
 * Load monitoring data.
 */
async function loadMonitoringData() {
  const days = parseInt(document.getElementById("monitoringDays").value, 10);
  const tbody = document.getElementById("monitoringTableBody");

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8">Loading activity logs...</td></tr>`;
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startTimestamp = firebase.firestore.Timestamp.fromDate(startDate);

  try {
    await loadProjectsRegistry();

    await loadMonitoringUsersAndFilters();

    rebuildMonitoringFilterDropdowns();

    const logs = await fetchMonitoringLogs(startTimestamp);

    monitoringAllLogs = logs;
    monitoringTableState.currentPage = 1;
    renderFilteredMonitoringView();
  } catch (error) {
    console.error(error);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8">Failed to load monitoring data.</td></tr>`;
    }
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
 * Table-only filters affect:
 * - Recent Activity Logs only
 */
function renderFilteredMonitoringView() {
  rebuildMonitoringFilterDropdowns();

  const primaryFilteredLogs = applyMonitoringFilters(monitoringAllLogs);

  renderMonitoringSummary(primaryFilteredLogs);
  renderMonitoringCharts(primaryFilteredLogs);

  const hasAdvancedTableFilters =
    document.getElementById("monitoringActionFilter") &&
    document.getElementById("monitoringPageFilter") &&
    document.getElementById("monitoringPageSize");

  if (hasAdvancedTableFilters) {
    rebuildMonitoringTableFilterDropdowns(primaryFilteredLogs);
    const tableFilteredLogs = applyMonitoringTableFilters(primaryFilteredLogs);
    renderMonitoringTable(tableFilteredLogs);
  } else {
    renderMonitoringTable(primaryFilteredLogs);
  }
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

  const statLogins = document.getElementById("statLogins");
  const statDownloads = document.getElementById("statDownloads");
  const statUsers = document.getElementById("statUsers");
  const statMinutes = document.getElementById("statMinutes");

  if (statLogins) statLogins.textContent = loginCount;
  if (statDownloads) statDownloads.textContent = downloadCount;
  if (statUsers) statUsers.textContent = uniqueUsers;
  if (statMinutes) statMinutes.textContent = totalMinutes;
}

/**
 * Render paginated monitoring logs table.
 */
function renderMonitoringTable(logs) {
  const tbody = document.getElementById("monitoringTableBody");
  if (!tbody) return;

  const countEl = document.getElementById("monitoringLogsCount");
  const pageInfoEl = document.getElementById("monitoringPageInfo");
  const prevBtn = document.getElementById("monitoringPrevPageBtn");
  const nextBtn = document.getElementById("monitoringNextPageBtn");
  const pageSizeSelect = document.getElementById("monitoringPageSize");

  tbody.innerHTML = "";

  const hasPagination = !!pageSizeSelect;

  if (!hasPagination) {
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">No activity logs found for the selected period and filters.</td></tr>`;
      return;
    }

    logs.forEach((log) => {
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

    return;
  }

  const pageSize = parseInt(pageSizeSelect.value || "25", 10);
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

  if (countEl) {
    countEl.textContent = `${totalRows} record${totalRows === 1 ? "" : "s"}`;
  }

  if (pageInfoEl) {
    pageInfoEl.textContent = `Page ${monitoringTableState.currentPage} of ${totalPages}`;
  }

  if (prevBtn) {
    prevBtn.disabled = monitoringTableState.currentPage <= 1;
  }

  if (nextBtn) {
    nextBtn.disabled = monitoringTableState.currentPage >= totalPages;
  }

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

  if (document.getElementById("rolesChart")) {
    renderRolesChart(logs);
  }

  if (document.getElementById("pagesChart")) {
    renderPagesChart(logs);
  }
}

/**
 * Activity by action.
 */
function renderActionsChart(logs) {
  const canvas = document.getElementById("actionsChart");
  if (!canvas) return;

  const counts = countBy(logs, (x) => x.action);
  const entries = topEntriesFromCounts(counts, 8);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(actionsChartInstance);
  actionsChartInstance = new Chart(canvas, {
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
  const canvas = document.getElementById("projectsChart");
  if (!canvas) return;

  const counts = countBy(logs, (x) => x.currentProject || "No Project");
  const entries = topEntriesFromCounts(counts, 8);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(projectsChartInstance);
  projectsChartInstance = new Chart(canvas, {
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
  const canvas = document.getElementById("usersChart");
  if (!canvas) return;

  const counts = countBy(logs, (x) => x.fullName || x.email || "Unknown");
  const entries = topEntriesFromCounts(counts, 10);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(usersChartInstance);
  usersChartInstance = new Chart(canvas, {
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
  const canvas = document.getElementById("dailyChart");
  if (!canvas) return;

  const counts = {};

  logs.forEach((log) => {
    if (!log.createdAt || !log.createdAt.toDate) return;
    const day = log.createdAt.toDate().toISOString().slice(0, 10);
    counts[day] = (counts[day] || 0) + 1;
  });

  const labels = Object.keys(counts).sort();
  const values = labels.map((label) => counts[label]);

  destroyChart(dailyChartInstance);
  dailyChartInstance = new Chart(canvas, {
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
  const canvas = document.getElementById("rolesChart");
  if (!canvas) return;

  const counts = countBy(logs, (x) => x.role || "Unknown");

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  destroyChart(rolesChartInstance);
  rolesChartInstance = new Chart(canvas, {
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
  const canvas = document.getElementById("pagesChart");
  if (!canvas) return;

  const counts = countBy(logs, (x) => x.page || "Unknown");
  const entries = topEntriesFromCounts(counts, 10);

  const labels = entries.map((x) => x[0]);
  const values = entries.map((x) => x[1]);

  destroyChart(pagesChartInstance);
  pagesChartInstance = new Chart(canvas, {
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
 * Reset filters.
 */
function clearMonitoringFilters() {
  const projectFilter = document.getElementById("monitoringProjectFilter");
  const supervisorFilter = document.getElementById("monitoringSupervisorFilter");
  const fieldworkerFilter = document.getElementById("monitoringFieldworkerFilter");
  const actionFilter = document.getElementById("monitoringActionFilter");
  const pageFilter = document.getElementById("monitoringPageFilter");
  const startDate = document.getElementById("monitoringStartDate");
  const endDate = document.getElementById("monitoringEndDate");
  const searchText = document.getElementById("monitoringSearchText");
  const pageSize = document.getElementById("monitoringPageSize");

  if (projectFilter) projectFilter.value = "";
  if (supervisorFilter) supervisorFilter.value = "";
  if (fieldworkerFilter) fieldworkerFilter.value = "";

  if (actionFilter) actionFilter.value = "";
  if (pageFilter) pageFilter.value = "";
  if (startDate) startDate.value = "";
  if (endDate) endDate.value = "";
  if (searchText) searchText.value = "";
  if (pageSize) pageSize.value = "25";

  monitoringTableState.currentPage = 1;
  renderFilteredMonitoringView();
}

/**
 * Pagination helpers.
 */
function goToPreviousMonitoringPage() {
  monitoringTableState.currentPage -= 1;
  renderFilteredMonitoringView();
}

function goToNextMonitoringPage() {
  monitoringTableState.currentPage += 1;
  renderFilteredMonitoringView();
}

/**
 * Wire up monitoring events.
 */
function setupMonitoringUI() {
  const refreshBtn = document.getElementById("refreshMonitoringBtn");
  const daysSelect = document.getElementById("monitoringDays");
  const projectFilter = document.getElementById("monitoringProjectFilter");
  const supervisorFilter = document.getElementById("monitoringSupervisorFilter");
  const fieldworkerFilter = document.getElementById("monitoringFieldworkerFilter");
  const clearBtn = document.getElementById("clearMonitoringFiltersBtn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadMonitoringData);
  }

  if (daysSelect) {
    daysSelect.addEventListener("change", loadMonitoringData);
  }

  if (projectFilter) {
    projectFilter.addEventListener("change", () => {
      if (supervisorFilter) supervisorFilter.value = "";
      if (fieldworkerFilter) fieldworkerFilter.value = "";
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (supervisorFilter) {
    supervisorFilter.addEventListener("change", () => {
      if (fieldworkerFilter) fieldworkerFilter.value = "";
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (fieldworkerFilter) {
    fieldworkerFilter.addEventListener("change", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  const actionFilter = document.getElementById("monitoringActionFilter");
  const pageFilter = document.getElementById("monitoringPageFilter");
  const startDate = document.getElementById("monitoringStartDate");
  const endDate = document.getElementById("monitoringEndDate");
  const searchText = document.getElementById("monitoringSearchText");
  const pageSize = document.getElementById("monitoringPageSize");
  const prevBtn = document.getElementById("monitoringPrevPageBtn");
  const nextBtn = document.getElementById("monitoringNextPageBtn");

  if (actionFilter) {
    actionFilter.addEventListener("change", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (pageFilter) {
    pageFilter.addEventListener("change", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (startDate) {
    startDate.addEventListener("change", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (endDate) {
    endDate.addEventListener("change", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (searchText) {
    searchText.addEventListener("input", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (pageSize) {
    pageSize.addEventListener("change", () => {
      monitoringTableState.currentPage = 1;
      renderFilteredMonitoringView();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", goToPreviousMonitoringPage);
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", goToNextMonitoringPage);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", clearMonitoringFilters);
  }
}