const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const nodemailer = require("nodemailer");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const GMAIL_SMTP_USER = defineSecret("GMAIL_SMTP_USER");
const GMAIL_SMTP_PASS = defineSecret("GMAIL_SMTP_PASS");
const PHYSIO_HEMAB_REDCAP_API_URL = defineSecret("PHYSIO_HEMAB_REDCAP_API_URL");
const PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN = defineSecret("PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN");
const PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN = defineSecret("PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN");

const APP_BASE_URL = "https://nhrc-dashboard.web.app/";
const LOGIN_URL = APP_BASE_URL;
const LOGO_URL = `${APP_BASE_URL}images/nhrc-logo.png`;
const SENDER_NAME = "NHRC Projects Dashboard";

// const RESEND_SENDER_EMAIL = "onboarding@resend.dev";
// const RESEND_SENDER_EMAIL = "dashboard@navrongo-hrc.org";
const RESEND_SENDER_EMAIL = "noreply@navrongo-hrc.org";

const SIGNATURE_HTML = `
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#334155;font-size:14px;line-height:1.6;">
    <strong>William Dormechele</strong><br>
    Data Manager/Analyst/SysDev<br>
    Navrongo Health Research Centre<br>
    william.dormechele@navrongo-hrc.org
  </div>
`;

async function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const actorUid = request.auth.uid;
  const actorRef = db.collection("users").doc(actorUid);
  const actorSnap = await actorRef.get();

  if (!actorSnap.exists) {
    throw new HttpsError("permission-denied", "Admin profile not found.");
  }

  const actor = actorSnap.data() || {};
  const role = actor.role || "";

  if (!["administrator", "developer"].includes(role)) {
    throw new HttpsError("permission-denied", "You are not allowed to manage users.");
  }

  return {
    uid: actorUid,
    email: actor.email || request.auth.token.email || "",
    fullName: actor.fullName || ""
  };
}

