const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function corsHeaders(origin, allowedOrigin) {
  const headers = { ...JSON_HEADERS };
  if (origin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  return headers;
}

function json(status, body, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, env.ALLOWED_ORIGIN)
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

async function authenticateFirebaseUser(idToken, env) {
  const authResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
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
  const user = authData?.users?.[0];

  if (!user?.localId) {
    throw new Error("AUTH_INVALID");
  }

  const profileResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/users/${encodeURIComponent(user.localId)}`,
    {
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    }
  );

  if (!profileResponse.ok) {
    throw new Error("PROFILE_UNAVAILABLE");
  }

  const profile = await profileResponse.json();
  const fields = profile?.fields || {};

  const role = firestoreString(fields.role).trim().toLowerCase();
  const isActive = firestoreBoolean(fields.isActive, true);
  const isDeleted = firestoreBoolean(fields.isDeleted, false);
  const assignedProjects = firestoreStringArray(fields.assignedProjects);

  if (
    !isActive ||
    isDeleted ||
    !assignedProjects.includes("physio-hemab-wp2")
  ) {
    throw new Error("FORBIDDEN");
  }

  return {
    uid: user.localId,
    role
  };
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nhrc-physio-hemab-refresh-worker"
  };
}

async function assertNoRecentOrRunningRefresh(env) {
  const url =
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/runs?per_page=10`;

  const response = await fetch(url, {
    headers: githubHeaders(env)
  });

  if (!response.ok) {
    throw new Error("GITHUB_STATUS_FAILED");
  }

  const data = await response.json();
  const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
  const now = Date.now();
  const cooldownMs = Number(env.COOLDOWN_SECONDS || "120") * 1000;

  const active = runs.find((run) =>
    ["queued", "in_progress", "waiting", "requested", "pending"].includes(run?.status)
  );

  if (active) {
    return {
      allowed: false,
      reason: "A Physio-HeMAB refresh is already running.",
      retryAfterSeconds: 60
    };
  }

  const recent = runs
    .filter((run) => run?.created_at)
    .map((run) => new Date(run.created_at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  if (recent && now - recent < cooldownMs) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((cooldownMs - (now - recent)) / 1000)
    );
    return {
      allowed: false,
      reason: "A refresh was requested recently. Please wait briefly before trying again.",
      retryAfterSeconds
    };
  }

  return { allowed: true };
}

async function dispatchRefresh(env) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(env),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          source: "dashboard"
        }
      })
    }
  );

  if (response.status !== 204) {
    const body = await response.text();
    console.error("GitHub workflow dispatch failed", response.status, body.slice(0, 500));
    throw new Error("GITHUB_DISPATCH_FAILED");
  }
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
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN)
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { ok: true, service: "physio-hemab-wp2-refresh" }, origin, env);
    }

    if (request.method !== "POST" || url.pathname !== "/refresh") {
      return json(404, { error: "Not found." }, origin, env);
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
      await authenticateFirebaseUser(match[1], env);

      const gate = await assertNoRecentOrRunningRefresh(env);
      if (!gate.allowed) {
        return json(
          409,
          {
            error: gate.reason,
            retryAfterSeconds: gate.retryAfterSeconds
          },
          origin,
          env
        );
      }

      await dispatchRefresh(env);

      return json(
        202,
        {
          accepted: true,
          message: "Refresh started.",
          cooldownSeconds: Number(env.COOLDOWN_SECONDS || "120")
        },
        origin,
        env
      );
    } catch (error) {
      const code = String(error?.message || "");

      if (code === "AUTH_INVALID") {
        return json(401, { error: "Your login session could not be verified." }, origin, env);
      }

      if (code === "FORBIDDEN") {
        return json(
          403,
          { error: "Only an active NHRC user assigned to Physio-HeMAB WP2 can refresh REDCap data." },
          origin,
          env
        );
      }

      if (code === "PROFILE_UNAVAILABLE") {
        return json(403, { error: "Your NHRC user profile could not be verified." }, origin, env);
      }

      console.error("Refresh worker error", code);
      return json(
        502,
        { error: "The refresh service could not start the REDCap refresh." },
        origin,
        env
      );
    }
  }
};
