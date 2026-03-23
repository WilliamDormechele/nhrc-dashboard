// js/auth.js
const sendUserLifecycleEmailCallable = functions.httpsCallable("sendUserLifecycleEmail");

function getPasswordResetActionCodeSettings(email = "") {
  const baseUrl = "https://williamdormechele.github.io/nhrc-dashboard/";
  const params = new URLSearchParams();

  if (email) {
    params.set("prefillEmail", email);
  }

  params.set("fromReset", "1");

  return {
    url: `${baseUrl}?${params.toString()}`,
    handleCodeInApp: false
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

function renderPasswordCriteria(password) {
  const checks = getPasswordChecks(password);

  const items = [
    { key: "length", label: "At least 8 characters" },
    { key: "upper", label: "At least 1 uppercase letter" },
    { key: "lower", label: "At least 1 lowercase letter" },
    { key: "number", label: "At least 1 number" },
    { key: "special", label: "At least 1 special character" }
  ];

  const container = document.getElementById("passwordCriteria");
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
  const passwordInput = document.getElementById("passwordInput");
  const strengthText = document.getElementById("passwordStrengthText");
  const strengthFill = document.getElementById("passwordStrengthFill");

  if (!passwordInput || !strengthText || !strengthFill) return;

  const password = passwordInput.value;
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
  const params = new URLSearchParams(window.location.search);
  const prefillEmail = params.get("prefillEmail") || "";
  const fromReset = params.get("fromReset") === "1";

  const emailInput = document.getElementById("emailInput");
  const authMessage = document.getElementById("authMessage");

  if (emailInput && prefillEmail && !emailInput.value.trim()) {
    emailInput.value = prefillEmail;
  }

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
  const email = document.getElementById("emailInput").value.trim().toLowerCase();
  const authMessage = document.getElementById("authMessage");

  authMessage.textContent = "";
  authMessage.style.color = "#b91c1c";

  if (!email) {
    authMessage.textContent = "Enter your email first, then click 'Forgot password?'.";
    return;
  }

  try {
    const userQuery = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (userQuery.empty) {
      throw new Error("No dashboard user account was found for this email. Please contact the administrator.");
    }

    const userDoc = userQuery.docs[0];
    const userId = userDoc.id;

    await sendUserLifecycleEmailCallable({
      eventType: "password_reset",
      userId
    });

    authMessage.style.color = "#047857";
    authMessage.textContent =
      "A branded password reset email has been sent. After resetting your password, return to the NHRC dashboard login page and sign in.";
  } catch (error) {
    console.error("Forgot password email failed:", error);

    const message =
      error?.message ||
      error?.details ||
      "Failed to send the password reset email. Please try again or contact the administrator.";

    authMessage.style.color = "#b91c1c";
    authMessage.textContent = message;
  }
}

function setupAuthUI() {
  const loginBtn = document.getElementById("loginBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("passwordInput");

  applyAuthPageStateFromUrl();
  updatePasswordStrengthUI();

  loginBtn.addEventListener("click", signInUser);

  forgotPasswordLink.addEventListener("click", function (e) {
    e.preventDefault();
    sendResetEmail();
  });

  togglePassword.addEventListener("click", function () {
    if (passwordInput.type === "password") {
      passwordInput.type = "text";
      togglePassword.textContent = "Hide";
    } else {
      passwordInput.type = "password";
      togglePassword.textContent = "Show";
    }
  });

  passwordInput.addEventListener("input", updatePasswordStrengthUI);

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logActivity("logout", { page: "header" });
    await auth.signOut();
  });
}