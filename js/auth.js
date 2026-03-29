// js/auth.js
const sendUserLifecycleEmailCallable = functions.httpsCallable("sendUserLifecycleEmail");

// 🔒 Prevent persistent login (session only)
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
  .then(() => {
    console.log("Auth persistence set to SESSION");
  })
  .catch((error) => {
    console.error("Failed to set auth persistence:", error);
  });

// ===============================
// Idle timeout settings
// ===============================
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;     // 10 minutes
const WARNING_BEFORE_MS = 60 * 1000;        // warn 1 minute before logout

let idleTimeoutHandle = null;
let idleWarningHandle = null;
let idleCountdownInterval = null;
let idleSecondsRemaining = Math.floor(WARNING_BEFORE_MS / 1000);
let idleTrackingStarted = false;

function clearIdleTimers() {
  if (idleTimeoutHandle) {
    clearTimeout(idleTimeoutHandle);
    idleTimeoutHandle = null;
  }

  if (idleWarningHandle) {
    clearTimeout(idleWarningHandle);
    idleWarningHandle = null;
  }

  if (idleCountdownInterval) {
    clearInterval(idleCountdownInterval);
    idleCountdownInterval = null;
  }

  idleSecondsRemaining = Math.floor(WARNING_BEFORE_MS / 1000);
}

async function performIdleLogout() {
  clearIdleTimers();

  try {
    if (window.currentUserProfile) {
      await logActivity("auto_logout_idle", { page: "auth" });
    }
  } catch (error) {
    console.error("Failed to log idle logout:", error);
  }

  if (typeof Swal !== "undefined") {
    await Swal.fire({
      icon: "warning",
      title: "Session expired",
      text: "You were signed out because your session was inactive for too long.",
      confirmButtonText: "OK"
    });
  }

  await auth.signOut();
}

function closeIdleWarningIfOpen() {
  if (typeof Swal !== "undefined" && Swal.isVisible()) {
    const popupTitle = document.querySelector(".swal2-title");
    if (popupTitle && popupTitle.textContent === "Session timeout warning") {
      Swal.close();
    }
  }
}

function updateIdleWarningText() {
  const htmlContainer = document.getElementById("idleWarningCountdownText");
  if (htmlContainer) {
    htmlContainer.textContent = `${idleSecondsRemaining}`;
  }
}

