// js/monitoring.js

let actionsChartInstance = null;
let projectsChartInstance = null;
let usersChartInstance = null;
let dailyChartInstance = null;

let monitoringAllLogs = [];
let monitoringUsersByEmail = {};
let monitoringSupervisors = [];
let monitoringFieldworkers = [];
let monitoringFilterOptionsLoaded = false;

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
 * Return current monitoring filter values.
 */
function getMonitoringFilters() {
  return {
    project: document.getElementById("monitoringProjectFilter")?.value || "",
    supervisor: document.getElementById("monitoringSupervisorFilter")?.value || "",
    fieldworker: document.getElementById("monitoringFieldworkerFilter")?.value || ""
  };
}

/**
 * Rebuild project/supervisor/fieldworker dropdowns with hierarchy.
 */
function rebuildMonitoringFilterDropdowns() {
  const projectFilter = document.getElementById("monitoringProjectFilter");
  const supervisorFilter = document.getElementById("monitoringSupervisorFilter");
  const fieldworkerFilter = document.getElementById("monitoringFieldworkerFilter");

  if (!projectFilter || !supervisorFilter || !fieldworkerFilter) return;

  const currentProject = projectFilter.value || "";
  const currentSupervisor = supervisorFilter.value || "";
  const currentFieldworker = fieldworkerFilter.value || "";

  // Project options
  const projectItems = Object.values(window.projectRegistry || {})
    .map((project) => ({
      value: project.code,
      label: `${project.name} (${project.code})`
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  populateSelectOptions("monitoringProjectFilter", projectItems, "All projects");

  if ([...projectFilter.options].some((opt) => opt.value === currentProject)) {
    projectFilter.value = currentProject;
  }

  const selectedProject = projectFilter.value || "";

  // Supervisors limited by selected project if one is chosen
  const supervisorsForProject = monitoringSupervisors.filter((supervisor) => {
    if (!selectedProject) return true;
    return Array.isArray(supervisor.assignedProjects) && supervisor.assignedProjects.includes(selectedProject);
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

  // Fieldworkers limited by selected project and selected supervisor
  const fieldworkersForFilters = monitoringFieldworkers.filter((worker) => {
    const matchesProject = !selectedProject ||
      (Array.isArray(worker.assignedProjects) && worker.assignedProjects.includes(selectedProject));

    const matchesSupervisor = !selectedSupervisor ||
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
 * Apply hierarchical monitoring filters to logs.
 *
 * Supervisor filter includes:
 * - the supervisor's own activity
 * - all fieldworkers assigned to that supervisor
 *
 * Fieldworker filter narrows to one worker only.
 */
function applyMonitoringFilters(logs) {
  const filters = getMonitoringFilters();

  return logs.filter((log) => {
    const logEmail = (log.email || "").toLowerCase();
    const logProject = log.currentProject || "";
    const userProfile = monitoringUsersByEmail[logEmail] || {};
    const workerSupervisorEmail = (userProfile.supervisorEmail || "").toLowerCase();

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

    monitoringAllLogs = logs;
    renderFilteredMonitoringView();
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="8">Failed to load monitoring data.</td></tr>`;
  }
}

/**
 * Re-render monitoring view from selected filters.
 */
function renderFilteredMonitoringView() {
  rebuildMonitoringFilterDropdowns();

  const filteredLogs = applyMonitoringFilters(monitoringAllLogs);

  renderMonitoringSummary(filteredLogs);
  renderMonitoringTable(filteredLogs);
  renderMonitoringCharts(filteredLogs);
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
 * Render monitoring logs table.
 */
function renderMonitoringTable(logs) {
  const tbody = document.getElementById("monitoringTableBody");
  tbody.innerHTML = "";

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
 * Render all monitoring charts.
 */
function renderMonitoringCharts(logs) {
  renderActionsChart(logs);
  renderProjectsChart(logs);
  renderUsersChart(logs);
  renderDailyChart(logs);
}

/**
 * Chart 1: activity by action.
 */
function renderActionsChart(logs) {
  const counts = countBy(logs, (x) => x.action);

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  destroyChart(actionsChartInstance);
  actionsChartInstance = new Chart(document.getElementById("actionsChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Count", data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true
    }
  });
}

/**
 * Chart 2: activity by project.
 */
function renderProjectsChart(logs) {
  const counts = countBy(logs, (x) => x.currentProject || "No Project");

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  destroyChart(projectsChartInstance);
  projectsChartInstance = new Chart(document.getElementById("projectsChart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true
    }
  });
}

/**
 * Chart 3: top active users.
 */
function renderUsersChart(logs) {
  const counts = countBy(logs, (x) => x.fullName || x.email || "Unknown");

  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

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
      maintainAspectRatio: true
    }
  });
}

/**
 * Chart 4: daily activity trend.
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
      datasets: [{ label: "Daily Activity", data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true
    }
  });
}

/**
 * Clear filters.
 */
function clearMonitoringFilters() {
  document.getElementById("monitoringProjectFilter").value = "";
  document.getElementById("monitoringSupervisorFilter").value = "";
  document.getElementById("monitoringFieldworkerFilter").value = "";
  renderFilteredMonitoringView();
}

/**
 * Set up monitoring actions.
 */
function setupMonitoringUI() {
  document.getElementById("refreshMonitoringBtn").addEventListener("click", loadMonitoringData);
  document.getElementById("monitoringDays").addEventListener("change", loadMonitoringData);

  document.getElementById("monitoringProjectFilter").addEventListener("change", () => {
    document.getElementById("monitoringSupervisorFilter").value = "";
    document.getElementById("monitoringFieldworkerFilter").value = "";
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringSupervisorFilter").addEventListener("change", () => {
    document.getElementById("monitoringFieldworkerFilter").value = "";
    renderFilteredMonitoringView();
  });

  document.getElementById("monitoringFieldworkerFilter").addEventListener("change", renderFilteredMonitoringView);

  const clearBtn = document.getElementById("clearMonitoringFiltersBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearMonitoringFilters);
  }
}