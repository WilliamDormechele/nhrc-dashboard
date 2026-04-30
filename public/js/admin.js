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
window.renderProjectCheckboxesForAdmin = function (selectedProjects = []) {
  const container = document.getElementById("adminUserProjectsBox");
  if (!container) return;

  container.innerHTML = "";

  const registry = window.projectRegistry || {};
  const selected = Array.isArray(selectedProjects) ? selectedProjects : [];

  Object.values(registry).forEach((project) => {

  // ❗ HIDE deleted or inactive
  if (project.isDeleted === true || project.isActive === false) return;
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = project.code;
    checkbox.checked = selected.includes(project.code);

    const text = document.createElement("span");
    text.textContent = `${project.name} (${project.code})`;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    container.appendChild(wrapper);
  });
};

/**
 * Show a message in the admin UI.
 */
function setAdminMessage(elementId, text, isError = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#047857";
}

function showAdminToast(message, icon = "success", timer = 2200) {
  if (typeof Swal !== "undefined") {
    Swal.fire({
      toast: true,
      position: "top-end",
      icon,
      title: message,
      showConfirmButton: false,
      timer,
      timerProgressBar: true
    });
  }
}

function highlightAndScrollToCard(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;

  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.remove("form-focus-highlight");

  void card.offsetWidth;

  card.classList.add("form-focus-highlight");

  setTimeout(() => {
    card.classList.remove("form-focus-highlight");
  }, 2300);
}

