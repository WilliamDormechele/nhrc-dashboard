// js/role-access.js
(function () {
  "use strict";

  const PROTECTED_ROLES = new Set(["administrator", "developer"]);
  const FEATURE_KEYS = ["dashboard", "reports", "queries", "monitoring", "admin"];
  let matrixCache = null;
  let profileAccessUnsubscribe = null;
  let matrixLoaded = false;

  function roles() {
    return Array.isArray(window.ROLE_ACCESS_ROLES) ? window.ROLE_ACCESS_ROLES : [];
  }

  function features() {
    return Array.isArray(window.ROLE_ACCESS_FEATURES)
      ? window.ROLE_ACCESS_FEATURES
      : [
          { key: "dashboard", label: "Dashboard" },
          { key: "reports", label: "Reports" },
          { key: "queries", label: "Data Queries" },
          { key: "monitoring", label: "Strategic Oversight" },
          { key: "admin", label: "Admin" }
        ];
  }

  function defaultMatrix() {
    return typeof window.getDefaultRoleAccessMatrix === "function"
      ? window.getDefaultRoleAccessMatrix()
      : {};
  }

  function normalizeRow(row) {
    row = row || {};
    return {
      dashboard: row.dashboard === true,
      reports: row.reports === true,
      queries: row.queries === true,
      monitoring: row.monitoring === true,
      admin: row.admin === true
    };
  }

  function sanitizeMatrix(matrix) {
    const defaults = defaultMatrix();
    const output = {};
    matrix = matrix || {};

    roles().forEach(function (definition) {
      const key = definition.key;
      if (PROTECTED_ROLES.has(key)) {
        output[key] = {
          dashboard: true,
          reports: true,
          queries: true,
          monitoring: true,
          admin: true
        };
        return;
      }

      output[key] = matrix[key] && typeof matrix[key] === "object"
        ? normalizeRow(matrix[key])
        : normalizeRow(defaults[key] || {});
    });

    return output;
  }

  function matrixForRole(role, matrix) {
    const key = String(role || "").trim().toLowerCase();
    if (PROTECTED_ROLES.has(key)) {
      return {
        dashboard: true,
        reports: true,
        queries: true,
        monitoring: true,
        admin: true
      };
    }

    const source = sanitizeMatrix(matrix || matrixCache || defaultMatrix());
    return normalizeRow(source[key] || source.field_worker || {});
  }

  const baseGetPermissions =
    typeof window.getPermissions === "function" ? window.getPermissions : null;

  window.getPermissions = function (role) {
    const key = String(role || "").trim().toLowerCase();
    const base = baseGetPermissions ? Object.assign({}, baseGetPermissions(key)) : {};
    const profile = window.currentUserProfile;
    let access = null;

    if (
      profile &&
      String(profile.role || "").trim().toLowerCase() === key &&
      profile.roleAccess &&
      typeof profile.roleAccess === "object"
    ) {
      access = normalizeRow(profile.roleAccess);
    } else if (matrixCache) {
      access = matrixForRole(key, matrixCache);
    }

    if (PROTECTED_ROLES.has(key)) {
      access = {
        dashboard: true,
        reports: true,
        queries: true,
        monitoring: true,
        admin: true
      };
    }

    if (access) {
      base.canViewDashboard = access.dashboard;
      base.canViewReports = access.reports;
      base.canDownloadReports = access.reports;
      base.canViewQueries = access.queries;
      base.canMonitorUsers = access.monitoring;
      base.canManageUsers = access.admin;
      base.canManageProjects = access.admin;
    }

    base.canViewChat = false;
    return base;
  };

  const baseApplyRoleVisibility =
    typeof window.applyRoleVisibility === "function"
      ? window.applyRoleVisibility
      : null;

  function ensureNoAccessNotice() {
    let notice = document.getElementById("workspaceAccessNotice");
    if (notice) return notice;

    const body = document.querySelector(".workspace-body");
    const toolbar = document.querySelector(".workspace-toolbar");
    if (!body) return null;

    notice = document.createElement("section");
    notice.id = "workspaceAccessNotice";
    notice.className = "panel workspace-access-notice hidden";
    notice.innerHTML =
      '<div class="workspace-access-icon"><i class="fas fa-shield-halved"></i></div>' +
      '<div><h2>No workspace area is assigned</h2>' +
      '<p>Your account is active, but your role does not currently have access to a dashboard area. Contact an administrator if you need access.</p></div>';

    if (toolbar && toolbar.nextSibling) {
      body.insertBefore(notice, toolbar.nextSibling);
    } else {
      body.prepend(notice);
    }

    return notice;
  }

  function enforceAccessibleArea(role) {
    const permissions = window.getPermissions(role);
    const dashboardButton = document.querySelector('.tab-button[data-tab="tab-dashboard"]');

    if (dashboardButton) {
      dashboardButton.classList.toggle("hidden", !permissions.canViewDashboard);
    }

    const areas = [
      { tab: "tab-dashboard", allowed: permissions.canViewDashboard },
      { tab: "tab-reports", allowed: permissions.canViewReports },
      { tab: "tab-queries", allowed: permissions.canViewQueries },
      { tab: "tab-monitoring", allowed: permissions.canMonitorUsers },
      { tab: "tab-admin", allowed: permissions.canManageUsers || permissions.canManageProjects }
    ];

    const allowedAreas = areas.filter(function (item) { return item.allowed; });
    const notice = ensureNoAccessNotice();

    if (!allowedAreas.length) {
      document.querySelectorAll(".tab-content").forEach(function (tab) {
        tab.classList.remove("active");
      });
      if (notice) notice.classList.remove("hidden");
      return;
    }

    if (notice) notice.classList.add("hidden");

    const active = document.querySelector(".tab-content.active");
    const activeAllowed = active && allowedAreas.some(function (item) {
      return item.tab === active.id;
    });

    if (activeAllowed) return;

    const first = allowedAreas[0];
    const button = document.querySelector('.tab-button[data-tab="' + first.tab + '"]');
    if (button && typeof button.click === "function") {
      setTimeout(function () { button.click(); }, 0);
    }
  }

  window.applyRoleVisibility = function (role) {
    if (baseApplyRoleVisibility) baseApplyRoleVisibility(role);
    enforceAccessibleArea(role);
  };

  async function loadMatrix(force) {
    if (matrixCache && !force) return sanitizeMatrix(matrixCache);

    try {
      const snapshot = await db
        .collection("system_meta")
        .doc("role_access_matrix")
        .get();

      matrixCache = snapshot.exists
        ? sanitizeMatrix((snapshot.data() || {}).permissions || {})
        : sanitizeMatrix(defaultMatrix());
    } catch (error) {
      console.warn("Unable to load saved role access matrix.", error);
      matrixCache = sanitizeMatrix(defaultMatrix());
    }

    matrixLoaded = true;
    return sanitizeMatrix(matrixCache);
  }

  function setStatus(message, tone) {
    const el = document.getElementById("roleAccessStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "role-access-status role-access-status-" + (tone || "neutral");
  }

  function renderMatrix(matrix) {
    const tbody = document.getElementById("roleAccessMatrixBody");
    if (!tbody) return;

    const safe = sanitizeMatrix(matrix);
    tbody.innerHTML = "";

    roles().forEach(function (definition) {
      const key = definition.key;
      const protectedRole = definition.protected === true || PROTECTED_ROLES.has(key);
      const row = document.createElement("tr");

      const roleCell = document.createElement("td");
      roleCell.className = "role-access-role-cell";

      const strong = document.createElement("strong");
      strong.textContent = definition.label || key;
      const detail = document.createElement("span");
      detail.textContent = protectedRole ? "Protected full access" : "Role-wide access";

      roleCell.appendChild(strong);
      roleCell.appendChild(detail);
      row.appendChild(roleCell);

      features().forEach(function (feature) {
        const cell = document.createElement("td");
        cell.className = "role-access-check-cell";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "role-access-checkbox";
        input.dataset.role = key;
        input.dataset.feature = feature.key;
        input.setAttribute(
          "aria-label",
          (definition.label || key) + ": " + (feature.label || feature.key)
        );
        input.checked = protectedRole ? true : safe[key][feature.key] === true;
        input.disabled = protectedRole;

        cell.appendChild(input);
        row.appendChild(cell);
      });

      tbody.appendChild(row);
    });
  }

  function readMatrixFromUi() {
    const matrix = sanitizeMatrix(matrixCache || defaultMatrix());

    roles().forEach(function (definition) {
      const key = definition.key;
      if (PROTECTED_ROLES.has(key)) return;

      const access = {};
      FEATURE_KEYS.forEach(function (feature) {
        const input = document.querySelector(
          '.role-access-checkbox[data-role="' + key + '"][data-feature="' + feature + '"]'
        );
        access[feature] = !!(input && input.checked);
      });
      matrix[key] = normalizeRow(access);
    });

    return sanitizeMatrix(matrix);
  }

  async function applyMatrixToUsers(matrix) {
    const snapshot = await db.collection("users").get();
    const docs = snapshot.docs || [];
    const chunkSize = 400;
    const actor =
      (window.currentUserProfile && window.currentUserProfile.email) ||
      (auth.currentUser && auth.currentUser.email) ||
      "";

    for (let start = 0; start < docs.length; start += chunkSize) {
      const batch = db.batch();
      docs.slice(start, start + chunkSize).forEach(function (doc) {
        const data = doc.data() || {};
        const access = matrixForRole(data.role || "", matrix);

        batch.update(doc.ref, {
          roleAccess: access,
          roleAccessUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          roleAccessUpdatedBy: actor
        });
      });
      await batch.commit();
    }

    return docs.length;
  }

  function canGovernAccess() {
    const role = String(
      (window.currentUserProfile && window.currentUserProfile.role) || ""
    ).toLowerCase();
    return PROTECTED_ROLES.has(role);
  }

  async function saveMatrix() {
    const button = document.getElementById("saveRoleAccessBtn");
    if (!button || !canGovernAccess()) return;

    const matrix = readMatrixFromUi();

    try {
      if (window.NHRCUI) window.NHRCUI.setButtonBusy(button, true, "Saving access");
      setStatus("Saving role access and applying it to users...", "working");

      await db
        .collection("system_meta")
        .doc("role_access_matrix")
        .set(
          {
            permissions: matrix,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy:
              (window.currentUserProfile && window.currentUserProfile.email) ||
              (auth.currentUser && auth.currentUser.email) ||
              ""
          },
          { merge: true }
        );

      const count = await applyMatrixToUsers(matrix);
      matrixCache = sanitizeMatrix(matrix);

      if (window.currentUserProfile) {
        window.currentUserProfile.roleAccess = matrixForRole(
          window.currentUserProfile.role,
          matrixCache
        );
      }

      window.applyRoleVisibility(
        (window.currentUserProfile && window.currentUserProfile.role) || ""
      );

      try {
        await logActivity("admin_update_role_access_matrix", {
          page: "admin",
          target: String(count) + "_users_updated"
        });
      } catch (auditError) {
        console.warn("Role access activity log failed.", auditError);
      }

      setStatus(
        "Saved successfully. Applied to " + count + " user account" + (count === 1 ? "." : "s."),
        "success"
      );

      if (window.NHRCUI) {
        window.NHRCUI.showToast(
          "success",
          "Role access updated",
          "Access settings were applied to " + count + " user account" + (count === 1 ? "." : "s."),
          { timer: 3600 }
        );
      }
    } catch (error) {
      console.error("Failed to save role access matrix:", error);
      setStatus(error.message || "Role access settings could not be saved.", "error");
      if (window.NHRCUI) {
        window.NHRCUI.showToast(
          "error",
          "Role access not saved",
          error.message || "Please try again."
        );
      }
    } finally {
      if (window.NHRCUI) window.NHRCUI.setButtonBusy(button, false);
    }
  }

  async function reloadMatrix() {
    const button = document.getElementById("reloadRoleAccessBtn");
    try {
      if (window.NHRCUI) window.NHRCUI.setButtonBusy(button, true, "Reloading");
      const matrix = await loadMatrix(true);
      renderMatrix(matrix);
      setStatus("Saved role access settings reloaded.", "success");
    } catch (error) {
      setStatus("Role access settings could not be reloaded.", "error");
    } finally {
      if (window.NHRCUI) window.NHRCUI.setButtonBusy(button, false);
    }
  }

  function restoreDefaultsInUi() {
    renderMatrix(defaultMatrix());
    setStatus(
      "Default settings loaded in the form. Click Save Access to apply them.",
      "neutral"
    );
  }

  async function refreshGovernancePanel() {
    const panel = document.getElementById("roleAccessPanel");
    if (!panel) return;

    const allowed = canGovernAccess();
    panel.classList.toggle("hidden", !allowed);
    if (!allowed) return;

    if (!matrixLoaded) {
      setStatus("Loading saved role access settings...", "working");
      const matrix = await loadMatrix(true);
      renderMatrix(matrix);
      setStatus("Saved role access settings loaded.", "success");
    }
  }

  function createAdminPanel() {
    const adminTab = document.getElementById("tab-admin");
    if (!adminTab || document.getElementById("roleAccessPanel")) return;

    const panel = document.createElement("div");
    panel.id = "roleAccessPanel";
    panel.className = "panel inner-panel role-access-panel hidden";
    panel.innerHTML =
      '<div class="role-access-heading">' +
        '<div><span class="role-access-eyebrow">Access governance</span>' +
        '<h3>Role Access Matrix</h3>' +
        '<p>Control which areas each role can see and use. Changes apply to all users assigned to that role.</p></div>' +
        '<div class="role-access-actions">' +
          '<button type="button" id="reloadRoleAccessBtn" class="btn btn-secondary"><i class="fas fa-rotate"></i><span>Reload</span></button>' +
          '<button type="button" id="restoreRoleAccessDefaultsBtn" class="btn btn-secondary"><i class="fas fa-arrow-rotate-left"></i><span>Restore Defaults</span></button>' +
          '<button type="button" id="saveRoleAccessBtn" class="btn btn-primary"><i class="fas fa-shield-halved"></i><span>Save Access</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="role-access-note"><i class="fas fa-lock"></i><span>Administrator and Developer are protected with full access to prevent accidental administrative lockout.</span></div>' +
      '<div class="table-wrap role-access-table-wrap">' +
        '<table class="data-table role-access-table"><thead><tr>' +
          '<th>Role</th><th>Dashboard</th><th>Reports</th><th>Data Queries</th><th>Strategic Oversight</th><th>Admin</th>' +
        '</tr></thead><tbody id="roleAccessMatrixBody"><tr><td colspan="6">Loading role access settings...</td></tr></tbody></table>' +
      '</div>' +
      '<div id="roleAccessStatus" class="role-access-status role-access-status-neutral">Loading saved settings...</div>';

    const header = adminTab.querySelector(".section-header");
    if (header && header.nextSibling) {
      adminTab.insertBefore(panel, header.nextSibling);
    } else {
      adminTab.appendChild(panel);
    }

    document.getElementById("saveRoleAccessBtn").addEventListener("click", saveMatrix);
    document.getElementById("reloadRoleAccessBtn").addEventListener("click", reloadMatrix);
    document.getElementById("restoreRoleAccessDefaultsBtn").addEventListener("click", restoreDefaultsInUi);

    setTimeout(refreshGovernancePanel, 250);
  }

  function startProfileAccessWatcher(user) {
    if (profileAccessUnsubscribe) {
      profileAccessUnsubscribe();
      profileAccessUnsubscribe = null;
    }

    if (!user || !user.uid) {
      refreshGovernancePanel();
      return;
    }

    profileAccessUnsubscribe = db
      .collection("users")
      .doc(user.uid)
      .onSnapshot(function (snapshot) {
        if (!snapshot.exists) return;

        const data = snapshot.data() || {};
        const nextAccess =
          data.roleAccess && typeof data.roleAccess === "object"
            ? normalizeRow(data.roleAccess)
            : null;

        if (window.currentUserProfile) {
          const current = window.currentUserProfile.roleAccess || null;
          if (JSON.stringify(nextAccess) !== JSON.stringify(current)) {
            window.currentUserProfile = Object.assign({}, window.currentUserProfile, {
              roleAccess: nextAccess
            });

            window.applyRoleVisibility(window.currentUserProfile.role || "");

            if (window.NHRCUI) {
              window.NHRCUI.showToast(
                "info",
                "Access updated",
                "Your workspace access has been updated by an administrator."
              );
            }
          }
        }

        refreshGovernancePanel();
      });
  }

  auth.onAuthStateChanged(function (user) {
    startProfileAccessWatcher(user);
    setTimeout(refreshGovernancePanel, 350);
  });

  window.RoleAccessAdmin = {
    loadMatrix: loadMatrix,
    saveMatrix: saveMatrix,
    renderMatrix: renderMatrix,
    matrixForRole: matrixForRole,
    sanitizeMatrix: sanitizeMatrix,
    createAdminPanel: createAdminPanel,
    getCachedMatrix: function () {
      return sanitizeMatrix(matrixCache || defaultMatrix());
    }
  };

  window.addEventListener("DOMContentLoaded", function () {
    createAdminPanel();
    setTimeout(refreshGovernancePanel, 400);
  });
})();