async function writeAdminAudit({
  actor,
  action,
  targetUserId,
  before = null,
  after = null,
  note = ""
}) {
  await db.collection("admin_audit_logs").add({
    action,
    actorUid: actor.uid,
    actorEmail: actor.email || "",
    actorName: actor.fullName || "",
    targetUserId,
    targetEmail: before?.email || after?.email || "",
    targetName: before?.fullName || after?.fullName || "",
    note,
    before,
    after,
    createdAt: FieldValue.serverTimestamp()
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function titleCaseWords(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildPasswordResetActionCodeSettings(email = "") {
  const params = new URLSearchParams();

  if (email) {
    params.set("prefillEmail", email);
  }

  params.set("mode", "resetPassword");
  params.set("fromReset", "1");

  return {
    url: `${APP_BASE_URL}?${params.toString()}`,
    handleCodeInApp: true
  };
}

async function getProjectDisplayNames(projectCodes = []) {
  const codes = Array.isArray(projectCodes) ? projectCodes : [];
  if (codes.length === 0) return [];

  const docs = await Promise.all(
    codes.map((code) => db.collection("projects").doc(code).get())
  );

  return docs.map((doc, index) => {
    if (doc.exists) {
      const data = doc.data() || {};
      return data.name || titleCaseWords(codes[index]);
    }
    return titleCaseWords(codes[index]);
  });
}

function buildProjectListHtml(projectNames = []) {
  if (!projectNames.length) {
    return `<p style="margin:8px 0 0 0;color:#475569;">No projects assigned.</p>`;
  }

  return `
    <ul style="margin:8px 0 0 18px;padding:0;color:#1e293b;">
      ${projectNames.map((name) => `<li style="margin:4px 0;">${escapeHtml(name)}</li>`).join("")}
    </ul>
  `;
}

function buildPrimaryButton(label, href, bg = "#1d4ed8") {
  if (!href) return "";
  return `
    <a href="${href}" style="
      display:inline-block;
      padding:12px 18px;
      margin-right:10px;
      margin-bottom:10px;
      background:${bg};
      color:#ffffff;
      text-decoration:none;
      border-radius:8px;
      font-weight:600;
    ">${escapeHtml(label)}</a>
  `;
}

function convertFirebaseActionLinkToCustomHandler(firebaseLink, email = "") {
  if (!firebaseLink) return "";

  const sourceUrl = new URL(firebaseLink);
  const sourceParams = sourceUrl.searchParams;

  const targetUrl = new URL(APP_BASE_URL);

  const mode = sourceParams.get("mode") || "resetPassword";
  const oobCode = sourceParams.get("oobCode") || "";
  const apiKey = sourceParams.get("apiKey") || "";
  const lang = sourceParams.get("lang") || "";

  targetUrl.searchParams.set("mode", mode);

  if (oobCode) {
    targetUrl.searchParams.set("oobCode", oobCode);
  }

  if (apiKey) {
    targetUrl.searchParams.set("apiKey", apiKey);
  }

  if (lang) {
    targetUrl.searchParams.set("lang", lang);
  }

  if (email) {
    targetUrl.searchParams.set("prefillEmail", email);
  }

  targetUrl.searchParams.set("fromReset", "1");

  return targetUrl.toString();
}

function buildEmailShell({ title, greeting, introHtml, detailsHtml, actionsHtml, footerNoteHtml = "" }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:700px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#0f2744;color:#ffffff;padding:22px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
          <tr>
            <td style="width:72px;vertical-align:middle;">
              <img
                src="${LOGO_URL}"
                alt="NHRC Logo"
                style="display:block;width:58px;height:58px;object-fit:contain;border-radius:10px;background:#ffffff;padding:4px;"
              />
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:24px;font-weight:700;">NHRC Projects Dashboard</div>
              <div style="font-size:14px;opacity:0.95;margin-top:4px;">
                Secure dashboard access by project, role, and privilege
              </div>
            </td>
          </tr>
        </table>
      </div>

        <div style="padding:24px;">
          <h2 style="margin:0 0 12px 0;color:#0f172a;">${escapeHtml(title)}</h2>
          <p style="margin:0 0 12px 0;color:#1e293b;">${greeting}</p>
          ${introHtml}
          ${detailsHtml}
          <div style="margin-top:22px;">${actionsHtml}</div>
          ${footerNoteHtml}
          ${SIGNATURE_HTML}
        </div>
      </div>
    </div>
  `;
}

function getGmailTransport(gmailUser, gmailPass) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailPass
    }
  });
}

async function sendViaResend({ resendApiKey, toEmail, subject, html }) {
  const resend = new Resend(resendApiKey);

  const { data, error } = await resend.emails.send({
    from: `${SENDER_NAME} <${RESEND_SENDER_EMAIL}>`,
    to: [toEmail],
    subject,
    html
  });

  if (error) {
    logger.error("Resend send failed", error);
    throw new Error(error.message || "Failed to send email through Resend.");
  }

  return {
    provider: "resend",
    messageId: data?.id || ""
  };
}

async function sendViaGmail({ gmailUser, gmailPass, toEmail, subject, html }) {
  const transporter = getGmailTransport(gmailUser, gmailPass);

  const info = await transporter.sendMail({
    from: `${SENDER_NAME} <${gmailUser}>`,
    to: toEmail,
    subject,
    html
  });

  return {
    provider: "gmail_smtp",
    messageId: info?.messageId || ""
  };
}

async function sendViaResendWithGmailFallback({
  resendApiKey,
  gmailUser,
  gmailPass,
  toEmail,
  subject,
  html
}) {
  try {
    return await sendViaResend({
      resendApiKey,
      toEmail,
      subject,
      html
    });
  } catch (resendError) {
    logger.warn("Resend failed. Falling back to Gmail SMTP.", {
      toEmail,
      error: resendError?.message || String(resendError)
    });

    return await sendViaGmail({
      gmailUser,
      gmailPass,
      toEmail,
      subject,
      html
    });
  }
}

async function sendLifecycleEmail({
  resendApiKey,
  gmailUser,
  gmailPass,
  user,
  eventType,
  actor,
  previousRole = "",
  previousProjects = [],
  previousIsActive = null,
  previousSupervisorName = ""
}) {
  const projectNames = await getProjectDisplayNames(user.assignedProjects || []);
  const projectListHtml = buildProjectListHtml(projectNames);
  const loginButton = buildPrimaryButton("Open NHRC Dashboard", LOGIN_URL, "#0f766e");

  let subject = "";
  let title = "";
  let introHtml = "";
  let detailsHtml = "";
  let actionsHtml = loginButton;
  let footerNoteHtml = "";
  let resetLink = "";

  if (eventType === "created" || eventType === "password_reset") {
    const firebaseResetLink = await admin.auth().generatePasswordResetLink(
      user.email,
      buildPasswordResetActionCodeSettings(user.email)
    );

    resetLink = convertFirebaseActionLinkToCustomHandler(firebaseResetLink, user.email);
  }

  if (eventType === "created") {
    subject = "Your NHRC Projects Dashboard account has been created";
    title = "Account created";
    introHtml = `
      <p style="margin:0 0 16px 0;color:#334155;">
        Your NHRC Projects Dashboard account has been created. Please use the button below to set your password, then use the login button to access the dashboard.
      </p>
    `;
    detailsHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${escapeHtml(user.fullName || "User")}</p>
        <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(user.email || "")}</p>
        <p style="margin:0 0 8px 0;"><strong>Role:</strong> ${escapeHtml(titleCaseWords(user.role || ""))}</p>
        <p style="margin:0 0 8px 0;"><strong>Supervisor:</strong> ${escapeHtml(user.supervisorName || user.supervisorEmail || "Not assigned")}</p>
        <div style="margin-top:10px;"><strong>Assigned projects:</strong>${projectListHtml}</div>
      </div>
    `;
    actionsHtml =
      buildPrimaryButton("Set Your Password", resetLink, "#1d4ed8") +
      loginButton;
    footerNoteHtml = `
      <p style="margin-top:18px;color:#475569;font-size:14px;">
        This account was created by ${escapeHtml(actor.fullName || actor.email || "the administrator")}.
      </p>
    `;
  } else if (eventType === "password_reset") {
    subject = "Reset your NHRC Projects Dashboard password";
    title = "Password reset";
    introHtml = `
      <p style="margin:0 0 16px 0;color:#334155;">
        A password reset has been initiated for your NHRC Projects Dashboard account. Please use the button below to set a new password, then sign in from the dashboard.
      </p>
    `;
    detailsHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${escapeHtml(user.fullName || "User")}</p>
        <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(user.email || "")}</p>
        <p style="margin:0 0 8px 0;"><strong>Role:</strong> ${escapeHtml(titleCaseWords(user.role || ""))}</p>
        <div style="margin-top:10px;"><strong>Assigned projects:</strong>${projectListHtml}</div>
      </div>
    `;
    actionsHtml =
      buildPrimaryButton("Reset Your Password", resetLink, "#1d4ed8") +
      loginButton;
    footerNoteHtml = `
      <p style="margin-top:18px;color:#475569;font-size:14px;">
        This reset email was sent by ${escapeHtml(actor.fullName || actor.email || "the administrator")}.
      </p>
    `;
  } else if (eventType === "role_updated") {
    subject = "Your NHRC Projects Dashboard access has been updated";
    title = "Access updated";
    introHtml = `
      <p style="margin:0 0 16px 0;color:#334155;">
        Your dashboard access details have been updated. Please review the updated role and project assignments below.
      </p>
    `;
    detailsHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${escapeHtml(user.fullName || "User")}</p>
        <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(user.email || "")}</p>
        <p style="margin:0 0 8px 0;"><strong>Previous role:</strong> ${escapeHtml(titleCaseWords(previousRole || "Not set"))}</p>
        <p style="margin:0 0 8px 0;"><strong>Current role:</strong> ${escapeHtml(titleCaseWords(user.role || ""))}</p>
        <p style="margin:0 0 8px 0;"><strong>Previous supervisor:</strong> ${escapeHtml(previousSupervisorName || "Not assigned")}</p>
        <p style="margin:0 0 8px 0;"><strong>Current supervisor:</strong> ${escapeHtml(user.supervisorName || user.supervisorEmail || "Not assigned")}</p>
        <p style="margin:0 0 8px 0;"><strong>Previous access:</strong> ${previousIsActive === null ? "Not available" : previousIsActive ? "Active" : "Inactive"}</p>
        <p style="margin:0 0 8px 0;"><strong>Current access:</strong> ${user.isActive === true ? "Active" : "Inactive"}</p>
        <div style="margin-top:10px;"><strong>Previous projects:</strong>${buildProjectListHtml(await getProjectDisplayNames(previousProjects || []))}</div>
        <div style="margin-top:10px;"><strong>Current projects:</strong>${projectListHtml}</div>
      </div>
    `;
    actionsHtml = loginButton;
    footerNoteHtml = `
      <p style="margin-top:18px;color:#475569;font-size:14px;">
        This access update was made by ${escapeHtml(actor.fullName || actor.email || "the administrator")}.
      </p>
    `;
  } else {
    throw new HttpsError("invalid-argument", "Unsupported email event type.");
  }

  const html = buildEmailShell({
    title,
    greeting: `Hello ${escapeHtml(user.fullName || "User")},`,
    introHtml,
    detailsHtml,
    actionsHtml,
    footerNoteHtml
  });

  return await sendViaResendWithGmailFallback({
    resendApiKey,
    gmailUser,
    gmailPass,
    toEmail: user.email,
    subject,
    html
  });
}

exports.sendUserLifecycleEmail = onCall(
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, GMAIL_SMTP_USER, GMAIL_SMTP_PASS]
  },
  async (request) => {
    try {
      const actor = await requireAdmin(request);
      const {
        eventType,
        userId,
        context = {}
      } = request.data || {};

      if (!eventType || !userId) {
        throw new HttpsError("invalid-argument", "eventType and userId are required.");
      }

      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const user = userSnap.data() || {};

      if (!user.email) {
        throw new HttpsError("failed-precondition", "Target user does not have an email address.");
      }

      const result = await sendLifecycleEmail({
        resendApiKey: RESEND_API_KEY.value(),
        gmailUser: GMAIL_SMTP_USER.value(),
        gmailPass: GMAIL_SMTP_PASS.value(),
        user,
        eventType,
        actor,
        previousRole: context.previousRole || "",
        previousProjects: Array.isArray(context.previousProjects) ? context.previousProjects : [],
        previousIsActive:
          typeof context.previousIsActive === "boolean" ? context.previousIsActive : null,
        previousSupervisorName: context.previousSupervisorName || ""
      });

      await writeAdminAudit({
        actor,
        action: `send_${eventType}_email`,
        targetUserId: userId,
        before: user,
        after: user,
        note: `Lifecycle email sent for ${eventType}`
      });

      return {
        ok: true,
        message: `Email sent successfully for ${eventType} via ${result?.provider || "unknown"}.`,
        emailId: result?.messageId || ""
      };
    } catch (error) {
      logger.error("sendUserLifecycleEmail failed", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", error.message || "Failed to send lifecycle email.");
    }
  }
);

exports.setUserActiveState = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireAdmin(request);
  const { userId, isActive } = request.data || {};

  if (!userId || typeof isActive !== "boolean") {
    throw new HttpsError("invalid-argument", "userId and isActive are required.");
  }

  if (actor.uid === userId && isActive === false) {
    throw new HttpsError("failed-precondition", "You cannot deactivate your own account.");
  }

  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const before = userSnap.data() || {};

  const updates = {
    isActive,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.email || actor.uid
  };

  if (isActive) {
    updates.isDeleted = false;
    updates.deletedAt = null;
    updates.deletedBy = null;
    updates.restoredAt = FieldValue.serverTimestamp();
    updates.restoredBy = actor.email || actor.uid;
  }

  await userRef.set(updates, { merge: true });

  await db.collection("monitoring_directory").doc(userId).set({
    isActive,
    isDeleted: isActive ? false : !!before.isDeleted,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.email || actor.uid
  }, { merge: true });

  await admin.auth().updateUser(userId, {
    disabled: !isActive
  });

  const afterSnap = await userRef.get();
  const after = afterSnap.data() || {};

  await writeAdminAudit({
    actor,
    action: isActive ? "restore_activate_user" : "deactivate_user",
    targetUserId: userId,
    before,
    after,
    note: isActive ? "User activated" : "User deactivated"
  });

  return {
    ok: true,
    message: isActive ? "User activated successfully." : "User deactivated successfully."
  };
});