/**
 * Safe helpers.
 */
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(values = []) {
  return safeArray(values)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function arraysEqualIgnoreOrder(left = [], right = []) {
  return JSON.stringify(normalizeStringArray(left)) === JSON.stringify(normalizeStringArray(right));
}

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function adminEscapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function adminTimestampToDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function adminDateTimeText(value) {
  const date = adminTimestampToDate(value);
  return date ? date.toLocaleString() : "";
}

function adminDateOnlyText(value) {
  const date = adminTimestampToDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * Load all field supervisors and populate the supervisor dropdown.
 * This version avoids needing a Firestore composite index by sorting in JavaScript.
 */
window.loadSupervisorOptions = async function (selectedValue = "") {
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
};

/**
 * Show/hide the supervisor field depending on role.
 */
window.updateSupervisorFieldVisibility = function () {
  const role = document.getElementById("adminUserRole")?.value || "";

  const supervisorGroup = document.getElementById("adminSupervisorGroup");
  const supervisorHelp = document.getElementById("adminSupervisorHelp");
  const supervisorSelect = document.getElementById("adminUserSupervisor");

  const districtGroup = document.getElementById("adminDistrictGroup");
  const districtHelp = document.getElementById("adminDistrictHelp");
  const districtSelect = document.getElementById("adminUserDistrict");

  const isFieldWorker = role === "field_worker";

  if (supervisorGroup) supervisorGroup.style.display = isFieldWorker ? "block" : "none";
  if (districtGroup) districtGroup.style.display = isFieldWorker ? "block" : "none";

  if (supervisorHelp) supervisorHelp.textContent = "Required for Field Worker only.";
  if (districtHelp) districtHelp.textContent = "Required for Field Worker only.";

  if (!isFieldWorker) {
    if (supervisorSelect) supervisorSelect.value = "";
    if (districtSelect) districtSelect.value = "";
  }
};

/**
 * Clear the user form.
 */
async function clearUserForm(showToast = true) {
  document.getElementById("editingUserId").value = "";
  document.getElementById("adminUserFullName").value = "";
  document.getElementById("adminUserEmail").value = "";
  document.getElementById("adminUserPassword").value = "";
  document.getElementById("adminUserRole").value = "field_worker";
  document.getElementById("adminUserIsActive").value = "true";
  document.getElementById("adminUserDistrict").value = "";
  window.renderProjectCheckboxesForAdmin([]);
  await window.loadSupervisorOptions("");
  window.updateSupervisorFieldVisibility();
  setAdminMessage("adminUserMessage", "");

  if (showToast) {
    showAdminToast("User form cleared", "success", 1500);
  }
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
 * Build fw fields to save on the user profile.
 */
function getDistrictPayloadFromForm(role) {
  const district = document.getElementById("adminUserDistrict")?.value || "";

  if (role !== "field_worker") {
    return null;
  }

  if (!district) {
    throw new Error("Please select a district for this field worker.");
  }

  return district;
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
    district: userPayload.district || null,
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
window.loadMonitoringDirectorySyncStatus = async function () {
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
};

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
        district: data.district || null,
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
 * Loader helpers
 */
function ensureAdminLoaderOverlay() {
  let overlay = document.getElementById("adminLoaderOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "adminLoaderOverlay";
  overlay.className = "admin-loader-overlay hidden";
  overlay.innerHTML = `
    <div class="admin-loader-modal" role="dialog" aria-modal="true" aria-labelledby="adminLoaderTitle">
      <div class="admin-loader-header">
        <h3 class="admin-loader-header-title" id="adminLoaderTitle">Processing Admin Action</h3>
        <p class="admin-loader-header-subtitle">Please wait while the system completes this request.</p>
      </div>
      <div class="admin-loader-body">
        <div class="admin-loader-row">
          <div class="admin-loader-spinner" aria-hidden="true"></div>
          <div class="admin-loader-message" id="adminLoaderMessage">Processing...</div>
        </div>
        <div class="admin-loader-progress">
          <div class="admin-loader-progress-bar"></div>
        </div>
        <div class="admin-loader-footnote">Please do not refresh or close this page.</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

function showAdminLoader(message = "Processing...") {
  const overlay = ensureAdminLoaderOverlay();
  const messageEl = document.getElementById("adminLoaderMessage");

  if (messageEl) {
    messageEl.textContent = message;
  }

  overlay.classList.remove("hidden");
  document.body.classList.add("admin-loading");
}

function hideAdminLoader() {
  const overlay = document.getElementById("adminLoaderOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
  document.body.classList.remove("admin-loading");
}

function setAdminLoading(elementId, message = "Processing...") {
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = `
      <span class="spinner" style="
        display:inline-block;
        width:14px;
        height:14px;
        border:2px solid #ccc;
        border-top:2px solid #1d4ed8;
        border-radius:50%;
        animation:spin 0.6s linear infinite;
        margin-right:6px;
      "></span>
      ${message}
    `;
    el.style.color = "#1d4ed8";
  }

  showAdminLoader(message);
}

/**
 * Callable functions
 */
const setUserActiveStateCallable = functions.httpsCallable("setUserActiveState");
const softDeleteUserCallable = functions.httpsCallable("softDeleteUser");
const restoreDeletedUserCallable = functions.httpsCallable("restoreDeletedUser");
const hardDeleteUserCallable = functions.httpsCallable("hardDeleteUser");
const sendUserLifecycleEmailCallable = functions.httpsCallable("sendUserLifecycleEmail");

/**
 * Create a new user profile or update an existing one.
 */
async function saveUserFromAdminForm() {
  try {
    setAdminLoading("adminUserMessage", "Saving user...");

    const editingUserId = document.getElementById("editingUserId").value.trim();
    const fullName = document.getElementById("adminUserFullName").value.trim();
    const email = document.getElementById("adminUserEmail").value.trim().toLowerCase();
    const password = document.getElementById("adminUserPassword").value.trim();
    const role = document.getElementById("adminUserRole").value;
    const isActive = document.getElementById("adminUserIsActive").value === "true";
    const assignedProjects = getCheckedProjects("adminUserProjectsBox");
    const isEditingSelf = !!editingUserId && editingUserId === auth.currentUser?.uid;

    if (!fullName || !email) {
      setAdminMessage("adminUserMessage", "Full name and email are required.", true);
      return;
    }

    if (assignedProjects.length === 0) {
      setAdminMessage("adminUserMessage", "Please assign at least one project.", true);
      return;
    }

    const supervisorPayload = getSupervisorPayloadFromForm(role);
    const district = getDistrictPayloadFromForm(role);

    const userPayload = {
      fullName,
      email,
      role,
      isActive,
      assignedProjects,
      district,
      supervisorId: supervisorPayload.supervisorId,
      supervisorEmail: supervisorPayload.supervisorEmail,
      supervisorName: supervisorPayload.supervisorName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: window.currentUserProfile.email
    };

    if (editingUserId) {
      const beforeSnap = await db.collection("users").doc(editingUserId).get();

      if (!beforeSnap.exists) {
        throw new Error("User being edited was not found.");
      }

      const beforeData = beforeSnap.data() || {};
      const previousProjects = safeArray(beforeData.assignedProjects);
      const projectsChanged = !arraysEqualIgnoreOrder(previousProjects, assignedProjects);

      const roleChanged = (beforeData.role || "") !== role;
      const activeChanged = (beforeData.isActive === true) !== isActive;
      const supervisorChanged =
        (beforeData.supervisorId || "") !== (supervisorPayload.supervisorId || "") ||
        (beforeData.supervisorEmail || "") !== (supervisorPayload.supervisorEmail || "") ||
        (beforeData.supervisorName || "") !== (supervisorPayload.supervisorName || "");

      if (isEditingSelf && projectsChanged) {
        window.suppressSelfAccessChangeLogout = true;
      }

      await db.collection("users").doc(editingUserId).update(userPayload);
      await saveMonitoringDirectoryRecord(editingUserId, userPayload);

      await logActivity("admin_update_user", {
        page: "admin",
        target: email
      });

      let accessEmailWarning = "";
      setAdminLoading("adminUserMessage", "Saving user changes...");

      if (roleChanged || projectsChanged || activeChanged || supervisorChanged) {
        setAdminLoading("adminUserMessage", "Updating access and notifying user...");
        try {
          await sendUserLifecycleEmailCallable({
            eventType: "role_updated",
            userId: editingUserId,
            context: {
              previousRole: beforeData.role || "",
              previousProjects: previousProjects,
              previousIsActive: beforeData.isActive === true,
              previousSupervisorName: beforeData.supervisorName || beforeData.supervisorEmail || ""
            }
          });
        } catch (emailError) {
          console.error("Failed to send access update email:", emailError);
          accessEmailWarning = " Access was updated, but the notification email could not be sent.";
        }
      }

      setAdminMessage("adminUserMessage", `User updated successfully.${accessEmailWarning}`);
      showAdminToast("User updated successfully", "success");

      if (isEditingSelf && projectsChanged) {
        await Swal.fire({
          icon: "success",
          title: "Access updated",
          text: "Your project access was updated successfully. Please sign out and sign in again to refresh the project dropdown."
        });
      }

      await clearUserForm(false);
      await loadUsersForAdmin();
      await loadRecentAdminAuditLogs();
      return;
    }

    if (!password) {
      setAdminMessage("adminUserMessage", "Temporary PIN / password is required for a new user.", true);
      return;
    }

    const newUid = await createAuthUserWithoutReplacingAdmin(email, password);
    setAdminLoading("adminUserMessage", "Creating user profile...");

    await db.collection("users").doc(newUid).set({
      ...userPayload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: window.currentUserProfile.email
    });

    setAdminLoading("adminUserMessage", "Finalizing setup...");

    await saveMonitoringDirectoryRecord(newUid, userPayload, { includeCreatedFields: true });

    await logActivity("admin_create_user", {
      page: "admin",
      target: email
    });

    let emailSent = false;
    let onboardingEmailWarning = "";

    setAdminLoading("adminUserMessage", "Sending onboarding email...");
    try {
      await sendUserLifecycleEmailCallable({
        eventType: "created",
        userId: newUid
      });
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send custom onboarding email:", emailError);
      onboardingEmailWarning =
        " User created successfully, but the onboarding email could not be sent.";
    }

    setAdminMessage(
      "adminUserMessage",
      emailSent
        ? "New user created successfully. Test onboarding email sent with set-password and login buttons."
        : onboardingEmailWarning
    );

    showAdminToast("User saved successfully", "success");

    await clearUserForm();
    await loadUsersForAdmin();
    await loadRecentAdminAuditLogs();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", error.message, true);
  } finally {
    window.suppressSelfAccessChangeLogout = false;
    hideAdminLoader();
  }
}

/**
 * Send a password reset email for a selected user.
 */
async function sendPasswordResetForUser(userId) {
  try {
    const doc = await db.collection("users").doc(userId).get();

    if (!doc.exists) {
      throw new Error("User not found.");
    }

    const data = doc.data() || {};
    const email = (data.email || "").trim().toLowerCase();
    const fullName = data.fullName || "User";

    if (!email) {
      throw new Error("This user does not have a valid email address.");
    }

    const useSweetAlert = typeof Swal !== "undefined";

    if (useSweetAlert) {
      const result = await Swal.fire({
        title: "Send custom password reset email?",
        html: `Send a custom password reset email to <b>${fullName}</b><br><small>${email}</small>?`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Yes, send reset email",
        cancelButtonText: "Cancel"
      });

      if (!result.isConfirmed) return;
    } else {
      const confirmed = confirm(`Send a custom password reset email to ${fullName} (${email})?`);
      if (!confirmed) return;
    }

    setAdminLoading("adminUserMessage", "Sending password reset email...");

    await sendUserLifecycleEmailCallable({
      eventType: "password_reset",
      userId
    });

    await logActivity("admin_send_password_reset", {
      page: "admin",
      target: email
    });

    setAdminMessage(
      "adminUserMessage",
      `Custom password reset email sent successfully to ${fullName} (${email}).`
    );

    hideAdminLoader();

    if (useSweetAlert) {
      await Swal.fire({
        icon: "success",
        title: "Reset Email Sent",
        text: `A custom password reset email has been sent to ${email}.`
      });
    }
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", `Failed to send reset email: ${error.message}`, true);

    hideAdminLoader();

    if (typeof Swal !== "undefined") {
      await Swal.fire({
        icon: "error",
        title: "Reset Failed",
        text: error.message
      });
    }
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
  document.getElementById("adminUserDistrict").value = data.district || "";

  window.renderProjectCheckboxesForAdmin(safeArray(data.assignedProjects));
  await window.loadSupervisorOptions(data.supervisorId || "");
  window.updateSupervisorFieldVisibility();

  setAdminMessage("adminUserMessage", "Loaded user for editing.");

  if (typeof Swal !== "undefined") {
    await Swal.fire({
      icon: "info",
      title: "User Loaded for Editing",
      html: `
        <div style="text-align:left">
          <div><b>Name:</b> ${data.fullName || "-"}</div>
          <div><b>Email:</b> ${data.email || "-"}</div>
          <div><b>Role:</b> ${data.role || "-"}</div>
          <div><b>Status:</b> ${data.isActive === false ? "Inactive" : "Active"}</div>
          <div><b>Supervisor:</b> ${data.supervisorName || data.supervisorEmail || "-"}</div>
          <div><b>Projects:</b> ${safeArray(data.assignedProjects).join(", ") || "-"}</div>
        </div>
      `,
      confirmButtonText: "Continue to Edit"
    });
  }

  highlightAndScrollToCard("adminUserFormCard");
  showAdminToast("User loaded into form", "info", 1800);
}

/**
 * Clear the project form.
 */
function clearProjectForm(showToast = true) {
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

  if (showToast) {
    showAdminToast("Project form cleared", "success", 1500);
  }
}

/**
 * Save or update a project document in Firestore.
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

      // ✅ NEW ENTERPRISE FLAGS
      isActive: enabled === true,
      isDeleted: false,

      // keep for backward compatibility
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
    showAdminToast("Project saved successfully", "success");
    clearProjectForm(false);

    await loadProjectsRegistry();
    await window.loadProjectsForAdmin();
    window.renderProjectCheckboxesForAdmin([]);
    repopulateProjectsForCurrentUser();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminProjectMessage", `Project save failed: ${error.message}`, true);
  } finally {
    hideAdminLoader();
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
    await window.loadProjectsForAdmin();
    window.renderProjectCheckboxesForAdmin([]);
    repopulateProjectsForCurrentUser();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminProjectMessage", error.message, true);
  }
}

/**
 * Toggle user active status
 */
async function toggleUserActiveStatus(userId, email, nextIsActive) {
  try {
    const actionText = nextIsActive ? "activate" : "deactivate";
    let confirmed = false;

    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: nextIsActive ? "Activate User?" : "Deactivate User?",
        html: `
          <b>${email}</b><br><br>
          ${nextIsActive
            ? "This will restore the user's active access."
            : "This will immediately disable the user's login access."}
        `,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: nextIsActive ? "Yes, activate" : "Yes, deactivate",
        cancelButtonText: "Cancel",
        confirmButtonColor: nextIsActive ? "#059669" : "#d97706"
      });

      confirmed = result.isConfirmed;
    } else {
      confirmed = confirm(`Are you sure you want to ${actionText} ${email}?`);
    }

    if (!confirmed) return;

    setAdminLoading("adminUserMessage", nextIsActive ? "Activating user..." : "Deactivating user...");

    await setUserActiveStateCallable({
      userId,
      isActive: nextIsActive
    });

    await logActivity(nextIsActive ? "admin_activate_user" : "admin_deactivate_user", {
      page: "admin",
      target: email
    });

    setAdminMessage(
      "adminUserMessage",
      nextIsActive
        ? `User activated successfully: ${email}`
        : `User deactivated successfully: ${email}`
    );

    await loadUsersForAdmin();
    await loadRecentAdminAuditLogs();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", `Status update failed: ${error.message}`, true);
  } finally {
    hideAdminLoader();
  }
}

async function softDeleteUserFromAdmin(userId, email) {
  try {
    let confirmed = false;

    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: "Soft Delete User?",
        html: `
          <b>${email}</b><br><br>
          This will hide the user from normal active use but keep the record for possible restore.
        `,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, soft delete",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#dc2626"
      });

      confirmed = result.isConfirmed;
    } else {
      confirmed = confirm(`Soft delete user ${email}?`);
    }

    if (!confirmed) return;

    setAdminLoading("adminUserMessage", "Soft deleting user...");

    await softDeleteUserCallable({ userId });

    await logActivity("admin_soft_delete_user", {
      page: "admin",
      target: email
    });

    setAdminMessage("adminUserMessage", `User soft deleted successfully: ${email}`);
    await clearUserForm();
    await loadUsersForAdmin();
    await loadRecentAdminAuditLogs();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", `Soft delete failed: ${error.message}`, true);
  } finally {
    hideAdminLoader();
  }
}

async function restoreDeletedUserFromAdmin(userId, email) {
  try {
    let confirmed = false;

    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: "Restore User?",
        html: `
          <b>${email}</b><br><br>
          This will restore the deleted user record and allow access again if active.
        `,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Yes, restore user",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#059669"
      });

      confirmed = result.isConfirmed;
    } else {
      confirmed = confirm(`Restore deleted user ${email}?`);
    }

    if (!confirmed) return;

    setAdminLoading("adminUserMessage", "Restoring user...");

    await restoreDeletedUserCallable({ userId });

    await logActivity("admin_restore_deleted_user", {
      page: "admin",
      target: email
    });

    setAdminMessage("adminUserMessage", `Deleted user restored successfully: ${email}`);
    await loadUsersForAdmin();
    await loadRecentAdminAuditLogs();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", `Restore failed: ${error.message}`, true);
  } finally {
    hideAdminLoader();
  }
}

async function deleteUserCompletelyFromAdmin(userId, email) {
  try {
    let confirmed = false;

    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: "Permanent Delete?",
        html: `
          <b>${email}</b><br><br>
          This action cannot be undone.<br>
          The Auth account and user record will be permanently removed.
        `,
        icon: "error",
        showCancelButton: true,
        confirmButtonText: "Yes, permanently delete",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#b91c1c"
      });

      confirmed = result.isConfirmed;
    } else {
      confirmed = confirm(
        `Permanently delete ${email}?\n\nThis cannot be undone.\nThe Auth account will also be removed.`
      );
    }

    if (!confirmed) return;

    setAdminLoading("adminUserMessage", "Permanently deleting user...");

    await hardDeleteUserCallable({ userId });

    await logActivity("admin_hard_delete_user", {
      page: "admin",
      target: email
    });

    setAdminMessage("adminUserMessage", `User permanently deleted: ${email}`);
    await clearUserForm();
    await loadUsersForAdmin();
    await loadRecentAdminAuditLogs();
  } catch (error) {
    console.error(error);
    setAdminMessage("adminUserMessage", `Permanent delete failed: ${error.message}`, true);
  } finally {
    hideAdminLoader();
  }
}

/**
 * Admin table helpers
 */
function getAdminUserFilterValue() {
  return document.getElementById("adminUserStatusFilter")?.value || "all";
}

function getUserStatusLabel(user) {
  if (user.isDeleted === true) return "Deleted";
  if (user.isActive === true) return "Active";
  return "Inactive";
}

const adminTableState = {
  users: {
    rows: [],
    currentPage: 1,
    pageSize: 5,
    sortKey: "fullName",
    sortDirection: "asc"
  },
  audit: {
    rows: [],
    currentPage: 1,
    pageSize: 5,
    sortKey: "createdAt",
    sortDirection: "desc"
  },
  projects: {
    rows: [],
    currentPage: 1,
    pageSize: 5,
    sortKey: "name",
    sortDirection: "asc"
  }
};

function getComparableValue(row, sortKey, tableName) {
  if (tableName === "users") {
    if (sortKey === "supervisor") return safeLower(row.supervisorName || row.supervisorEmail || "");
    if (sortKey === "status") return safeLower(getUserStatusLabel(row));
    if (sortKey === "assignedProjects") return safeLower(safeArray(row.assignedProjects).join(", "));
    return safeLower(row[sortKey] || "");
  }

  if (tableName === "audit") {
    if (sortKey === "createdAt") {
      const date = adminTimestampToDate(row.createdAt);
      return date ? date.getTime() : 0;
    }
    if (sortKey === "target") return safeLower(row.targetName || row.targetEmail || row.targetUserId || "");
    if (sortKey === "admin") return safeLower(row.actorName || row.actorEmail || "");
    return safeLower(row[sortKey] || "");
  }

  if (tableName === "projects") {
    if (sortKey === "enabled") return row.enabled === false ? 0 : 1;
    if (sortKey === "dashboard") return row.dashboardEmbedUrl ? 1 : 0;
    return safeLower(row[sortKey] || "");
  }

  return safeLower(row[sortKey] || "");
}

function sortRows(rows, tableName) {
  const state = adminTableState[tableName];
  const direction = state.sortDirection === "asc" ? 1 : -1;
  const sortKey = state.sortKey;

  return [...rows].sort((a, b) => {
    const left = getComparableValue(a, sortKey, tableName);
    const right = getComparableValue(b, sortKey, tableName);

    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return 0;
  });
}

function getPagedRows(rows, tableName) {
  const state = adminTableState[tableName];
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));

  if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }
  if (state.currentPage < 1) {
    state.currentPage = 1;
  }

  const start = (state.currentPage - 1) * state.pageSize;
  const end = start + state.pageSize;

  return {
    totalRows,
    totalPages,
    pagedRows: rows.slice(start, end)
  };
}

function updatePageInfo(tableName, totalRows, totalPages) {
  if (tableName === "users") {
    const info = document.getElementById("adminUsersPageInfo");
    const prevBtn = document.getElementById("adminUsersPrevPageBtn");
    const nextBtn = document.getElementById("adminUsersNextPageBtn");

    if (info) info.textContent = `Page ${adminTableState.users.currentPage} of ${totalPages} • ${totalRows} users`;
    if (prevBtn) prevBtn.disabled = adminTableState.users.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = adminTableState.users.currentPage >= totalPages;
  }

  if (tableName === "audit") {
    const info = document.getElementById("adminAuditPageInfo");
    const prevBtn = document.getElementById("adminAuditPrevPageBtn");
    const nextBtn = document.getElementById("adminAuditNextPageBtn");

    if (info) info.textContent = `Page ${adminTableState.audit.currentPage} of ${totalPages} • ${totalRows} records`;
    if (prevBtn) prevBtn.disabled = adminTableState.audit.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = adminTableState.audit.currentPage >= totalPages;
  }

  if (tableName === "projects") {
    const info = document.getElementById("adminProjectsPageInfo");
    const prevBtn = document.getElementById("adminProjectsPrevPageBtn");
    const nextBtn = document.getElementById("adminProjectsNextPageBtn");

    if (info) info.textContent = `Page ${adminTableState.projects.currentPage} of ${totalPages} • ${totalRows} projects`;
    if (prevBtn) prevBtn.disabled = adminTableState.projects.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = adminTableState.projects.currentPage >= totalPages;
  }
}

function setSort(tableName, sortKey) {
  const state = adminTableState[tableName];

  if (state.sortKey === sortKey) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = sortKey;
    state.sortDirection = tableName === "audit" && sortKey === "createdAt" ? "desc" : "asc";
  }

  state.currentPage = 1;
}

function updateSortableHeaders(tableName) {
  document.querySelectorAll(`.admin-sortable[data-table="${tableName}"]`).forEach((th) => {
    th.classList.remove("sort-active", "sort-asc", "sort-desc");

    const sortKey = th.dataset.sort;
    const state = adminTableState[tableName];

    if (!state || !sortKey) return;

    if (state.sortKey === sortKey) {
      th.classList.add("sort-active");
      th.classList.add(state.sortDirection === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function setupCollapsiblePanel(toggleBtnId, toggleTextId, contentId, collapsedText, expandedText) {
  const btn = document.getElementById(toggleBtnId);
  const textEl = document.getElementById(toggleTextId);
  const content = document.getElementById(contentId);

  if (!btn || !textEl || !content) return;

  function setExpanded(expanded) {
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    btn.classList.toggle("expanded", expanded);
    content.classList.toggle("expanded", expanded);
    content.classList.toggle("collapsed", !expanded);
    content.setAttribute("aria-hidden", expanded ? "false" : "true");
    textEl.textContent = expanded ? expandedText : collapsedText;
  }

  btn.addEventListener("click", () => {
    const expanded = btn.getAttribute("aria-expanded") === "true";
    setExpanded(!expanded);
  });

  setExpanded(false);
}

async function loadAdminUserMetricsFromSnapshot(snapshot) {
  let total = 0;
  let active = 0;
  let inactive = 0;
  let deleted = 0;

  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    total += 1;

    if (data.isDeleted === true) {
      deleted += 1;
    } else if (data.isActive === true) {
      active += 1;
    } else {
      inactive += 1;
    }
  });

  const totalEl = document.getElementById("adminUserTotalCount");
  const activeEl = document.getElementById("adminUserActiveCount");
  const inactiveEl = document.getElementById("adminUserInactiveCount");
  const deletedEl = document.getElementById("adminUserDeletedCount");

  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (inactiveEl) inactiveEl.textContent = inactive;
  if (deletedEl) deletedEl.textContent = deleted;
}

function filterUserRows(rows) {
  const statusFilter = getAdminUserFilterValue();
  const fullNameFilter = safeLower(document.getElementById("adminUserFullNameFilter")?.value || "");
  const emailFilter = safeLower(document.getElementById("adminUserEmailFilter")?.value || "");
  const supervisorFilter = safeLower(document.getElementById("adminUserSupervisorFilter")?.value || "");
  const projectFilter = safeLower(document.getElementById("adminUserProjectFilter")?.value || "");
  const searchText = safeLower(document.getElementById("adminUserSearchText")?.value || "");

  return rows.filter((data) => {
    const isDeleted = data.isDeleted === true;
    const isActive = data.isActive === true;

    const statusMatch =
      statusFilter === "all" ||
      (statusFilter === "active" && !isDeleted && isActive) ||
      (statusFilter === "inactive" && !isDeleted && !isActive) ||
      (statusFilter === "deleted" && isDeleted);

    if (!statusMatch) return false;

    const fullName = data.fullName || "";
    const email = data.email || "";
    const supervisor = data.supervisorName || data.supervisorEmail || "";
    const assignedProjectsText = safeArray(data.assignedProjects).join(", ");
    const statusLabel = getUserStatusLabel(data);

    const matchesFullName = !fullNameFilter || safeLower(fullName).includes(fullNameFilter);
    const matchesEmail = !emailFilter || safeLower(email).includes(emailFilter);
    const matchesSupervisor = !supervisorFilter || safeLower(supervisor).includes(supervisorFilter);
    const matchesProject = !projectFilter || safeLower(assignedProjectsText).includes(projectFilter);

    const searchBlob = [
      fullName,
      email,
      data.role || "",
      supervisor,
      statusLabel,
      assignedProjectsText
    ].join(" ").toLowerCase();

    const matchesSearch = !searchText || searchBlob.includes(searchText);

    return matchesFullName && matchesEmail && matchesSupervisor && matchesProject && matchesSearch;
  });
}

function bindUserTableActions() {
  document.querySelectorAll(".btn-edit-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadUserIntoForm(btn.dataset.id);

      const userFormBtn = document.getElementById("adminUserFormToggleBtn");
      if (userFormBtn && userFormBtn.getAttribute("aria-expanded") !== "true") {
        userFormBtn.click();
      }
    });
  });

  document.querySelectorAll(".btn-reset-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await sendPasswordResetForUser(btn.dataset.id);
    });
  });

  document.querySelectorAll(".btn-toggle-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await toggleUserActiveStatus(
        btn.dataset.id,
        btn.dataset.email || "",
        btn.dataset.active !== "true"
      );
    });
  });

  document.querySelectorAll(".btn-soft-delete-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await softDeleteUserFromAdmin(btn.dataset.id, btn.dataset.email || "");
    });
  });

  document.querySelectorAll(".btn-restore-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await restoreDeletedUserFromAdmin(btn.dataset.id, btn.dataset.email || "");
    });
  });

  document.querySelectorAll(".btn-hard-delete-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteUserCompletelyFromAdmin(btn.dataset.id, btn.dataset.email || "");
    });
  });
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  const filteredRows = filterUserRows(adminTableState.users.rows);
  const sortedRows = sortRows(filteredRows, "users");
  const { totalRows, totalPages, pagedRows } = getPagedRows(sortedRows, "users");

  if (!pagedRows.length) {
    tbody.innerHTML = `<tr><td colspan="7">No users found for the selected filters.</td></tr>`;
    updatePageInfo("users", totalRows, totalPages);
    updateSortableHeaders("users");
    return;
  }

  tbody.innerHTML = "";

  pagedRows.forEach((data) => {
    const isDeleted = data.isDeleted === true;
    const isActive = data.isActive === true;
    const statusLabel = getUserStatusLabel(data);

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${adminEscapeHtml(data.fullName || "")}</td>
      <td>${adminEscapeHtml(data.email || "")}</td>
      <td>${adminEscapeHtml(data.role || "")}</td>
      <td>${adminEscapeHtml(data.supervisorName || data.supervisorEmail || "-")}</td>
      <td>${adminEscapeHtml(statusLabel)}</td>
      <td>${adminEscapeHtml(safeArray(data.assignedProjects).join(", "))}</td>
      <td>
        <div class="button-row">
          <button class="btn btn-secondary btn-edit-user" data-id="${data.id}">Edit</button>
          <button class="btn btn-secondary btn-reset-user" data-id="${data.id}">Reset</button>

          ${
            isDeleted
              ? `<button class="btn btn-success btn-restore-user" data-id="${data.id}" data-email="${adminEscapeHtml(data.email || "")}">Restore</button>`
              : `<button
                  class="btn ${isActive ? "btn-warning" : "btn-success"} btn-toggle-user"
                  data-id="${data.id}"
                  data-email="${adminEscapeHtml(data.email || "")}"
                  data-active="${isActive ? "true" : "false"}"
                >
                  ${isActive ? "Deactivate" : "Activate"}
                </button>`
          }

          ${
            isDeleted
              ? `<button class="btn btn-danger btn-hard-delete-user" data-id="${data.id}" data-email="${adminEscapeHtml(data.email || "")}">Permanent Delete</button>`
              : `<button class="btn btn-danger btn-soft-delete-user" data-id="${data.id}" data-email="${adminEscapeHtml(data.email || "")}">Soft Delete</button>`
          }
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  bindUserTableActions();
  updatePageInfo("users", totalRows, totalPages);
  updateSortableHeaders("users");
}

/**
 * Load all user profiles for the admin table.
 */
window.loadUsersForAdmin = async function () {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7">Loading users...</td></tr>`;

  try {
    const snapshot = await db.collection("users").orderBy("fullName").get();
    await loadAdminUserMetricsFromSnapshot(snapshot);

    const rows = [];
    snapshot.forEach((doc) => {
      rows.push({ id: doc.id, ...doc.data() });
    });

    adminTableState.users.rows = rows;
    adminTableState.users.currentPage = 1;
    adminTableState.users.pageSize = Number(document.getElementById("adminUserPageSize")?.value || 5);

    renderUsersTable();
    await loadRecentAdminAuditLogs();
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="7">Failed to load users.</td></tr>`;
  }
};

function filterAuditRows(rows) {
  const actionFilter = safeLower(document.getElementById("adminAuditActionFilter")?.value || "");
  const targetFilter = safeLower(document.getElementById("adminAuditTargetFilter")?.value || "");
  const adminFilter = safeLower(document.getElementById("adminAuditAdminFilter")?.value || "");
  const noteFilter = safeLower(document.getElementById("adminAuditNoteFilter")?.value || "");
  const startDate = document.getElementById("adminAuditStartDate")?.value || "";
  const endDate = document.getElementById("adminAuditEndDate")?.value || "";
  const searchText = safeLower(document.getElementById("adminAuditSearchText")?.value || "");

  return rows.filter((row) => {
    const action = row.action || "";
    const target = row.targetName || row.targetEmail || row.targetUserId || "";
    const adminName = row.actorName || row.actorEmail || "";
    const note = row.note || "";
    const createdDateOnly = adminDateOnlyText(row.createdAt);
    const createdDateText = adminDateTimeText(row.createdAt);

    const matchesAction = !actionFilter || safeLower(action).includes(actionFilter);
    const matchesTarget = !targetFilter || safeLower(target).includes(targetFilter);
    const matchesAdmin = !adminFilter || safeLower(adminName).includes(adminFilter);
    const matchesNote = !noteFilter || safeLower(note).includes(noteFilter);
    const matchesStart = !startDate || (createdDateOnly && createdDateOnly >= startDate);
    const matchesEnd = !endDate || (createdDateOnly && createdDateOnly <= endDate);

    const searchBlob = [
      createdDateText,
      action,
      target,
      adminName,
      note
    ].join(" ").toLowerCase();

    const matchesSearch = !searchText || searchBlob.includes(searchText);

    return matchesAction && matchesTarget && matchesAdmin && matchesNote && matchesStart && matchesEnd && matchesSearch;
  });
}

function renderAuditTable() {
  const tbody = document.getElementById("adminAuditTableBody");
  if (!tbody) return;

  const filteredRows = filterAuditRows(adminTableState.audit.rows);
  const sortedRows = sortRows(filteredRows, "audit");
  const { totalRows, totalPages, pagedRows } = getPagedRows(sortedRows, "audit");

  if (!pagedRows.length) {
    tbody.innerHTML = `<tr><td colspan="5">No admin audit logs found for the selected filters.</td></tr>`;
    updatePageInfo("audit", totalRows, totalPages);
    updateSortableHeaders("audit");
    return;
  }

  tbody.innerHTML = "";

  pagedRows.forEach((data) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${adminEscapeHtml(adminDateTimeText(data.createdAt))}</td>
      <td>${adminEscapeHtml(data.action || "")}</td>
      <td>${adminEscapeHtml(data.targetName || data.targetEmail || data.targetUserId || "")}</td>
      <td>${adminEscapeHtml(data.actorName || data.actorEmail || "")}</td>
      <td>${adminEscapeHtml(data.note || "")}</td>
    `;

    tbody.appendChild(tr);
  });

  updatePageInfo("audit", totalRows, totalPages);
  updateSortableHeaders("audit");
}

async function loadRecentAdminAuditLogs() {
  const tbody = document.getElementById("adminAuditTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5">Loading audit trail...</td></tr>`;

  try {
    const snapshot = await db
      .collection("admin_audit_logs")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    const rows = [];
    snapshot.forEach((doc) => {
      rows.push({ id: doc.id, ...doc.data() });
    });

    adminTableState.audit.rows = rows;
    adminTableState.audit.currentPage = 1;
    adminTableState.audit.pageSize = Number(document.getElementById("adminAuditPageSize")?.value || 5);

    renderAuditTable();
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="5">Failed to load audit trail.</td></tr>`;
  }
}

function filterProjectRows(rows) {
  const codeFilter = safeLower(document.getElementById("adminProjectCodeFilter")?.value || "");
  const nameFilter = safeLower(document.getElementById("adminProjectNameFilter")?.value || "");
  const searchText = safeLower(document.getElementById("adminProjectSearchText")?.value || "");

  return rows.filter((row) => {
    const code = row.code || "";
    const name = row.name || "";
    const enabled = row.enabled === false ? "No" : "Yes";
    const dashboard = row.dashboardEmbedUrl ? "Configured" : "Not set";

    const matchesCode = !codeFilter || safeLower(code).includes(codeFilter);
    const matchesName = !nameFilter || safeLower(name).includes(nameFilter);

    const searchBlob = [code, name, enabled, dashboard].join(" ").toLowerCase();
    const matchesSearch = !searchText || searchBlob.includes(searchText);

    return matchesCode && matchesName && matchesSearch;
  });
}

function bindProjectTableActions() {
  document.querySelectorAll(".btn-edit-project").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadProjectIntoForm(btn.dataset.id);

      const projectFormBtn = document.getElementById("adminProjectFormToggleBtn");
      if (projectFormBtn && projectFormBtn.getAttribute("aria-expanded") !== "true") {
        projectFormBtn.click();
      }
    });
  });

  document.querySelectorAll(".btn-toggle-project").forEach(btn => {
  btn.addEventListener("click", async () => {
    await toggleProjectStatus(
      btn.dataset.id,
      btn.dataset.active !== "true"
    );
  });
});

  document.querySelectorAll(".btn-soft-delete-project").forEach(btn => {
    btn.addEventListener("click", async () => {
      await softDeleteProject(btn.dataset.id);
    });
  });

  document.querySelectorAll(".btn-hard-delete-project").forEach(btn => {
    btn.addEventListener("click", async () => {
      await permanentlyDeleteProject(btn.dataset.id);
    });
  });

  document.querySelectorAll(".btn-restore-project").forEach(btn => {
    btn.addEventListener("click", async () => {
      await restoreProject(btn.dataset.id);
    });
  });
}

