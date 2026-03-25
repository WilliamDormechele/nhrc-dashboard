// js/projects.js

window.projectRegistry = {};
window.projectUsersDirectory = {
  usersByEmail: {},
  fieldworkers: [],
  supervisors: []
};

/**
 * Dynamic JSON sources that are fetched at runtime from GitHub Pages.
 * This lets Stata fully control reports/queries without Firestore editing.
 */
const DYNAMIC_PROJECT_JSON = {
  hemab: {
    reports: [
      "reports/hemab/household_members/hh_members_reports.json",
      "reports/hemab/women/women_reports.json",
      "reports/hemab/health_workers/health_workers_reports.json"
    ],
    queries: [
      "queries/hemab/household_members/hh_members_queries.json",
      "queries/hemab/women/women_queries.json",
      "queries/hemab/health_workers/health_workers_queries.json"
    ]
  },

  brave: {
    reports: [],
    queries: []
  },

hdss: {
  reports: [
    "reports/HDSS/compoundsnotvisited/hdss_compoundsnotvisited_reports.json",
    "reports/HDSS/householdsnotvisited/hdss_householdsnotvisited_reports.json"
  ],
  queries: [
    "queries/HDSS/compoundsnotvisited_by_fieldworker/hdss_compoundsnotvisited_by_fieldworker_queries.json",
    "queries/HDSS/householdsnotvisited_by_fieldworker/hdss_householdsnotvisited_by_fieldworker_queries.json",
    "queries/HDSS/no_membership/hdss_no_membership_queries.json"
  ]
}
};

/**
 * Fetch JSON safely.
 */
/**
 * Convert a JSON path into a friendly section label.
 */
function inferSectionCategoryFromPath(path = "") {
  const safePath = String(path).toLowerCase();

  if (safePath.includes("/household_members/")) return "Household Members";
  if (safePath.includes("/women/")) return "Women";
  if (safePath.includes("/health_workers/")) return "Health Workers";

  if (safePath.includes("/compoundsnotvisited/")) return "Compounds Not Visited";
  if (safePath.includes("/householdsnotvisited/")) return "Households Not Visited";

  return "Files";
}

/**
 * Build a visible empty section instead of hiding it.
 */
function createEmptySection(category, message, sourcePath = "") {
  return {
    category: category || "Files",
    items: [],
    emptyMessage: message || "No files available in this section yet.",
    sourcePath: sourcePath || ""
  };
}

/**
 * Fetch JSON safely.
 * Returns null for missing/bad files so we can show an empty state in the UI.
 */