exports.softDeleteUser = onCall({ region: "us-central1" }, async (request) => {
  try {
    const actor = await requireAdmin(request);
    const { userId, reason = "" } = request.data || {};

    if (!userId) {
      throw new HttpsError("invalid-argument", "userId is required.");
    }

    if (actor.uid === userId) {
      throw new HttpsError("failed-precondition", "You cannot soft delete your own account.");
    }

    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const before = userSnap.data() || {};

    await userRef.set({
      isActive: false,
      isDeleted: true,
      deleteReason: reason || "",
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: actor.email || actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.email || actor.uid
    }, { merge: true });

    await db.collection("monitoring_directory").doc(userId).set({
      isActive: false,
      isDeleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: actor.email || actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.email || actor.uid
    }, { merge: true });

    try {
      await admin.auth().updateUser(userId, {
        disabled: true
      });
    } catch (authError) {
      logger.error("Auth disable failed", authError);

      if (authError.code === "auth/user-not-found") {
        throw new HttpsError(
          "not-found",
          "Auth user not found. Firestore user exists but Authentication account is missing."
        );
      }

      throw new HttpsError(
        "internal",
        authError.message || "Failed to disable user in Firebase Auth."
      );
    }

    const afterSnap = await userRef.get();
    const after = afterSnap.data() || {};

    await writeAdminAudit({
      actor,
      action: "soft_delete_user",
      targetUserId: userId,
      before,
      after,
      note: reason || "Soft deleted"
    });

    return {
      ok: true,
      message: "User soft deleted successfully."
    };
  } catch (error) {
    logger.error("softDeleteUser failed", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error.message || "Soft delete failed unexpectedly."
    );
  }
});

