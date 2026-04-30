/**
 * Firestore cleanup script for NHRC dashboard chat + user documents
 *
 * What it fixes:
 * - users.assignedProjects => always array of lowercase trimmed strings
 * - users.isActive => defaults to true if missing
 * - users.isDeleted => defaults to false if missing
 * - users.fullName/email/role => safe defaults
 * - project chats => projectCode normalized, members rebuilt from active assigned users
 * - direct chats => projectCode normalized, members normalized to 2 unique ids if possible
 * - memberNames => rebuilt where needed
 * - memberState => initialized where missing
 *
 * Run:
 *   node scripts/cleanup-firestore-chat.js
 *
 * Before running:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
 */

const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.resolve(__dirname, "../serviceAccountKey.json"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function asString(value) {
  return String(value || "").trim();
}

function normalizeProjectCode(value) {
  return asString(value).toLowerCase();
}

function normalizeAssignedProjects(value) {
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map((x) => normalizeProjectCode(x))
        .filter(Boolean)
    )].sort();
  }

  if (typeof value === "string" && value.trim()) {
    return [normalizeProjectCode(value)];
  }

  return [];
}

function safeBool(value, defaultValue = false) {
  return typeof value === "boolean" ? value : defaultValue;
}

function safeRole(value) {
  const role = asString(value);
  return role || "field_worker";
}

function safeEmail(value) {
  return asString(value).toLowerCase();
}

function safeFullName(value, email = "", uid = "") {
  const fullName = asString(value);
  if (fullName) return fullName;
  if (email) return email;
  return uid || "User";
}

function chunkArray(arr, size = 400) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function loadAllUsers() {
  const snapshot = await db.collection("users").get();

  const usersById = new Map();
  const activeUsersByProject = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const uid = doc.id;

    const email = safeEmail(data.email);
    const fullName = safeFullName(data.fullName, email, uid);
    const role = safeRole(data.role);
    const assignedProjects = normalizeAssignedProjects(data.assignedProjects);
    const isActive = safeBool(data.isActive, true);
    const isDeleted = safeBool(data.isDeleted, false);

    const normalized = {
      uid,
      email,
      fullName,
      role,
      assignedProjects,
      isActive,
      isDeleted,
      raw: data
    };

    usersById.set(uid, normalized);

    if (isActive && !isDeleted) {
      for (const projectCode of assignedProjects) {
        if (!activeUsersByProject.has(projectCode)) {
          activeUsersByProject.set(projectCode, []);
        }
        activeUsersByProject.get(projectCode).push(normalized);
      }
    }
  });

  for (const [, users] of activeUsersByProject) {
    users.sort((a, b) =>
      (a.fullName || a.email || a.uid).localeCompare(b.fullName || b.email || b.uid)
    );
  }

  return { usersById, activeUsersByProject };
}

async function cleanupUsers() {
  console.log("Loading users...");
  const snapshot = await db.collection("users").get();

  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let opCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const uid = doc.id;

    const normalizedAssignedProjects = normalizeAssignedProjects(data.assignedProjects);
    const normalizedEmail = safeEmail(data.email);
    const normalizedRole = safeRole(data.role);
    const normalizedIsActive = safeBool(data.isActive, true);
    const normalizedIsDeleted = safeBool(data.isDeleted, false);
    const normalizedFullName = safeFullName(data.fullName, normalizedEmail, uid);

    const patch = {};
    let needsUpdate = false;

    if (JSON.stringify(normalizedAssignedProjects) !== JSON.stringify(Array.isArray(data.assignedProjects) ? data.assignedProjects : normalizeAssignedProjects(data.assignedProjects))) {
      patch.assignedProjects = normalizedAssignedProjects;
      needsUpdate = true;
    }

    if (normalizedEmail !== safeEmail(data.email)) {
      patch.email = normalizedEmail;
      needsUpdate = true;
    }

    if (normalizedRole !== asString(data.role)) {
      patch.role = normalizedRole;
      needsUpdate = true;
    }

    if (data.isActive !== normalizedIsActive) {
      patch.isActive = normalizedIsActive;
      needsUpdate = true;
    }

    if (data.isDeleted !== normalizedIsDeleted) {
      patch.isDeleted = normalizedIsDeleted;
      needsUpdate = true;
    }

    if (normalizedFullName !== asString(data.fullName)) {
      patch.fullName = normalizedFullName;
      needsUpdate = true;
    }

    if (needsUpdate) {
      patch.updatedAt = FieldValue.serverTimestamp();
      patch.cleanedAt = FieldValue.serverTimestamp();

      batch.set(doc.ref, patch, { merge: true });
      opCount += 1;
      updated += 1;
    } else {
      skipped += 1;
    }

    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  console.log(`Users cleanup complete. Updated: ${updated}, skipped: ${skipped}`);
}

