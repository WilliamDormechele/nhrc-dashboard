// js/monitoring.js

let actionsChartInstance = null;
let projectsChartInstance = null;
let usersChartInstance = null;
let dailyChartInstance = null;

/**
 * Destroy old chart instance before drawing a new one.
 */
function destroyChart(chartInstance) {
  if (chartInstance) {
    chartInstance.destroy();
  }
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

    renderMonitoringSummary(logs);
    renderMonitoringTable(logs);
    renderMonitoringCharts(logs);
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="8">Failed to load monitoring data.</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="8">No activity logs found for the selected period.</td></tr>`;
    return;
  }

  logs.forEach((log) => {
    const tr = document.createElement("tr");

    const dateText = log.createdAt && log.createdAt.toDate
      ? log.createdAt.toDate().toLocaleString()
      : "";

    tr.innerHTML = `
      <td>${dateText}</td>
      <td>${log.fullName || log.email || ""}</td>
      <td>${log.role || ""}</td>
      <td>${log.currentProject || ""}</td>
      <td>${log.action || ""}</td>
      <td>${log.page || ""}</td>
      <td>${log.target || ""}</td>
      <td>${log.durationSeconds || ""}</td>
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
 * Set up monitoring actions.
 */
function setupMonitoringUI() {
  document.getElementById("refreshMonitoringBtn").addEventListener("click", loadMonitoringData);
}