exports.restoreDeletedUser = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireAdmin(request);
  const { userId } = request.data || {};

  if (!userId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }

  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const before = userSnap.data() || {};

  await userRef.set({
    isActive: true,
    isDeleted: false,
    deleteReason: "",
    deletedAt: null,
    deletedBy: null,
    restoredAt: FieldValue.serverTimestamp(),
    restoredBy: actor.email || actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.email || actor.uid
  }, { merge: true });

  await db.collection("monitoring_directory").doc(userId).set({
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    restoredAt: FieldValue.serverTimestamp(),
    restoredBy: actor.email || actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.email || actor.uid
  }, { merge: true });

  await admin.auth().updateUser(userId, {
    disabled: false
  });

  const afterSnap = await userRef.get();
  const after = afterSnap.data() || {};

  await writeAdminAudit({
    actor,
    action: "restore_deleted_user",
    targetUserId: userId,
    before,
    after,
    note: "User restored"
  });

  return {
    ok: true,
    message: "Deleted user restored successfully."
  };
});

exports.hardDeleteUser = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireAdmin(request);
  const { userId } = request.data || {};

  if (!userId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }

  if (actor.uid === userId) {
    throw new HttpsError("failed-precondition", "You cannot permanently delete your own account.");
  }

  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  const before = userSnap.exists ? (userSnap.data() || {}) : null;

  if (before) {
    await db.collection("users_deleted_archive").doc(userId).set({
      ...before,
      hardDeletedAt: FieldValue.serverTimestamp(),
      hardDeletedBy: actor.email || actor.uid
    }, { merge: true });
  }

  try {
    await admin.auth().deleteUser(userId);
  } catch (error) {
    logger.error("Auth delete failed", error);
  }

  await db.collection("monitoring_directory").doc(userId).delete().catch(() => {});
  await userRef.delete().catch(() => {});

  await writeAdminAudit({
    actor,
    action: "hard_delete_user",
    targetUserId: userId,
    before,
    after: null,
    note: "User permanently deleted"
  });

  return {
    ok: true,
    message: "User permanently deleted."
  };
});

exports.requestSelfServicePasswordReset = onCall(
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, GMAIL_SMTP_USER, GMAIL_SMTP_PASS]
  },
  async (request) => {
    try {
      const email = String(request.data?.email || "").trim().toLowerCase();

      if (!email) {
        throw new HttpsError("invalid-argument", "Email is required.");
      }

      const userQuery = await db
        .collection("users")
        .where("email", "==", email)
        .limit(1)
        .get();

      // For security, do not reveal too much
      if (userQuery.empty) {
        return {
          ok: true,
          message: "If an account exists for that email, a reset link has been sent."
        };
      }

      const userDoc = userQuery.docs[0];
      const user = {
        id: userDoc.id,
        ...userDoc.data()
      };

      const actor = {
        uid: "self-service",
        email: "",
        fullName: "Self-service password reset"
      };

      const result = await sendLifecycleEmail({
        resendApiKey: RESEND_API_KEY.value(),
        gmailUser: GMAIL_SMTP_USER.value(),
        gmailPass: GMAIL_SMTP_PASS.value(),
        user,
        eventType: "password_reset",
        actor
      });

      return {
        ok: true,
        message: `If an account exists for that email, a reset link has been sent via ${result?.provider || "email"}.`
      };
    } catch (error) {
      logger.error("Self-service password reset failed", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        error?.message || "Failed to process password reset request."
      );
    }
  }
);

function normalizeProjectCodes(values = []) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function userDistrictLabel(user = {}) {
  return (
    user.district ||
    user.districtName ||
    user.locationDistrict ||
    user.location ||
    user.workDistrict ||
    "Not assigned"
  );
}

function hasSharedProject(left = [], right = []) {
  const leftSet = new Set(normalizeProjectCodes(left));
  return normalizeProjectCodes(right).some((code) => leftSet.has(code));
}

function toAssignmentUser(userDoc = {}, docId = "") {
  return {
    uid: docId,
    fullName: userDoc.fullName || "",
    email: userDoc.email || "",
    role: userDoc.role || "",
    district: userDistrictLabel(userDoc),
    assignedProjects: normalizeProjectCodes(userDoc.assignedProjects),
    supervisorId: userDoc.supervisorId || "",
    supervisorEmail: userDoc.supervisorEmail || "",
    supervisorName: userDoc.supervisorName || ""
  };
}