async function showIdleWarning() {
  idleSecondsRemaining = Math.floor(WARNING_BEFORE_MS / 1000);

  if (typeof Swal === "undefined") {
    return;
  }

  updateIdleWarningText();

  Swal.fire({
    icon: "warning",
    title: "Session timeout warning",
    html: `
      <div>
        You have been inactive for a while.<br><br>
        You will be signed out in <strong><span id="idleWarningCountdownText">${idleSecondsRemaining}</span></strong> seconds unless you continue working.
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: "Stay signed in",
    cancelButtonText: "Log out now",
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      idleCountdownInterval = setInterval(() => {
        idleSecondsRemaining -= 1;
        updateIdleWarningText();

        if (idleSecondsRemaining <= 0) {
          clearInterval(idleCountdownInterval);
          idleCountdownInterval = null;
        }
      }, 1000);
    },
    willClose: () => {
      if (idleCountdownInterval) {
        clearInterval(idleCountdownInterval);
        idleCountdownInterval = null;
      }
    }
  }).then(async (result) => {
    if (result.isConfirmed) {
      resetIdleTimer();
      return;
    }

    if (result.dismiss === Swal.DismissReason.cancel) {
      await performIdleLogout();
    }
  });
}

function resetIdleTimer() {
  if (!window.currentUserProfile) return;

  clearIdleTimers();
  closeIdleWarningIfOpen();

  idleWarningHandle = setTimeout(() => {
    showIdleWarning();
  }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);

  idleTimeoutHandle = setTimeout(() => {
    performIdleLogout();
  }, IDLE_TIMEOUT_MS);
}

function setupIdleTracking() {
  if (idleTrackingStarted) return;
  idleTrackingStarted = true;

  const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];

  events.forEach((eventName) => {
    window.addEventListener(eventName, () => {
      resetIdleTimer();
    }, true);
  });
}

function stopIdleTracking() {
  clearIdleTimers();
}

function getPasswordResetActionCodeSettings(email = "") {
  const baseUrl = "https://williamdormechele.github.io/nhrc-dashboard/";
  const params = new URLSearchParams();

  if (email) {
    params.set("prefillEmail", email);
  }

  params.set("mode", "resetPassword");
  params.set("fromReset", "1");

  return {
    url: `${baseUrl}?${params.toString()}`,
    handleCodeInApp: true
  };
}

function getPasswordChecks(password) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
  };
}

function getPasswordStrength(password) {
  if (!password) {
    return {
      label: "",
      className: ""
    };
  }

  const checks = getPasswordChecks(password);
  const score = Object.values(checks).filter(Boolean).length;

  if (password.length < 8 || score <= 2) {
    return {
      label: "Weak",
      className: "password-strength-weak"
    };
  }

  if (score === 3 || score === 4) {
    return {
      label: "Medium",
      className: "password-strength-medium"
    };
  }

  return {
    label: "Strong",
    className: "password-strength-strong"
  };
}

function isPasswordStrongEnough(password) {
  const checks = getPasswordChecks(password);
  return Object.values(checks).every(Boolean);
}

function getResetModeInfo() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get("mode") || "",
    oobCode: params.get("oobCode") || "",
    prefillEmail: params.get("prefillEmail") || "",
    fromReset: params.get("fromReset") === "1"
  };
}

function renderPasswordCriteria(password) {
  const checks = getPasswordChecks(password);

  const items = [
    { key: "length", label: "At least 8 characters" },
    { key: "upper", label: "At least 1 uppercase letter" },
    { key: "lower", label: "At least 1 lowercase letter" },
    { key: "number", label: "At least 1 number" },
    { key: "special", label: "At least 1 special character" }
  ];

  const resetSectionVisible =
    document.getElementById("resetPasswordSection")?.style.display === "block";

  const container = resetSectionVisible
    ? document.getElementById("resetPasswordCriteria")
    : document.getElementById("signInPasswordCriteria");

  if (!container) return;

  container.innerHTML = items
    .map((item) => {
      const passed = checks[item.key];
      return `
        <div class="password-criterion ${passed ? "passed" : ""}">
          <span class="criterion-icon">${passed ? "✓" : "○"}</span>
          <span>${item.label}</span>
        </div>
      `;
    })
    .join("");
}

function updatePasswordStrengthUI() {
  const resetSectionVisible =
    document.getElementById("resetPasswordSection")?.style.display === "block";

  const activePasswordInput = resetSectionVisible
    ? document.getElementById("newPasswordInput")
    : document.getElementById("passwordInput");

  const strengthText = resetSectionVisible
    ? document.getElementById("resetPasswordStrengthText")
    : document.getElementById("signInPasswordStrengthText");

  const strengthFill = resetSectionVisible
    ? document.getElementById("resetPasswordStrengthFill")
    : document.getElementById("signInPasswordStrengthFill");

  if (!activePasswordInput || !strengthText || !strengthFill) return;

  const password = activePasswordInput.value;
  const strength = getPasswordStrength(password);

  renderPasswordCriteria(password);

  strengthText.className = "password-strength-text";
  strengthFill.className = "password-strength-fill";

  if (!password) {
    strengthText.textContent = "Password strength: not entered";
    strengthFill.style.width = "0%";
    return;
  }

  strengthText.textContent = `Password strength: ${strength.label}`;
  strengthText.classList.add(strength.className);

  if (strength.label === "Weak") {
    strengthFill.style.width = "33%";
    strengthFill.classList.add("password-strength-fill-weak");
  } else if (strength.label === "Medium") {
    strengthFill.style.width = "66%";
    strengthFill.classList.add("password-strength-fill-medium");
  } else {
    strengthFill.style.width = "100%";
    strengthFill.classList.add("password-strength-fill-strong");
  }
}

function applyAuthPageStateFromUrl() {
  const { mode, oobCode, prefillEmail, fromReset } = getResetModeInfo();

  const emailInput = document.getElementById("emailInput");
  const authMessage = document.getElementById("authMessage");
  const signInSection = document.getElementById("signInSection");
  const resetPasswordSection = document.getElementById("resetPasswordSection");
  const authTitle = document.getElementById("authTitle");
  const authIntro = document.getElementById("authIntro");

  if (emailInput && prefillEmail && !emailInput.value.trim()) {
    emailInput.value = prefillEmail;
  }

  if (mode === "resetPassword" && oobCode) {
    if (signInSection) signInSection.style.display = "none";
    if (resetPasswordSection) resetPasswordSection.style.display = "block";

    if (authTitle) authTitle.textContent = "Reset password";
    if (authIntro) authIntro.textContent = "";

    if (authMessage) {
      authMessage.style.color = "#1d4ed8";
      authMessage.textContent =
        "Create a strong new password to complete your password reset.";
    }

    updatePasswordStrengthUI();
    return;
  }

  if (signInSection) signInSection.style.display = "block";
  if (resetPasswordSection) resetPasswordSection.style.display = "none";

  if (authMessage && fromReset) {
    authMessage.style.color = "#047857";
    authMessage.textContent =
      "Your password has been reset. Please sign in below with your email and new password.";
  }
}

async function signInUser() {
  const email = document.getElementById("emailInput").value.trim().toLowerCase();
  const password = document.getElementById("passwordInput").value;
  const authMessage = document.getElementById("authMessage");

  authMessage.textContent = "";
  authMessage.style.color = "#b91c1c";

  if (!email || !password) {
    authMessage.textContent = "Please enter your email and password.";
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    authMessage.textContent = error.message;
  }
}

async function fetchUserProfile(uid) {
  const docRef = db.collection("users").doc(uid);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    throw new Error("User profile not found in Firestore. Please contact the administrator.");
  }

  const data = snapshot.data();

  return {
    uid,
    ...data
  };
}

async function sendResetEmail() {
  const emailInput = document.getElementById("emailInput");
  const authMessage = document.getElementById("authMessage");

  let email = (emailInput?.value || "").trim().toLowerCase();

  authMessage.textContent = "";
  authMessage.style.color = "#b91c1c";

  // 🔹 If no email → ask via popup
  if (!email) {
    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: "Reset password",
        input: "email",
        inputLabel: "Enter your email address",
        inputPlaceholder: "name@nhrc.org or name@gmail.com",
        confirmButtonText: "Send reset link",
        showCancelButton: true,
        inputValidator: (value) => {
          if (!value) return "Email is required";
        }
      });

      if (!result.isConfirmed) return;

      email = result.value.trim().toLowerCase();
    } else {
      authMessage.textContent = "Enter your email first, then click 'Forgot password?'.";
      return;
    }
  }

  try {
    // 🔍 Validate user exists
    const userQuery = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (userQuery.empty) {
      throw new Error("No dashboard user account found for this email.");
    }

    const userDoc = userQuery.docs[0];
    const userId = userDoc.id;

    // 🔄 Show loading
    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: "Sending reset email...",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
    }

    // 📧 Send reset email
    await sendUserLifecycleEmailCallable({
      eventType: "password_reset",
      userId
    });

    // ✅ Success
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "success",
        title: "Reset email sent",
        text: "Check your email to reset your password.",
        confirmButtonText: "OK"
      });
    }

    authMessage.style.color = "#047857";
    authMessage.textContent =
      "A password reset email has been sent. Please check your inbox.";

  } catch (error) {
    console.error("Forgot password failed:", error);

    const message =
      error?.message ||
      error?.details ||
      "Failed to send reset email.";

    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "error",
        title: "Reset failed",
        text: message
      });
    }

    authMessage.style.color = "#b91c1c";
    authMessage.textContent = message;
  }
}

async function confirmCustomPasswordReset() {
  const { oobCode } = getResetModeInfo();
  const newPasswordInput = document.getElementById("newPasswordInput");
  const confirmPasswordInput = document.getElementById("confirmPasswordInput");
  const authMessage = document.getElementById("authMessage");

  if (!newPasswordInput || !confirmPasswordInput || !authMessage) return;

  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  authMessage.textContent = "";
  authMessage.style.color = "#b91c1c";

  if (!oobCode) {
    authMessage.textContent = "This password reset link is invalid or incomplete.";
    return;
  }

  if (!newPassword || !confirmPassword) {
    authMessage.textContent = "Please enter and confirm your new password.";
    return;
  }

  if (!isPasswordStrongEnough(newPassword)) {
    authMessage.textContent =
      "Your new password does not yet meet all password requirements.";
    return;
  }

  if (newPassword !== confirmPassword) {
    authMessage.textContent = "The passwords do not match.";
    return;
  }

  try {
    await auth.confirmPasswordReset(oobCode, newPassword);

    authMessage.style.color = "#047857";
    authMessage.textContent =
      "Your password has been reset successfully. You can now sign in with your new password.";

    const signInSection = document.getElementById("signInSection");
    const resetPasswordSection = document.getElementById("resetPasswordSection");
    const emailInput = document.getElementById("emailInput");

    if (signInSection) signInSection.style.display = "block";
    if (resetPasswordSection) resetPasswordSection.style.display = "none";

    if (emailInput && !emailInput.value.trim()) {
      const { prefillEmail } = getResetModeInfo();
      if (prefillEmail) emailInput.value = prefillEmail;
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("mode");
    cleanUrl.searchParams.delete("oobCode");
    cleanUrl.searchParams.delete("apiKey");
    cleanUrl.searchParams.delete("lang");
    cleanUrl.searchParams.set("fromReset", "1");
    window.history.replaceState({}, document.title, cleanUrl.toString());
  } catch (error) {
    console.error("Custom password reset failed:", error);
    authMessage.textContent =
      error?.message || "Failed to reset password. The link may be expired or invalid.";
  }
}

function setupAuthUI() {
  const loginBtn = document.getElementById("loginBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("passwordInput");

  const confirmResetBtn = document.getElementById("confirmResetBtn");
  const newPasswordInput = document.getElementById("newPasswordInput");
  const confirmPasswordInput = document.getElementById("confirmPasswordInput");
  const toggleNewPassword = document.getElementById("toggleNewPassword");
  const toggleConfirmPassword = document.getElementById("toggleConfirmPassword");

  applyAuthPageStateFromUrl();
  updatePasswordStrengthUI();

  if (loginBtn) {
    loginBtn.addEventListener("click", signInUser);
  }

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", function (e) {
      e.preventDefault();
      sendResetEmail();
    });
  }

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        togglePassword.textContent = "Hide";
      } else {
        passwordInput.type = "password";
        togglePassword.textContent = "Show";
      }
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener("input", updatePasswordStrengthUI);
  }

  if (toggleNewPassword && newPasswordInput) {
    toggleNewPassword.addEventListener("click", function () {
      if (newPasswordInput.type === "password") {
        newPasswordInput.type = "text";
        toggleNewPassword.textContent = "Hide";
      } else {
        newPasswordInput.type = "password";
        toggleNewPassword.textContent = "Show";
      }
    });
  }

  if (toggleConfirmPassword && confirmPasswordInput) {
    toggleConfirmPassword.addEventListener("click", function () {
      if (confirmPasswordInput.type === "password") {
        confirmPasswordInput.type = "text";
        toggleConfirmPassword.textContent = "Hide";
      } else {
        confirmPasswordInput.type = "password";
        toggleConfirmPassword.textContent = "Show";
      }
    });
  }

  if (newPasswordInput) {
    newPasswordInput.addEventListener("input", updatePasswordStrengthUI);
  }

  if (confirmResetBtn) {
    confirmResetBtn.addEventListener("click", confirmCustomPasswordReset);
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    stopIdleTracking();
    await logActivity("logout", { page: "header" });
    await auth.signOut();
  });
}