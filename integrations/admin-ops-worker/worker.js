const APP_BASE_URL = "https://nhrc-dashboard.web.app/";
const PROJECT_CODE = "nhrc-dashboard";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

let cachedGoogleAccessToken = "";
let cachedGoogleAccessTokenExpiresAt = 0;

function corsHeaders(origin, env) {
  const headers = { ...JSON_HEADERS };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  return headers;
}

function json(status, body, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, env)
  });
}

function firestoreString(field) {
  return field?.stringValue || "";
}

function firestoreBoolean(field, fallback = true) {
  return typeof field?.booleanValue === "boolean" ? field.booleanValue : fallback;
}

function firestoreStringArray(field) {
  return (field?.arrayValue?.values || [])
    .map((value) => value?.stringValue || "")
    .filter(Boolean);
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values || []).map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    const fields = value.mapValue?.fields || {};
    return Object.fromEntries(
      Object.entries(fields).map(([key, item]) => [key, fromFirestoreValue(item)])
    );
  }
  return null;
}

function fromFirestoreDocument(document) {
  const fields = document?.fields || {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreValue)
      }
    };
  }

  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])
        )
      }
    };
  }

  return { stringValue: String(value) };
}

function toFirestoreFields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)])
  );
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlFromString(value) {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function getGoogleAccessToken(env) {
  if (
    cachedGoogleAccessToken &&
    Date.now() < cachedGoogleAccessTokenExpiresAt - 60_000
  ) {
    return cachedGoogleAccessToken;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("SERVICE_ACCOUNT_NOT_CONFIGURED");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (error) {
    throw new Error("SERVICE_ACCOUNT_INVALID");
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("SERVICE_ACCOUNT_INVALID");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsigned =
    `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const assertion = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!tokenResponse.ok) {
    console.error("Google OAuth token exchange failed", tokenResponse.status);
    throw new Error("GOOGLE_AUTH_FAILED");
  }

  const tokenData = await tokenResponse.json();
  cachedGoogleAccessToken = tokenData.access_token || "";
  cachedGoogleAccessTokenExpiresAt =
    Date.now() + Number(tokenData.expires_in || 3600) * 1000;

  if (!cachedGoogleAccessToken) {
    throw new Error("GOOGLE_AUTH_FAILED");
  }

  return cachedGoogleAccessToken;
}

function firestoreDocumentUrl(env, path) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    env.FIREBASE_PROJECT_ID
  )}/databases/(default)/documents/${path}`;
}

async function fetchFirestoreDocument(env, path, accessToken) {
  const response = await fetch(firestoreDocumentUrl(env, path), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    console.error("Firestore read failed", response.status, path);
    throw new Error("FIRESTORE_READ_FAILED");
  }

  return response.json();
}

async function patchFirestoreDocument(env, path, data, accessToken) {
  const fieldNames = Object.keys(data);
  const updateMask = fieldNames
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");

  const response = await fetch(
    `${firestoreDocumentUrl(env, path)}?${updateMask}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: toFirestoreFields(data)
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error("Firestore patch failed", response.status, path, body.slice(0, 500));
    throw new Error("FIRESTORE_WRITE_FAILED");
  }

  return response.json();
}

async function safePatchMonitoringDirectory(env, userId, data, accessToken) {
  try {
    await patchFirestoreDocument(
      env,
      `monitoring_directory/${encodeURIComponent(userId)}`,
      data,
      accessToken
    );
  } catch (error) {
    console.warn(
      "Monitoring directory sync failed; core user operation will continue.",
      userId,
      error?.message || error
    );
  }
}

async function createFirestoreDocument(env, collectionPath, data, accessToken) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      env.FIREBASE_PROJECT_ID
    )}/databases/(default)/documents/${collectionPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: toFirestoreFields(data)
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error("Firestore create failed", response.status, collectionPath, body.slice(0, 500));
    throw new Error("FIRESTORE_WRITE_FAILED");
  }

  return response.json();
}

async function deleteFirestoreDocument(env, path, accessToken) {
  const response = await fetch(firestoreDocumentUrl(env, path), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok && response.status !== 404) {
    console.error("Firestore delete failed", response.status, path);
    throw new Error("FIRESTORE_WRITE_FAILED");
  }
}

async function authenticateAdmin(idToken, env) {
  const authResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      env.FIREBASE_API_KEY
    )}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ idToken })
    }
  );

  if (!authResponse.ok) {
    throw new Error("AUTH_INVALID");
  }

  const authData = await authResponse.json();
  const firebaseUser = authData?.users?.[0];

  if (!firebaseUser?.localId) {
    throw new Error("AUTH_INVALID");
  }

  const profileResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      env.FIREBASE_PROJECT_ID
    )}/databases/(default)/documents/users/${encodeURIComponent(firebaseUser.localId)}`,
    {
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    }
  );

  if (!profileResponse.ok) {
    throw new Error("PROFILE_UNAVAILABLE");
  }

  const profileDocument = await profileResponse.json();
  const fields = profileDocument?.fields || {};

  const role = firestoreString(fields.role).trim().toLowerCase();
  const isActive = firestoreBoolean(fields.isActive, true);
  const isDeleted = firestoreBoolean(fields.isDeleted, false);
  const roleAccess = fromFirestoreValue(fields.roleAccess) || {};
  const hasAdminAccess =
    ["administrator", "developer"].includes(role) ||
    roleAccess?.admin === true;

  if (!isActive || isDeleted || !hasAdminAccess) {
    throw new Error("FORBIDDEN");
  }

  return {
    uid: firebaseUser.localId,
    email: firestoreString(fields.email) || firebaseUser.email || "",
    fullName: firestoreString(fields.fullName) || firebaseUser.email || "Administrator",
    role
  };
}

async function updateFirebaseAuthState(env, userId, disabled, accessToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
      env.FIREBASE_PROJECT_ID
    )}/accounts:update`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        localId: userId,
        disableUser: disabled
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error("Firebase Auth update failed", response.status, body.slice(0, 500));
    throw new Error("AUTH_ADMIN_UPDATE_FAILED");
  }

  return response.json();
}

async function deleteFirebaseAuthUser(env, userId, accessToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
      env.FIREBASE_PROJECT_ID
    )}/accounts:delete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        localId: userId
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error("Firebase Auth delete failed", response.status, body.slice(0, 500));
    throw new Error("AUTH_ADMIN_DELETE_FAILED");
  }
}

async function generatePasswordResetLink(env, email, accessToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
      env.FIREBASE_PROJECT_ID
    )}/accounts:sendOobCode`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        continueUrl: APP_BASE_URL,
        returnOobLink: true
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error("Password reset link generation failed", response.status, body.slice(0, 500));
    throw new Error("PASSWORD_RESET_LINK_FAILED");
  }

  const data = await response.json();
  if (!data?.oobLink) {
    throw new Error("PASSWORD_RESET_LINK_FAILED");
  }

  return convertFirebaseActionLinkToCustomHandler(data.oobLink, email);
}