exports.getAssignmentOverview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const actorUid = request.auth.uid;
  const actorSnap = await db.collection("users").doc(actorUid).get();

  if (!actorSnap.exists) {
    throw new HttpsError("permission-denied", "User profile not found.");
  }

  const actor = actorSnap.data() || {};
  const actorEmail = String(actor.email || request.auth.token.email || "").toLowerCase();
  const actorRole = String(actor.role || "").trim();
  const actorProjects = normalizeProjectCodes(actor.assignedProjects);

  const allUsersSnap = await db.collection("users").get();

  const allUsers = [];
  allUsersSnap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.isDeleted === true) return;
    if (data.isActive === false) return;

    allUsers.push({
      id: doc.id,
      ...data
    });
  });

  const allSupervisors = allUsers
    .filter((user) => user.role === "field_supervisor")
    .map((user) => toAssignmentUser(user, user.id));

  const allWorkers = allUsers
    .filter((user) => user.role === "field_worker")
    .map((user) => toAssignmentUser(user, user.id));

  if (actorRole === "field_worker") {
    const supervisor =
      allSupervisors.find((item) => item.uid === actor.supervisorId) ||
      allSupervisors.find((item) => String(item.email || "").toLowerCase() === String(actor.supervisorEmail || "").toLowerCase()) ||
      null;

    return {
      roleView: "field_worker",
      actor: toAssignmentUser(actor, actorUid),
      supervisor
    };
  }

  if (actorRole === "field_supervisor") {
    const myWorkers = allWorkers.filter((worker) => {
      const matchById = worker.supervisorId && worker.supervisorId === actorUid;
      const matchByEmail =
        worker.supervisorEmail &&
        String(worker.supervisorEmail).toLowerCase() === actorEmail;

      return matchById || matchByEmail;
    });

    return {
      roleView: "field_supervisor",
      actor: toAssignmentUser(actor, actorUid),
      workers: myWorkers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "")),
      supervisors: [
        {
          ...toAssignmentUser(actor, actorUid)
        }
      ]
    };
  }

  if (["field_headquarters", "administrator", "developer"].includes(actorRole)) {
    let visibleSupervisors = allSupervisors;
    let visibleWorkers = allWorkers;

    if (actorRole === "field_headquarters") {
      visibleSupervisors = allSupervisors.filter((supervisor) =>
        hasSharedProject(actorProjects, supervisor.assignedProjects)
      );

      const allowedSupervisorIds = new Set(visibleSupervisors.map((item) => item.uid));
      const allowedSupervisorEmails = new Set(
        visibleSupervisors.map((item) => String(item.email || "").toLowerCase())
      );

      visibleWorkers = allWorkers.filter((worker) => {
        const projectMatch = hasSharedProject(actorProjects, worker.assignedProjects);
        const supervisorMatch =
          allowedSupervisorIds.has(worker.supervisorId) ||
          allowedSupervisorEmails.has(String(worker.supervisorEmail || "").toLowerCase());

        return projectMatch || supervisorMatch;
      });
    }

    visibleSupervisors = visibleSupervisors.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    visibleWorkers = visibleWorkers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

    return {
      roleView: "leadership",
      actor: toAssignmentUser(actor, actorUid),
      supervisors: visibleSupervisors,
      workers: visibleWorkers
    };
  }

  return {
    roleView: "basic",
    actor: toAssignmentUser(actor, actorUid),
    supervisors: [],
    workers: []
  };
});

/* ========================================================================== */
/* Physio-HeMAB WP2 native dashboard                                         */
/* ========================================================================== */

const PHYSIO_HEMAB_PROJECT_CODE = "physio-hemab-wp2";
const PHYSIO_HEMAB_MAIN_PID = 410;
const PHYSIO_HEMAB_DEVICES_PID = 411;
const PHYSIO_HEMAB_CACHE_TTL_MS = 60 * 1000;

let physioHemabDashboardCache = {
  expiresAt: 0,
  payload: null
};

const PHYSIO_HEMAB_MAIN_FIELDS = [
  "record_id",
  "health_facility_enrollment",
  "enroll_studid",
  "enroll_registr_date",
  "data_collector",
  "enrollment_form_complete",
  "maternal_record_book_baseline_complete",
  "crf_date",
  "crf_facility",
  "crf_examiner",
  "physical_examination_form_complete",
  "ad_date",
  "call_date",
  "call_date_delay",
  "ad_call_numb",
  "activity_diary_complete"
];

const PHYSIO_HEMAB_DEVICE_FIELDS = [
  "record_id",
  "devices_date",
  "distribution_log_complete",
  "devices_war",
  "devices_paga",
  "devices_pungu",
  "devices_sirigu",
  "study_id_a1",
  "study_id_a2",
  "study_id_a3",
  "study_id_a4",
  "study_id_a5",
  "study_id_b1",
  "study_id_b2",
  "study_id_b3",
  "study_id_b4",
  "study_id_b5",
  "study_id_paga_a1",
  "study_id_paga_a2",
  "study_id_paga_a3",
  "study_id_paga_a4",
  "study_id_paga_a5",
  "study_id_paga_b1",
  "study_id_paga_b2",
  "study_id_paga_b3",
  "study_id_paga_b4",
  "study_id_paga_b5",
  "study_id_pungu_a1",
  "study_id_pungu_a2",
  "study_id_pungu_a3",
  "study_id_pungu_a4",
  "study_id_pungu_a5",
  "study_id_pungu_b1",
  "study_id_pungu_b2",
  "study_id_pungu_b3",
  "study_id_pungu_b4",
  "study_id_pungu_b5",
  "study_id_sirigu_a1",
  "study_id_sirigu_a2",
  "study_id_sirigu_a3",
  "study_id_sirigu_a4",
  "study_id_sirigu_a5",
  "study_id_sirigu_b",
  "study_id_sirigu_b2",
  "study_id_sirigu_b3",
  "study_id_sirigu_b4",
  "study_id_sirigu_b5",
  "date_devices_return",
  "devices_return",
  "return_log_complete",
  "set_a1",
  "set_a2",
  "set_a3",
  "set_a4",
  "set_a5",
  "set_b1",
  "set_b2",
  "set_b3",
  "set_b4",
  "set_b5"
];

