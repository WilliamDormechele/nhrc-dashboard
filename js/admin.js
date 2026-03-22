// js/admin.js

/**
 * Get all checked projects from a checkbox container.
 */
function getCheckedProjects(containerId) {
  const checked = [];
  document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`).forEach((cb) => {
    checked.push(cb.value);
  });
  return checked;
}

/**
 * Render project checkboxes for the user form.
 */
function renderProjectCheckboxesForAdmin(selectedProjects = []) {
  const container = document.getElementById("adminUserProjectsBox");
  if (!container) return;

  container.innerHTML = "";

  const registry = window.projectRegistry || {};

  Object.values(registry).forEach((project) => {
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = project.code;
    checkbox.checked = selectedProjects.includes(project.code);

    const text = document.createElement("span");
    text.textContent = `${project.name} (${project.code})`;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    container.appendChild(wrapper);
  });
}

/**
 * Show a message in the admin UI.
 */
function setAdminMessage(elementId, text, isError = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#047857";
}

/**
 * Safe helper.
 */
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Load all field supervisors and populate the supervisor dropdown.
 */
/**
 * Load all field supervisors and populate the supervisor dropdown.
 * This version avoids needing a Firestore composite index by sorting in JavaScript.
 */
async function loadSupervisorOptions(selectedValue = "") {
  const select = document.getElementById("adminUserSupervisor");
  if (!select) return;

  select.innerHTML = `<option value="">Select supervisor</option>`;

  try {
    const snapshot = await db
      .collection("users")
      .where("role", "==", "field_supervisor")
      .get();

    const supervisors = [];

    snapshot.forEach((doc) => {
      const data = doc.data() || {};

      supervisors.push({
        id: doc.id,
        fullName: data.fullName || "",
        email: data.email || ""
      });
    });

    supervisors.sort((a, b) => {
      const nameA = (a.fullName || a.email || a.id).toLowerCase();
      const nameB = (b.fullName || b.email || b.id).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    supervisors.forEach((supervisor) => {
      const option = document.createElement("option");
      option.value = supervisor.id;
      option.textContent = supervisor.fullName
        ? `${supervisor.fullName} (${supervisor.email || supervisor.id})`
        : (supervisor.email || supervisor.id);

      option.dataset.email = supervisor.email || "";
      option.dataset.name = supervisor.fullName || "";
      select.appendChild(option);
    });

    if (selectedValue && [...select.options].some((opt) => opt.value === selectedValue)) {
      select.value = selectedValue;
    } else {
      select.value = "";
    }
  } catch (error) {
    console.error("Failed to load supervisor options:", error);
  }
}

/**
 * Show/hide the supervisor field depending on role.
 */
function updateSupervisorFieldVisibility() {
  const role = document.getElementById("adminUserRole")?.value || "";
  const group = document.getElementById("adminSupervisorGroup");
  const help = document.getElementById("adminSupervisorHelp");

  if (!group) return;

  if (role === "field_worker") {
    group.style.display = "block";
    if (help) help.textContent = "Required for Field Worker only.";
  } else {
    group.style.display = "none";
    const select = document.getElementById("adminUserSupervisor");
    if (select) select.value = "";
  }
}

/**
 * Clear the user form.
 */
async function clearUserForm() {
  document.getElementById("editingUserId").value = "";
  document.getElementById("adminUserFullName").value = "";
  document.getElementById("adminUserEmail").value = "";
  document.getElementById("adminUserPassword").value = "";
  document.getElementById("adminUserRole").value = "field_worker";
  document.getElementById("adminUserIsActive").value = "true";
  renderProjectCheckboxesForAdmin([]);
  await loadSupervisorOptions("");
  updateSupervisorFieldVisibility();
  setAdminMessage("adminUserMessage", "");
}

/**
 * Create a new Auth user using the secondary auth instance.
 * This keeps the main admin session signed in.
 */
async function createAuthUserWithoutReplacingAdmin(email, password) {
  const credential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
  const newUid = credential.user.uid;

  await secondaryAuth.signOut();
  return newUid;
}

/**
 * Build supervisor fields to save on the user profile.
 */
function getSupervisorPayloadFromForm(role) {
  const supervisorSelect = document.getElementById("adminUserSupervisor");

  if (role !== "field_worker") {
    return {
      supervisorId: null,
      supervisorEmail: null,
      supervisorName: null
    };
  }

  const supervisorId = supervisorSelect?.value || "";
  if (!supervisorId) {
    throw new Error("Please select a supervisor for this field worker.");
  }

  const selectedOption = supervisorSelect.options[supervisorSelect.selectedIndex];

  return {
    supervisorId,
    supervisorEmail: selectedOption?.dataset?.email || null,
    supervisorName: selectedOption?.dataset?.name || null
  };
}

/**
 * Keep monitoring_directory in sync with user profile changes.
 * This collection is for Strategic Oversight lookups only.
 */
async function saveMonitoringDirectoryRecord(userId, userPayload, options = {}) {
  const payload = {
    fullName: userPayload.fullName || "",
    email: userPayload.email || "",
    role: userPayload.role || "",
    isActive: userPayload.isActive === true,
    assignedProjects: Array.isArray(userPayload.assignedProjects) ? userPayload.assignedProjects : [],
    supervisorId: userPayload.supervisorId || null,
    supervisorEmail: userPayload.supervisorEmail || null,
    supervisorName: userPayload.supervisorName || null,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: window.currentUserProfile.email
  };

  if (options.includeCreatedFields) {
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    payload.createdBy = window.currentUserProfile.email;
  }

  await db.collection("monitoring_directory").doc(userId).set(payload, { merge: true });
}

/**
 * Update the small sync badge under the admin buttons.
 */
function setMonitoringDirectorySyncBadge(message, status = "idle") {
  const badge = document.getElementById("monitoringDirectorySyncBadge");
  if (!badge) return;

  badge.textContent = `Last sync: ${message}`;
  badge.className = "sync-status-badge";

  if (status === "running") {
    badge.classList.add("sync-status-running");
  } else if (status === "success") {
    badge.classList.add("sync-status-success");
  } else if (status === "error") {
    badge.classList.add("sync-status-error");
  } else {
    badge.classList.add("sync-status-idle");
  }
}

/**
 * Save last sync badge/status to Firestore so it survives refresh.
 */
async function saveMonitoringDirectorySyncStatus({
  status = "idle",
  message = "Not run yet",
  mode = "none"
} = {}) {
  await db.collection("system_meta").doc("monitoring_directory_sync").set({
    status,
    message,
    mode,
    lastRunAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastRunBy: window.currentUserProfile?.email || ""
  }, { merge: true });
}

/**
 * Load saved sync badge/status from Firestore.
 */
async function loadMonitoringDirectorySyncStatus() {
  try {
    const doc = await db.collection("system_meta").doc("monitoring_directory_sync").get();

    if (!doc.exists) {
      setMonitoringDirectorySyncBadge("Not run yet", "idle");
      return;
    }

    const data = doc.data() || {};
    const status = data.status || "idle";
    const message = data.message || "Not run yet";

    let suffix = "";
    if (data.lastRunAt && data.lastRunAt.toDate) {
      suffix += ` (${data.lastRunAt.toDate().toLocaleString()})`;
    }

    if (data.lastRunBy) {
      suffix += ` by ${data.lastRunBy}`;
    }

    setMonitoringDirectorySyncBadge(`${message}${suffix}`, status);
  } catch (error) {
    console.error("Failed to load monitoring directory sync status:", error);
    setMonitoringDirectorySyncBadge("Unable to load last sync status", "error");
  }
}

/**
 * Backfill or rebuild monitoring_directory from users.
 */
async function backfillMonitoringDirectoryFromUsers(options = {}) {
  const {
    overwriteExisting = false,
    progressElementId = "adminUserMessage",
    activeButtonId = null
  } = options;

  const progressEl = document.getElementById(progressElementId);
  const backfillMissingBtn = document.getElementById("backfillMissingMonitoringBtn");
  const forceRebuildBtn = document.getElementById("forceRebuildMonitoringBtn");
  const buttons = [backfillMissingBtn, forceRebuildBtn].filter(Boolean);

  const originalLabels = new Map();
  buttons.forEach((btn) => {
    originalLabels.set(btn.id, btn.textContent);
    btn.disabled = true;
  });

  if (activeButtonId) {
    const activeBtn = document.getElementById(activeButtonId);
    if (activeBtn) {
      activeBtn.textContent = overwriteExisting ? "Rebuilding..." : "Backfilling...";
    }
  }

  setMonitoringDirectorySyncBadge(
    overwriteExisting ? "Rebuild in progress..." : "Backfill in progress...",
    "running"
  );

  await saveMonitoringDirectorySyncStatus({
    status: "running",
    message: overwriteExisting ? "Rebuild in progress..." : "Backfill in progress...",
    mode: overwriteExisting ? "force_rebuild" : "backfill_missing"
  });

  try {
    setAdminMessage(
      progressElementId,
      overwriteExisting
        ? "Loading users for full monitoring directory rebuild..."
        : "Loading users for missing-record backfill..."
    );

    const usersSnapshot = await db.collection("users").orderBy("fullName").get();

    if (usersSnapshot.empty) {
      setAdminMessage(progressElementId, "No users found to process.", true);
      setMonitoringDirectorySyncBadge("No users found to process", "error");

      await saveMonitoringDirectorySyncStatus({
        status: "error",
        message: "No users found to process",
        mode: overwriteExisting ? "force_rebuild" : "backfill_missing"
      });

      return;
    }

    const directorySnapshot = await db.collection("monitoring_directory").get();
    const existingDirectoryIds = new Set(directorySnapshot.docs.map((doc) => doc.id));

    const totalUsers = usersSnapshot.docs.length;
    let processedCount = 0;
    let writtenCount = 0;
    let skippedCount = 0;

    for (const doc of usersSnapshot.docs) {
      processedCount += 1;

      if (progressEl) {
        progressEl.textContent = `Processing ${processedCount} / ${totalUsers} users...`;
        progressEl.style.color = "#475569";
      }

      setMonitoringDirectorySyncBadge(
        `Processing ${processedCount} / ${totalUsers} users...`,
        "running"
      );

      const alreadyExists = existingDirectoryIds.has(doc.id);

      if (alreadyExists && !overwriteExisting) {
        skippedCount += 1;
        continue;
      }

      const data = doc.data();

      const userPayload = {
        fullName: data.fullName || "",
        email: data.email || "",
        role: data.role || "",
        isActive: data.isActive === true,
        assignedProjects: Array.isArray(data.assignedProjects) ? data.assignedProjects : [],
        supervisorId: data.supervisorId || null,
        supervisorEmail: data.supervisorEmail || null,
        supervisorName: data.supervisorName || null
      };

      await saveMonitoringDirectoryRecord(doc.id, userPayload, {
        includeCreatedFields: !alreadyExists
      });

      writtenCount += 1;
    }

    await logActivity(
      overwriteExisting ? "admin_force_rebuild_monitoring_directory" : "admin_backfill_missing_monitoring_directory",
      {
        page: "admin",
        target: `processed_${processedCount}_written_${writtenCount}_skipped_${skippedCount}`
      }
    );

    const successMessage = overwriteExisting
      ? `Force rebuild complete. Processed ${processedCount} users and rebuilt ${writtenCount} records.`
      : `Backfill complete. Processed ${processedCount} users, created ${writtenCount} missing records, skipped ${skippedCount}.`;

    setAdminMessage(progressElementId, successMessage);
    setMonitoringDirectorySyncBadge(successMessage, "success");

    await saveMonitoringDirectorySyncStatus({
      status: "success",
      message: successMessage,
      mode: overwriteExisting ? "force_rebuild" : "backfill_missing"
    });
  } catch (error) {
    console.error(error);
    setAdminMessage(progressElementId, `Directory sync failed: ${error.message}`, true);
    setMonitoringDirectorySyncBadge(`Failed: ${error.message}`, "error");

    try {
      await saveMonitoringDirectorySyncStatus({
        status: "error",
        message: `Failed: ${error.message}`,
        mode: overwriteExisting ? "force_rebuild" : "backfill_missing"
      });
    } catch (saveError) {
      console.error("Failed to save sync status:", saveError);
    }
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.textContent = originalLabels.get(btn.id) || btn.textContent;
    });
  }
}

/**
 * Create a new user profile or update an existing one.
 */
async function saveUserFromAdminForm() {
  try {
    setAdminMessage("adminUserMessage", "");

    const editingUserId = document.getElementById("editingUserId").value.trim();
    const fullName = document.getElementById("adminUserFullName").value.trim();
    const email = document.getElementById("adminUserEmail").value.trim().toLowerCase();
    const password = document.getElementById("adminUserPassword").value.trim();
    const role = document.getElementById("adminUserRole").value;
    const isActive = document.getElementById("adminUserIsActive").value === "true";
    const assignedProjects = getCheckedProjects("adminUserProjectsBox");

    if (!fullName || !email) {
      setAdminMessage("adminUserMessage", "Full name and email are required.", true);
      return;
    }

    if (assignedProjects.length === 0) {
      setAdminMessage("adminUserMessage", "Please assign at least one project.", true);
      return;
    }

    const supervisorPayload = getSupervisorPayloadFromForm(role);

    const userPayload = {
      fullName,
      email,
      role,
      isActive,
      assignedProjects,
      supervisorId: supervisorPayload.supervisorId,
      supervisorEmail: supervisorPayload.supervisorEmail,
      supervisorName: supervisorPayload.supervisorName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: window.currentUserProfile.email
    };

    if (editingUserId) {
      await db.collection("users").doc(editingUserId).update(userPayload);
      await saveMonitoringDirectoryRecord(editingUserId, userPayload);

      await logActivity("admin_update_user", {
        page: "admin",
        target: email
      });

      setAdminMessage("adminUserMessage", "User updated successfully.");
      await clearUserForm();
      await loadUsersForAdmin();
      return;
    }

    if (!password) {
      setAdminMessage("adminUserMessage", "Temporary PIN / password is required for a new user.", true);
      return;
    }

    const newUid = await createAuthUserWithoutReplacingAdmin(email, password);

    await db.collection("users").doc(newUid).set({
      ...userPayload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: window.currentUserProfile.email
    });

    await saveMonitoringDirectoryRecord(newUid, userPayload, { includeCreatedFields: true });

    await logActivity("admin_create_user", {
      page: "admin",
      target: email
    });

    try {
      await auth.sendPasswordResetEmail(email);
    } catch (emailError) {
      console.error("Failed to send account setup email:", emailError);
    }

    setAdminMessage(
      "adminUserMessage",
      "New user created successfully. A password setup/reset email has been sent to the user."
    );
    await clearUserForm();
    await loadUsersForAdmin();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", error.message, true);
  }
}



/**
 * Load all user profiles for the admin table.
 */
async function loadUsersForAdmin() {
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = `<tr><td colspan="7">Loading users...</td></tr>`;

  try {
    const snapshot = await db.collection("users").orderBy("fullName").get();

    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";

    snapshot.forEach((doc) => {
      const data = doc.data();
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${data.fullName || ""}</td>
        <td>${data.email || ""}</td>
        <td>${data.role || ""}</td>
        <td>${data.supervisorName || data.supervisorEmail || "-"}</td>
        <td>${data.isActive === true ? "Yes" : "No"}</td>
        <td>${safeArray(data.assignedProjects).join(", ")}</td>
        <td><button class="btn btn-secondary btn-edit-user" data-id="${doc.id}">Edit</button></td>
      `;

      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-edit-user").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await loadUserIntoForm(btn.dataset.id);
      });
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="7">Failed to load users.</td></tr>`;
  }
}

/**
 * Load one user profile into the edit form.
 */
async function loadUserIntoForm(userId) {
  const doc = await db.collection("users").doc(userId).get();
  if (!doc.exists) {
    alert("User not found.");
    return;
  }

  const data = doc.data();

  document.getElementById("editingUserId").value = userId;
  document.getElementById("adminUserFullName").value = data.fullName || "";
  document.getElementById("adminUserEmail").value = data.email || "";
  document.getElementById("adminUserPassword").value = "";
  document.getElementById("adminUserRole").value = data.role || "field_worker";
  document.getElementById("adminUserIsActive").value = data.isActive === false ? "false" : "true";

  renderProjectCheckboxesForAdmin(safeArray(data.assignedProjects));
  await loadSupervisorOptions(data.supervisorId || "");
  updateSupervisorFieldVisibility();

  setAdminMessage("adminUserMessage", "Loaded user for editing.");
}

/**
 * Clear the project form.
 */
function clearProjectForm() {
  document.getElementById("editingProjectCode").value = "";
  document.getElementById("projectCodeInput").value = "";
  document.getElementById("projectNameInput").value = "";
  document.getElementById("projectDescriptionInput").value = "";
  document.getElementById("projectEnabledInput").value = "true";
  document.getElementById("projectDashboardUrlInput").value = "";
  document.getElementById("projectPdfInput").value = "";
  document.getElementById("projectPptInput").value = "";
  document.getElementById("projectReportsJsonInput").value = "[]";
  document.getElementById("projectQueriesJsonInput").value = "[]";
  setAdminMessage("adminProjectMessage", "");
}

/**
 * Save or update a project document in Firestore.
 * Project code becomes the Firestore document ID.
 */
async function saveProjectFromAdminForm() {
  try {
    setAdminMessage("adminProjectMessage", "");

    const editingProjectCode = document.getElementById("editingProjectCode").value.trim();
    const code = document.getElementById("projectCodeInput").value.trim().toLowerCase();
    const name = document.getElementById("projectNameInput").value.trim();
    const description = document.getElementById("projectDescriptionInput").value.trim();
    const enabled = document.getElementById("projectEnabledInput").value === "true";
    const dashboardEmbedUrl = document.getElementById("projectDashboardUrlInput").value.trim();
    const dashboardPdf = document.getElementById("projectPdfInput").value.trim();
    const dashboardPpt = document.getElementById("projectPptInput").value.trim();
    const reportsJsonText = document.getElementById("projectReportsJsonInput").value.trim();
    const queriesJsonText = document.getElementById("projectQueriesJsonInput").value.trim();

    if (!code || !name) {
      setAdminMessage("adminProjectMessage", "Project code and name are required.", true);
      return;
    }

    const reports = reportsJsonText ? JSON.parse(reportsJsonText) : [];
    const queries = queriesJsonText ? JSON.parse(queriesJsonText) : [];

    await db.collection("projects").doc(code).set({
      code,
      name,
      description,
      enabled,
      dashboardEmbedUrl,
      dashboardPdf,
      dashboardPpt,
      reports,
      queries,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: window.currentUserProfile.email
    }, { merge: true });

    if (!editingProjectCode || editingProjectCode !== code) {
      await db.collection("projects").doc(code).set({
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: window.currentUserProfile.email
      }, { merge: true });
    }

    await logActivity("admin_save_project", {
      page: "admin",
      target: code
    });

    setAdminMessage("adminProjectMessage", "Project saved successfully.");
    clearProjectForm();

    await loadProjectsRegistry();
    await loadProjectsForAdmin();
    renderProjectCheckboxesForAdmin([]);
    repopulateProjectsForCurrentUser();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminProjectMessage", `Project save failed: ${error.message}`, true);
  }
}

/**
 * Seed the fallback project config into Firestore.
 */
async function seedFallbackProjectsToFirestore() {
  try {
    setAdminMessage("adminProjectMessage", "");

    const writes = [];

    Object.values(PROJECTS).forEach((project) => {
      writes.push(
        db.collection("projects").doc(project.code).set({
          ...project,
          enabled: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: window.currentUserProfile.email,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: window.currentUserProfile.email
        }, { merge: true })
      );
    });

    await Promise.all(writes);

    await logActivity("admin_seed_projects", {
      page: "admin",
      target: "projects"
    });

    setAdminMessage("adminProjectMessage", "Fallback projects seeded to Firestore successfully.");
    await loadProjectsRegistry();
    await loadProjectsForAdmin();
    renderProjectCheckboxesForAdmin([]);
    repopulateProjectsForCurrentUser();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminProjectMessage", error.message, true);
  }
}

/**
 * Load Firestore projects into the project table.
 */
async function loadProjectsForAdmin() {
  const tbody = document.getElementById("projectsTableBody");
  tbody.innerHTML = `<tr><td colspan="5">Loading projects...</td></tr>`;

  try {
    const snapshot = await db.collection("projects").orderBy("name").get();

    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="5">No Firestore projects found yet. You can seed them using the button above.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";

    snapshot.forEach((doc) => {
      const data = doc.data();
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${data.code || doc.id}</td>
        <td>${data.name || ""}</td>
        <td>${data.enabled === false ? "No" : "Yes"}</td>
        <td>${data.dashboardEmbedUrl ? "Configured" : "Not set"}</td>
        <td><button class="btn btn-secondary btn-edit-project" data-id="${doc.id}">Edit</button></td>
      `;

      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-edit-project").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await loadProjectIntoForm(btn.dataset.id);
      });
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="5">Failed to load projects.</td></tr>`;
  }
}

/**
 * Load a Firestore project into the admin project form.
 */
async function loadProjectIntoForm(projectCode) {
  const doc = await db.collection("projects").doc(projectCode).get();
  if (!doc.exists) {
    alert("Project not found.");
    return;
  }

  const data = doc.data();

  document.getElementById("editingProjectCode").value = projectCode;
  document.getElementById("projectCodeInput").value = data.code || projectCode;
  document.getElementById("projectNameInput").value = data.name || "";
  document.getElementById("projectDescriptionInput").value = data.description || "";
  document.getElementById("projectEnabledInput").value = data.enabled === false ? "false" : "true";
  document.getElementById("projectDashboardUrlInput").value = data.dashboardEmbedUrl || "";
  document.getElementById("projectPdfInput").value = data.dashboardPdf || "";
  document.getElementById("projectPptInput").value = data.dashboardPpt || "";
  document.getElementById("projectReportsJsonInput").value = JSON.stringify(data.reports || [], null, 2);
  document.getElementById("projectQueriesJsonInput").value = JSON.stringify(data.queries || [], null, 2);

  setAdminMessage("adminProjectMessage", "Loaded project for editing.");
}

/**
 * Rebuild the current user's project dropdown after project changes.
 */
function repopulateProjectsForCurrentUser() {
  if (!window.currentUserProfile) return;

  populateProjectSelect(window.currentUserProfile.assignedProjects || []);

  const assigned = window.currentUserProfile.assignedProjects || [];
  if (assigned.length > 0) {
    const select = document.getElementById("projectSelect");
    if (window.currentProjectCode && assigned.includes(window.currentProjectCode)) {
      select.value = window.currentProjectCode;
      loadProject(window.currentProjectCode);
    } else {
      select.value = assigned[0];
      loadProject(assigned[0]);
    }
  }
}

/**
 * Set up all admin event listeners.
 */
function setupAdminUI() {
  document.getElementById("saveUserBtn").addEventListener("click", saveUserFromAdminForm);
  document.getElementById("clearUserFormBtn").addEventListener("click", clearUserForm);
  document.getElementById("refreshUsersBtn").addEventListener("click", loadUsersForAdmin);

  const backfillMissingBtn = document.getElementById("backfillMissingMonitoringBtn");
  if (backfillMissingBtn) {
    backfillMissingBtn.addEventListener("click", async () => {
      const useSweetAlert = typeof Swal !== "undefined";

      if (useSweetAlert) {
        const result = await Swal.fire({
          title: "Backfill Missing Records?",
          text: "This will scan all users and create only missing monitoring directory records. Existing records will be skipped.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Yes, backfill missing",
          cancelButtonText: "Cancel"
        });

        if (!result.isConfirmed) return;

        await backfillMonitoringDirectoryFromUsers({
          overwriteExisting: false,
          activeButtonId: "backfillMissingMonitoringBtn"
        });

        await Swal.fire({
          icon: "success",
          title: "Backfill Complete",
          text: "Missing monitoring directory records have been created."
        });

        return;
      }

      const confirmRun = confirm(
        "This will scan all users and create only missing monitoring directory records.\n\n" +
        "Existing records will be skipped.\n\n" +
        "Do you want to continue?"
      );

      if (!confirmRun) return;

      await backfillMonitoringDirectoryFromUsers({
        overwriteExisting: false,
        activeButtonId: "backfillMissingMonitoringBtn"
      });
      alert("Backfill complete.");
    });
  }

  const forceRebuildBtn = document.getElementById("forceRebuildMonitoringBtn");
  if (forceRebuildBtn) {
    forceRebuildBtn.addEventListener("click", async () => {
      const useSweetAlert = typeof Swal !== "undefined";

      if (useSweetAlert) {
        const result = await Swal.fire({
          title: "Force Rebuild Monitoring Directory?",
          text: "This will overwrite and rebuild monitoring directory records for ALL users.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Yes, rebuild all",
          cancelButtonText: "Cancel"
        });

        if (!result.isConfirmed) return;

        await backfillMonitoringDirectoryFromUsers({
          overwriteExisting: true,
          activeButtonId: "forceRebuildMonitoringBtn"
        });

        await Swal.fire({
          icon: "success",
          title: "Rebuild Complete",
          text: "Monitoring directory records have been fully rebuilt."
        });

        return;
      }

      const confirmRun = confirm(
        "This will overwrite and rebuild monitoring directory records for ALL users.\n\n" +
        "Do you want to continue?"
      );

      if (!confirmRun) return;

      await backfillMonitoringDirectoryFromUsers({
        overwriteExisting: true,
        activeButtonId: "forceRebuildMonitoringBtn"
      });
      alert("Rebuild complete.");
    });
  }

  document.getElementById("adminUserRole").addEventListener("change", updateSupervisorFieldVisibility);

  document.getElementById("saveProjectBtn").addEventListener("click", saveProjectFromAdminForm);
  document.getElementById("clearProjectFormBtn").addEventListener("click", clearProjectForm);
  document.getElementById("seedProjectsBtn").addEventListener("click", seedFallbackProjectsToFirestore);
  document.getElementById("refreshProjectsBtn").addEventListener("click", async () => {
    await loadProjectsRegistry();
    await loadProjectsForAdmin();
  });

  // Do not load admin-only Firestore data here.
  // These are loaded only after sign-in, and only for admin/developer users.
  updateSupervisorFieldVisibility();
}