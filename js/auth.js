// js/auth.js

async function signInUser() {
  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value.trim();
  const authMessage = document.getElementById("authMessage");

  authMessage.textContent = "";

  if (!email || !password) {
    authMessage.textContent = "Please enter your email and PIN.";
    return;
  }

  if (!/^\d{6}$/.test(password)) {
    authMessage.textContent = "PIN must be exactly 6 digits.";
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
  const email = document.getElementById("emailInput").value.trim();
  const authMessage = document.getElementById("authMessage");

  authMessage.textContent = "";

  if (!email) {
    authMessage.textContent = "Enter your email first, then click 'Forgot password?'.";
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
    authMessage.style.color = "#047857";
    authMessage.textContent = "Password reset email sent. Please check your inbox.";
  } catch (error) {
    authMessage.style.color = "#b91c1c";
    authMessage.textContent = error.message;
  }
}

function setupAuthUI() {
  const loginBtn = document.getElementById("loginBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("passwordInput");

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

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logActivity("logout", { page: "header" });
    await auth.signOut();
  });
}