async function requirePhysioHemabProjectAccess(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const userSnap = await db.collection("users").doc(request.auth.uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "User profile not found.");
  }

  const user = userSnap.data() || {};
  if (user.isDeleted === true || user.isActive === false) {
    throw new HttpsError("permission-denied", "Your dashboard account is not active.");
  }

  const role = String(user.role || "").trim();
  const projects = normalizeProjectCodes(user.assignedProjects);
  const privileged = ["administrator", "developer"].includes(role);

  if (!privileged && !projects.includes(PHYSIO_HEMAB_PROJECT_CODE)) {
    throw new HttpsError(
      "permission-denied",
      "You are not assigned to the Physio-HeMAB WP2 project."
    );
  }

  return {
    uid: request.auth.uid,
    email: user.email || request.auth.token.email || "",
    role,
    assignedProjects: projects
  };
}

function physioParseChoices(raw = "") {
  const result = {};
  String(raw || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const comma = item.indexOf(",");
      if (comma < 0) return;
      const code = item.slice(0, comma).trim();
      const label = item.slice(comma + 1).trim();
      if (code) result[code] = label;
    });
  return result;
}

function physioMetadataMap(metadata = []) {
  const map = new Map();
  for (const field of metadata) {
    const name = String(field?.field_name || "").trim();
    if (!name) continue;
    map.set(name, {
      ...field,
      choices: physioParseChoices(field?.select_choices_or_calculations || "")
    });
  }
  return map;
}

function physioChoiceLabel(metadataMap, fieldName, code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  return metadataMap.get(fieldName)?.choices?.[raw] || raw;
}

function physioCanonicalFacility(value = "") {
  const label = String(value || "").trim();
  if (!label) return "";

  const aliases = {
    "Paga Hospital": "Paga District Hospital",
    "Paga District Hospital": "Paga District Hospital",
    "Pungu Central": "Pungu Central",
    "War Memorial Hospital": "War Memorial Hospital",
    "Martiers of Uganda Health Centre Sirigu": "Martyrs of Uganda Health Centre, Sirigu",
    "Martyrs of Uganda Health Centre, Sirigu": "Martyrs of Uganda Health Centre, Sirigu"
  };

  return aliases[label] || label;
}

function physioDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}