function renderProjectsTable() {
  const tbody = document.getElementById("projectsTableBody");
  if (!tbody) return;

  const filteredRows = filterProjectRows(adminTableState.projects.rows);
  const sortedRows = sortRows(filteredRows, "projects");
  const { totalRows, totalPages, pagedRows } = getPagedRows(sortedRows, "projects");

  if (!pagedRows.length) {
    tbody.innerHTML = `<tr><td colspan="5">No projects found for the selected filters.</td></tr>`;
    updatePageInfo("projects", totalRows, totalPages);
    updateSortableHeaders("projects");
    return;
  }

  tbody.innerHTML = "";

  pagedRows.forEach((data) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${adminEscapeHtml(data.code || "")}</td>
      <td>${adminEscapeHtml(data.name || "")}</td>
      <td>
        ${
          data.isDeleted
            ? "Deleted"
            : data.isActive === false
            ? "Inactive"
            : "Active"
        }
      </td>
      <td>${data.dashboardEmbedUrl ? "Configured" : "Not set"}</td>
      
      <td>
        <div class="button-row">
          <button class="btn btn-secondary btn-edit-project" data-id="${data.id || data.code}">Edit</button>

          ${
            data.isDeleted
              ? `<button class="btn btn-success btn-restore-project" data-id="${data.id}">Restore</button>`
              : `<button class="btn ${data.isActive ? "btn-warning" : "btn-success"} btn-toggle-project"
                    data-id="${data.id}"
                    data-active="${data.isActive ? "true" : "false"}">
                    ${data.isActive ? "Deactivate" : "Activate"}
                </button>`
          }

          ${
            data.isDeleted
              ? `<button class="btn btn-danger btn-hard-delete-project" data-id="${data.id}">Permanent Delete</button>`
              : `<button class="btn btn-danger btn-soft-delete-project" data-id="${data.id}">Soft Delete</button>`
          }
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  bindProjectTableActions();
  updatePageInfo("projects", totalRows, totalPages);
  updateSortableHeaders("projects");
}

/**
 * Load Firestore projects into the project table.
 */
window.loadProjectsForAdmin = async function () {
  const tbody = document.getElementById("projectsTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5">Loading projects...</td></tr>`;

  try {
    const snapshot = await db.collection("projects").orderBy("name").get();

    if (snapshot.empty) {
      adminTableState.projects.rows = [];
      tbody.innerHTML = `<tr><td colspan="5">No Firestore projects found yet. You can seed them using the button above.</td></tr>`;
      updatePageInfo("projects", 0, 1);
      updateSortableHeaders("projects");
      return;
    }

    const rows = [];
    snapshot.forEach((doc) => {
      rows.push({ id: doc.id, ...doc.data() });
    });

    adminTableState.projects.rows = rows;
    adminTableState.projects.currentPage = 1;
    adminTableState.projects.pageSize = Number(document.getElementById("adminProjectPageSize")?.value || 5);

    renderProjectsTable();
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="5">Failed to load projects.</td></tr>`;
  }
};

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

  if (typeof Swal !== "undefined") {
    await Swal.fire({
      icon: "info",
      title: "Project Loaded for Editing",
      html: `
        <div style="text-align:left">
          <div><b>Code:</b> ${data.code || projectCode}</div>
          <div><b>Name:</b> ${data.name || "-"}</div>
          <div><b>Status:</b> ${data.enabled === false ? "Disabled" : "Enabled"}</div>
          <div><b>Dashboard URL:</b> ${data.dashboardEmbedUrl ? "Configured" : "Not set"}</div>
          <div><b>Reports:</b> ${(data.reports || []).length}</div>
          <div><b>Queries:</b> ${(data.queries || []).length}</div>
        </div>
      `,
      confirmButtonText: "Continue to Edit"
    });
  }

  const formCard = document.getElementById("adminProjectFormCard");
  if (formCard && formCard.scrollIntoView) {
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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

  document.getElementById("refreshUsersBtn").addEventListener("click", async () => {
    await window.loadUsersForAdmin();
    showAdminToast("Users refreshed", "success", 1500);
  });

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

  document.getElementById("adminUserRole").addEventListener("change", window.updateSupervisorFieldVisibility);

  document.getElementById("saveProjectBtn").addEventListener("click", saveProjectFromAdminForm);
  document.getElementById("clearProjectFormBtn").addEventListener("click", clearProjectForm);
  document.getElementById("seedProjectsBtn").addEventListener("click", seedFallbackProjectsToFirestore);
  document.getElementById("refreshProjectsBtn").addEventListener("click", async () => {
    await loadProjectsRegistry();
    await loadProjectsForAdmin();
    showAdminToast("Projects refreshed", "success", 1500);
  });

  window.updateSupervisorFieldVisibility();
}

function setupAdminLifecycleExtras() {
  const userStatusFilter = document.getElementById("adminUserStatusFilter");
  const userFullNameFilter = document.getElementById("adminUserFullNameFilter");
  const userEmailFilter = document.getElementById("adminUserEmailFilter");
  const userSupervisorFilter = document.getElementById("adminUserSupervisorFilter");
  const userProjectFilter = document.getElementById("adminUserProjectFilter");
  const userSearch = document.getElementById("adminUserSearchText");
  const userPageSize = document.getElementById("adminUserPageSize");
  const userPrev = document.getElementById("adminUsersPrevPageBtn");
  const userNext = document.getElementById("adminUsersNextPageBtn");
  const clearUserFiltersBtn = document.getElementById("clearAdminUserFiltersBtn");

  const auditRefresh = document.getElementById("refreshAdminAuditBtn");
  const auditActionFilter = document.getElementById("adminAuditActionFilter");
  const auditTargetFilter = document.getElementById("adminAuditTargetFilter");
  const auditAdminFilter = document.getElementById("adminAuditAdminFilter");
  const auditNoteFilter = document.getElementById("adminAuditNoteFilter");
  const auditStartDate = document.getElementById("adminAuditStartDate");
  const auditEndDate = document.getElementById("adminAuditEndDate");
  const auditSearch = document.getElementById("adminAuditSearchText");
  const auditPageSize = document.getElementById("adminAuditPageSize");
  const auditPrev = document.getElementById("adminAuditPrevPageBtn");
  const auditNext = document.getElementById("adminAuditNextPageBtn");
  const clearAuditFiltersBtn = document.getElementById("clearAdminAuditFiltersBtn");

  const projectCodeFilter = document.getElementById("adminProjectCodeFilter");
  const projectNameFilter = document.getElementById("adminProjectNameFilter");
  const projectSearch = document.getElementById("adminProjectSearchText");
  const projectPageSize = document.getElementById("adminProjectPageSize");
  const projectPrev = document.getElementById("adminProjectsPrevPageBtn");
  const projectNext = document.getElementById("adminProjectsNextPageBtn");
  const clearProjectFiltersBtn = document.getElementById("clearAdminProjectFiltersBtn");

  [
    userStatusFilter,
    userFullNameFilter,
    userEmailFilter,
    userSupervisorFilter,
    userProjectFilter
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      adminTableState.users.currentPage = 1;
      renderUsersTable();
    });
    el.addEventListener("change", () => {
      adminTableState.users.currentPage = 1;
      renderUsersTable();
    });
  });

  if (userSearch) {
    userSearch.addEventListener("input", () => {
      adminTableState.users.currentPage = 1;
      renderUsersTable();
    });
  }

  if (userPageSize) {
    userPageSize.addEventListener("change", () => {
      adminTableState.users.pageSize = Number(userPageSize.value || 5);
      adminTableState.users.currentPage = 1;
      renderUsersTable();
    });
  }

  if (userPrev) {
    userPrev.addEventListener("click", () => {
      adminTableState.users.currentPage -= 1;
      renderUsersTable();
    });
  }

  if (userNext) {
    userNext.addEventListener("click", () => {
      adminTableState.users.currentPage += 1;
      renderUsersTable();
    });
  }

  if (clearUserFiltersBtn) {
    clearUserFiltersBtn.addEventListener("click", () => {
      if (userStatusFilter) userStatusFilter.value = "all";
      if (userFullNameFilter) userFullNameFilter.value = "";
      if (userEmailFilter) userEmailFilter.value = "";
      if (userSupervisorFilter) userSupervisorFilter.value = "";
      if (userProjectFilter) userProjectFilter.value = "";
      if (userSearch) userSearch.value = "";
      if (userPageSize) userPageSize.value = "5";

      adminTableState.users.pageSize = 5;
      adminTableState.users.currentPage = 1;
      renderUsersTable();
      showAdminToast("User filters cleared", "success", 1400);
    });
  }

  if (auditRefresh) {
    auditRefresh.addEventListener("click", async () => {
      await loadRecentAdminAuditLogs();
      showAdminToast("Audit trail refreshed", "success", 1500);
    });
  }

  [
    auditActionFilter,
    auditTargetFilter,
    auditAdminFilter,
    auditNoteFilter,
    auditStartDate,
    auditEndDate
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      adminTableState.audit.currentPage = 1;
      renderAuditTable();
    });
    el.addEventListener("change", () => {
      adminTableState.audit.currentPage = 1;
      renderAuditTable();
    });
  });

  if (auditSearch) {
    auditSearch.addEventListener("input", () => {
      adminTableState.audit.currentPage = 1;
      renderAuditTable();
    });
  }

  if (auditPageSize) {
    auditPageSize.addEventListener("change", () => {
      adminTableState.audit.pageSize = Number(auditPageSize.value || 5);
      adminTableState.audit.currentPage = 1;
      renderAuditTable();
    });
  }

  if (auditPrev) {
    auditPrev.addEventListener("click", () => {
      adminTableState.audit.currentPage -= 1;
      renderAuditTable();
    });
  }

  if (auditNext) {
    auditNext.addEventListener("click", () => {
      adminTableState.audit.currentPage += 1;
      renderAuditTable();
    });
  }

  if (clearAuditFiltersBtn) {
    clearAuditFiltersBtn.addEventListener("click", () => {
      if (auditActionFilter) auditActionFilter.value = "";
      if (auditTargetFilter) auditTargetFilter.value = "";
      if (auditAdminFilter) auditAdminFilter.value = "";
      if (auditNoteFilter) auditNoteFilter.value = "";
      if (auditStartDate) auditStartDate.value = "";
      if (auditEndDate) auditEndDate.value = "";
      if (auditSearch) auditSearch.value = "";
      if (auditPageSize) auditPageSize.value = "5";

      adminTableState.audit.pageSize = 5;
      adminTableState.audit.currentPage = 1;
      renderAuditTable();
      showAdminToast("Audit filters cleared", "success", 1400);
    });
  }

  [
    projectCodeFilter,
    projectNameFilter
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      adminTableState.projects.currentPage = 1;
      renderProjectsTable();
    });
    el.addEventListener("change", () => {
      adminTableState.projects.currentPage = 1;
      renderProjectsTable();
    });
  });

  if (projectSearch) {
    projectSearch.addEventListener("input", () => {
      adminTableState.projects.currentPage = 1;
      renderProjectsTable();
    });
  }

  if (projectPageSize) {
    projectPageSize.addEventListener("change", () => {
      adminTableState.projects.pageSize = Number(projectPageSize.value || 5);
      adminTableState.projects.currentPage = 1;
      renderProjectsTable();
    });
  }

  if (projectPrev) {
    projectPrev.addEventListener("click", () => {
      adminTableState.projects.currentPage -= 1;
      renderProjectsTable();
    });
  }

  if (projectNext) {
    projectNext.addEventListener("click", () => {
      adminTableState.projects.currentPage += 1;
      renderProjectsTable();
    });
  }

  if (clearProjectFiltersBtn) {
    clearProjectFiltersBtn.addEventListener("click", () => {
      if (projectCodeFilter) projectCodeFilter.value = "";
      if (projectNameFilter) projectNameFilter.value = "";
      if (projectSearch) projectSearch.value = "";
      if (projectPageSize) projectPageSize.value = "5";

      adminTableState.projects.pageSize = 5;
      adminTableState.projects.currentPage = 1;
      renderProjectsTable();
      showAdminToast("Project filters cleared", "success", 1400);
    });
  }

  document.querySelectorAll(".admin-sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const tableName = th.dataset.table;
      const sortKey = th.dataset.sort;

      if (!tableName || !sortKey || !adminTableState[tableName]) return;

      setSort(tableName, sortKey);

      if (tableName === "users") renderUsersTable();
      if (tableName === "audit") renderAuditTable();
      if (tableName === "projects") renderProjectsTable();
    });
  });

  setupCollapsiblePanel(
    "adminUserFormToggleBtn",
    "adminUserFormToggleText",
    "adminUserFormContent",
    "Open Form",
    "Hide Form"
  );

  setupCollapsiblePanel(
    "adminAuditToggleBtn",
    "adminAuditToggleText",
    "adminAuditContent",
    "Show Audit Trail",
    "Hide Audit Trail"
  );

  setupCollapsiblePanel(
    "adminProjectFormToggleBtn",
    "adminProjectFormToggleText",
    "adminProjectFormContent",
    "Open Project Form",
    "Hide Project Form"
  );
}