async function fetchJsonSafe(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });

    if (!response.ok) {
      console.warn(`JSON fetch failed for ${path}: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.warn(`JSON fetch error for ${path}:`, error);
    return null;
  }
}

/**
 * Normalize loaded JSON into grouped sections.
 * Supports either:
 * 1. flat arrays of items
 * 2. grouped arrays with { category, items }
 */
function normalizeDynamicQuerySections(jsonData, fallbackCategory = "Files") {
  if (!Array.isArray(jsonData) || !jsonData.length) {
    return [];
  }

  const groupedMode = jsonData.some(
    (entry) => entry && typeof entry === "object" && Array.isArray(entry.items)
  );

if (groupedMode) {
  return jsonData.map((section) => ({
    category: section.category || fallbackCategory,
    updatedAt: section.updatedAt || section.lastUpdated || section.updated_at || section.last_updated || "",
    items: Array.isArray(section.items) ? section.items : [],
    emptyMessage: section.emptyMessage || "No files available in this section yet."
  }));
}

return [
  {
    category: fallbackCategory,
    updatedAt: "",
    items: jsonData,
    emptyMessage: "No files available in this section yet."
  }
];
}

/**
 * Merge multiple grouped JSON files into one project.reports and project.queries array.
 * Empty/missing files are preserved as visible empty sections.
 */
async function hydrateDynamicProjectFiles(project) {
  const projectCode = normalizeText(project?.code);
  const config = DYNAMIC_PROJECT_JSON[projectCode];

  if (!config) return project;

  const clonedProject = {
    ...project,
    queries: Array.isArray(project.queries) ? [...project.queries] : [],
    reports: Array.isArray(project.reports) ? [...project.reports] : []
  };

  if (Array.isArray(config.reports) && config.reports.length) {
    const loadedReportSections = [];

    for (const path of config.reports) {
      const category = inferSectionCategoryFromPath(path);
      const jsonData = await fetchJsonSafe(path);

      if (jsonData === null) {
        loadedReportSections.push(
          createEmptySection(
            category,
            "Report file is missing or could not be loaded yet.",
            path
          )
        );
        continue;
      }

      const sections = normalizeDynamicQuerySections(jsonData, category);

      if (!sections.length) {
        loadedReportSections.push(
          createEmptySection(
            category,
            "No report files available in this section yet.",
            path
          )
        );
      } else {
        loadedReportSections.push(...sections);
      }
    }

    clonedProject.reports = loadedReportSections;
  }

  if (Array.isArray(config.queries) && config.queries.length) {
    const loadedQuerySections = [];

    for (const path of config.queries) {
      const category = inferSectionCategoryFromPath(path);
      const jsonData = await fetchJsonSafe(path);

      if (jsonData === null) {
        loadedQuerySections.push(
          createEmptySection(
            category,
            "Query file is missing or could not be loaded yet.",
            path
          )
        );
        continue;
      }

      const sections = normalizeDynamicQuerySections(jsonData, category);

      if (!sections.length) {
        loadedQuerySections.push(
          createEmptySection(
            category,
            "No query files available in this section yet.",
            path
          )
        );
      } else {
        loadedQuerySections.push(...sections);
      }
    }

    clonedProject.queries = loadedQuerySections;
  }

  return clonedProject;
}

/**
 * Load projects from Firestore.
 * If no Firestore projects exist yet, use the local fallback config from data/project-config.js.
 */
async function loadProjectsRegistry() {
  const firestoreProjects = {};
  const assignedProjects = Array.isArray(window.currentUserProfile?.assignedProjects)
    ? window.currentUserProfile.assignedProjects
    : [];
  const role = window.currentUserProfile?.role || "";
  const canReadAllProjects = role === "administrator" || role === "developer";

  if (canReadAllProjects) {
    const snapshot = await db.collection("projects").get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      const fallbackProject = PROJECTS[doc.id] || {};

      if (data.enabled !== false) {
        firestoreProjects[doc.id] = {
          ...fallbackProject,
          code: doc.id,
          ...data,
          reports: Array.isArray(data.reports) && data.reports.length
            ? data.reports
            : (Array.isArray(fallbackProject.reports) ? fallbackProject.reports : []),
          queries: Array.isArray(data.queries) && data.queries.length
            ? data.queries
            : (Array.isArray(fallbackProject.queries) ? fallbackProject.queries : [])
        };
      }
    });
  } else {
    const reads = assignedProjects.map((projectCode) =>
      db.collection("projects").doc(projectCode).get()
    );

    const docs = await Promise.all(reads);

    docs.forEach((doc) => {
      if (!doc.exists) return;

      const data = doc.data();
      const fallbackProject = PROJECTS[doc.id] || {};

      if (data.enabled !== false) {
        firestoreProjects[doc.id] = {
          ...fallbackProject,
          code: doc.id,
          ...data,
          reports: Array.isArray(data.reports) && data.reports.length
            ? data.reports
            : (Array.isArray(fallbackProject.reports) ? fallbackProject.reports : []),
          queries: Array.isArray(data.queries) && data.queries.length
            ? data.queries
            : (Array.isArray(fallbackProject.queries) ? fallbackProject.queries : [])
        };
      }
    });
  }

  if (Object.keys(firestoreProjects).length > 0) {
    window.projectRegistry = firestoreProjects;
  } else {
    window.projectRegistry = PROJECTS;
  }
}

/**
 * Build the dropdown of projects available to the current user.
 */
function populateProjectSelect(assignedProjects) {
  const projectSelect = document.getElementById("projectSelect");
  projectSelect.innerHTML = "";

  (assignedProjects || []).forEach((projectCode) => {
    const project = window.projectRegistry[projectCode];
    if (!project) return;

    const option = document.createElement("option");
    option.value = project.code;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  });
}

/**
 * Return a file type label from a file path.
 */
function getFileTypeLabel(filePath = "") {
  const path = String(filePath || "").toLowerCase();

  if (path.endsWith(".pdf")) return "PDF";
  if (path.endsWith(".html") || path.endsWith(".htm")) return "HTML";
  if (path.endsWith(".ppt") || path.endsWith(".pptx")) return "PPT";
  if (path.endsWith(".xls") || path.endsWith(".xlsx") || path.endsWith(".csv")) return "Excel";
  if (path.endsWith(".doc") || path.endsWith(".docx")) return "Word";
  return "File";
}

/**
 * Safe HTML text.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Normalize text for filtering.
 */
function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Format date safely.
 */
function formatFriendlyDate(value) {
  if (!value) return "Not available";

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
    return value;
  }

  if (value?.toDate) {
    return value.toDate().toLocaleString();
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  return String(value);
}

function extractLatestTimestampFromItems(items = [], section = null) {
  let latestDate = null;

  // 🔹 FIRST: check section-level timestamp
  if (section?.updatedAt) {
    const d = new Date(section.updatedAt);
    if (!isNaN(d)) {
      latestDate = d;
    }
  }

  // 🔹 THEN: check items
  (items || []).forEach((item) => {
    const candidates = [
      item?.updatedAt,
      item?.lastUpdated,
      item?.updated_at,
      item?.last_updated,
      item?.date,
      item?.reportDate,
      item?.queryDate
    ];

    candidates.forEach((value) => {
      if (!value) return;

      const parsed = new Date(value);
      if (!isNaN(parsed) && (!latestDate || parsed > latestDate)) {
        latestDate = parsed;
      }
    });
  });

  return latestDate;
}

function getFreshnessStatus(latestDate) {
  if (!latestDate) {
    return {
      label: "Update time unavailable",
      tone: "unknown"
    };
  }

  const now = new Date();
  const diffMs = now - latestDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 2) {
    return {
      label: `Fresh · updated ${formatFriendlyDate(latestDate)}`,
      tone: "fresh"
    };
  }

  if (diffDays <= 7) {
    return {
      label: `Recent · updated ${formatFriendlyDate(latestDate)}`,
      tone: "recent"
    };
  }

  if (diffDays <= 30) {
    return {
      label: `Aging · updated ${formatFriendlyDate(latestDate)}`,
      tone: "aging"
    };
  }

  return {
    label: `Stale · updated ${formatFriendlyDate(latestDate)}`,
    tone: "stale"
  };
}

function buildFreshnessBadgeFromItems(items = [], section = null) {
  const latestDate = extractLatestTimestampFromItems(items, section);
  const freshness = getFreshnessStatus(latestDate);

  const badge = document.createElement("div");
  badge.className = `data-freshness-badge data-freshness-${freshness.tone}`;
  badge.textContent = freshness.label;

  return badge;
}

/**
 * Load a lightweight user directory for query/report filters.
 * - Admin/developer: users collection
 * - Others: monitoring_directory if readable
 */
async function loadProjectUsersDirectory() {
  const role = window.currentUserProfile?.role || "";
  const assignedProjects = Array.isArray(window.currentUserProfile?.assignedProjects)
    ? window.currentUserProfile.assignedProjects
    : [];
  const canReadAllUsers = role === "administrator" || role === "developer";

  const usersByEmail = {};
  const fieldworkers = [];
  const supervisors = [];

  try {
    if (canReadAllUsers) {
      const snapshot = await db.collection("users").orderBy("fullName").get();

      snapshot.forEach((doc) => {
        const user = { id: doc.id, ...doc.data() };
        const emailKey = normalizeText(user.email);

        if (emailKey) {
          usersByEmail[emailKey] = user;
        }

        if (user.role === "field_worker") {
          fieldworkers.push(user);
        }

        if (user.role === "field_supervisor") {
          supervisors.push(user);
        }
      });
    } else if (assignedProjects.length) {
      const snapshot = await db.collection("monitoring_directory")
        .where("isActive", "==", true)
        .get();

      snapshot.forEach((doc) => {
        const user = { id: doc.id, ...doc.data() };
        const emailKey = normalizeText(user.email);
        const userProjects = Array.isArray(user.assignedProjects) ? user.assignedProjects : [];
        const hasProjectMatch = userProjects.some((code) => assignedProjects.includes(code));

        if (!hasProjectMatch) return;

        if (emailKey) {
          usersByEmail[emailKey] = user;
        }

        if (user.role === "field_worker") {
          fieldworkers.push(user);
        }

        if (user.role === "field_supervisor") {
          supervisors.push(user);
        }
      });
    }
  } catch (error) {
    console.warn("User directory could not be loaded for project filters:", error);
  }

  fieldworkers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  supervisors.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  window.projectUsersDirectory = {
    usersByEmail,
    fieldworkers,
    supervisors
  };
}

/**
 * Resolve user display name.
 */
function resolveUserNameByEmail(email, fallback = "") {
  const key = normalizeText(email);
  const match = window.projectUsersDirectory?.usersByEmail?.[key];
  return match?.fullName || fallback || email || "Unknown";
}

/**
 * Build a resource card.
 */
function buildResourceCard(
  item,
  badgeText,
  actionName,
  pageName,
  canDownload = true,
  options = {}
) {
  const safeItem = item || {};
  const filePath = String(safeItem.file || "").trim();
  const titleText = String(safeItem.title || "Untitled resource").trim();

  const unavailable = options.unavailable === true || !filePath;
  const unavailableMessage =
    options.unavailableMessage || "No file is currently available for this selection.";

  if (unavailable) {
    const card = document.createElement("div");
    card.className = "resource-card resource-card-disabled";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-disabled", "true");
    card.title = unavailableMessage;

    card.innerHTML = `
      <div class="resource-card-top">
        <span class="resource-filetype">N/A</span>
      </div>

      <div class="resource-title">${escapeHtml(titleText)}</div>

      <div class="resource-subtext">
        No file is currently available for this selection.
      </div>
    `;

    const showUnavailableNotice = () => {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: "info",
          title: "File Not Available",
          text: unavailableMessage,
          confirmButtonText: "OK"
        });
      }
    };

    card.addEventListener("click", function (event) {
      event.preventDefault();
      showUnavailableNotice();
    });

    card.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showUnavailableNotice();
      }
    });

    return card;
  }

  const link = document.createElement("a");
  link.className = "resource-card";
  link.href = filePath;
  link.target = "_blank";
  link.rel = "noopener";

  const fileType = getFileTypeLabel(filePath);

  link.innerHTML = `
    <div class="resource-card-top">
      <span class="resource-filetype">${escapeHtml(fileType)}</span>
      <span class="resource-badge">${escapeHtml(badgeText)}</span>
    </div>

    <div class="resource-title">${escapeHtml(titleText)}</div>

    <div class="resource-subtext">
      Click to ${canDownload ? "open or download" : "open"} this file
    </div>
  `;

  link.addEventListener("click", async (event) => {
    if (!canDownload) {
      event.preventDefault();

      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: "warning",
          title: "Access Restricted",
          text: "You do not have permission to download this file.",
          confirmButtonText: "OK"
        });
      } else {
        alert("You do not have permission to download this file.");
      }
      return;
    }

    await logActivity(actionName, {
      page: pageName,
      target: filePath
    });
  });

  return link;
}

/**
 * Build an advanced query/report list card with metadata.
 */
function buildAdvancedFileCard(item, config = {}) {
  const filePath = String(item.file || "").trim();
  const hasData = String(item.hasData || "true") !== "false";
  const typeLabel = getFileTypeLabel(filePath);
  const canDownload = config.canDownload !== false;
  const actionName = config.actionName || "download_file";
  const pageName = config.pageName || "files";
  const unavailableMessage =
  !hasData
    ? "This file contains no records."
    : (config.unavailableMessage || "No file is currently available for this selection.");

  const card = buildResourceCard(
    {
      title: item.title || item.fieldworkerName || "Untitled file",
      file: filePath
    },
    filePath && hasData ? (canDownload ? "Open / Download" : "Open") : "Unavailable",
    actionName,
    pageName,
    filePath && hasData ? canDownload : false,
    {
      unavailable: !filePath || !hasData,
      unavailableMessage
    }
  );

  const meta = document.createElement("div");
  meta.className = "resource-meta-stack";

  const topRowBits = [];

  if (item.district) {
    topRowBits.push(`<span class="resource-meta-pill"><i class="fas fa-location-dot"></i> ${escapeHtml(item.district)}</span>`);
  }

  if (item.supervisorName) {
    topRowBits.push(`<span class="resource-meta-pill"><i class="fas fa-user-tie"></i> ${escapeHtml(item.supervisorName)}</span>`);
  }

  if (item.fieldworkerName) {
    topRowBits.push(`<span class="resource-meta-pill"><i class="fas fa-user"></i> ${escapeHtml(item.fieldworkerName)}</span>`);
  }

  if (topRowBits.length) {
    const row = document.createElement("div");
    row.className = "resource-meta-row";
    row.innerHTML = topRowBits.join("");
    meta.appendChild(row);
  }

  const bottomRowBits = [];

  if (item.reportDate) {
    bottomRowBits.push(`<span class="resource-meta-text"><i class="fas fa-calendar-days"></i> ${escapeHtml(item.reportDate)}</span>`);
  }

  if (item.updatedAtLabel) {
    bottomRowBits.push(`<span class="resource-meta-text"><i class="fas fa-clock"></i> Updated ${escapeHtml(item.updatedAtLabel)}</span>`);
  }

  if (bottomRowBits.length) {
    const row = document.createElement("div");
    row.className = "resource-meta-row";
    row.innerHTML = bottomRowBits.join("");
    meta.appendChild(row);
  }

  card.appendChild(meta);
  return card;
}

/**
 * Build a professional filter toolbar.
 */
function buildAdvancedFiltersToolbar({
  searchId = "",
  districtId = "",
  supervisorId = "",
  dateId = "",
  searchPlaceholder = "Search",
  districts = [],
  supervisors = [],
  dateLabel = "Date"
}) {
  const wrapper = document.createElement("div");
  wrapper.className = "advanced-library-toolbar";

  wrapper.innerHTML = `
    <div class="advanced-filter-group advanced-filter-search">
      <label for="${escapeHtml(searchId)}">Field Worker Search</label>
      <div class="advanced-search-input-wrap">
        <i class="fas fa-search"></i>
        <input type="text" id="${escapeHtml(searchId)}" placeholder="${escapeHtml(searchPlaceholder)}" />
      </div>
    </div>

    <div class="advanced-filter-group">
      <label for="${escapeHtml(districtId)}">District</label>
      <select id="${escapeHtml(districtId)}">
        <option value="">All districts</option>
        ${districts.map((district) => `<option value="${escapeHtml(district)}">${escapeHtml(district)}</option>`).join("")}
      </select>
    </div>

    <div class="advanced-filter-group">
      <label for="${escapeHtml(supervisorId)}">Supervisor</label>
      <select id="${escapeHtml(supervisorId)}">
        <option value="">All supervisors</option>
        ${supervisors.map((supervisor) => `<option value="${escapeHtml(supervisor)}">${escapeHtml(supervisor)}</option>`).join("")}
      </select>
    </div>

    <div class="advanced-filter-group">
      <label for="${escapeHtml(dateId)}">${escapeHtml(dateLabel)}</label>
      <input type="date" id="${escapeHtml(dateId)}" />
    </div>

    <div class="advanced-filter-group advanced-filter-actions">
      <label>&nbsp;</label>
      <button type="button" class="btn btn-secondary" data-clear-target="${escapeHtml(searchId)}|${escapeHtml(districtId)}|${escapeHtml(supervisorId)}|${escapeHtml(dateId)}">
        Clear Filters
      </button>
    </div>
  `;

  const clearBtn = wrapper.querySelector("[data-clear-target]");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const ids = String(clearBtn.getAttribute("data-clear-target") || "").split("|");
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });

      wrapper.dispatchEvent(new CustomEvent("advancedfiltersclear", { bubbles: true }));
    });
  }

  return wrapper;
}

/**
 * Return unique sorted list.
 */
function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean).map((x) => String(x).trim()))]
    .sort((a, b) => a.localeCompare(b));
}

function getLocationLabelForProject(project) {
  const projectCode = normalizeText(project?.code);
  const projectName = normalizeText(project?.name);

  if (projectCode === "brave" || projectName === "brave") {
    return "Hospital / Facility";
  }

  return "District";
}

function getLocationPlaceholderForProject(project) {
  const projectCode = normalizeText(project?.code);
  const projectName = normalizeText(project?.name);

  if (projectCode === "brave" || projectName === "brave") {
    return "All hospitals / facilities";
  }

  return "All districts";
}

/**
 * Normalize raw query items.
 */
function normalizeQueryItems(rawItems = []) {
  return (rawItems || []).map((item) => {
    const supervisorName =
      item.supervisorName ||
      resolveUserNameByEmail(item.supervisorEmail, item.supervisorEmail || "");

    const fieldworkerName =
      item.fieldworkerName ||
      resolveUserNameByEmail(item.fieldworkerEmail, item.title || "");

    const reportDate = item.date || item.queryDate || "";
    const updatedAtLabel =
      item.updatedAtLabel ||
      formatFriendlyDate(item.updatedAt || item.lastUpdated || "");

    return {
      title: item.title || fieldworkerName || "Data Query",
      file: item.file || "",
      district: item.district || "",
      supervisorEmail: item.supervisorEmail || "",
      supervisorName,
      fieldworkerEmail: item.fieldworkerEmail || "",
      fieldworkerName,
      reportDate,
      updatedAtLabel,

      // NEW: keep query type/category for filtering
      queryType: item.queryType || item.category || item.sectionCategory || ""
    };
  });
}

/**
 * Normalize raw report items.
 */
function normalizeReportItems(rawItems = []) {
  return (rawItems || []).map((item) => {
    const supervisorName =
      item.supervisorName ||
      resolveUserNameByEmail(item.supervisorEmail, item.supervisorEmail || "");

    const fieldworkerName =
      item.fieldworkerName ||
      resolveUserNameByEmail(item.fieldworkerEmail, item.title || "");

    const reportDate = item.date || item.reportDate || "";
    const updatedAtLabel = item.updatedAtLabel || formatFriendlyDate(item.updatedAt || item.lastUpdated || "");

    return {
      title: item.title || "Report",
      file: item.file || "",
      district: item.district || "",
      supervisorEmail: item.supervisorEmail || "",
      supervisorName,
      fieldworkerEmail: item.fieldworkerEmail || "",
      fieldworkerName,
      reportDate,
      updatedAtLabel
    };
  });
}

/**
 * Apply advanced list filters.
 */
function filterAdvancedItems(items, {
  district = "",
  supervisor = "",
  date = "",
  search = "",
  queryType = ""
}) {
  const searchNorm = normalizeText(search);
  const districtNorm = normalizeText(district);
  const supervisorNorm = normalizeText(supervisor);
  const dateNorm = normalizeText(date);
  const queryTypeNorm = normalizeText(queryType);

  return (items || []).filter((item) => {
    const matchesDistrict =
      !districtNorm || normalizeText(item.district) === districtNorm;

    const matchesSupervisor =
      !supervisorNorm || normalizeText(item.supervisorName) === supervisorNorm;

    const matchesDate =
      !dateNorm || normalizeText(item.reportDate) === dateNorm;

    const matchesQueryType =
      !queryTypeNorm || normalizeText(item.queryType) === queryTypeNorm;

    const searchBlob = [
      item.title,
      item.fieldworkerName,
      item.fieldworkerEmail,
      item.supervisorName,
      item.supervisorEmail,
      item.district,
      item.queryType
    ].join(" ").toLowerCase();

    const matchesSearch = !searchNorm || searchBlob.includes(searchNorm);

    return (
      matchesDistrict &&
      matchesSupervisor &&
      matchesDate &&
      matchesQueryType &&
      matchesSearch
    );
  });
}

/**
 * Render advanced query library.
 */
function renderAdvancedQueries(project) {
  const queriesContainer = document.getElementById("queriesContainer");
  queriesContainer.innerHTML = "";

  const permissions = getPermissions(window.currentUserProfile.role);

  if (!permissions.canViewQueries) {
    queriesContainer.innerHTML = `<div class="placeholder-box">You do not have permission to access queries.</div>`;
    return;
  }

  const rawQueries = Array.isArray(project.queries) ? project.queries : [];

  if (!rawQueries.length) {
    queriesContainer.innerHTML = `<div class="placeholder-box">No queries configured for this project yet.</div>`;
    return;
  }

  const projectCode = normalizeText(project?.code);
  const projectName = normalizeText(project?.name);
  const isBrave = projectCode === "brave" || projectName === "brave";

  // IMPORTANT:
  // If queries were saved in grouped format, flatten them into one list.
  // This is especially for BRAVE, where the page should show one toolbar
  // and one combined results area, not separate tool sections.
  const flattenedQueries = rawQueries.flatMap((entry) => {
    if (entry && typeof entry === "object" && Array.isArray(entry.items)) {
      return entry.items.map((item) => ({
        ...item,
        queryType: item.queryType || entry.category || ""
      }));
    }

    return [{
      ...entry,
      queryType: entry?.queryType || entry?.category || ""
    }];
  });

  const normalizedItems = normalizeQueryItems(flattenedQueries);

  if (!normalizedItems.length) {
    queriesContainer.innerHTML = `<div class="placeholder-box">No queries configured for this project yet.</div>`;
    return;
  }

  const locationLabel = isBrave ? "Hospital / Facility" : "District";
  const locationPlaceholder = isBrave ? "All hospitals / facilities" : "All districts";

  const allLocations = uniqueSorted(normalizedItems.map((item) => item.district));
  const allSupervisors = uniqueSorted(normalizedItems.map((item) => item.supervisorName));
  const allQueryTypes = uniqueSorted(normalizedItems.map((item) => item.queryType));

  const shell = document.createElement("div");
  shell.className = "advanced-library-shell";

  const header = document.createElement("div");
  header.className = "advanced-library-header";
  header.innerHTML = `
<div>
  <div class="section-title-row">
    <h3>${escapeHtml(project.name)} Fieldworker Data Queries</h3>
    <span class="data-freshness-badge data-freshness-${getFreshnessStatus(extractLatestTimestampFromItems(normalizedItems)).tone}">
      ${escapeHtml(getFreshnessStatus(extractLatestTimestampFromItems(normalizedItems)).label)}
    </span>
  </div>
  <p>Search and filter query files by field worker, ${escapeHtml(locationLabel.toLowerCase())}, supervisor, and date.</p>
</div>
    <div class="advanced-library-summary" id="queriesSummaryText">0 files</div>
  `;
  shell.appendChild(header);

  const toolbar = document.createElement("div");
  toolbar.className = "advanced-library-toolbar";
  toolbar.innerHTML = `
    <div class="advanced-filter-group advanced-filter-search">
      <label for="queriesFieldworkerSearch">Field Worker Search</label>
      <div class="advanced-search-input-wrap">
        <i class="fas fa-search"></i>
        <input
          type="text"
          id="queriesFieldworkerSearch"
          placeholder="Search by field worker name..."
        />
      </div>
    </div>

    <div class="advanced-filter-group">
      <label for="queriesDistrictFilter">${escapeHtml(locationLabel)}</label>
      <select id="queriesDistrictFilter">
        <option value="">${escapeHtml(locationPlaceholder)}</option>
        ${allLocations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join("")}
      </select>
    </div>

    <div class="advanced-filter-group">
      <label for="queriesSupervisorFilter">Supervisor</label>
      <select id="queriesSupervisorFilter">
        <option value="">All supervisors</option>
        ${allSupervisors.map((supervisor) => `<option value="${escapeHtml(supervisor)}">${escapeHtml(supervisor)}</option>`).join("")}
      </select>
    </div>

    <div class="advanced-filter-group">
      <label for="queriesTypeFilter">Query Type</label>
      <select id="queriesTypeFilter">
        <option value="">All query types</option>
        ${allQueryTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
      </select>
    </div>

    <div class="advanced-filter-group">
      <label for="queriesDateFilter">Query date</label>
      <input type="date" id="queriesDateFilter" />
    </div>

    <div class="advanced-filter-group advanced-filter-actions">
      <label>&nbsp;</label>
      <button type="button" class="btn btn-secondary" id="queriesClearBtn">
        Clear Filters
      </button>
    </div>
  `;

  shell.appendChild(toolbar);

  const resultsWrap = document.createElement("div");
  resultsWrap.className = "advanced-library-results";
  shell.appendChild(resultsWrap);

  queriesContainer.appendChild(shell);

  function repaint() {
    const district = document.getElementById("queriesDistrictFilter")?.value || "";
    const supervisor = document.getElementById("queriesSupervisorFilter")?.value || "";
    const queryType = document.getElementById("queriesTypeFilter")?.value || "";
    const date = document.getElementById("queriesDateFilter")?.value || "";
    const search = document.getElementById("queriesFieldworkerSearch")?.value || "";

    const filteredItems = filterAdvancedItems(normalizedItems, {
      district,
      supervisor,
      date,
      search,
      queryType
    });

    const summary = document.getElementById("queriesSummaryText");
    if (summary) {
      summary.textContent = `${filteredItems.length} quer${filteredItems.length === 1 ? "y file" : "y files"}`;
    }

    resultsWrap.innerHTML = "";

    if (!filteredItems.length) {
      resultsWrap.innerHTML = `
        <div class="placeholder-box">
          No data queries match the selected filters.
        </div>
      `;
      return;
    }

    const grid = document.createElement("div");
    grid.className = "resource-grid advanced-resource-grid";

    filteredItems.forEach((item) => {
      grid.appendChild(
        buildAdvancedFileCard(item, {
          canDownload: true,
          actionName: "download_query",
          pageName: "queries",
          unavailableMessage: "No query file is currently available for this field worker."
        })
      );
    });

    resultsWrap.appendChild(grid);
  }

  document.getElementById("queriesFieldworkerSearch")?.addEventListener("input", repaint);
  document.getElementById("queriesDistrictFilter")?.addEventListener("change", repaint);
  document.getElementById("queriesSupervisorFilter")?.addEventListener("change", repaint);
  document.getElementById("queriesTypeFilter")?.addEventListener("change", repaint);
  document.getElementById("queriesDateFilter")?.addEventListener("change", repaint);

  document.getElementById("queriesClearBtn")?.addEventListener("click", () => {
    const searchEl = document.getElementById("queriesFieldworkerSearch");
    const districtEl = document.getElementById("queriesDistrictFilter");
    const supervisorEl = document.getElementById("queriesSupervisorFilter");
    const queryTypeEl = document.getElementById("queriesTypeFilter");
    const dateEl = document.getElementById("queriesDateFilter");

    if (searchEl) searchEl.value = "";
    if (districtEl) districtEl.value = "";
    if (supervisorEl) supervisorEl.value = "";
    if (queryTypeEl) queryTypeEl.value = "";
    if (dateEl) dateEl.value = "";

    repaint();
  });

  repaint();
}

/**
 * Render advanced reports library for HDSS.
 */
function renderAdvancedReports(project) {
  const reportsContainer = document.getElementById("reportsContainer");
  reportsContainer.innerHTML = "";

  const permissions = getPermissions(window.currentUserProfile.role);

  if (!permissions.canViewReports) {
    reportsContainer.innerHTML = `<div class="placeholder-box">You do not have permission to view project reports.</div>`;
    return;
  }

  const reportSections = Array.isArray(project.reports) ? project.reports : [];

  if (!reportSections.length) {
    reportsContainer.innerHTML = `<div class="placeholder-box">No reports configured for this project yet.</div>`;
    return;
  }

  const locationLabel = getLocationLabelForProject(project);
  const locationPlaceholder = getLocationPlaceholderForProject(project);

  reportSections.forEach((section, index) => {
    const sectionItems = normalizeReportItems(section.items || []);
    const sectionLocations = uniqueSorted(sectionItems.map((item) => item.district));

    const shell = document.createElement("div");
    shell.className = "report-category advanced-library-shell";

    const header = document.createElement("div");
    header.className = "advanced-library-header";
    header.innerHTML = `
      <div>
        <div class="section-title-row">
          <h3>${escapeHtml(section.category || "Reports")}</h3>
          <span class="data-freshness-badge data-freshness-${getFreshnessStatus(extractLatestTimestampFromItems(sectionItems, section)).tone}">
            ${escapeHtml(getFreshnessStatus(extractLatestTimestampFromItems(sectionItems, section)).label)}
          </span>
        </div>
        <p>Filter report files by ${locationLabel.toLowerCase()} and reporting date.</p>
      </div>
      <div class="advanced-library-summary" id="reportsSummaryText_${index}">0 files</div>
    `;
    shell.appendChild(header);

    const toolbar = document.createElement("div");
    toolbar.className = "advanced-library-toolbar";
    toolbar.innerHTML = `
      <div class="advanced-filter-group">
        <label for="reportsDistrictFilter_${index}">${escapeHtml(locationLabel)}</label>
        <select id="reportsDistrictFilter_${index}">
          <option value="">${escapeHtml(locationPlaceholder)}</option>
          ${sectionLocations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join("")}
        </select>
      </div>

      <div class="advanced-filter-group">
        <label for="reportsDateFilter_${index}">Report date</label>
        <input type="date" id="reportsDateFilter_${index}" />
      </div>

      <div class="advanced-filter-group advanced-filter-actions">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-secondary" id="reportsClearBtn_${index}">Clear Filters</button>
      </div>
    `;
    shell.appendChild(toolbar);

    const resultsWrap = document.createElement("div");
    resultsWrap.className = "advanced-library-results";
    shell.appendChild(resultsWrap);

    reportsContainer.appendChild(shell);

    function repaint() {
      const district = document.getElementById(`reportsDistrictFilter_${index}`)?.value || "";
      const date = document.getElementById(`reportsDateFilter_${index}`)?.value || "";

      const filteredItems = filterAdvancedItems(sectionItems, {
        district,
        supervisor: "",
        date,
        search: ""
      });

      const summary = document.getElementById(`reportsSummaryText_${index}`);
      if (summary) {
        summary.textContent = `${filteredItems.length} report file${filteredItems.length === 1 ? "" : "s"}`;
      }

      resultsWrap.innerHTML = "";

      if (!filteredItems.length) {
        resultsWrap.innerHTML = `
          <div class="placeholder-box">
            No reports match the selected filters.
          </div>
        `;
        return;
      }

      const grid = document.createElement("div");
      grid.className = "resource-grid advanced-resource-grid";

      filteredItems.forEach((item) => {
        grid.appendChild(
          buildAdvancedFileCard(item, {
            canDownload: permissions.canDownloadReports,
            actionName: "download_report",
            pageName: "reports",
            unavailableMessage: "No report file is currently available for this selection."
          })
        );
      });

      resultsWrap.appendChild(grid);
    }

    document.getElementById(`reportsDistrictFilter_${index}`)?.addEventListener("change", repaint);
    document.getElementById(`reportsDateFilter_${index}`)?.addEventListener("change", repaint);
    document.getElementById(`reportsClearBtn_${index}`)?.addEventListener("click", () => {
      const districtEl = document.getElementById(`reportsDistrictFilter_${index}`);
      const dateEl = document.getElementById(`reportsDateFilter_${index}`);
      if (districtEl) districtEl.value = "";
      if (dateEl) dateEl.value = "";
      repaint();
    });

    repaint();
  });
}

function buildEmptyStateCard(message, type = "info") {
  const box = document.createElement("div");
  box.className = `empty-state-card empty-state-${type}`;

  const icon = document.createElement("div");
  icon.className = "empty-state-icon";
  icon.textContent = type === "warning" ? "⚠" : "ℹ";

  const content = document.createElement("div");
  content.className = "empty-state-content";

  const title = document.createElement("div");
  title.className = "empty-state-title";
  title.textContent = type === "warning" ? "Not available yet" : "Nothing to show yet";

  const text = document.createElement("div");
  text.className = "empty-state-text";
  text.textContent = message || "No files available.";

  content.appendChild(title);
  content.appendChild(text);

  box.appendChild(icon);
  box.appendChild(content);

  return box;
}

/**
 * Legacy reports renderer for non-HDSS projects.
 */
function renderStandardReports(project) {
  const reportsContainer = document.getElementById("reportsContainer");
  reportsContainer.innerHTML = "";

  const permissions = getPermissions(window.currentUserProfile.role);

  if (!permissions.canViewReports) {
    reportsContainer.innerHTML = `<div class="placeholder-box">You do not have permission to view project reports.</div>`;
    return;
  }

  const reportSections = Array.isArray(project.reports) ? project.reports : [];

  if (!reportSections.length) {
    reportsContainer.innerHTML = `<div class="placeholder-box">No reports configured for this project yet.</div>`;
    return;
  }

  reportSections.forEach((section) => {
    const block = document.createElement("div");
    block.className = "report-category";

    const titleRow = document.createElement("div");
    titleRow.className = "section-title-row";

    const title = document.createElement("h3");
    title.textContent = section.category || "Reports";

    titleRow.appendChild(title);
    titleRow.appendChild(buildFreshnessBadgeFromItems(section.items || [], section));

    block.appendChild(titleRow);

    const items = Array.isArray(section.items) ? section.items : [];

    if (!items.length) {
      block.appendChild(
        buildEmptyStateCard("No report files available in this section.")
      );
    } else {
      const grid = document.createElement("div");
      grid.className = "resource-grid";

      items.forEach((item) => {
        grid.appendChild(
          buildResourceCard(
            item,
            "Download",
            "download_report",
            "reports",
            permissions.canDownloadReports
          )
        );
      });

      block.appendChild(grid);
    }

    reportsContainer.appendChild(block);
  });
}

/**
 * Legacy queries renderer for non-HDSS projects.
 */
function renderStandardQueries(project) {
  const queriesContainer = document.getElementById("queriesContainer");
  queriesContainer.innerHTML = "";

  const permissions = getPermissions(window.currentUserProfile.role);

  if (!permissions.canViewQueries) {
    queriesContainer.innerHTML = `<div class="placeholder-box">You do not have permission to access queries.</div>`;
    return;
  }

  const rawQueries = Array.isArray(project.queries) ? project.queries : [];

  if (!rawQueries.length) {
    queriesContainer.innerHTML = `<div class="placeholder-box">No queries configured for this project yet.</div>`;
    return;
  }

  rawQueries.forEach((section) => {
    const block = document.createElement("div");
    block.className = "report-category";

    const titleRow = document.createElement("div");
    titleRow.className = "section-title-row";

    const title = document.createElement("h3");
    title.textContent = section.category || "Queries";

    titleRow.appendChild(title);
    titleRow.appendChild(buildFreshnessBadgeFromItems(section.items || [], section));

    block.appendChild(titleRow);

    const items = Array.isArray(section.items) ? section.items : [];

    if (!items.length) {
      block.appendChild(
        buildEmptyStateCard("No query files available in this section.")
      );
    } else {
      const grid = document.createElement("div");
      grid.className = "resource-grid";

      items.forEach((item) => {
        grid.appendChild(
          buildResourceCard(
            item,
            "Open / Download",
            "download_query",
            "queries",
            true
          )
        );
      });

      block.appendChild(grid);
    }

    queriesContainer.appendChild(block);
  });
}

/**
 * Render reports for the selected project.
 */
function renderReports(project) {
  const projectCode = normalizeText(project?.code);
  const projectName = normalizeText(project?.name);

  if (
    projectCode === "hdss" ||
    projectName === "hdss" ||
    projectCode === "brave" ||
    projectName === "brave"
  ) {
    renderAdvancedReports(project);
    return;
  }

  renderStandardReports(project);
}

/**
 * Render queries for the selected project.
 */
function renderQueries(project) {
  const projectCode = normalizeText(project?.code);
  const projectName = normalizeText(project?.name);

  if (
    projectCode === "hdss" ||
    projectName === "hdss" ||
    projectCode === "brave" ||
    projectName === "brave"
  ) {
    renderAdvancedQueries(project);
    return;
  }

  renderStandardQueries(project);
}

/**
 * Load the selected project into the dashboard tab.
 */
async function loadProject(projectCode) {
  const baseProject = window.projectRegistry[projectCode];
  if (!baseProject) {
    alert(`Project "${projectCode}" is not configured.`);
    return;
  }

  const project = await hydrateDynamicProjectFiles(baseProject);

  window.currentProjectCode = projectCode;

  document.getElementById("dashboardTitle").textContent = `${project.name} Dashboard`;
  document.getElementById("dashboardDescription").textContent = project.description || "";
  document.getElementById("dashboardFrame").src = project.dashboardEmbedUrl || "";
  document.getElementById("downloadPdfBtn").href = project.dashboardPdf || "#";
  document.getElementById("downloadPptBtn").href = project.dashboardPpt || "#";

  await loadProjectUsersDirectory();

  renderReports(project);
  renderQueries(project);

  await logActivity("project_opened", {
    page: "project_switch",
    target: projectCode
  });
}