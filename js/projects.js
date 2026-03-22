// js/projects.js

window.projectRegistry = {};

/**
 * Load projects from Firestore.
 * If no Firestore projects exist yet, use the local fallback config from data/project-config.js.
 */
async function loadProjectsRegistry() {
  const snapshot = await db.collection("projects").get();
  const firestoreProjects = {};

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (data.enabled !== false) {
      firestoreProjects[doc.id] = {
        code: doc.id,
        ...data
      };
    }
  });

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
function buildResourceCard(item, badgeText, actionName, pageName, canDownload = true) {
  const link = document.createElement("a");
  link.className = "resource-card";
  link.href = item.file;
  link.target = "_blank";
  link.rel = "noopener";

  const fileType = getFileTypeLabel(item.file);

  link.innerHTML = `
    <div class="resource-card-top">
      <span class="resource-filetype">${fileType}</span>
      <span class="resource-badge">${badgeText}</span>
    </div>

    <div class="resource-title">${item.title}</div>

    <div class="resource-subtext">
      Click to ${canDownload ? "open or download" : "open"} this file
    </div>
  `;

  link.addEventListener("click", async (event) => {
    if (!canDownload) {
      event.preventDefault();
      alert("You do not have permission to download reports.");
      return;
    }

    await logActivity(actionName, {
      page: pageName,
      target: item.file
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

  (project.reports || []).forEach((section) => {
    const block = document.createElement("div");
    block.className = "report-category";

    const title = document.createElement("h3");
    title.textContent = section.category;
    block.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "resource-grid";

    (section.items || []).forEach((item) => {
      const card = buildResourceCard(
        item,
        permissions.canDownloadReports ? "Download" : "View",
        "download_report",
        "reports",
        permissions.canDownloadReports
      );

      grid.appendChild(card);
    });

    block.appendChild(grid);
    reportsContainer.appendChild(block);
  });

  if (!project.reports || project.reports.length === 0) {
    reportsContainer.innerHTML = `<div class="placeholder-box">No reports configured for this project yet.</div>`;
  }
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