// 🔁 Activate / Deactivate Project
async function toggleProjectStatus(projectId, nextIsActive) {
  try {
    await db.collection("projects").doc(projectId).update({
      isActive: nextIsActive,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await logActivity("admin_toggle_project_status", {
      page: "admin",
      target: projectId
    });

    showAdminToast(`Project ${nextIsActive ? "activated" : "deactivated"}`, "success");

    await loadProjectsRegistry();
    await loadProjectsForAdmin();
    repopulateProjectsForCurrentUser();

  } catch (error) {
    console.error(error);
    showAdminToast("Failed to update project status", "error");
  }
}


// 🗑 SOFT DELETE PROJECT (ENTERPRISE)
async function softDeleteProject(projectId) {
  if (!confirm("Soft delete this project?")) return;

  try {
    // 1. mark project deleted
    await db.collection("projects").doc(projectId).update({
      isDeleted: true,
      isActive: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. REMOVE PROJECT FROM ALL USERS ❗
    const usersSnap = await db.collection("users").get();

    const batch = db.batch();

    usersSnap.forEach(doc => {
      const data = doc.data();
      const projects = safeArray(data.assignedProjects);

      if (projects.includes(projectId)) {
        const updated = projects.filter(p => p !== projectId);
        batch.update(doc.ref, { assignedProjects: updated });
      }
    });

    await batch.commit();

    await logActivity("admin_soft_delete_project", {
      page: "admin",
      target: projectId
    });

    showAdminToast("Project soft deleted and removed from users", "success");

    await loadProjectsRegistry();
    await loadProjectsForAdmin();
    repopulateProjectsForCurrentUser();

  } catch (error) {
    console.error(error);
    showAdminToast("Soft delete failed", "error");
  }
}


// ❌ PERMANENT DELETE PROJECT
async function permanentlyDeleteProject(projectId) {
  if (!confirm("Permanently delete this project? This cannot be undone.")) return;

  try {
    await db.collection("projects").doc(projectId).delete();

    await logActivity("admin_hard_delete_project", {
      page: "admin",
      target: projectId
    });

    showAdminToast("Project permanently deleted", "success");

    await loadProjectsRegistry();
    await loadProjectsForAdmin();
    repopulateProjectsForCurrentUser();

  } catch (error) {
    console.error(error);
    showAdminToast("Permanent delete failed", "error");
  }
}


// 🔄 RESTORE PROJECT
async function restoreProject(projectId) {
  try {
    await db.collection("projects").doc(projectId).update({
      isDeleted: false,
      isActive: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await logActivity("admin_restore_project", {
      page: "admin",
      target: projectId
    });

    showAdminToast("Project restored", "success");

    await loadProjectsRegistry();
    await loadProjectsForAdmin();

  } catch (error) {
    console.error(error);
    showAdminToast("Restore failed", "error");
  }
}

const originalSetupAdminUI = setupAdminUI;
let adminUiAlreadyInitialized = false;

setupAdminUI = function () {
  if (adminUiAlreadyInitialized) return;
  originalSetupAdminUI();
  setupAdminLifecycleExtras();
  adminUiAlreadyInitialized = true;
};