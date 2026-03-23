// js/projects.js

window.projectRegistry = {};

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

      if (data.enabled !== false) {
        firestoreProjects[doc.id] = {
          code: doc.id,
          ...data
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

      if (data.enabled !== false) {
        firestoreProjects[doc.id] = {
          code: doc.id,
          ...data
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
  const path = filePath.toLowerCase();

  if (path.endsWith(".pdf")) return "PDF";
  if (path.endsWith(".ppt") || path.endsWith(".pptx")) return "PPT";
  if (path.endsWith(".xls") || path.endsWith(".xlsx") || path.endsWith(".csv")) return "Excel";
  if (path.endsWith(".doc") || path.endsWith(".docx")) return "Word";
  return "File";
}

/**
 * Build a clean resource card.
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
  const titleText = String(safeItem.title || "Untitled report").trim();

  const unavailable =
    options.unavailable === true || !filePath;

  const unavailableMessage =
  options.unavailableMessage || "No report is currently available for this selection.";

  // Unavailable / empty report card
  if (unavailable) {
    const card = document.createElement("div");
    card.className = "resource-card resource-card-disabled";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-disabled", "true");
    card.title = unavailableMessage;

    // Inline styling so you do not need to touch CSS
    // card.style.opacity = "0.58";
    // card.style.filter = "grayscale(0.25)";
    // card.style.cursor = "not-allowed";
    // card.style.border = "1px solid #d1d5db";
    // card.style.background = "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)";
    // card.style.boxShadow = "none";
    // card.style.position = "relative";
    // card.style.userSelect = "none";

    card.innerHTML = `
      <div class="resource-card-top">
        <span class="resource-filetype">N/A</span>
        <span class="resource-badge">Unavailable</span>
      </div>

      <div class="resource-title">${titleText}</div>

      <div class="resource-subtext">
        No report currently available for this selection.
      </div>
    `;

    const showUnavailableNotice = () => {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: "info",
          title: "Report Not Available",
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

  // Normal available card
  const link = document.createElement("a");
  link.className = "resource-card";
  link.href = filePath;
  link.target = "_blank";
  link.rel = "noopener";

  const fileType = getFileTypeLabel(filePath);

  link.innerHTML = `
    <div class="resource-card-top">
      <span class="resource-filetype">${fileType}</span>
      <span class="resource-badge">${badgeText}</span>
    </div>

    <div class="resource-title">${titleText}</div>

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
          text: "You do not have permission to download reports.",
          confirmButtonText: "OK"
        });
      } else {
        alert("You do not have permission to download reports.");
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
 * Load the selected project into the dashboard tab.
 */
function loadProject(projectCode) {
  const project = window.projectRegistry[projectCode];
  if (!project) {
    alert(`Project "${projectCode}" is not configured.`);
    return;
  }

  window.currentProjectCode = projectCode;

  document.getElementById("dashboardTitle").textContent = `${project.name} Dashboard`;
  document.getElementById("dashboardDescription").textContent = project.description || "";
  document.getElementById("dashboardFrame").src = project.dashboardEmbedUrl || "";
  document.getElementById("downloadPdfBtn").href = project.dashboardPdf || "#";
  document.getElementById("downloadPptBtn").href = project.dashboardPpt || "#";

  renderReports(project);
  renderQueries(project);

  logActivity("project_opened", {
    page: "project_switch",
    target: projectCode
  });
}

/**
 * Render reports for the selected project.
 */
function renderReports(project) {
  const reportsContainer = document.getElementById("reportsContainer");
  reportsContainer.innerHTML = "";

  const permissions = getPermissions(window.currentUserProfile.role);

  if (!permissions.canViewReports) {
    reportsContainer.innerHTML = `<div class="placeholder-box">You do not have permission to view project reports.</div>`;
    return;
  }

  const reportSections = Array.isArray(project.reports) ? project.reports : [];

  if (reportSections.length === 0) {
    const block = document.createElement("div");
    block.className = "report-category";

    const title = document.createElement("h3");
    title.textContent = `${project.name || "Project"} Reports`;
    block.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "resource-grid";

    grid.appendChild(
      buildResourceCard(
        {
          title: "No report available"
        },
        "Unavailable",
        "download_report",
        "reports",
        false,
        {
          unavailable: true,
          unavailableMessage: "No report is currently available for this selection."
        }
      )
    );

    block.appendChild(grid);
    reportsContainer.appendChild(block);
    return;
  }

  reportSections.forEach((section) => {
    const block = document.createElement("div");
    block.className = "report-category";

    const title = document.createElement("h3");
    title.textContent = section.category || "Reports";
    block.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "resource-grid";

    const items = Array.isArray(section.items) ? section.items : [];

    // If a category exists but has no items, show one grey unavailable card
    if (items.length === 0) {
      grid.appendChild(
        buildResourceCard(
          {
            title: `${section.category || "Report"} not available`
          },
          "Unavailable",
          "download_report",
          "reports",
          false,
          {
            unavailable: true,
            unavailableMessage: "No report is currently available for this selection."
          }
        )
      );
    } else {
      items.forEach((item) => {
        const hasFile = !!String(item?.file || "").trim();

        const card = buildResourceCard(
          item,
          hasFile
            ? (permissions.canDownloadReports ? "Download" : "View")
            : "Unavailable",
          "download_report",
          "reports",
          hasFile ? permissions.canDownloadReports : false,
          {
            unavailable: !hasFile,
            unavailableMessage: "No report is currently available for this selection."
          }
        );

        grid.appendChild(card);
      });
    }

    block.appendChild(grid);
    reportsContainer.appendChild(block);
  });
}

/**
 * Render queries for the selected project.
 */
function renderQueries(project) {
  const queriesContainer = document.getElementById("queriesContainer");
  queriesContainer.innerHTML = "";

  const permissions = getPermissions(window.currentUserProfile.role);

  if (!permissions.canViewQueries) {
    queriesContainer.innerHTML = `<div class="placeholder-box">You do not have permission to access queries.</div>`;
    return;
  }

  const block = document.createElement("div");
  block.className = "report-category";

  const title = document.createElement("h3");
  title.textContent = `${project.name} Queries`;
  block.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "resource-grid";

  (project.queries || []).forEach((item) => {
    const card = buildResourceCard(
      item,
      "Open / Download",
      "download_query",
      "queries",
      true
    );

    grid.appendChild(card);
  });

  block.appendChild(grid);
  queriesContainer.appendChild(block);

  if (!project.queries || project.queries.length === 0) {
    queriesContainer.innerHTML = `<div class="placeholder-box">No queries configured for this project yet.</div>`;
  }
}