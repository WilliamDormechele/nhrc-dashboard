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

const APP_BASE_URL = "https://williamdormechele.github.io/nhrc-dashboard/";
const LOGIN_URL = APP_BASE_URL;
const SENDER_NAME = "NHRC Projects Dashboard";

const RESEND_SENDER_EMAIL = "onboarding@resend.dev";

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

  params.set("fromReset", "1");

  return {
    url: `${APP_BASE_URL}?${params.toString()}`,
    handleCodeInApp: false
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

function buildEmailShell({ title, greeting, introHtml, detailsHtml, actionsHtml, footerNoteHtml = "" }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:700px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="background:#0f2744;color:#ffffff;padding:22px 24px;">
          <div style="font-size:24px;font-weight:700;">NHRC Projects Dashboard</div>
          <div style="font-size:14px;opacity:0.95;margin-top:4px;">Secure dashboard access by project, role, and privilege</div>
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
    resetLink = await admin.auth().generatePasswordResetLink(
      user.email,
      buildPasswordResetActionCodeSettings(user.email)
    );
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