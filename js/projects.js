// js/projects.js

// This object becomes the active source of truth used by the app.
// It loads from Firestore first, then falls back to the local PROJECTS constant.
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

    // Keep only enabled projects in the active registry
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
    grid.className = "report-grid";

    (section.items || []).forEach((item) => {
      const link = document.createElement("a");
      link.className = "report-link";
      link.href = item.file;
      link.target = "_blank";
      link.rel = "noopener";

      link.innerHTML = `
        <span class="report-title">${item.title}</span>
        <span class="download-badge">${permissions.canDownloadReports ? "Download" : "View"}</span>
      `;

      link.addEventListener("click", async (event) => {
        if (!permissions.canDownloadReports) {
          event.preventDefault();
          alert("You do not have permission to download reports.");
          return;
        }

        await logActivity("download_report", {
          page: "reports",
          target: item.file
        });
      });

      grid.appendChild(link);
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
  grid.className = "report-grid";

  (project.queries || []).forEach((item) => {
    const link = document.createElement("a");
    link.className = "report-link";
    link.href = item.file;
    link.target = "_blank";
    link.rel = "noopener";

    link.innerHTML = `
      <span class="report-title">${item.title}</span>
      <span class="download-badge">Open / Download</span>
    `;

    link.addEventListener("click", async () => {
      await logActivity("download_query", {
        page: "queries",
        target: item.file
      });
    });

    grid.appendChild(link);
  });

  block.appendChild(grid);
  queriesContainer.appendChild(block);

  if (!project.queries || project.queries.length === 0) {
    queriesContainer.innerHTML = `<div class="placeholder-box">No queries configured for this project yet.</div>`;
  }
}