// js/ui.js

(function () {
  const ROLE_LABELS = {
    field_worker: "Field Worker",
    field_supervisor: "Field Supervisor",
    field_headquarters: "Field Headquarters",
    director: "Director",
    project_pi: "Project PI",
    local_principal_investigator: "Local Principal Investigator",
    head_of_department: "Head of Department",
    project_manager: "Project Manager",
    project_coordinator: "Project Coordinator",
    data_collector: "Data Collector",
    administrator: "Administrator",
    developer: "Developer"
  };

  function formatRole(role = "") {
    const key = String(role || "").trim().toLowerCase();
    if (!key) return "";
    if (ROLE_LABELS[key]) return ROLE_LABELS[key];

    return key
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function showToast(icon = "info", title = "", text = "", options = {}) {
    if (typeof Swal === "undefined") return;

    Swal.fire({
      toast: true,
      position: options.position || "top-end",
      icon,
      title,
      text,
      showConfirmButton: false,
      timer: options.timer || 3200,
      timerProgressBar: true,
      customClass: {
        popup: "nhrc-toast",
        title: "nhrc-toast-title",
        htmlContainer: "nhrc-toast-copy"
      },
      didOpen: (toast) => {
        toast.addEventListener("mouseenter", Swal.stopTimer);
        toast.addEventListener("mouseleave", Swal.resumeTimer);
      }
    });
  }

  function showBusy(options = {}) {
    const overlay = document.getElementById("appBootOverlay");
    const title = document.getElementById("appBootTitle");
    const message = document.getElementById("appBootMessage");

    if (!overlay) return;

    if (title) {
      title.textContent = options.title || "Preparing your workspace";
    }

    if (message) {
      message.textContent =
        options.text ||
        "Checking your secure session and loading your assigned workspace.";
    }

    overlay.classList.remove("is-hidden");
    overlay.style.display = "grid";
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideBusy() {
    const overlay = document.getElementById("appBootOverlay");
    if (!overlay) return;

    overlay.classList.add("is-hidden");
    overlay.setAttribute("aria-hidden", "true");

    window.setTimeout(() => {
      if (overlay.classList.contains("is-hidden")) {
        overlay.style.display = "none";
      }
    }, 220);
  }

  function setButtonBusy(button, busy, label = "Working") {
    if (!button) return;

    if (busy) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.innerHTML =
        '<span class="button-spinner" aria-hidden="true"></span><span>' +
        String(label) +
        "</span>";
      return;
    }

    button.disabled = false;
    button.removeAttribute("aria-busy");

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function closeMobileSidebar() {
    document.body.classList.remove("workspace-nav-open");
    const mobileButton = document.getElementById("mobileSidebarBtn");
    if (mobileButton) mobileButton.setAttribute("aria-expanded", "false");
  }

  function setupSidebar() {
    const shell = document.getElementById("workspaceShell");
    const sidebar = document.getElementById("appSidebar");
    const toggle = document.getElementById("sidebarToggleBtn");
    const mobileButton = document.getElementById("mobileSidebarBtn");
    const backdrop = document.getElementById("sidebarBackdrop");

    if (!shell || !sidebar) return;

    let collapsed = false;

    try {
      collapsed = localStorage.getItem("nhrcSidebarCollapsed") === "1";
    } catch (error) {
      collapsed = false;
    }

    const applyCollapsed = (value) => {
      collapsed = !!value;
      shell.classList.toggle("sidebar-collapsed", collapsed);

      if (toggle) {
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.title = collapsed ? "Expand navigation" : "Collapse navigation";
        const icon = toggle.querySelector("i");
        if (icon) {
          icon.className = collapsed
            ? "fas fa-angles-right"
            : "fas fa-angles-left";
        }
      }

      try {
        localStorage.setItem("nhrcSidebarCollapsed", collapsed ? "1" : "0");
      } catch (error) {
        // Storage can be unavailable in private browsing.
      }
    };

    applyCollapsed(collapsed);

    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = "true";
      toggle.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) {
          closeMobileSidebar();
          return;
        }
        applyCollapsed(!collapsed);
      });
    }

    if (mobileButton && !mobileButton.dataset.bound) {
      mobileButton.dataset.bound = "true";
      mobileButton.addEventListener("click", () => {
        const opening = !document.body.classList.contains("workspace-nav-open");
        document.body.classList.toggle("workspace-nav-open", opening);
        mobileButton.setAttribute("aria-expanded", opening ? "true" : "false");
      });
    }

    if (backdrop && !backdrop.dataset.bound) {
      backdrop.dataset.bound = "true";
      backdrop.addEventListener("click", closeMobileSidebar);
    }

    sidebar.querySelectorAll(".tab-button").forEach((button) => {
      if (button.dataset.mobileCloseBound) return;
      button.dataset.mobileCloseBound = "true";
      button.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) {
          closeMobileSidebar();
        }
      });
    });

    window.addEventListener("resize", () => {
      if (!window.matchMedia("(max-width: 900px)").matches) {
        closeMobileSidebar();
      }
    });
  }

  window.NHRCUI = {
    formatRole,
    showToast,
    showBusy,
    hideBusy,
    setButtonBusy,
    setupSidebar,
    closeMobileSidebar
  };
})();