function physioDateValue(value) {
  const dateOnly = physioDateOnly(value);
  if (!dateOnly) return null;
  const ms = Date.parse(`${dateOnly}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function physioDateDiffDays(start, end) {
  const a = physioDateValue(start);
  const b = physioDateValue(end);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

function physioNumericFromChoice(labelOrCode) {
  const match = String(labelOrCode || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

async function physioRedcapPost(apiUrl, token, payload = {}) {
  const body = new URLSearchParams();
  body.set("token", token);
  body.set("format", "json");
  body.set("returnFormat", "json");

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.set(key, String(value));
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`REDCap returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (data && !Array.isArray(data) && data.error) {
    throw new Error(String(data.error));
  }

  return data;
}

async function physioFetchRedcapProject(apiUrl, token, fields) {
  const metadataPromise = physioRedcapPost(apiUrl, token, {
    content: "metadata"
  });

  const recordsPayload = {
    content: "record",
    type: "flat",
    rawOrLabel: "raw",
    rawOrLabelHeaders: "raw",
    exportCheckboxLabel: "false",
    exportSurveyFields: "false",
    exportDataAccessGroups: "false"
  };

  fields.forEach((field, index) => {
    recordsPayload[`fields[${index}]`] = field;
  });

  const recordsPromise = physioRedcapPost(apiUrl, token, recordsPayload);
  const [metadata, records] = await Promise.all([metadataPromise, recordsPromise]);

  if (!Array.isArray(metadata) || !Array.isArray(records)) {
    throw new Error("Unexpected REDCap API response.");
  }

  return { metadata, records };
}

function physioStudyFieldForDevice(facilityKey, deviceSet) {
  const suffix = String(deviceSet || "").toLowerCase();
  if (facilityKey === "war") return `study_id_${suffix}`;
  if (facilityKey === "paga") return `study_id_paga_${suffix}`;
  if (facilityKey === "pungu") return `study_id_pungu_${suffix}`;
  if (facilityKey === "sirigu" && suffix === "b1") return "study_id_sirigu_b";
  if (facilityKey === "sirigu") return `study_id_sirigu_${suffix}`;
  return "";
}

function physioBuildMainPayload(projectData) {
  if (!projectData) {
    return {
      participants: [],
      activityDiaries: []
    };
  }

  const metadataMap = physioMetadataMap(projectData.metadata);
  const participantsByRecord = new Map();
  const participants = [];

  for (const row of projectData.records) {
    const repeatInstrument = String(row.redcap_repeat_instrument || "").trim();
    if (repeatInstrument) continue;

    const recordId = String(row.record_id || "").trim();
    if (!recordId) continue;

    const facility = physioCanonicalFacility(
      physioChoiceLabel(
        metadataMap,
        "health_facility_enrollment",
        row.health_facility_enrollment
      )
    );

    const dataCollector = physioChoiceLabel(
      metadataMap,
      "data_collector",
      row.data_collector
    );

    const participant = {
      studyId: String(row.enroll_studid || "").trim(),
      facility,
      enrollmentDate: physioDateOnly(row.enroll_registr_date),
      dataCollector: dataCollector || "Unassigned",
      enrollmentComplete: String(row.enrollment_form_complete || "") === "2",
      maternalRecordComplete:
        String(row.maternal_record_book_baseline_complete || "") === "2",
      physicalExamComplete:
        String(row.physical_examination_form_complete || "") === "2",
      physicalExamDate: physioDateOnly(row.crf_date),
      physicalExamFacility: physioCanonicalFacility(
        physioChoiceLabel(metadataMap, "crf_facility", row.crf_facility)
      ),
      physicalExaminer: String(row.crf_examiner || "").trim()
    };

    participantsByRecord.set(recordId, participant);
    participants.push(participant);
  }

  const activityDiaries = [];
  for (const row of projectData.records) {
    if (String(row.redcap_repeat_instrument || "").trim() !== "activity_diary") {
      continue;
    }

    const recordId = String(row.record_id || "").trim();
    const participant = participantsByRecord.get(recordId) || {};
    const sameDayInterview = physioChoiceLabel(
      metadataMap,
      "call_date",
      row.call_date
    );
    const callLabel = physioChoiceLabel(
      metadataMap,
      "ad_call_numb",
      row.ad_call_numb
    );

    const diaryDate = physioDateOnly(row.ad_date);
    const interviewDate = physioDateOnly(row.call_date_delay);
    let delayDays = null;

    if (sameDayInterview === "Yes") {
      delayDays = 0;
    } else if (diaryDate && interviewDate) {
      delayDays = physioDateDiffDays(diaryDate, interviewDate);
    }

    activityDiaries.push({
      studyId: participant.studyId || "",
      facility: participant.facility || "",
      dataCollector: participant.dataCollector || "Unassigned",
      diaryInstance: Number(row.redcap_repeat_instance || 0) || null,
      diaryDate,
      sameDayInterview,
      interviewDate,
      delayDays,
      callsMade: physioNumericFromChoice(callLabel),
      diaryComplete: String(row.activity_diary_complete || "") === "2"
    });
  }

  return { participants, activityDiaries };
}

function physioBuildDevicePayload(projectData) {
  if (!projectData) {
    return {
      deviceDistributions: [],
      deviceReturns: [],
      deviceSets: []
    };
  }

  const metadataMap = physioMetadataMap(projectData.metadata);

  const facilityMappings = [
    {
      key: "war",
      field: "devices_war",
      facility: "War Memorial Hospital"
    },
    {
      key: "paga",
      field: "devices_paga",
      facility: "Paga District Hospital"
    },
    {
      key: "pungu",
      field: "devices_pungu",
      facility: "Pungu Central"
    },
    {
      key: "sirigu",
      field: "devices_sirigu",
      facility: "Martyrs of Uganda Health Centre, Sirigu"
    }
  ];

  const deviceDistributions = [];
  const deviceReturns = [];

  for (const row of projectData.records) {
    const instrument = String(row.redcap_repeat_instrument || "").trim();

    if (instrument === "distribution_log") {
      for (const mapping of facilityMappings) {
        const choices = metadataMap.get(mapping.field)?.choices || {};
        for (const [code, deviceSet] of Object.entries(choices)) {
          if (String(row[`${mapping.field}___${code}`] || "") !== "1") {
            continue;
          }

          const studyField = physioStudyFieldForDevice(mapping.key, deviceSet);
          deviceDistributions.push({
            distributionDate: physioDateOnly(row.devices_date),
            distributionInstance:
              Number(row.redcap_repeat_instance || 0) || null,
            facility: mapping.facility,
            deviceSet,
            studyId: studyField ? String(row[studyField] || "").trim() : "",
            formComplete:
              String(row.distribution_log_complete || "") === "2"
          });
        }
      }
    }

    if (instrument === "return_log") {
      const returnedChoices = metadataMap.get("devices_return")?.choices || {};
      for (const [code, deviceSet] of Object.entries(returnedChoices)) {
        if (String(row[`devices_return___${code}`] || "") !== "1") {
          continue;
        }

        const componentField = `set_${String(deviceSet || "").toLowerCase()}`;
        const components = metadataMap.get(componentField)?.choices || {};
        let componentsReturned = 0;

        for (const componentCode of Object.keys(components)) {
          if (String(row[`${componentField}___${componentCode}`] || "") === "1") {
            componentsReturned += 1;
          }
        }

        const componentsExpected = Object.keys(components).length;

        deviceReturns.push({
          returnDate: physioDateOnly(row.date_devices_return),
          returnInstance: Number(row.redcap_repeat_instance || 0) || null,
          deviceSet,
          componentsReturned,
          componentsExpected,
          allComponentsReturned:
            componentsExpected > 0 && componentsReturned === componentsExpected,
          formComplete: String(row.return_log_complete || "") === "2"
        });
      }
    }
  }

  const deviceSetNames = new Set();
  deviceDistributions.forEach((row) => deviceSetNames.add(row.deviceSet));
  deviceReturns.forEach((row) => deviceSetNames.add(row.deviceSet));

  function latestByDate(rows, dateField, instanceField) {
    return [...rows].sort((a, b) => {
      const aDate = physioDateValue(a[dateField]) ?? -1;
      const bDate = physioDateValue(b[dateField]) ?? -1;
      if (aDate !== bDate) return bDate - aDate;
      return Number(b[instanceField] || 0) - Number(a[instanceField] || 0);
    })[0] || null;
  }

  const deviceSets = [...deviceSetNames]
    .sort()
    .map((deviceSet) => {
      const distribution = latestByDate(
        deviceDistributions.filter((row) => row.deviceSet === deviceSet),
        "distributionDate",
        "distributionInstance"
      );
      const returned = latestByDate(
        deviceReturns.filter((row) => row.deviceSet === deviceSet),
        "returnDate",
        "returnInstance"
      );

      const distributionMs = physioDateValue(distribution?.distributionDate);
      const returnMs = physioDateValue(returned?.returnDate);

      let currentStatus = "Unknown";
      if (distributionMs === null && returnMs !== null) {
        currentStatus = "Returned";
      } else if (
        distributionMs !== null &&
        (returnMs === null || distributionMs > returnMs)
      ) {
        currentStatus = "Distributed";
      } else if (
        distributionMs !== null &&
        returnMs !== null &&
        returnMs >= distributionMs
      ) {
        currentStatus = "Returned";
      }

      return {
        deviceSet,
        latestDistributionDate: distribution?.distributionDate || "",
        latestFacility: distribution?.facility || "",
        latestStudyId: distribution?.studyId || "",
        latestReturnDate: returned?.returnDate || "",
        componentsReturned: returned?.componentsReturned ?? null,
        componentsExpected: returned?.componentsExpected ?? null,
        allComponentsReturned: returned?.allComponentsReturned ?? null,
        currentStatus
      };
    });

  return {
    deviceDistributions,
    deviceReturns,
    deviceSets
  };
}

function physioSanitizeFacilityTargets(rawTargets = {}) {
  const result = {};
  if (!rawTargets || typeof rawTargets !== "object" || Array.isArray(rawTargets)) {
    return result;
  }

  for (const [facility, raw] of Object.entries(rawTargets)) {
    if (!raw || typeof raw !== "object") continue;
    const target = Number(raw.target);
    const arm = String(raw.arm || "").trim();
    result[facility] = {
      arm,
      target: Number.isFinite(target) && target > 0 ? Math.round(target) : null
    };
  }

  return result;
}

async function physioProjectConfiguration() {
  const projectSnap = await db.collection("projects").doc(PHYSIO_HEMAB_PROJECT_CODE).get();
  const project = projectSnap.exists ? projectSnap.data() || {} : {};
  const wp2Config = project.wp2Config || {};

  const participantTarget = Number(wp2Config.participantTarget);
  const diariesExpected = Number(wp2Config.activityDiariesExpectedPerParticipant);
  const returnWindowDays = Number(wp2Config.returnWindowDays);

  return {
    participantTarget:
      Number.isFinite(participantTarget) && participantTarget > 0
        ? Math.round(participantTarget)
        : 200,
    activityDiariesExpectedPerParticipant:
      Number.isFinite(diariesExpected) && diariesExpected > 0
        ? Math.round(diariesExpected)
        : 6,
    facilityTargets: physioSanitizeFacilityTargets(wp2Config.facilityTargets),
    returnWindowDays:
      Number.isFinite(returnWindowDays) && returnWindowDays > 0
        ? Math.round(returnWindowDays)
        : null,
    returnWindowOptions: [1, 2, 3, 5, 7, 10, 14]
  };
}

async function physioBuildDashboardPayload({ apiUrl, mainToken, devicesToken }) {
  const normalizedApiUrl = String(apiUrl || "").trim().replace(/\/+$/, "") + "/";
  const fetchedAt = new Date().toISOString();

  const [mainResult, devicesResult, config] = await Promise.all([
    physioFetchRedcapProject(
      normalizedApiUrl,
      mainToken,
      PHYSIO_HEMAB_MAIN_FIELDS
    ).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    ),
    physioFetchRedcapProject(
      normalizedApiUrl,
      devicesToken,
      PHYSIO_HEMAB_DEVICE_FIELDS
    ).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    ),
    physioProjectConfiguration()
  ]);

  if (!mainResult.ok && !devicesResult.ok) {
    logger.error("Both Physio-HeMAB REDCap sources failed", {
      main: mainResult.error?.message || String(mainResult.error),
      devices: devicesResult.error?.message || String(devicesResult.error)
    });
    throw new HttpsError(
      "unavailable",
      "The Physio-HeMAB data sources could not be reached."
    );
  }

  const mainPayload = physioBuildMainPayload(mainResult.ok ? mainResult.value : null);
  const devicePayload = physioBuildDevicePayload(
    devicesResult.ok ? devicesResult.value : null
  );

  return {
    projectCode: PHYSIO_HEMAB_PROJECT_CODE,
    fetchedAt,
    sourceStatus: {
      main: {
        pid: PHYSIO_HEMAB_MAIN_PID,
        status: mainResult.ok ? "success" : "error",
        message: mainResult.ok ? "" : "Main REDCap source unavailable"
      },
      devices: {
        pid: PHYSIO_HEMAB_DEVICES_PID,
        status: devicesResult.ok ? "success" : "error",
        message: devicesResult.ok ? "" : "Devices REDCap source unavailable"
      }
    },
    config,
    participants: mainPayload.participants,
    activityDiaries: mainPayload.activityDiaries,
    deviceDistributions: devicePayload.deviceDistributions,
    deviceReturns: devicePayload.deviceReturns,
    deviceSets: devicePayload.deviceSets
  };
}