function convertFirebaseActionLinkToCustomHandler(firebaseLink, email = "") {
  const sourceUrl = new URL(firebaseLink);
  const targetUrl = new URL(APP_BASE_URL);

  const mode = sourceUrl.searchParams.get("mode") || "resetPassword";
  const oobCode = sourceUrl.searchParams.get("oobCode") || "";
  const apiKey = sourceUrl.searchParams.get("apiKey") || "";
  const lang = sourceUrl.searchParams.get("lang") || "";

  targetUrl.searchParams.set("mode", mode);

  if (oobCode) targetUrl.searchParams.set("oobCode", oobCode);
  if (apiKey) targetUrl.searchParams.set("apiKey", apiKey);
  if (lang) targetUrl.searchParams.set("lang", lang);
  if (email) targetUrl.searchParams.set("prefillEmail", email);

  targetUrl.searchParams.set("fromReset", "1");

  return targetUrl.toString();
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
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildPrimaryButton(label, href, background = "#1d4ed8") {
  if (!href) return "";
  return `
    <a href="${escapeHtml(href)}" style="
      display:inline-block;
      padding:12px 18px;
      margin-right:10px;
      margin-bottom:10px;
      background:${background};
      color:#ffffff;
      text-decoration:none;
      border-radius:8px;
      font-weight:600;
    ">${escapeHtml(label)}</a>
  `;
}

function buildProjectListHtml(projectNames = []) {
  if (!projectNames.length) {
    return '<p style="margin:8px 0 0;color:#475569;">No projects assigned.</p>';
  }

  return `
    <ul style="margin:8px 0 0 18px;padding:0;color:#1e293b;">
      ${projectNames
        .map((name) => `<li style="margin:4px 0;">${escapeHtml(name)}</li>`)
        .join("")}
    </ul>
  `;
}

function buildEmailShell({
  title,
  greeting,
  introHtml,
  detailsHtml,
  actionsHtml,
  footerNoteHtml = ""
}) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:700px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="background:#0f2744;color:#ffffff;padding:22px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="width:72px;vertical-align:middle;">
                <img
                  src="${APP_BASE_URL}images/nhrc-logo.png"
                  alt="NHRC Logo"
                  style="display:block;width:58px;height:58px;object-fit:contain;border-radius:10px;background:#ffffff;padding:4px;"
                />
              </td>
              <td style="vertical-align:middle;">
                <div style="font-size:24px;font-weight:700;">NHRC Projects Dashboard</div>
                <div style="font-size:14px;opacity:0.95;margin-top:4px;">
                  Access by project, role and privilege
                </div>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:24px;">
          <h2 style="margin:0 0 12px;color:#0f172a;">${escapeHtml(title)}</h2>
          <p style="margin:0 0 12px;color:#1e293b;">${greeting}</p>
          ${introHtml}
          ${detailsHtml}
          <div style="margin-top:22px;">${actionsHtml}</div>
          ${footerNoteHtml}
          <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#334155;font-size:14px;line-height:1.6;">
            <strong>William Dormechele</strong><br>
            Data Manager/Analyst/SysDev<br>
            Navrongo Health Research Centre<br>
            william.dormechele@navrongo-hrc.org
          </div>
        </div>
      </div>
    </div>
  `;
}

async function getProjectDisplayNames(env, projectCodes, accessToken) {
  const codes = Array.isArray(projectCodes) ? projectCodes : [];

  const names = await Promise.all(
    codes.map(async (code) => {
      const document = await fetchFirestoreDocument(
        env,
        `projects/${encodeURIComponent(code)}`,
        accessToken
      );

      const data = document ? fromFirestoreDocument(document) : {};
      return data.name || titleCaseWords(code);
    })
  );

  return names;
}

async function sendViaResend(env, toEmail, subject, html) {
  if (!env.RESEND_API_KEY) {
    throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `NHRC Projects Dashboard <${env.RESEND_FROM_EMAIL || "noreply@navrongo-hrc.org"}>`,
      to: [toEmail],
      subject,
      html
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Resend send failed", response.status, data);
    throw new Error("EMAIL_SEND_FAILED");
  }

  return {
    provider: "resend",
    messageId: data?.id || ""
  };
}

async function sendLifecycleEmail(env, targetUser, eventType, actor, context, accessToken) {
  const projectNames = await getProjectDisplayNames(
    env,
    targetUser.assignedProjects || [],
    accessToken
  );
  const projectListHtml = buildProjectListHtml(projectNames);
  const loginButton = buildPrimaryButton("Open NHRC Dashboard", APP_BASE_URL, "#0f766e");

  let subject = "";
  let title = "";
  let introHtml = "";
  let detailsHtml = "";
  let actionsHtml = loginButton;
  let footerNoteHtml = "";

  if (eventType === "created") {
    const resetLink = await generatePasswordResetLink(
      env,
      targetUser.email,
      accessToken
    );

    subject = "Your NHRC Projects Dashboard account has been created";
    title = "Account created";
    introHtml = `
      <p style="margin:0 0 16px;color:#334155;">
        Your NHRC Projects Dashboard account has been created. Use the button below to set your password, then sign in to access your assigned projects.
      </p>
    `;
    detailsHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(targetUser.fullName || "User")}</p>
        <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(targetUser.email || "")}</p>
        <p style="margin:0 0 8px;"><strong>Role:</strong> ${escapeHtml(titleCaseWords(targetUser.role || ""))}</p>
        <p style="margin:0 0 8px;"><strong>Supervisor:</strong> ${escapeHtml(targetUser.supervisorName || targetUser.supervisorEmail || "Not assigned")}</p>
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
    const resetLink = await generatePasswordResetLink(
      env,
      targetUser.email,
      accessToken
    );

    subject = "Reset your NHRC Projects Dashboard password";
    title = "Password reset";
    introHtml = `
      <p style="margin:0 0 16px;color:#334155;">
        A password reset has been requested for your NHRC Projects Dashboard account.
      </p>
    `;
    detailsHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(targetUser.fullName || "User")}</p>
        <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(targetUser.email || "")}</p>
        <div style="margin-top:10px;"><strong>Assigned projects:</strong>${projectListHtml}</div>
      </div>
    `;
    actionsHtml =
      buildPrimaryButton("Reset Your Password", resetLink, "#1d4ed8") +
      loginButton;
  } else if (eventType === "role_updated") {
    const previousProjects = Array.isArray(context?.previousProjects)
      ? context.previousProjects
      : [];
    const previousProjectNames = await getProjectDisplayNames(
      env,
      previousProjects,
      accessToken
    );

    subject = "Your NHRC Projects Dashboard access has been updated";
    title = "Access updated";
    introHtml = `
      <p style="margin:0 0 16px;color:#334155;">
        Your dashboard access details have been updated. Please review the current role and project assignments below.
      </p>
    `;
    detailsHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(targetUser.fullName || "User")}</p>
        <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(targetUser.email || "")}</p>
        <p style="margin:0 0 8px;"><strong>Previous role:</strong> ${escapeHtml(titleCaseWords(context?.previousRole || "Not set"))}</p>
        <p style="margin:0 0 8px;"><strong>Current role:</strong> ${escapeHtml(titleCaseWords(targetUser.role || ""))}</p>
        <p style="margin:0 0 8px;"><strong>Previous access:</strong> ${typeof context?.previousIsActive === "boolean" ? (context.previousIsActive ? "Active" : "Inactive") : "Not available"}</p>
        <p style="margin:0 0 8px;"><strong>Current access:</strong> ${targetUser.isActive === true ? "Active" : "Inactive"}</p>
        <div style="margin-top:10px;"><strong>Previous projects:</strong>${buildProjectListHtml(previousProjectNames)}</div>
        <div style="margin-top:10px;"><strong>Current projects:</strong>${projectListHtml}</div>
      </div>
    `;
    footerNoteHtml = `
      <p style="margin-top:18px;color:#475569;font-size:14px;">
        This access update was made by ${escapeHtml(actor.fullName || actor.email || "the administrator")}.
      </p>
    `;
  } else {
    throw new Error("UNSUPPORTED_EMAIL_EVENT");
  }

  const html = buildEmailShell({
    title,
    greeting: `Hello ${escapeHtml(targetUser.fullName || "User")},`,
    introHtml,
    detailsHtml,
    actionsHtml,
    footerNoteHtml
  });

  return sendViaResend(env, targetUser.email, subject, html);
}

async function writeAdminAudit(env, actor, action, targetUserId, before, after, note, accessToken) {
  await createFirestoreDocument(
    env,
    "admin_audit_logs",
    {
      action,
      actorUid: actor.uid,
      actorEmail: actor.email || "",
      actorName: actor.fullName || "",
      targetUserId,
      targetEmail: before?.email || after?.email || "",
      targetName: before?.fullName || after?.fullName || "",
      note: note || "",
      before: before || null,
      after: after || null,
      createdAt: new Date()
    },
    accessToken
  );
}

async function getTargetUser(env, userId, accessToken) {
  const document = await fetchFirestoreDocument(
    env,
    `users/${encodeURIComponent(userId)}`,
    accessToken
  );

  if (!document) {
    throw new Error("TARGET_NOT_FOUND");
  }

  return fromFirestoreDocument(document);
}

async function handleSetActive(env, actor, payload, accessToken) {
  const userId = String(payload?.userId || "").trim();
  const isActive = payload?.isActive;

  if (!userId || typeof isActive !== "boolean") {
    throw new Error("INVALID_ARGUMENT");
  }

  if (!isActive && actor.uid === userId) {
    throw new Error("SELF_DEACTIVATE_BLOCKED");
  }

  const before = await getTargetUser(env, userId, accessToken);

  await updateFirebaseAuthState(env, userId, !isActive, accessToken);

  const now = new Date();
  const userUpdate = {
    isActive,
    updatedAt: now,
    updatedBy: actor.email || actor.uid
  };

  if (isActive) {
    Object.assign(userUpdate, {
      isDeleted: false,
      deleteReason: "",
      deletedAt: null,
      deletedBy: null,
      restoredAt: now,
      restoredBy: actor.email || actor.uid
    });
  }

  await patchFirestoreDocument(
    env,
    `users/${encodeURIComponent(userId)}`,
    userUpdate,
    accessToken
  );

  await safePatchMonitoringDirectory(
    env,
    userId,
    {
      isActive,
      isDeleted: isActive ? false : before.isDeleted === true,
      updatedAt: now,
      updatedBy: actor.email || actor.uid
    },
    accessToken
  );

  const after = {
    ...before,
    ...userUpdate
  };

  await writeAdminAudit(
    env,
    actor,
    isActive ? "restore_activate_user" : "deactivate_user",
    userId,
    before,
    after,
    isActive ? "User activated" : "User deactivated",
    accessToken
  );

  return {
    ok: true,
    message: isActive
      ? "User activated successfully."
      : "User deactivated successfully."
  };
}

async function handleSoftDelete(env, actor, payload, accessToken) {
  const userId = String(payload?.userId || "").trim();
  const reason = String(payload?.reason || "").trim();

  if (!userId) throw new Error("INVALID_ARGUMENT");
  if (actor.uid === userId) throw new Error("SELF_DELETE_BLOCKED");

  const before = await getTargetUser(env, userId, accessToken);
  const now = new Date();

  await updateFirebaseAuthState(env, userId, true, accessToken);

  const updates = {
    isActive: false,
    isDeleted: true,
    deleteReason: reason,
    deletedAt: now,
    deletedBy: actor.email || actor.uid,
    updatedAt: now,
    updatedBy: actor.email || actor.uid
  };

  await patchFirestoreDocument(
    env,
    `users/${encodeURIComponent(userId)}`,
    updates,
    accessToken
  );

  await safePatchMonitoringDirectory(
    env,
    userId,
    {
      isActive: false,
      isDeleted: true,
      deletedAt: now,
      deletedBy: actor.email || actor.uid,
      updatedAt: now,
      updatedBy: actor.email || actor.uid
    },
    accessToken
  );

  const after = {
    ...before,
    ...updates
  };

  await writeAdminAudit(
    env,
    actor,
    "soft_delete_user",
    userId,
    before,
    after,
    reason || "Soft deleted",
    accessToken
  );

  return {
    ok: true,
    message: "User soft deleted successfully."
  };
}

async function handleRestore(env, actor, payload, accessToken) {
  const userId = String(payload?.userId || "").trim();
  if (!userId) throw new Error("INVALID_ARGUMENT");

  const before = await getTargetUser(env, userId, accessToken);
  const now = new Date();

  await updateFirebaseAuthState(env, userId, false, accessToken);

  const updates = {
    isActive: true,
    isDeleted: false,
    deleteReason: "",
    deletedAt: null,
    deletedBy: null,
    restoredAt: now,
    restoredBy: actor.email || actor.uid,
    updatedAt: now,
    updatedBy: actor.email || actor.uid
  };

  await patchFirestoreDocument(
    env,
    `users/${encodeURIComponent(userId)}`,
    updates,
    accessToken
  );

  await safePatchMonitoringDirectory(
    env,
    userId,
    {
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      restoredAt: now,
      restoredBy: actor.email || actor.uid,
      updatedAt: now,
      updatedBy: actor.email || actor.uid
    },
    accessToken
  );

  const after = {
    ...before,
    ...updates
  };

  await writeAdminAudit(
    env,
    actor,
    "restore_deleted_user",
    userId,
    before,
    after,
    "User restored",
    accessToken
  );

  return {
    ok: true,
    message: "Deleted user restored successfully."
  };
}

async function handleHardDelete(env, actor, payload, accessToken) {
  const userId = String(payload?.userId || "").trim();
  if (!userId) throw new Error("INVALID_ARGUMENT");
  if (actor.uid === userId) throw new Error("SELF_DELETE_BLOCKED");

  const before = await getTargetUser(env, userId, accessToken);
  const now = new Date();

  await patchFirestoreDocument(
    env,
    `users_deleted_archive/${encodeURIComponent(userId)}`,
    {
      ...before,
      hardDeletedAt: now,
      hardDeletedBy: actor.email || actor.uid
    },
    accessToken
  );

  await deleteFirebaseAuthUser(env, userId, accessToken);
  await deleteFirestoreDocument(
    env,
    `monitoring_directory/${encodeURIComponent(userId)}`,
    accessToken
  );
  await deleteFirestoreDocument(
    env,
    `users/${encodeURIComponent(userId)}`,
    accessToken
  );

  await writeAdminAudit(
    env,
    actor,
    "hard_delete_user",
    userId,
    before,
    null,
    "User permanently deleted",
    accessToken
  );

  return {
    ok: true,
    message: "User permanently deleted."
  };
}

async function handleLifecycleEmail(env, actor, payload, accessToken) {
  const userId = String(payload?.userId || "").trim();
  const eventType = String(payload?.eventType || "").trim();
  const context =
    payload?.context && typeof payload.context === "object"
      ? payload.context
      : {};

  if (!userId || !eventType) {
    throw new Error("INVALID_ARGUMENT");
  }

  const targetUser = await getTargetUser(env, userId, accessToken);

  if (!targetUser.email) {
    throw new Error("TARGET_EMAIL_MISSING");
  }

  const result = await sendLifecycleEmail(
    env,
    targetUser,
    eventType,
    actor,
    context,
    accessToken
  );

  await writeAdminAudit(
    env,
    actor,
    `send_${eventType}_email`,
    userId,
    targetUser,
    targetUser,
    `Lifecycle email sent via ${result.provider}`,
    accessToken
  );

  return {
    ok: true,
    provider: result.provider,
    messageId: result.messageId,
    message: `Email sent successfully for ${eventType}.`
  };
}

function mapError(error) {
  const code = String(error?.message || "");

  const known = {
    AUTH_INVALID: [401, "Your login session could not be verified."],
    PROFILE_UNAVAILABLE: [403, "Your NHRC user profile could not be verified."],
    FORBIDDEN: [403, "Only an administrator or developer can perform this action."],
    INVALID_ARGUMENT: [400, "The request is missing required information."],
    TARGET_NOT_FOUND: [404, "The selected user profile was not found."],
    TARGET_EMAIL_MISSING: [400, "The selected user does not have an email address."],
    SELF_DEACTIVATE_BLOCKED: [409, "You cannot deactivate your own account."],
    SELF_DELETE_BLOCKED: [409, "You cannot delete your own account."],
    EMAIL_PROVIDER_NOT_CONFIGURED: [503, "Email provider is not configured on the admin service."],
    EMAIL_SEND_FAILED: [502, "The notification email provider rejected the message."],
    PASSWORD_RESET_LINK_FAILED: [502, "A password reset link could not be generated."],
    AUTH_ADMIN_UPDATE_FAILED: [502, "Firebase Authentication could not update the user."],
    AUTH_ADMIN_DELETE_FAILED: [502, "Firebase Authentication could not delete the user."],
    FIRESTORE_READ_FAILED: [502, "The user record could not be read."],
    FIRESTORE_WRITE_FAILED: [502, "The user record could not be updated."],
    GOOGLE_AUTH_FAILED: [502, "The backend could not authenticate with Firebase."],
    SERVICE_ACCOUNT_NOT_CONFIGURED: [503, "Firebase Admin credentials are not configured."],
    SERVICE_ACCOUNT_INVALID: [503, "Firebase Admin credentials are invalid."],
    UNSUPPORTED_EMAIL_EVENT: [400, "Unsupported email notification type."]
  };

  return known[code] || [500, error?.message || "The admin operation failed."];
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin !== env.ALLOWED_ORIGIN) {
        return json(403, { error: "Origin not allowed." }, origin, env);
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env)
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        200,
        {
          ok: true,
          service: "nhrc-admin-ops",
          firebaseAdminConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON),
          emailConfigured: Boolean(env.RESEND_API_KEY),
          senderConfigured: Boolean(env.RESEND_FROM_EMAIL)
        },
        origin,
        env
      );
    }

    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed." }, origin, env);
    }

    if (origin !== env.ALLOWED_ORIGIN) {
      return json(403, { error: "Origin not allowed." }, origin, env);
    }

    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return json(401, { error: "Authentication required." }, origin, env);
    }

    try {
      const actor = await authenticateAdmin(match[1], env);
      const accessToken = await getGoogleAccessToken(env);
      const payload = await request.json().catch(() => ({}));

      let result;

      if (url.pathname === "/users/set-active") {
        result = await handleSetActive(env, actor, payload, accessToken);
      } else if (url.pathname === "/users/soft-delete") {
        result = await handleSoftDelete(env, actor, payload, accessToken);
      } else if (url.pathname === "/users/restore") {
        result = await handleRestore(env, actor, payload, accessToken);
      } else if (url.pathname === "/users/hard-delete") {
        result = await handleHardDelete(env, actor, payload, accessToken);
      } else if (url.pathname === "/email/lifecycle") {
        result = await handleLifecycleEmail(env, actor, payload, accessToken);
      } else {
        return json(404, { error: "Not found." }, origin, env);
      }

      return json(200, result, origin, env);
    } catch (error) {
      console.error("Admin operations Worker failed", error?.message || error);
      const [status, message] = mapError(error);
      return json(status, { error: message }, origin, env);
    }
  }
};
