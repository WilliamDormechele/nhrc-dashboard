(() => {
  "use strict";

  const FACILITIES = [
    "War Memorial Hospital",
    "Paga District Hospital",
    "Pungu Central",
    "Martyrs of Uganda Health Centre, Sirigu"
  ];

  const COLORS = {
    navy: "#17324D",
    blue: "#2F6F9F",
    teal: "#16867A",
    green: "#2E7D5B",
    amber: "#C58A1B",
    red: "#C94B4B",
    slate: "#7C8D9C",
    grid: "#E6EDF2"
  };

  const state = {
    data: null,
    section: "overview",
    filters: {
      facility: "",
      collector: "",
      dateFrom: "",
      dateTo: ""
    },
    returnWindowDays: null,
    charts: new Map()
  };

  const els = {
    loading: document.getElementById("loadingOverlay"),
    errorPanel: document.getElementById("errorPanel"),
    errorMessage: document.getElementById("errorMessage"),
    liveStatus: document.getElementById("liveStatus"),
    dataCurrentTo: document.getElementById("dataCurrentTo"),
    mainStatus: document.getElementById("mainSourceStatus"),
    devicesStatus: document.getElementById("devicesSourceStatus"),
    activeFilterSummary: document.getElementById("activeFilterSummary"),
    facilityFilter: document.getElementById("facilityFilter"),
    collectorFilter: document.getElementById("collectorFilter"),
    dateFromFilter: document.getElementById("dateFromFilter"),
    dateToFilter: document.getElementById("dateToFilter"),
    returnWindowFilter: document.getElementById("returnWindowFilter")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function number(value, decimals = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "—";
    return parsed.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function percent(numerator, denominator, decimals = 1) {
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
    return (100 * n) / d;
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(includeTime ? value : `${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      timeZone: "Europe/London"
    }).format(date);
  }

  function dateInRange(value) {
    if (!value) return !state.filters.dateFrom && !state.filters.dateTo;
    if (state.filters.dateFrom && value < state.filters.dateFrom) return false;
    if (state.filters.dateTo && value > state.filters.dateTo) return false;
    return true;
  }

  function participantMatches(row) {
    if (state.filters.facility && row.facility !== state.filters.facility) return false;
    if (state.filters.collector && row.dataCollector !== state.filters.collector) return false;
    return dateInRange(row.enrollmentDate);
  }

  function diaryMatches(row) {
    if (state.filters.facility && row.facility !== state.filters.facility) return false;
    if (state.filters.collector && row.dataCollector !== state.filters.collector) return false;
    return dateInRange(row.diaryDate);
  }

  function deviceMatches(row) {
    if (state.filters.facility && row.latestFacility !== state.filters.facility) return false;
    return true;
  }

  function filteredParticipants() {
    return (state.data?.participants || []).filter(participantMatches);
  }

  function filteredDiaries() {
    return (state.data?.activityDiaries || []).filter(diaryMatches);
  }

  function filteredDeviceSets() {
    return (state.data?.deviceSets || []).filter(deviceMatches);
  }

  function filteredDistributions() {
    return (state.data?.deviceDistributions || []).filter((row) => {
      if (state.filters.facility && row.facility !== state.filters.facility) return false;
      return dateInRange(row.distributionDate);
    });
  }

  function filteredReturns() {
    return (state.data?.deviceReturns || []).filter((row) => dateInRange(row.returnDate));
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  }

  function countBy(rows, key) {
    const result = new Map();
    rows.forEach((row) => {
      const value = row[key] || "Unassigned";
      result.set(value, (result.get(value) || 0) + 1);
    });
    return result;
  }

  function sumBy(rows, key) {
    return rows.reduce((sum, row) => {
      const value = Number(row[key]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function average(values) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }

  function weekStartMonday(dateString) {
    if (!dateString) return "";
    const ms = Date.parse(`${dateString}T00:00:00Z`);
    if (!Number.isFinite(ms)) return "";

    const date = new Date(ms);
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date.toISOString().slice(0, 10);
  }

  function weeklyCounts(rows, dateField) {
    const map = new Map();

    rows.forEach((row) => {
      const week = weekStartMonday(row[dateField]);
      if (!week) return;
      map.set(week, (map.get(week) || 0) + 1);
    });

    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, count]) => ({ weekStart, count }));
  }

  function kpiCard(label, value, tone = "info", note = "") {
    return `
      <article class="kpi-card ${tone}">
        <span class="kpi-label">${escapeHtml(label)}</span>
        <strong class="kpi-value">${escapeHtml(value)}</strong>
        ${note ? `<span class="kpi-note">${escapeHtml(note)}</span>` : ""}
      </article>
    `;
  }

  function panel(title, content, span = 6, className = "") {
    return `
      <article class="panel span-${span} ${className}">
        <div class="panel-title-row">
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${content}
      </article>
    `;
  }

  function emptyState(message) {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function table(headers, rows, rowAttributes = []) {
    if (!rows.length) return emptyState("No records match the current filters.");

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows.map((cells, i) => {
              const attrs = rowAttributes[i] || "";
              return `<tr ${attrs}>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function severityChip(severity) {
    const safe = String(severity || "Medium").toLowerCase();
    return `<span class="severity-chip severity-${safe}">${escapeHtml(severity)}</span>`;
  }

  function statusChip(status) {
    const normalized = String(status || "").toLowerCase();
    let className = "status-neutral";
    if (["success", "returned", "complete", "current"].includes(normalized)) className = "status-success";
    if (["distributed", "due today", "within return window", "warning"].includes(normalized)) className = "status-warning";
    if (["error", "overdue", "incomplete"].includes(normalized)) className = "status-error";
    return `<span class="status-chip ${className}">${escapeHtml(status || "Unknown")}</span>`;
  }

  function chartCanvas(id, short = false) {
    return `<div class="chart-wrap ${short ? "chart-short" : ""}"><canvas id="${id}"></canvas></div>`;
  }

  function destroyChart(id) {
    const chart = state.charts.get(id);
    if (chart) {
      chart.destroy();
      state.charts.delete(id);
    }
  }

  function buildChart(id, config, clickHandler = null) {
    destroyChart(id);
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;

    const options = config.options || {};
    options.responsive = true;
    options.maintainAspectRatio = false;
    options.animation = false;
    options.plugins = {
      legend: {
        display: config.data.datasets.length > 1,
        position: "top",
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: "#637789",
          font: { size: 10 }
        }
      },
      tooltip: { enabled: true },
      ...(options.plugins || {})
    };
    options.scales = {
      x: {
        grid: { display: false },
        ticks: { color: "#637789", font: { size: 10 } }
      },
      y: {
        beginAtZero: true,
        grid: { color: COLORS.grid },
        ticks: { precision: 0, color: "#637789", font: { size: 10 } }
      },
      ...(options.scales || {})
    };

    if (clickHandler) {
      options.onClick = (event, elements, chart) => {
        if (!elements.length) return;
        const index = elements[0].index;
        clickHandler(chart.data.labels[index], index);
      };
    }

    const chart = new Chart(canvas, { ...config, options });
    state.charts.set(id, chart);
  }

  function setFacilityFilter(value) {
    state.filters.facility = value || "";
    els.facilityFilter.value = state.filters.facility;
    renderActiveFilterSummary();
    renderCurrentSection();
  }

  function setCollectorFilter(value) {
    state.filters.collector = value || "";
    els.collectorFilter.value = state.filters.collector;
    renderActiveFilterSummary();
    renderCurrentSection();
  }

  function renderActiveFilterSummary() {
    const parts = [];
    if (state.filters.facility) parts.push(state.filters.facility);
    if (state.filters.collector) parts.push(state.filters.collector);
    if (state.filters.dateFrom) parts.push(`From ${formatDate(state.filters.dateFrom)}`);
    if (state.filters.dateTo) parts.push(`To ${formatDate(state.filters.dateTo)}`);
    els.activeFilterSummary.textContent = parts.length ? parts.join(" • ") : "None";
  }

  function populateFilters() {
    const participants = state.data?.participants || [];
    const facilities = unique([...FACILITIES, ...participants.map((r) => r.facility)]);
    const collectors = unique(participants.map((r) => r.dataCollector));

    els.facilityFilter.innerHTML =
      '<option value="">All facilities</option>' +
      facilities.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");

    els.collectorFilter.innerHTML =
      '<option value="">All collectors</option>' +
      collectors.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");

    els.facilityFilter.value = state.filters.facility;
    els.collectorFilter.value = state.filters.collector;

    const options = state.data?.config?.returnWindowOptions || [1, 2, 3, 5, 7, 10, 14];
    const configured = state.data?.config?.returnWindowDays;
    if (state.returnWindowDays === null) {
      state.returnWindowDays = configured || options.find((v) => Number(v) === 3) || options[0] || 3;
    }

    els.returnWindowFilter.innerHTML = options
      .map((days) => `<option value="${days}">${days} day${Number(days) === 1 ? "" : "s"}</option>`)
      .join("");
    els.returnWindowFilter.value = String(state.returnWindowDays);
  }

  function renderFreshness() {
    const data = state.data;
    const main = data?.sourceStatus?.main || {};
    const devices = data?.sourceStatus?.devices || {};
    const bothSuccess = main.status === "success" && devices.status === "success";

    els.dataCurrentTo.textContent = formatDate(data?.fetchedAt, true);
    els.mainStatus.innerHTML =
      main.status === "success" ? "● Current" : "● Unavailable";
    els.devicesStatus.innerHTML =
      devices.status === "success" ? "● Current" : "● Unavailable";

    els.mainStatus.style.color = main.status === "success" ? COLORS.green : COLORS.red;
    els.devicesStatus.style.color = devices.status === "success" ? COLORS.green : COLORS.red;

    els.liveStatus.innerHTML = `
      <span class="status-dot ${bothSuccess ? "status-good" : "status-warning"}"></span>
      <span>${bothSuccess ? "Live REDCap data" : "Partial data"}</span>
    `;
  }

  function getOverviewMetrics() {
    const participants = filteredParticipants();
    const diaries = filteredDiaries();
    const target = Number(state.data?.config?.participantTarget || 200);
    const expectedPerParticipant = Number(
      state.data?.config?.activityDiariesExpectedPerParticipant || 6
    );
    const diaryExpected = participants.length * expectedPerParticipant;
    const diaryComplete = diaries.filter((r) => r.diaryComplete).length;
    const sameDay = diaries.filter((r) => r.sameDayInterview === "Yes").length;
    const delayed = diaries.filter((r) => r.sameDayInterview === "No").length;
    const calls = sumBy(diaries, "callsMade");

    return {
      participants,
      diaries,
      target,
      enrolled: participants.length,
      remaining: Math.max(target - participants.length, 0),
      recruitmentPct: percent(participants.length, target),
      recruitingFacilities: unique(participants.map((r) => r.facility)).length,
      enrollmentComplete: participants.filter((r) => r.enrollmentComplete).length,
      maternalComplete: participants.filter((r) => r.maternalRecordComplete).length,
      physicalComplete: participants.filter((r) => r.physicalExamComplete).length,
      coreComplete: participants.filter(
        (r) => r.enrollmentComplete && r.maternalRecordComplete && r.physicalExamComplete
      ).length,
      diaryExpected,
      diaryComplete,
      diaryOutstanding: Math.max(diaryExpected - diaryComplete, 0),
      diaryCompletionPct: percent(diaryComplete, diaryExpected),
      sameDay,
      delayed,
      onTimePct: percent(sameDay, diaryComplete),
      delayedPct: percent(delayed, diaryComplete),
      calls,
      avgCalls: average(diaries.map((r) => r.callsMade)),
      avgDelay: average(diaries.map((r) => r.delayDays)),
      maxDelay: Math.max(0, ...diaries.map((r) => Number(r.delayDays)).filter(Number.isFinite))
    };
  }

  function renderOverview() {
    const content = document.getElementById("overviewContent");
    const m = getOverviewMetrics();

    const facilityCounts = FACILITIES.map((facility) => ({
      facility,
      count: m.participants.filter((r) => r.facility === facility).length
    }));
    const forms = [
      { label: "Enrollment Form", expected: m.enrolled, completed: m.enrollmentComplete },
      { label: "Maternal Record Book", expected: m.enrolled, completed: m.maternalComplete },
      { label: "Physical Examination", expected: m.enrolled, completed: m.physicalComplete },
      { label: "Activity Diary", expected: m.diaryExpected, completed: m.diaryComplete }
    ];

    content.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("Participants Enrolled", number(m.enrolled), "info", `Target ${m.target}`)}
        ${kpiCard("Overall Study Target", number(m.target), "neutral", "Across four study facilities")}
        ${kpiCard("Recruitment Progress", `${number(m.recruitmentPct, 1)}%`, "positive", `${m.remaining} participants remaining`)}
        ${kpiCard("Activity Diaries Complete", number(m.diaryComplete), m.diaryOutstanding ? "warning" : "positive", `${m.diaryOutstanding} outstanding of ${m.diaryExpected}`)}
        ${kpiCard("Enrollment Forms Complete", number(m.enrollmentComplete), "positive")}
        ${kpiCard("Maternal Records Complete", number(m.maternalComplete), "positive")}
        ${kpiCard("Physical Exams Complete", number(m.physicalComplete), "positive")}
        ${kpiCard("On-Time Interviews", `${number(m.onTimePct, 1)}%`, m.onTimePct >= 80 ? "positive" : "warning")}
      </div>

      <div class="dashboard-grid">
        ${panel("Recruitment by Facility", chartCanvas("overviewRecruitment"), 6)}
        ${panel("Expected vs Completed Forms", chartCanvas("overviewForms"), 6)}
      </div>
    `;

    buildChart(
      "overviewRecruitment",
      {
        type: "bar",
        data: {
          labels: facilityCounts.map((r) => r.facility),
          datasets: [{
            label: "Participants",
            data: facilityCounts.map((r) => r.count),
            backgroundColor: COLORS.blue,
            borderRadius: 5
          }]
        },
        options: {
          indexAxis: "y",
          plugins: { legend: { display: false } }
        }
      },
      (label) => setFacilityFilter(label)
    );

    buildChart("overviewForms", {
      type: "bar",
      data: {
        labels: forms.map((r) => r.label),
        datasets: [
          {
            label: "Expected",
            data: forms.map((r) => r.expected),
            backgroundColor: "#BFD0DD",
            borderRadius: 4
          },
          {
            label: "Completed",
            data: forms.map((r) => r.completed),
            backgroundColor: COLORS.teal,
            borderRadius: 4
          }
        ]
      },
      options: { indexAxis: "y" }
    });
  }

  function renderRecruitment() {
    const content = document.getElementById("recruitmentContent");
    const participants = filteredParticipants();
    const target = Number(state.data?.config?.participantTarget || 200);
    const byFacility = FACILITIES.map((facility) => ({
      facility,
      count: participants.filter((r) => r.facility === facility).length
    }));
    const collectorMap = countBy(participants, "dataCollector");
    const collectors = [...collectorMap.entries()].map(([name, count]) => ({ name, count }));

    content.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("Participants Enrolled", number(participants.length), "info")}
        ${kpiCard("Overall Study Target", number(target), "neutral")}
        ${kpiCard("Recruitment Progress", `${number(percent(participants.length, target), 1)}%`, "positive")}
        ${kpiCard("Participants Remaining", number(Math.max(target - participants.length, 0)), "info")}
      </div>

      <div class="dashboard-grid">
        ${panel("Participants Enrolled by Facility", chartCanvas("recruitmentFacility"), 6)}
        ${panel("Participants by Data Collector", chartCanvas("recruitmentCollector"), 6)}
        ${panel("Weekly and Cumulative Recruitment", chartCanvas("recruitmentTrend", true), 12)}
        ${panel(
          "Participant Operational Status",
          table(
            ["Study ID", "Facility", "Enrollment Date", "Data Collector", "Physical Exam Date"],
            participants.map((r) => [
              escapeHtml(r.studyId || "—"),
              escapeHtml(r.facility || "—"),
              escapeHtml(formatDate(r.enrollmentDate)),
              escapeHtml(r.dataCollector || "—"),
              escapeHtml(formatDate(r.physicalExamDate))
            ]),
            participants.map((r) =>
              `data-filter-facility="${escapeHtml(r.facility)}" data-filter-collector="${escapeHtml(r.dataCollector)}"`
            )
          ),
          12
        )}
      </div>
    `;

    buildChart(
      "recruitmentFacility",
      {
        type: "bar",
        data: {
          labels: byFacility.map((r) => r.facility),
          datasets: [{
            label: "Participants",
            data: byFacility.map((r) => r.count),
            backgroundColor: COLORS.blue,
            borderRadius: 5
          }]
        },
        options: { indexAxis: "y", plugins: { legend: { display: false } } }
      },
      (label) => setFacilityFilter(label)
    );

    const weeklyRecruitment = weeklyCounts(participants, "enrollmentDate");
    let cumulativeRecruitment = 0;
    const cumulativeValues = weeklyRecruitment.map((row) => {
      cumulativeRecruitment += row.count;
      return cumulativeRecruitment;
    });

    buildChart("recruitmentTrend", {
      type: "bar",
      data: {
        labels: weeklyRecruitment.map((row) => formatDate(row.weekStart)),
        datasets: [
          {
            type: "bar",
            label: "Weekly Enrolled",
            data: weeklyRecruitment.map((row) => row.count),
            backgroundColor: "#BFD0DD",
            borderRadius: 4
          },
          {
            type: "line",
            label: "Cumulative Enrolled",
            data: cumulativeValues,
            borderColor: COLORS.teal,
            backgroundColor: COLORS.teal,
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 3,
            pointHoverRadius: 4
          }
        ]
      }
    });

    buildChart(
      "recruitmentCollector",
      {
        type: "bar",
        data: {
          labels: collectors.map((r) => r.name),
          datasets: [{
            label: "Participants",
            data: collectors.map((r) => r.count),
            backgroundColor: COLORS.teal,
            borderRadius: 5
          }]
        },
        options: { indexAxis: "y", plugins: { legend: { display: false } } }
      },
      (label) => setCollectorFilter(label)
    );
  }

  function formRows(participants, diaries) {
    const expectedPerParticipant = Number(
      state.data?.config?.activityDiariesExpectedPerParticipant || 6
    );
    return [
      {
        form: "Enrollment Form",
        expected: participants.length,
        completed: participants.filter((r) => r.enrollmentComplete).length
      },
      {
        form: "Maternal Record Book",
        expected: participants.length,
        completed: participants.filter((r) => r.maternalRecordComplete).length
      },
      {
        form: "Physical Examination",
        expected: participants.length,
        completed: participants.filter((r) => r.physicalExamComplete).length
      },
      {
        form: "Activity Diary",
        expected: participants.length * expectedPerParticipant,
        completed: diaries.filter((r) => r.diaryComplete).length
      }
    ].map((r) => ({
      ...r,
      missing: Math.max(r.expected - r.completed, 0),
      completionPct: percent(r.completed, r.expected)
    }));
  }

  function renderForms() {
    const content = document.getElementById("formsContent");
    const participants = filteredParticipants();
    const diaries = filteredDiaries();
    const forms = formRows(participants, diaries);

    content.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("Enrollment Complete", number(forms[0].completed), forms[0].missing ? "warning" : "positive")}
        ${kpiCard("Maternal Records Complete", number(forms[1].completed), forms[1].missing ? "warning" : "positive")}
        ${kpiCard("Physical Exams Complete", number(forms[2].completed), forms[2].missing ? "warning" : "positive")}
        ${kpiCard("Activity Diaries Complete", number(forms[3].completed), forms[3].missing ? "warning" : "positive", `${forms[3].missing} outstanding`)}
      </div>

      <div class="dashboard-grid">
        ${panel("Expected vs Completed Forms", chartCanvas("formsCompletion"), 7)}
        ${panel(
          "Form Completion Detail",
          table(
            ["Form", "Expected", "Completed", "Missing", "Completion"],
            forms.map((r) => [
              escapeHtml(r.form),
              number(r.expected),
              number(r.completed),
              number(r.missing),
              `${number(r.completionPct, 1)}%`
            ])
          ),
          5
        )}
        ${panel("Core Form Completion by Facility", chartCanvas("formsByFacility", true), 12)}
      </div>
    `;

    buildChart("formsCompletion", {
      type: "bar",
      data: {
        labels: forms.map((r) => r.form),
        datasets: [
          {
            label: "Expected",
            data: forms.map((r) => r.expected),
            backgroundColor: "#BFD0DD",
            borderRadius: 4
          },
          {
            label: "Completed",
            data: forms.map((r) => r.completed),
            backgroundColor: COLORS.teal,
            borderRadius: 4
          }
        ]
      },
      options: { indexAxis: "y" }
    });

    const coreFormsByFacility = FACILITIES.map((facility) => {
      const rows = participants.filter((row) => row.facility === facility);
      return {
        facility,
        expected: rows.length * 3,
        completed:
          rows.filter((row) => row.enrollmentComplete).length +
          rows.filter((row) => row.maternalRecordComplete).length +
          rows.filter((row) => row.physicalExamComplete).length
      };
    });

    buildChart(
      "formsByFacility",
      {
        type: "bar",
        data: {
          labels: coreFormsByFacility.map((row) => row.facility),
          datasets: [
            {
              label: "Expected Core Forms",
              data: coreFormsByFacility.map((row) => row.expected),
              backgroundColor: "#BFD0DD",
              borderRadius: 4
            },
            {
              label: "Completed Core Forms",
              data: coreFormsByFacility.map((row) => row.completed),
              backgroundColor: COLORS.teal,
              borderRadius: 4
            }
          ]
        },
        options: { indexAxis: "y" }
      },
      (label) => setFacilityFilter(label)
    );
  }

  function renderDiary() {
    const content = document.getElementById("diaryContent");
    const diaries = filteredDiaries();
    const participants = filteredParticipants();
    const expected = participants.length * Number(
      state.data?.config?.activityDiariesExpectedPerParticipant || 6
    );
    const complete = diaries.filter((r) => r.diaryComplete).length;
    const sameDay = diaries.filter((r) => r.sameDayInterview === "Yes").length;
    const delayed = diaries.filter((r) => r.sameDayInterview === "No").length;
    const calls = sumBy(diaries, "callsMade");
    const avgCalls = average(diaries.map((r) => r.callsMade));
    const avgDelay = average(diaries.map((r) => r.delayDays));
    const maxDelay = Math.max(0, ...diaries.map((r) => Number(r.delayDays)).filter(Number.isFinite));

    const callsByFacility = FACILITIES.map((facility) => ({
      facility,
      calls: sumBy(diaries.filter((r) => r.facility === facility), "callsMade")
    }));
    const instanceMap = countBy(diaries, "diaryInstance");

    content.innerHTML = `
      <div class="kpi-grid kpi-grid-6">
        ${kpiCard("Completion", `${number(percent(complete, expected), 1)}%`, complete < expected ? "warning" : "positive", `${complete} of ${expected}`)}
        ${kpiCard("On-Time", `${number(percent(sameDay, complete), 1)}%`, "positive", `${sameDay} same-day interviews`)}
        ${kpiCard("Delayed", `${number(percent(delayed, complete), 1)}%`, delayed ? "problem" : "positive", `${delayed} delayed interviews`)}
        ${kpiCard("Avg Call Attempts", number(avgCalls, 2), "info", `${calls} total calls`)}
        ${kpiCard("Avg Delay", number(avgDelay, 2), avgDelay > 0 ? "warning" : "positive", "Days")}
        ${kpiCard("Max Delay", number(maxDelay), maxDelay > 0 ? "problem" : "positive", "Days")}
      </div>

      <div class="dashboard-grid">
        ${panel("Call Attempts by Facility", chartCanvas("diaryCalls", true), 4)}
        ${panel("Interview Timing", chartCanvas("diaryTiming", true), 4)}
        ${panel("Diary Instances Recorded", chartCanvas("diaryInstances", true), 4)}
        ${panel(
          "Activity Diary Operational Detail",
          table(
            ["Facility", "Data Collector", "Instance", "Diary Date", "Same-Day", "Interview Date", "Delay", "Calls"],
            diaries.map((r) => [
              escapeHtml(r.facility || "—"),
              escapeHtml(r.dataCollector || "—"),
              number(r.diaryInstance),
              escapeHtml(formatDate(r.diaryDate)),
              escapeHtml(r.sameDayInterview || "—"),
              escapeHtml(formatDate(r.interviewDate)),
              r.delayDays === null ? "—" : number(r.delayDays),
              r.callsMade === null ? "—" : number(r.callsMade)
            ]),
            diaries.map((r) =>
              `data-filter-facility="${escapeHtml(r.facility)}" data-filter-collector="${escapeHtml(r.dataCollector)}"`
            )
          ),
          12
        )}
      </div>
    `;

    buildChart(
      "diaryCalls",
      {
        type: "bar",
        data: {
          labels: callsByFacility.map((r) => r.facility),
          datasets: [{
            label: "Call Attempts",
            data: callsByFacility.map((r) => r.calls),
            backgroundColor: COLORS.blue,
            borderRadius: 5
          }]
        },
        options: { plugins: { legend: { display: false } } }
      },
      (label) => setFacilityFilter(label)
    );

    buildChart("diaryTiming", {
      type: "bar",
      data: {
        labels: ["No", "Yes"],
        datasets: [{
          label: "Diaries",
          data: [delayed, sameDay],
          backgroundColor: [COLORS.red, COLORS.teal],
          borderRadius: 5
        }]
      },
      options: { plugins: { legend: { display: false } } }
    });

    const instances = [...instanceMap.entries()]
      .filter(([key]) => key !== "Unassigned")
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    buildChart("diaryInstances", {
      type: "bar",
      data: {
        labels: instances.map(([key]) => String(key)),
        datasets: [{
          label: "Diaries",
          data: instances.map(([, count]) => count),
          backgroundColor: COLORS.teal,
          borderRadius: 5
        }]
      },
      options: { plugins: { legend: { display: false } } }
    });
  }

  function deviceStatusWithWindow(deviceSet, windowDays) {
    if (!deviceSet) return { status: "Unknown", expectedReturnDate: "", isOverdue: false };
    if (deviceSet.currentStatus === "Returned") {
      return {
        status: "Returned",
        expectedReturnDate: deviceSet.latestDistributionDate
          ? addDays(deviceSet.latestDistributionDate, windowDays)
          : "",
        isOverdue: false
      };
    }

    if (!deviceSet.latestDistributionDate) {
      return { status: "No distribution date", expectedReturnDate: "", isOverdue: false };
    }

    const expected = addDays(deviceSet.latestDistributionDate, windowDays);
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = today > expected;
    const status = isOverdue
      ? "Overdue"
      : today === expected
        ? "Due today"
        : "Within return window";

    return {
      status,
      expectedReturnDate: expected,
      isOverdue
    };
  }

  function addDays(dateString, days) {
    if (!dateString) return "";
    const ms = Date.parse(`${dateString}T00:00:00Z`);
    if (!Number.isFinite(ms)) return "";
    return new Date(ms + Number(days) * 86400000).toISOString().slice(0, 10);
  }

  function renderDevices() {
    const content = document.getElementById("devicesContent");
    const deviceSets = filteredDeviceSets();
    const returns = filteredReturns();
    const distributions = filteredDistributions();
    const componentsReturned = sumBy(returns, "componentsReturned");
    const componentsExpected = sumBy(returns, "componentsExpected");
    const completeReturns = returns.filter((r) => r.allComponentsReturned).length;
    const incompleteReturns = returns.filter((r) => !r.allComponentsReturned).length;
    const overdue = deviceSets.filter((row) =>
      deviceStatusWithWindow(row, state.returnWindowDays).isOverdue
    ).length;

    const componentsByFacility = FACILITIES.map((facility) => {
      const sets = deviceSets.filter((r) => r.latestFacility === facility);
      return {
        facility,
        expected: sumBy(sets, "componentsExpected"),
        returned: sumBy(sets, "componentsReturned")
      };
    });

    const statusMap = countBy(deviceSets, "currentStatus");

    content.innerHTML = `
      <div class="kpi-grid kpi-grid-6">
        ${kpiCard("Return Records", number(returns.length), "info")}
        ${kpiCard("Complete Returns", number(completeReturns), "positive")}
        ${kpiCard("Incomplete Returns", number(incompleteReturns), incompleteReturns ? "problem" : "positive")}
        ${kpiCard("Component Completeness", `${number(percent(componentsReturned, componentsExpected), 1)}%`, incompleteReturns ? "warning" : "positive", `${componentsReturned} of ${componentsExpected}`)}
        ${kpiCard("Return Window", `${state.returnWindowDays} days`, "neutral", state.data?.config?.returnWindowDays ? "Project policy" : "Scenario selection")}
        ${kpiCard("Overdue Devices", number(overdue), overdue ? "problem" : "positive")}
      </div>

      <div class="dashboard-grid">
        ${panel("Device Components by Latest Facility", chartCanvas("deviceFacility"), 6)}
        ${panel("Current Device Set Status", chartCanvas("deviceStatus"), 6)}
        ${panel("Weekly Device Distribution vs Return", chartCanvas("deviceWeeklyFlow", true), 12)}
        ${panel(
          "Current Device Set Detail",
          table(
            ["Device Set", "Status", "Facility", "Study ID", "Distributed", "Expected Return", "Returned", "Components"],
            deviceSets.map((r) => {
              const scenario = deviceStatusWithWindow(r, state.returnWindowDays);
              return [
                escapeHtml(r.deviceSet || "—"),
                statusChip(scenario.status),
                escapeHtml(r.latestFacility || "—"),
                escapeHtml(r.latestStudyId || "—"),
                escapeHtml(formatDate(r.latestDistributionDate)),
                escapeHtml(formatDate(scenario.expectedReturnDate)),
                escapeHtml(formatDate(r.latestReturnDate)),
                r.componentsExpected
                  ? `${number(r.componentsReturned)} / ${number(r.componentsExpected)}`
                  : "—"
              ];
            }),
            deviceSets.map((r) => `data-filter-facility="${escapeHtml(r.latestFacility)}"`)
          ),
          12
        )}
      </div>
    `;

    buildChart(
      "deviceFacility",
      {
        type: "bar",
        data: {
          labels: componentsByFacility.map((r) => r.facility),
          datasets: [
            {
              label: "Expected Components",
              data: componentsByFacility.map((r) => r.expected),
              backgroundColor: "#BFD0DD",
              borderRadius: 4
            },
            {
              label: "Returned Components",
              data: componentsByFacility.map((r) => r.returned),
              backgroundColor: COLORS.teal,
              borderRadius: 4
            }
          ]
        },
        options: { indexAxis: "y" }
      },
      (label) => setFacilityFilter(label)
    );

    const distributionWeeks = weeklyCounts(distributions, "distributionDate");
    const returnWeeks = weeklyCounts(returns, "returnDate");
    const allWeeks = unique([
      ...distributionWeeks.map((row) => row.weekStart),
      ...returnWeeks.map((row) => row.weekStart)
    ]);
    const distributionWeekMap = new Map(
      distributionWeeks.map((row) => [row.weekStart, row.count])
    );
    const returnWeekMap = new Map(
      returnWeeks.map((row) => [row.weekStart, row.count])
    );

    buildChart("deviceWeeklyFlow", {
      type: "bar",
      data: {
        labels: allWeeks.map((week) => formatDate(week)),
        datasets: [
          {
            label: "Distributed",
            data: allWeeks.map((week) => distributionWeekMap.get(week) || 0),
            backgroundColor: COLORS.blue,
            borderRadius: 4
          },
          {
            label: "Returned",
            data: allWeeks.map((week) => returnWeekMap.get(week) || 0),
            backgroundColor: COLORS.teal,
            borderRadius: 4
          }
        ]
      }
    });

    const statuses = [...statusMap.entries()];
    buildChart("deviceStatus", {
      type: "bar",
      data: {
        labels: statuses.map(([label]) => label),
        datasets: [{
          label: "Device Sets",
          data: statuses.map(([, count]) => count),
          backgroundColor: statuses.map(([label]) =>
            label === "Returned" ? COLORS.green : label === "Distributed" ? COLORS.amber : COLORS.slate
          ),
          borderRadius: 5
        }]
      },
      options: { plugins: { legend: { display: false } } }
    });
  }

  function dataQualityIssues() {
    const participants = filteredParticipants();
    const diaries = filteredDiaries();
    const returns = filteredReturns();
    const expectedPerParticipant = Number(
      state.data?.config?.activityDiariesExpectedPerParticipant || 6
    );
    const expectedDiaries = participants.length * expectedPerParticipant;
    const completedDiaries = diaries.filter((r) => r.diaryComplete).length;
    const sourceStatus = state.data?.sourceStatus || {};
    const targetConfig = state.data?.config?.facilityTargets || {};
    const targetGaps = FACILITIES.filter((facility) => {
      const target = targetConfig[facility];
      return !target?.target || !target?.arm;
    }).length;

    return [
      {
        name: "Outstanding Activity Diaries",
        count: Math.max(expectedDiaries - completedDiaries, 0),
        severity: "High"
      },
      {
        name: "Incomplete Device Returns",
        count: returns.filter((r) => !r.allComponentsReturned).length,
        severity: "High"
      },
      {
        name: "Return Logs Missing Return Date",
        count: returns.filter((r) => !r.returnDate).length,
        severity: "High"
      },
      {
        name: "Overdue Devices",
        count: filteredDeviceSets().filter((row) =>
          deviceStatusWithWindow(row, state.returnWindowDays).isOverdue
        ).length,
        severity: "High"
      },
      {
        name: "Delayed Interviews",
        count: diaries.filter((r) => r.sameDayInterview === "No").length,
        severity: "Medium"
      },
      {
        name: "Incomplete Enrollment Forms",
        count: participants.filter((r) => !r.enrollmentComplete).length,
        severity: "High"
      },
      {
        name: "Incomplete Maternal Record Books",
        count: participants.filter((r) => !r.maternalRecordComplete).length,
        severity: "High"
      },
      {
        name: "Incomplete Physical Examinations",
        count: participants.filter((r) => !r.physicalExamComplete).length,
        severity: "High"
      },
      {
        name: "Facility Targets Not Configured",
        count: targetGaps,
        severity: "Medium"
      },
      {
        name: "Unassigned Data-Collector Tasks",
        count: participants.filter((r) => !r.dataCollector || r.dataCollector === "Unassigned").length,
        severity: "Medium"
      },
      {
        name: "REDCap Source Errors",
        count: [sourceStatus.main, sourceStatus.devices].filter((s) => s?.status !== "success").length,
        severity: "Critical"
      }
    ];
  }

  function renderQuality() {
    const content = document.getElementById("qualityContent");
    const issues = dataQualityIssues();
    const diaries = filteredDiaries();
    const delayed = diaries.filter((r) => r.sameDayInterview === "No");
    const incompleteReturns = filteredReturns().filter((r) => !r.allComponentsReturned);
    const majorIssueCount = issues.filter((r) => ["High", "Critical"].includes(r.severity))
      .reduce((sum, r) => sum + r.count, 0);

    content.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("High / Critical Issues", number(majorIssueCount), majorIssueCount ? "problem" : "positive")}
        ${kpiCard("Outstanding Diaries", number(issues.find((r) => r.name === "Outstanding Activity Diaries")?.count || 0), "warning")}
        ${kpiCard("Incomplete Returns", number(incompleteReturns.length), incompleteReturns.length ? "problem" : "positive")}
        ${kpiCard("Delayed Interviews", number(delayed.length), delayed.length ? "warning" : "positive")}
      </div>

      <div class="dashboard-grid">
        ${panel("Issues by Type", chartCanvas("qualityIssues", true), 7, "warning-panel")}
        ${panel(
          "Issues Requiring Follow-up",
          `<div class="issue-list">
            ${issues.map((issue) => `
              <div class="issue-row">
                <span class="issue-name">${escapeHtml(issue.name)}</span>
                <strong class="issue-count">${number(issue.count)}</strong>
                ${severityChip(issue.severity)}
              </div>
            `).join("")}
          </div>`,
          5,
          "warning-panel"
        )}

        ${panel(
          "Delayed Activity Diary Follow-up",
          table(
            ["Facility", "Collector", "Study ID", "Diary Date", "Interview Date", "Delay", "Calls"],
            delayed.map((r) => [
              escapeHtml(r.facility || "—"),
              escapeHtml(r.dataCollector || "—"),
              escapeHtml(r.studyId || "—"),
              escapeHtml(formatDate(r.diaryDate)),
              escapeHtml(formatDate(r.interviewDate)),
              r.delayDays === null ? "—" : number(r.delayDays),
              r.callsMade === null ? "—" : number(r.callsMade)
            ])
          ),
          7,
          delayed.length ? "problem-panel" : ""
        )}

        ${panel(
          "Incomplete Device Returns",
          table(
            ["Device Set", "Return Date", "Components Returned", "Components Expected"],
            incompleteReturns.map((r) => [
              escapeHtml(r.deviceSet || "—"),
              escapeHtml(formatDate(r.returnDate)),
              number(r.componentsReturned),
              number(r.componentsExpected)
            ])
          ),
          12,
          incompleteReturns.length ? "problem-panel" : ""
        )}
      </div>
    `;

    buildChart("qualityIssues", {
      type: "bar",
      data: {
        labels: issues.map((issue) => issue.name),
        datasets: [{
          label: "Issue Count",
          data: issues.map((issue) => issue.count),
          backgroundColor: issues.map((issue) => {
            if (issue.severity === "Critical") return COLORS.red;
            if (issue.severity === "High") return "#D96B6B";
            if (issue.severity === "Medium") return COLORS.amber;
            return COLORS.slate;
          }),
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false } }
      }
    });
  }

  function renderSync() {
    const content = document.getElementById("syncContent");
    const main = state.data?.sourceStatus?.main || {};
    const devices = state.data?.sourceStatus?.devices || {};
    const allCurrent = main.status === "success" && devices.status === "success";

    const sourceRows = [
      ["Main REDCap", `PID ${main.pid || 410}`, statusChip(main.status === "success" ? "Current" : "Error"), main.message || "Live API access"],
      ["Devices REDCap", `PID ${devices.pid || 411}`, statusChip(devices.status === "success" ? "Current" : "Error"), devices.message || "Live API access"]
    ];

    content.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("Data Current To", formatDate(state.data?.fetchedAt, true), allCurrent ? "positive" : "warning")}
        ${kpiCard("Main REDCap", main.status === "success" ? "Current" : "Error", main.status === "success" ? "positive" : "problem", `PID ${main.pid || 410}`)}
        ${kpiCard("Devices REDCap", devices.status === "success" ? "Current" : "Error", devices.status === "success" ? "positive" : "problem", `PID ${devices.pid || 411}`)}
        ${kpiCard("Access Mode", "Secure", "info", "Firebase-authenticated callable")}
      </div>

      <div class="dashboard-grid">
        ${panel(
          "Live Data Sources",
          table(["Source", "Project", "Status", "Detail"], sourceRows),
          12
        )}
      </div>
    `;
  }

  function collectorPerformanceRows() {
    const participants = filteredParticipants();
    const diaries = filteredDiaries();
    const collectors = unique(participants.map((r) => r.dataCollector));

    return collectors.map((collector) => {
      const collectorParticipants = participants.filter((r) => r.dataCollector === collector);
      const collectorDiaries = diaries.filter((r) => r.dataCollector === collector);
      const coreTasks = collectorParticipants.length * 3;
      const diaryTasks = collectorDiaries.length;
      const tasksRecorded = coreTasks + diaryTasks;
      const tasksCompleted =
        collectorParticipants.filter((r) => r.enrollmentComplete).length +
        collectorParticipants.filter((r) => r.maternalRecordComplete).length +
        collectorParticipants.filter((r) => r.physicalExamComplete).length +
        collectorDiaries.filter((r) => r.diaryComplete).length;

      return {
        collector,
        facility: unique(collectorParticipants.map((r) => r.facility)).join(", "),
        participants: collectorParticipants.length,
        tasksRecorded,
        tasksCompleted,
        completionPct: percent(tasksCompleted, tasksRecorded),
        delayedDiaries: collectorDiaries.filter((r) => r.sameDayInterview === "No").length,
        callAttempts: sumBy(collectorDiaries, "callsMade"),
        averageDelay: average(collectorDiaries.map((r) => r.delayDays))
      };
    });
  }

  function facilityTargetRows() {
    const participants = filteredParticipants();
    const targetConfig = state.data?.config?.facilityTargets || {};

    return FACILITIES.map((facility) => {
      const config = targetConfig[facility] || {};
      const enrolled = participants.filter((r) => r.facility === facility).length;
      const target = Number(config.target);
      const configured = Boolean(config.arm && Number.isFinite(target) && target > 0);
      return {
        facility,
        arm: config.arm || "Not configured",
        target: configured ? target : null,
        enrolled,
        remaining: configured ? Math.max(target - enrolled, 0) : null,
        attainmentPct: configured ? percent(enrolled, target) : null,
        configured
      };
    });
  }

  function renderPerformance() {
    const content = document.getElementById("performanceContent");
    const performance = collectorPerformanceRows();
    const targets = facilityTargetRows();
    const targetGaps = targets.filter((r) => !r.configured).length;

    content.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("Data Collectors", number(performance.length), "info")}
        ${kpiCard("Collector Attribution Gaps", number(filteredParticipants().filter((r) => !r.dataCollector || r.dataCollector === "Unassigned").length), "positive")}
        ${kpiCard("Target Configuration Gaps", number(targetGaps), targetGaps ? "warning" : "positive")}
        ${kpiCard("Recruiting Facilities", number(unique(filteredParticipants().map((r) => r.facility)).length), "info", "of 4 facilities")}
      </div>

      ${targetGaps ? `
        <div class="config-notice">
          Facility-specific 60/40 Intervention/Control mapping has not yet been approved in the project configuration.
          Target-attainment values remain intentionally blank rather than guessed.
        </div>
      ` : ""}

      <div class="dashboard-grid" style="margin-top:10px;">
        ${panel("Participants Assigned by Data Collector", chartCanvas("performanceCollector"), 6)}
        ${panel("Current Enrollment by Facility", chartCanvas("performanceFacility"), 6)}
        ${panel(
          "Collector Performance Detail",
          table(
            ["Data Collector", "Facility", "Participants", "Tasks", "Completed", "Completion", "Delayed Diaries", "Calls", "Avg Delay"],
            performance.map((r) => [
              escapeHtml(r.collector),
              escapeHtml(r.facility || "—"),
              number(r.participants),
              number(r.tasksRecorded),
              number(r.tasksCompleted),
              `${number(r.completionPct, 1)}%`,
              number(r.delayedDiaries),
              number(r.callAttempts),
              r.averageDelay === null ? "—" : number(r.averageDelay, 2)
            ]),
            performance.map((r) => `data-filter-collector="${escapeHtml(r.collector)}"`)
          ),
          12
        )}
        ${panel(
          "Facility Target Attainment",
          table(
            ["Facility", "Study Arm", "Target", "Enrolled", "Remaining", "Attainment"],
            targets.map((r) => [
              escapeHtml(r.facility),
              escapeHtml(r.arm),
              r.target === null ? "—" : number(r.target),
              number(r.enrolled),
              r.remaining === null ? "—" : number(r.remaining),
              r.attainmentPct === null ? "—" : `${number(r.attainmentPct, 1)}%`
            ])
          ),
          12
        )}
      </div>
    `;

    buildChart(
      "performanceCollector",
      {
        type: "bar",
        data: {
          labels: performance.map((r) => r.collector),
          datasets: [{
            label: "Participants",
            data: performance.map((r) => r.participants),
            backgroundColor: COLORS.teal,
            borderRadius: 5
          }]
        },
        options: { indexAxis: "y", plugins: { legend: { display: false } } }
      },
      (label) => setCollectorFilter(label)
    );

    const byFacility = FACILITIES.map((facility) => ({
      facility,
      count: filteredParticipants().filter((r) => r.facility === facility).length
    }));

    buildChart(
      "performanceFacility",
      {
        type: "bar",
        data: {
          labels: byFacility.map((r) => r.facility),
          datasets: [{
            label: "Participants",
            data: byFacility.map((r) => r.count),
            backgroundColor: COLORS.blue,
            borderRadius: 5
          }]
        },
        options: { indexAxis: "y", plugins: { legend: { display: false } } }
      },
      (label) => setFacilityFilter(label)
    );
  }

  function renderCurrentSection() {
    if (!state.data) return;

    const renderers = {
      overview: renderOverview,
      recruitment: renderRecruitment,
      forms: renderForms,
      diary: renderDiary,
      devices: renderDevices,
      quality: renderQuality,
      sync: renderSync,
      performance: renderPerformance
    };

    const render = renderers[state.section] || renderOverview;
    render();
    wireInteractiveRows();
  }

  function wireInteractiveRows() {
    document.querySelectorAll("tr[data-filter-facility], tr[data-filter-collector]").forEach((row) => {
      row.addEventListener("click", () => {
        const facility = row.dataset.filterFacility;
        const collector = row.dataset.filterCollector;
        if (facility) state.filters.facility = facility;
        if (collector) state.filters.collector = collector;
        els.facilityFilter.value = state.filters.facility;
        els.collectorFilter.value = state.filters.collector;
        renderActiveFilterSummary();
        renderCurrentSection();
      });
    });
  }

  function showSection(sectionId) {
    state.section = sectionId;
    document.querySelectorAll(".dashboard-section").forEach((section) => {
      section.classList.toggle("active-section", section.id === sectionId);
    });
    document.querySelectorAll(".nav-item").forEach((button) => {
      const active = button.dataset.section === sectionId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    renderCurrentSection();
  }

  function getCallable() {
    try {
      if (
        window.parent &&
        window.parent !== window &&
        window.parent.nhrcFirebaseFunctions &&
        typeof window.parent.nhrcFirebaseFunctions.httpsCallable === "function"
      ) {
        return window.parent.nhrcFirebaseFunctions.httpsCallable("getPhysioHemabWp2Dashboard");
      }
    } catch (error) {
      console.warn("Parent Firebase Functions context is unavailable.", error);
    }

    if (
      window.nhrcFirebaseFunctions &&
      typeof window.nhrcFirebaseFunctions.httpsCallable === "function"
    ) {
      return window.nhrcFirebaseFunctions.httpsCallable("getPhysioHemabWp2Dashboard");
    }

    throw new Error(
      "Open this dashboard through the signed-in NHRC Projects Dashboard."
    );
  }

  async function loadDashboard(forceRefresh = false) {
    els.loading.classList.remove("hidden");
    els.errorPanel.classList.add("hidden");

    try {
      const callable = getCallable();
      const result = await callable({ forceRefresh });
      state.data = result?.data || result;

      if (!state.data || !Array.isArray(state.data.participants)) {
        throw new Error("The dashboard returned an unexpected response.");
      }

      populateFilters();
      renderFreshness();
      renderActiveFilterSummary();
      renderCurrentSection();
    } catch (error) {
      console.error("Physio-HeMAB WP2 dashboard load failed", error);
      els.errorMessage.textContent =
        error?.message ||
        "The Physio-HeMAB dashboard data could not be retrieved.";
      els.errorPanel.classList.remove("hidden");
      els.liveStatus.innerHTML =
        '<span class="status-dot status-bad"></span><span>Data unavailable</span>';
    } finally {
      els.loading.classList.add("hidden");
    }
  }

  function clearFilters() {
    state.filters = {
      facility: "",
      collector: "",
      dateFrom: "",
      dateTo: ""
    };
    els.facilityFilter.value = "";
    els.collectorFilter.value = "";
    els.dateFromFilter.value = "";
    els.dateToFilter.value = "";
    renderActiveFilterSummary();
    renderCurrentSection();
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  els.facilityFilter.addEventListener("change", () => {
    state.filters.facility = els.facilityFilter.value;
    renderActiveFilterSummary();
    renderCurrentSection();
  });

  els.collectorFilter.addEventListener("change", () => {
    state.filters.collector = els.collectorFilter.value;
    renderActiveFilterSummary();
    renderCurrentSection();
  });

  els.dateFromFilter.addEventListener("change", () => {
    state.filters.dateFrom = els.dateFromFilter.value;
    renderActiveFilterSummary();
    renderCurrentSection();
  });

  els.dateToFilter.addEventListener("change", () => {
    state.filters.dateTo = els.dateToFilter.value;
    renderActiveFilterSummary();
    renderCurrentSection();
  });

  els.returnWindowFilter.addEventListener("change", () => {
    state.returnWindowDays = Number(els.returnWindowFilter.value) || 3;
    if (state.section === "devices") renderDevices();
  });

  document.getElementById("clearFiltersBtn").addEventListener("click", clearFilters);
  document.getElementById("refreshDashboardBtn").addEventListener("click", () => loadDashboard(true));
  document.getElementById("retryDashboardBtn").addEventListener("click", () => loadDashboard(true));

  loadDashboard(false);
})();