exports.getPhysioHemabWp2Dashboard = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "512MiB",
    secrets: [
      PHYSIO_HEMAB_REDCAP_API_URL,
      PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN,
      PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN
    ]
  },
  async (request) => {
    const actor = await requirePhysioHemabProjectAccess(request);
    const forceRefresh = request.data?.forceRefresh === true;
    const now = Date.now();

    if (
      !forceRefresh &&
      physioHemabDashboardCache.payload &&
      physioHemabDashboardCache.expiresAt > now
    ) {
      return {
        ...physioHemabDashboardCache.payload,
        cacheHit: true
      };
    }

    try {
      const payload = await physioBuildDashboardPayload({
        apiUrl: PHYSIO_HEMAB_REDCAP_API_URL.value(),
        mainToken: PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN.value(),
        devicesToken: PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN.value()
      });

      physioHemabDashboardCache = {
        payload,
        expiresAt: now + PHYSIO_HEMAB_CACHE_TTL_MS
      };

      logger.info("Physio-HeMAB WP2 dashboard data served", {
        actorUid: actor.uid,
        actorRole: actor.role,
        participants: payload.participants.length,
        activityDiaries: payload.activityDiaries.length,
        deviceSets: payload.deviceSets.length
      });

      return {
        ...payload,
        cacheHit: false
      };
    } catch (error) {
      logger.error("getPhysioHemabWp2Dashboard failed", {
        actorUid: actor.uid,
        message: error?.message || String(error)
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Unable to load the Physio-HeMAB WP2 dashboard."
      );
    }
  }
);