function buildProjectChatTitle(projectCode) {
  return `${String(projectCode || "").toUpperCase()} Project Room`;
}

function buildDirectChatTitle(userA, userB) {
  const left = userA?.fullName || userA?.email || userA?.uid || "User";
  const right = userB?.fullName || userB?.email || userB?.uid || "User";
  return `${left} & ${right}`;
}

async function cleanupChats() {
  console.log("Loading users for chat rebuild...");
  const { usersById, activeUsersByProject } = await loadAllUsers();

  console.log("Loading chats...");
  const snapshot = await db.collection("chats").get();

  let updated = 0;
  let skipped = 0;
  let projectChatsFixed = 0;
  let directChatsFixed = 0;
  let batch = db.batch();
  let opCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const type = asString(data.type);
    const projectCode = normalizeProjectCode(data.projectCode);

    const patch = {
      updatedAt: FieldValue.serverTimestamp(),
      cleanedAt: FieldValue.serverTimestamp()
    };

    let needsUpdate = false;

    if (!projectCode) {
      console.warn(`Skipping chat ${doc.id}: missing projectCode`);
      skipped += 1;
      continue;
    }

    if (type === "project") {
      const projectUsers = activeUsersByProject.get(projectCode) || [];

      const existingMembers = Array.isArray(data.members)
        ? [...new Set(data.members.map((x) => asString(x)).filter(Boolean))].sort()
        : [];

      const rebuiltMembers = [
        ...new Set([
          ...existingMembers,
          ...projectUsers.map((u) => u.uid).filter(Boolean)
        ])
      ].sort();

      const memberNames = {
        ...(data.memberNames || {})
      };

      for (const user of projectUsers) {
        memberNames[user.uid] = user.fullName || user.email || user.uid;
      }

      const existingMemberState =
        data.memberState && typeof data.memberState === "object"
          ? data.memberState
          : {};

      const rebuiltMemberState = {};
      for (const uid of rebuiltMembers) {
        rebuiltMemberState[uid] = existingMemberState[uid] || {
          lastReadAt: FieldValue.serverTimestamp()
        };
      }

      if (projectCode !== asString(data.projectCode)) {
        patch.projectCode = projectCode;
        needsUpdate = true;
      }

      if (asString(data.title) !== buildProjectChatTitle(projectCode)) {
        patch.title = buildProjectChatTitle(projectCode);
        needsUpdate = true;
      }

      if (JSON.stringify(existingMembers) !== JSON.stringify(rebuiltMembers)) {
        patch.members = rebuiltMembers;
        needsUpdate = true;
      }

      if (JSON.stringify(data.memberNames || {}) !== JSON.stringify(memberNames)) {
        patch.memberNames = memberNames;
        needsUpdate = true;
      }

      if (
        JSON.stringify(Object.keys(existingMemberState).sort()) !==
        JSON.stringify(rebuiltMembers)
      ) {
        patch.memberState = rebuiltMemberState;
        needsUpdate = true;
      }

      if (data.active !== true) {
        patch.active = true;
        needsUpdate = true;
      }

      if (!data.createdAt) {
        patch.createdAt = FieldValue.serverTimestamp();
        needsUpdate = true;
      }

      if (needsUpdate) {
        batch.set(doc.ref, patch, { merge: true });
        opCount += 1;
        updated += 1;
        projectChatsFixed += 1;
      } else {
        skipped += 1;
      }
    } else if (type === "direct") {
      const rawMembers = Array.isArray(data.members)
        ? data.members.map((x) => asString(x)).filter(Boolean)
        : [];

      const uniqueMembers = [...new Set(rawMembers)];
      const validMembers = uniqueMembers.filter((uid) => usersById.has(uid));

      if (validMembers.length !== 2) {
        console.warn(
          `Direct chat ${doc.id} has invalid member count after cleanup: ${validMembers.length}`
        );
      }

      if (validMembers.length < 2) {
        console.warn(`Skipping direct chat ${doc.id}: not enough valid users`);
        skipped += 1;
        continue;
      }

      const finalMembers = validMembers.slice(0, 2).sort();
      const userA = usersById.get(finalMembers[0]);
      const userB = usersById.get(finalMembers[1]);

      const memberNames = {};
      if (userA) memberNames[userA.uid] = userA.fullName || userA.email || userA.uid;
      if (userB) memberNames[userB.uid] = userB.fullName || userB.email || userB.uid;

      const existingMemberState =
        data.memberState && typeof data.memberState === "object"
          ? data.memberState
          : {};

      const rebuiltMemberState = {};
      for (const uid of finalMembers) {
        rebuiltMemberState[uid] = existingMemberState[uid] || {
          lastReadAt: FieldValue.serverTimestamp()
        };
      }

      const existingDirectMembers = Array.isArray(data.members)
        ? [...new Set(data.members.map((x) => asString(x)).filter(Boolean))].sort()
        : [];

      if (projectCode !== asString(data.projectCode)) {
        patch.projectCode = projectCode;
        needsUpdate = true;
      }

      if (JSON.stringify(existingDirectMembers) !== JSON.stringify(finalMembers)) {
        patch.members = finalMembers;
        needsUpdate = true;
      }

      if (JSON.stringify(data.memberNames || {}) !== JSON.stringify(memberNames)) {
        patch.memberNames = memberNames;
        needsUpdate = true;
      }

      if (userA && userB) {
        const directTitle = buildDirectChatTitle(userA, userB);
        if (asString(data.title) !== directTitle) {
          patch.title = directTitle;
          needsUpdate = true;
        }
      }

      if (
        JSON.stringify(Object.keys(existingMemberState).sort()) !==
        JSON.stringify(finalMembers)
      ) {
        patch.memberState = rebuiltMemberState;
        needsUpdate = true;
      }

      if (data.active !== true) {
        patch.active = true;
        needsUpdate = true;
      }

      if (!data.createdAt) {
        patch.createdAt = FieldValue.serverTimestamp();
        needsUpdate = true;
      }

      if (needsUpdate) {
        batch.set(doc.ref, patch, { merge: true });
        opCount += 1;
        updated += 1;
        directChatsFixed += 1;
      } else {
        skipped += 1;
      }
    } else {
      console.warn(`Skipping chat ${doc.id}: unknown type "${type}"`);
      skipped += 1;
    }

    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  console.log(`Chats cleanup complete. Updated: ${updated}, skipped: ${skipped}`);
  console.log(`Project chats fixed: ${projectChatsFixed}`);
  console.log(`Direct chats fixed: ${directChatsFixed}`);
}

