const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

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

    // Update Firestore
    await userRef.set({
      isActive: false,
      isDeleted: true,
      deleteReason: reason || "",
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: actor.email || actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.email || actor.uid
    }, { merge: true });

    // Update monitoring directory
    await db.collection("monitoring_directory").doc(userId).set({
      isActive: false,
      isDeleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: actor.email || actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.email || actor.uid
    }, { merge: true });

    // 🔥 FIX: Wrap Auth update
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