async function createMissingProjectRooms() {
  console.log("Creating missing project rooms from users...");
  const { activeUsersByProject } = await loadAllUsers();

  let created = 0;
  let updated = 0;

  for (const [projectCode, projectUsers] of activeUsersByProject.entries()) {
    const chatId = `project__${projectCode}`;
    const docRef = db.collection("chats").doc(chatId);
    const snap = await docRef.get();

    const members = [...new Set(projectUsers.map((u) => u.uid).filter(Boolean))].sort();
    const memberNames = {};
    const memberState = {};

    for (const user of projectUsers) {
      memberNames[user.uid] = user.fullName || user.email || user.uid;
      memberState[user.uid] = { lastReadAt: FieldValue.serverTimestamp() };
    }

    const payload = {
      type: "project",
      active: true,
      projectCode,
      title: buildProjectChatTitle(projectCode),
      members,
      memberNames,
      memberState,
      updatedAt: FieldValue.serverTimestamp(),
      cleanedAt: FieldValue.serverTimestamp()
    };

    if (!snap.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
      await docRef.set(payload, { merge: true });
      created += 1;
    } else {
      await docRef.set(payload, { merge: true });
      updated += 1;
    }
  }

  console.log(`Missing project room sync complete. Created: ${created}, updated: ${updated}`);
}

async function main() {
  try {
    console.log("----- NHRC FIRESTORE CLEANUP START -----");

    await cleanupUsers();
    await cleanupChats();
    await createMissingProjectRooms();

    console.log("----- NHRC FIRESTORE CLEANUP DONE -----");
    process.exit(0);
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
  }
}

main();