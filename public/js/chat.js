// js/chat.js

let chatThreadsUnsubscribe = null;
let chatMessagesUnsubscribe = null;
let chatCurrentChatId = null;
let chatCurrentChatDoc = null;
let chatCurrentContacts = [];
let chatThreadsCache = [];
let chatLastNotifiedMap = {};
let chatTypingTimeoutHandle = null;
let chatBound = false;
let chatEditingMessageId = null;
let chatEditingOriginalText = "";
let chatReplyToMessage = null;
let chatSoundEnabled = localStorage.getItem("chatSoundEnabled") !== "false";
let chatPendingLocation = null;
let chatMediaRecorder = null;
let chatMediaChunks = [];
let chatRecordingStream = null;
let chatIsRecording = false;
let chatListFilter = "all";
let chatSearchTerm = "";

function chatExplainFirestoreError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("missing or insufficient permissions")) {
    return "Firestore rules denied this action.";
  }

  if (message.includes("permission-denied")) {
    return "Permission denied by Firestore rules.";
  }

  if (message.includes("failed-precondition")) {
    return "A required Firestore precondition or index is missing.";
  }

  return error?.message || "Unknown chat error.";
}

function chatEscapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function chatSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function chatNowMsFromTimestamp(value) {
  if (!value) return 0;
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function chatFormatTimestamp(value) {
  if (!value) return "";
  if (value?.toDate) return value.toDate().toLocaleString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
}

function chatCurrentUid() {
  return window.currentUserProfile?.uid || "";
}

function chatCurrentProjectCode() {
  const fromWindow = String(window.currentProjectCode || "").trim();
  if (fromWindow) return fromWindow;

  const projectSelect = document.getElementById("projectSelect");
  const fromSelect = String(projectSelect?.value || "").trim();

  if (fromSelect) {
    window.currentProjectCode = fromSelect;
    return fromSelect;
  }

  return "";
}

function chatCanUse() {
  return !!window.currentUserProfile && !!String(chatCurrentProjectCode() || "").trim();
}

function getProjectChatId(projectCode) {
  return `project__${String(projectCode || "").trim().toLowerCase()}`;
}

function getDirectChatId(projectCode, uidA, uidB) {
  const sorted = [String(uidA || ""), String(uidB || "")].sort();
  return `direct__${String(projectCode || "").trim().toLowerCase()}__${sorted[0]}__${sorted[1]}`;
}

function getChatUnreadCount(chatDoc) {
  const uid = chatCurrentUid();
  if (!uid || !chatDoc) return 0;

  const lastMessageAtMs = chatNowMsFromTimestamp(chatDoc.lastMessageAt);
  const lastReadAtMs = chatNowMsFromTimestamp(chatDoc?.memberState?.[uid]?.lastReadAt);

  if (!lastMessageAtMs) return 0;
  if (chatDoc.lastMessageBy === uid) return 0;

  return lastMessageAtMs > lastReadAtMs ? 1 : 0;
}

function getChatSearchTerm() {
  return String(chatSearchTerm || "").trim().toLowerCase();
}

function chatMatchesSearch(values = []) {
  const term = getChatSearchTerm();
  if (!term) return true;

  const haystack = values
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

function threadPassesCurrentFilter(chat) {
  if (!chat) return false;

  if (chatListFilter === "unread") {
    return getChatUnreadCount(chat) > 0;
  }

  if (chatListFilter === "project") {
    return chat.type === "project";
  }

  if (chatListFilter === "direct") {
    return chat.type === "direct";
  }

  return true;
}

function bindAllChatUI() {
  chatSetProjectPill();
  bindChatSearchAndFilters();
  bindComposeEvents();
  bindProjectRoomButton();
  bindTopProjectIcon();

  requestAnimationFrame(() => {
    ensureEmojiBar();
  });

  setTimeout(() => {
    ensureEmojiBar();
  }, 50);
}

function bindChatSearchAndFilters() {
  const searchInput = document.getElementById("chatSearchInput");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";

    searchInput.addEventListener("input", () => {
      chatSearchTerm = searchInput.value || "";
      renderThreadsList();
      renderContactsList();
    });
  }

  document.querySelectorAll("[data-chat-filter]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";

    btn.addEventListener("click", () => {
      chatListFilter = btn.getAttribute("data-chat-filter") || "all";

      document.querySelectorAll("[data-chat-filter]").forEach((chip) => {
        chip.classList.toggle("active", chip === btn);
      });

      renderThreadsList();
      renderContactsList();
    });
  });
}

function updateChatTabBadge(count) {
  const badge = document.getElementById("chatTabUnreadBadge");
  if (!badge) return;

  if (!count) {
    badge.textContent = "0";
    badge.classList.add("hidden");
    return;
  }

  badge.textContent = String(count);
  badge.classList.remove("hidden");
}

function updateChatUnreadSummary(count) {
  const el = document.getElementById("chatUnreadSummary");
  if (!el) return;
  el.textContent = `${count} unread`;
}

function updateDocumentTitleUnread(count) {
  const baseTitle = "NHRC Projects Dashboard";
  document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
}

function showChatToast(title, text) {
  if (typeof Swal === "undefined") return;

  Swal.fire({
    toast: true,
    position: "top-end",
    icon: "info",
    title,
    text,
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true
  });
}

function chatPersistSoundSetting() {
  localStorage.setItem("chatSoundEnabled", chatSoundEnabled ? "true" : "false");
}

function playIncomingMessageSound() {
  if (!chatSoundEnabled) return;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);

    gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.22);
  } catch (error) {
    console.error("Sound play failed:", error);
  }
}

function getOtherParticipantName(chatDoc) {
  if (!chatDoc || chatDoc.type !== "direct") return "";
  const myUid = chatCurrentUid();
  const otherUid = chatSafeArray(chatDoc.members).find((uid) => uid !== myUid);

  if (!otherUid) return chatDoc.title || "Direct Message";

  return (
    chatDoc?.memberNames?.[otherUid] ||
    chatCurrentContacts.find((user) => user.uid === otherUid)?.fullName ||
    chatCurrentContacts.find((user) => user.uid === otherUid)?.email ||
    chatDoc.title ||
    "Direct Message"
  );
}

function getChatMetaLabel(chatDoc) {
  if (!chatDoc) return "Choose a project room or direct message";

  if (chatDoc.type === "project") {
    const count = chatSafeArray(chatDoc.members).length;
    return `Project room • ${String(chatDoc.projectCode || "").toUpperCase()} • ${count} member${count === 1 ? "" : "s"}`;
  }

  const myUid = chatCurrentUid();
  const otherUid = chatSafeArray(chatDoc.members).find((uid) => uid !== myUid);
  const otherUser = chatCurrentContacts.find((user) => user.uid === otherUid);

  if (otherUser?.isOnline === true) {
    return `Direct message • ${String(chatDoc.projectCode || "").toUpperCase()} • Online`;
  }

  if (otherUser?.lastSeen) {
    return `Direct message • ${String(chatDoc.projectCode || "").toUpperCase()} • Last seen ${chatFormatTimestamp(otherUser.lastSeen)}`;
  }

  return `Direct message • ${String(chatDoc.projectCode || "").toUpperCase()}`;
}

function messageSeenByOthers(msg, chatDoc) {
  if (!msg || !chatDoc) return false;
  if (msg.senderId !== chatCurrentUid()) return false;

  const msgTime = chatNowMsFromTimestamp(msg.createdAt);
  if (!msgTime) return false;

  const memberState = chatDoc.memberState || {};
  const myUid = chatCurrentUid();

  return Object.entries(memberState).some(([uid, state]) => {
    if (uid === myUid) return false;
    const readAt = chatNowMsFromTimestamp(state?.lastReadAt);
    return readAt >= msgTime;
  });
}

function messageTickHtml(msg) {
  if (msg.senderId !== chatCurrentUid()) return "";
  const seen = messageSeenByOthers(msg, chatCurrentChatDoc);

  return `
    <span class="chat-status-tick ${seen ? "seen" : ""}">
      ${seen ? "✓✓" : "✓"}
    </span>
  `;
}

function ensureReplyPreviewBar() {
  if (document.getElementById("chatReplyPreviewBar")) return;

  const textInput = document.getElementById("chatTextInput");
  if (!textInput || !textInput.parentElement) return;

  const replyBar = document.createElement("div");
  replyBar.id = "chatReplyPreviewBar";
  replyBar.className = "chat-reply-preview hidden";
  textInput.parentElement.insertBefore(replyBar, textInput);
}

function renderReplyPreviewBar() {
  ensureReplyPreviewBar();

  const bar = document.getElementById("chatReplyPreviewBar");
  if (!bar) return;

  if (!chatReplyToMessage) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }

  bar.classList.remove("hidden");
  bar.innerHTML = `
    <div class="chat-reply-preview-content">
      <div class="chat-reply-preview-text">
        Replying to <strong>${chatEscapeHtml(chatReplyToMessage.senderName || chatReplyToMessage.senderEmail || "User")}</strong><br>
        <span>${chatEscapeHtml(chatReplyToMessage.text || "[Attachment or empty message]")}</span>
      </div>
      <button type="button" id="chatReplyCancelBtn" class="chat-mini-btn">Cancel</button>
    </div>
  `;

  const cancelBtn = document.getElementById("chatReplyCancelBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      chatReplyToMessage = null;
      renderReplyPreviewBar();
    };
  }
}

function ensureSoundToggleButton() {
  if (document.getElementById("chatSoundToggleBtn")) return;

  const metaEl = document.getElementById("chatActiveMeta");
  if (!metaEl || !metaEl.parentElement) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "chatSoundToggleBtn";
  btn.className = "chat-mini-btn";
  btn.style.marginTop = "8px";
  btn.onclick = () => {
    chatSoundEnabled = !chatSoundEnabled;
    chatPersistSoundSetting();
    updateSoundToggleButton();
  };

  metaEl.parentElement.appendChild(btn);
  updateSoundToggleButton();
}

function updateSoundToggleButton() {
  const btn = document.getElementById("chatSoundToggleBtn");
  if (!btn) return;

  btn.textContent = chatSoundEnabled ? "🔔 Sound On" : "🔕 Sound Off";
}

async function softDeleteMessage(messageId) {
  if (!chatCurrentChatId || !messageId) return;

  await db.collection("chats")
    .doc(chatCurrentChatId)
    .collection("messages")
    .doc(messageId)
    .set({
      text: "",
      isDeleted: true,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      editedAt: firebase.firestore.FieldValue.delete(),
      attachmentUrl: firebase.firestore.FieldValue.delete(),
      attachmentName: firebase.firestore.FieldValue.delete()
    }, { merge: true });
}

async function editOwnMessage(messageId, currentText) {
  if (!chatCurrentChatId || !messageId) return;
  startInlineEdit(messageId, currentText || "");

  if (chatCurrentChatId) {
    await openChatById(chatCurrentChatId);
  }
}

function insertEmojiIntoChatInput(emoji) {
  const textInput = document.getElementById("chatTextInput");
  if (!textInput) return;

  const start = textInput.selectionStart ?? textInput.value.length;
  const end = textInput.selectionEnd ?? textInput.value.length;
  const currentValue = textInput.value || "";

  textInput.value =
    currentValue.slice(0, start) +
    emoji +
    currentValue.slice(end);

  const nextPos = start + emoji.length;
  textInput.focus();
  textInput.setSelectionRange(nextPos, nextPos);
}

function triggerChatFilePicker(accept = "*/*", capture = "") {
  const fileInput = document.getElementById("chatFileInput");
  if (!fileInput) return;

  fileInput.setAttribute("accept", accept || "*/*");

  if (capture) {
    fileInput.setAttribute("capture", capture);
  } else {
    fileInput.removeAttribute("capture");
  }

  fileInput.click();
}

async function pickChatLocation() {
  if (!navigator.geolocation) {
    alert("Location is not supported on this device.");
    return;
  }

  const btn = document.getElementById("chatLocationBtn");
  if (btn) btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = Number(position.coords.latitude).toFixed(6);
      const lng = Number(position.coords.longitude).toFixed(6);

      chatPendingLocation = {
        latitude: lat,
        longitude: lng,
        mapUrl: `https://www.google.com/maps?q=${lat},${lng}`
      };

      const textInput = document.getElementById("chatTextInput");
      if (textInput) {
        const prefix = textInput.value.trim() ? `${textInput.value.trim()}\n` : "";
        textInput.value = `${prefix}📍 Location: ${chatPendingLocation.mapUrl}`;
      }

      if (typeof logActivity === "function") {
        logActivity("chat_location_attached", {
          page: "chat",
          target: `${lat},${lng}`
        }).catch(console.error);
      }

      if (btn) btn.disabled = false;
    },
    (error) => {
      console.error("Location fetch failed:", error);
      alert("Could not get your location.");
      if (btn) btn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

async function startVoiceRecording() {
  if (chatIsRecording) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chatRecordingStream = stream;
    chatMediaChunks = [];
    chatMediaRecorder = new MediaRecorder(stream);
    chatIsRecording = true;

    const btn = document.getElementById("chatVoiceBtn");
    if (btn) {
      btn.classList.add("recording");
      btn.innerHTML = `<i class="fas fa-stop"></i><span>Stop</span>`;
      btn.title = "Stop recording";
    }

    chatMediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chatMediaChunks.push(event.data);
      }
    };

    chatMediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chatMediaChunks, { type: "audio/webm" });
        if (!blob.size) return;

        const audioFile = new File(
          [blob],
          `voice_note_${Date.now()}.webm`,
          { type: "audio/webm" }
        );

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(audioFile);

        const fileInput = document.getElementById("chatFileInput");
        if (fileInput) {
          fileInput.files = dataTransfer.files;
          refreshAttachmentLabel();
        }

        const textInput = document.getElementById("chatTextInput");
        if (textInput && !textInput.value.trim()) {
          textInput.value = "🎤 Voice note";
        }
      } catch (error) {
        console.error("Voice note creation failed:", error);
        alert("Voice recording failed.");
      } finally {
        if (chatRecordingStream) {
          chatRecordingStream.getTracks().forEach((track) => track.stop());
        }

        chatRecordingStream = null;
        chatMediaRecorder = null;
        chatMediaChunks = [];
        chatIsRecording = false;

        const btn = document.getElementById("chatVoiceBtn");
        if (btn) {
          btn.classList.remove("recording");
          btn.innerHTML = `<i class="fas fa-microphone"></i><span>Voice</span>`;
          btn.title = "Record voice note";
        }
      }
    };

    chatMediaRecorder.start();
  } catch (error) {
    console.error("Microphone access failed:", error);
    alert("Microphone permission was denied or unavailable.");
    chatIsRecording = false;
  }
}

function stopVoiceRecording() {
  if (!chatMediaRecorder || !chatIsRecording) return;
  chatMediaRecorder.stop();
}

async function toggleVoiceRecording() {
  if (chatIsRecording) {
    stopVoiceRecording();
    return;
  }

  await startVoiceRecording();
}

function ensureEmojiBar() {
  const compose =
    document.querySelector(".chat-compose-modern") ||
    document.querySelector(".chat-compose");

  const textInput = document.getElementById("chatTextInput");
  const fileInput = document.getElementById("chatFileInput");

  if (!compose || !textInput || !fileInput) return;

  const existing = document.getElementById("chatEmojiBarWrap");
  if (existing) {
    existing.remove();
  }

  const fileWrap =
    compose.querySelector(".chat-file-wrap") ||
    fileInput.closest(".chat-file-wrap") ||
    fileInput.parentElement;

  if (!fileWrap) return;

  const wrap = document.createElement("div");
  wrap.id = "chatEmojiBarWrap";

  const actionsRow = document.createElement("div");
  actionsRow.className = "chat-media-actions";
  actionsRow.innerHTML = `
    <button type="button" id="chatPhotoBtn" class="chat-media-btn" title="Choose photo">
      <i class="fas fa-image"></i><span>Photo</span>
    </button>

    <button type="button" id="chatCameraBtn" class="chat-media-btn" title="Take photo">
      <i class="fas fa-camera"></i><span>Camera</span>
    </button>

    <button type="button" id="chatVoiceBtn" class="chat-media-btn" title="Record voice note">
      <i class="fas fa-microphone"></i><span>Voice</span>
    </button>

    <button type="button" id="chatLocationBtn" class="chat-media-btn" title="Share location">
      <i class="fas fa-location-dot"></i><span>Location</span>
    </button>
  `;

  const label = document.createElement("div");
  label.className = "chat-compose-tools-title";
  label.textContent = "Quick reactions";

  const bar = document.createElement("div");
  bar.id = "chatEmojiBar";
  bar.className = "chat-emoji-bar";

  const emojis = ["👍", "✅", "🎉", "🙏", "🙂", "📌", "⚠️", "🚀", "👏", "💡"];

  bar.innerHTML = emojis.map((emoji) => {
    return `<button type="button" class="chat-emoji-btn" data-chat-emoji="${emoji}" title="Insert ${emoji}">${emoji}</button>`;
  }).join("");

  wrap.appendChild(actionsRow);
  wrap.appendChild(label);
  wrap.appendChild(bar);

  compose.insertBefore(wrap, fileWrap);

  wrap.querySelectorAll("[data-chat-emoji]").forEach((btn) => {
    btn.onclick = () => {
      const emoji = btn.getAttribute("data-chat-emoji");
      insertEmojiIntoChatInput(emoji);
    };
  });

  document.getElementById("chatPhotoBtn")?.addEventListener("click", () => {
    triggerChatFilePicker("image/*", "");
  });

  document.getElementById("chatCameraBtn")?.addEventListener("click", () => {
    triggerChatFilePicker("image/*", "environment");
  });

  document.getElementById("chatVoiceBtn")?.addEventListener("click", async () => {
    await toggleVoiceRecording();
  });

  document.getElementById("chatLocationBtn")?.addEventListener("click", async () => {
    await pickChatLocation();
  });
}

async function saveInlineEditedMessage(messageId) {
  const textarea = document.getElementById(`chatInlineEditInput_${messageId}`);
  if (!textarea || !chatCurrentChatId) return;

  const clean = String(textarea.value || "").trim();
  if (!clean) {
    alert("Edited message cannot be empty.");
    return;
  }

  await db.collection("chats")
    .doc(chatCurrentChatId)
    .collection("messages")
    .doc(messageId)
    .set({
      text: clean,
      editedAt: firebase.firestore.FieldValue.serverTimestamp(),
      isDeleted: false
    }, { merge: true });

  chatEditingMessageId = null;
  chatEditingOriginalText = "";
}

function cancelInlineEdit() {
  chatEditingMessageId = null;
  chatEditingOriginalText = "";
}

function startInlineEdit(messageId, currentText) {
  chatEditingMessageId = messageId;
  chatEditingOriginalText = currentText || "";

  const container = document.getElementById("chatMessages");
  if (!container) return;

  const messageRows = container.querySelectorAll(".chat-message-row");
  if (messageRows.length) {
    const activeMessagesBox = document.getElementById("chatMessages");
    if (activeMessagesBox) {
      activeMessagesBox.scrollTop = activeMessagesBox.scrollTop;
    }
  }
}

function bindMessageActionButtons(messages) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  container.querySelectorAll("[data-reply-message-id]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-reply-message-id");
      const msg = messages.find((m) => m.id === id);
      if (!msg) return;

      chatReplyToMessage = msg;
      renderReplyPreviewBar();
      document.getElementById("chatTextInput")?.focus();
    };
  });

  container.querySelectorAll("[data-edit-message-id]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-edit-message-id");
      const msg = messages.find((m) => m.id === id);
      if (!msg) return;

      await editOwnMessage(id, msg.text || "");
    };
  });

  container.querySelectorAll("[data-delete-message-id]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-delete-message-id");
      const confirmed = confirm("Delete this message for everyone?");
      if (!confirmed) return;

      await softDeleteMessage(id);
    };
  });

  container.querySelectorAll("[data-save-edit-message-id]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-save-edit-message-id");
      await saveInlineEditedMessage(id);

      if (chatCurrentChatId) {
        await openChatById(chatCurrentChatId);
      }
    };
  });

  container.querySelectorAll("[data-cancel-edit-message-id]").forEach((btn) => {
    btn.onclick = async () => {
      cancelInlineEdit();

      if (chatCurrentChatId) {
        await openChatById(chatCurrentChatId);
      }
    };
  });
}

function ensureChatStyles() {
  if (document.getElementById("chatDynamicStyles")) return;

  const style = document.createElement("style");
  style.id = "chatDynamicStyles";
  style.textContent = `
    .chat-shell {
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 16px;
      min-height: 620px;
    }

    .chat-sidebar,
    .chat-main {
      min-width: 0;
    }

    .chat-sidebar {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .chat-sidebar-block,
    .chat-header,
    .chat-compose {
      border: 1px solid #dbe4f0;
      border-radius: 16px;
      background: #fff;
      padding: 14px;
    }

    .chat-sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .chat-thread-list,
    .chat-contacts-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 220px;
      overflow: auto;
      padding-right: 4px;
    }

    .chat-thread-item,
    .chat-contact-item {
      border: 1px solid #dbe4f0;
      border-radius: 14px;
      padding: 12px;
      cursor: pointer;
      background: #f8fafc;
      transition: all 0.18s ease;
    }

    .chat-thread-item:hover,
    .chat-contact-item:hover {
      border-color: #93c5fd;
      background: #eff6ff;
    }

    .chat-thread-item.active {
      border-color: #2563eb;
      background: #dbeafe;
    }

    .chat-thread-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 6px;
    }

    .chat-thread-title {
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
    }

    .chat-thread-meta {
      color: #64748b;
      font-size: 12px;
      white-space: nowrap;
    }

    .chat-thread-preview {
      color: #475569;
      font-size: 13px;
      line-height: 1.45;
    }

    .chat-unread-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      border-radius: 999px;
      padding: 0 8px;
      background: #2563eb;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
    }

    .chat-main {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 620px;
    }

    .chat-messages {
      flex: 1;
      min-height: 380px;
      max-height: 580px;
      overflow: auto;
      border: 1px solid #dbe4f0;
      border-radius: 16px;
      background: #f8fafc;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chat-message-row {
      display: flex;
    }

    .chat-message-row.mine {
      justify-content: flex-end;
    }

    .chat-message-row.theirs {
      justify-content: flex-start;
    }

    .chat-bubble {
      max-width: min(75%, 720px);
      border-radius: 16px;
      padding: 12px 14px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
      word-break: break-word;
    }

    .chat-bubble.mine {
      background: #dbeafe;
      border: 1px solid #93c5fd;
    }

    .chat-bubble.theirs {
      background: #ffffff;
      border: 1px solid #dbe4f0;
    }

    .chat-bubble-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
      font-size: 12px;
      color: #64748b;
    }

    .chat-bubble-name {
      font-weight: 700;
      color: #0f172a;
    }

    .chat-bubble-text {
      font-size: 14px;
      line-height: 1.55;
      color: #1e293b;
      white-space: pre-wrap;
    }

    .chat-attachment {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.72);
      border: 1px solid #dbe4f0;
      border-radius: 12px;
      text-decoration: none;
      color: #0f172a;
      font-size: 13px;
      font-weight: 600;
    }

    .chat-compose textarea {
      width: 100%;
      min-height: 90px;
      resize: vertical;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 12px;
      font: inherit;
      background: #fff;
    }

    .chat-compose-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .chat-compose-actions {
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .chat-file-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .chat-system-note {
      text-align: center;
      font-size: 13px;
      color: #64748b;
      margin: 8px 0;
    }

    .chat-contact-item.active {
      border-color: #2563eb;
      background: #dbeafe;
    }

    .active-project-room {
      box-shadow: inset 0 0 0 2px #1d4ed8;
    }

    .chat-mini-btn {
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #0f172a;
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }

    .chat-mini-btn:hover {
      background: #eff6ff;
      border-color: #93c5fd;
    }

    .chat-reply-preview {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      border-radius: 12px;
      padding: 10px 12px;
      margin-bottom: 10px;
    }

    .chat-reply-preview.hidden {
      display: none;
    }

    .chat-reply-preview-content {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }

    .chat-reply-preview-text {
      font-size: 13px;
      color: #334155;
      line-height: 1.45;
    }

    .chat-reply-snippet {
      border-left: 3px solid #60a5fa;
      padding-left: 8px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #475569;
    }

    .chat-message-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .chat-status-tick {
      margin-left: 8px;
      font-weight: 700;
      color: #94a3b8;
    }

    .chat-status-tick.seen {
      color: #2563eb;
    }

    .chat-edited-badge {
      margin-left: 8px;
      color: #64748b;
      font-size: 11px;
      font-style: italic;
    }

    .chat-inline-edit-wrap {
      margin-top: 10px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      border-radius: 12px;
      padding: 10px;
    }

    .chat-inline-edit-textarea {
      width: 100%;
      min-height: 70px;
      resize: vertical;
      border: 1px solid #93c5fd;
      border-radius: 10px;
      padding: 10px;
      font: inherit;
      background: #fff;
      color: #0f172a;
    }

    .chat-inline-edit-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 8px;
      flex-wrap: wrap;
    }
  `;
  document.head.appendChild(style);
}

function updateProjectRoomButtonState() {
  const btn = document.getElementById("openProjectRoomBtn");
  const projectCode = chatCurrentProjectCode();
  if (!btn) return;

  const projectRoomId = getProjectChatId(projectCode);
  const isActive = chatCurrentChatId === projectRoomId;

  btn.classList.toggle("active-project-room", isActive);
}

function chatSetProjectPill() {
  const pill = document.getElementById("chatProjectPill");
  if (!pill) return;

  const projectCode = chatCurrentProjectCode();

  if (!projectCode) {
    pill.innerHTML = `<i class="fas fa-folder-open"></i> No project selected`;
    return;
  }

  pill.innerHTML = `<i class="fas fa-folder-open"></i> ${chatEscapeHtml(projectCode)}`;
}

async function chatFetchProjectUsers(projectCode) {
  if (!projectCode) return [];

  const snapshot = await db
    .collection("users")
    .where("isActive", "==", true)
    .where("isDeleted", "==", false)
    .where("assignedProjects", "array-contains", projectCode)
    .get();

  const rows = [];
  snapshot.forEach((doc) => {
    const data = doc.data() || {};

    rows.push({
      uid: doc.id,
      fullName: data.fullName || "",
      email: data.email || "",
      role: data.role || "",
      assignedProjects: Array.isArray(data.assignedProjects) ? data.assignedProjects : [],
      isOnline: data.isOnline === true,
      lastSeen: data.lastSeen || null
    });
  });

  rows.sort((a, b) =>
    (a.fullName || a.email || "").localeCompare(b.fullName || b.email || "")
  );

  return rows;
}

async function ensureProjectRoom(projectCode) {
  const currentUid = chatCurrentUid();
  if (!projectCode || !currentUid) {
    throw new Error("Missing project code or current user.");
  }

  const chatId = getProjectChatId(projectCode);
  const docRef = db.collection("chats").doc(chatId);

  let users = [];
  try {
    users = await chatFetchProjectUsers(projectCode);
  } catch (error) {
    console.error("chatFetchProjectUsers inside ensureProjectRoom failed:", error);
    throw new Error("Unable to read assigned project users.");
  }

  const existingSnap = await docRef.get().catch((error) => {
    console.error("Project room read failed:", error);
    throw new Error("Unable to read project room.");
  });

  const existingData = existingSnap.exists ? (existingSnap.data() || {}) : {};

  const membersSet = new Set();

  const existingMembers = Array.isArray(existingData.members) ? existingData.members : [];
  existingMembers.forEach((uid) => {
    if (uid) membersSet.add(uid);
  });

  users
    .map((x) => x.uid)
    .filter(Boolean)
    .forEach((uid) => membersSet.add(uid));

  membersSet.add(currentUid);

  const members = Array.from(membersSet);

  const memberNames = {
    ...(existingData.memberNames || {})
  };

  users.forEach((user) => {
    if (!user?.uid) return;
    memberNames[user.uid] = user.fullName || user.email || user.uid;
  });

  if (!memberNames[currentUid]) {
    memberNames[currentUid] =
      window.currentUserProfile?.fullName ||
      window.currentUserProfile?.email ||
      currentUid;
  }

  const payload = {
    type: "project",
    active: true,
    projectCode,
    title: `${String(projectCode || "").toUpperCase()} Project Room`,
    members,
    memberNames,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  payload.memberState = {
    ...(existingData.memberState || {}),
    [currentUid]: {
      lastReadAt: firebase.firestore.FieldValue.serverTimestamp()
    }
  };

  if (!existingSnap.exists) {
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  }

  await docRef.set(payload, { merge: true }).catch((error) => {
    console.error("Project room write failed:", error, payload);
    throw new Error("Unable to create or update project room.");
  });

  return chatId;
}

async function ensureDirectChat(projectCode, otherUser) {
  const uid = chatCurrentUid();
  const chatId = getDirectChatId(projectCode, uid, otherUser.uid);

  const docRef = db.collection("chats").doc(chatId);

  await docRef.set({
    type: "direct",
    active: true,
    projectCode,
    title: `${otherUser.fullName || otherUser.email || "User"}`,
    members: [uid, otherUser.uid],
    memberNames: {
      [uid]: window.currentUserProfile.fullName || window.currentUserProfile.email || uid,
      [otherUser.uid]: otherUser.fullName || otherUser.email || otherUser.uid
    },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    memberState: {
      [uid]: {
        lastReadAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    }
  }, { merge: true });

  return chatId;
}

function renderContactsList() {
  const container = document.getElementById("chatContactsList");
  if (!container) return;

  const uid = chatCurrentUid();
  const projectCode = chatCurrentProjectCode();

  if (!projectCode) {
    container.innerHTML = `<div class="placeholder-box">Select a project first.</div>`;
    return;
  }

  const contacts = chatCurrentContacts
    .filter((x) => x.uid !== uid)
    .filter((user) => {
      if (chatListFilter === "project") return false;

      if (chatListFilter === "unread") {
        const directChatId = getDirectChatId(projectCode, uid, user.uid);
        const existingDirect = chatThreadsCache.find((chat) => chat.id === directChatId);
        if (!existingDirect || getChatUnreadCount(existingDirect) <= 0) return false;
      }

      return chatMatchesSearch([
        user.fullName || "",
        user.email || "",
        user.role || ""
      ]);
    });

  if (!contacts.length) {
    const label =
      chatListFilter === "project"
        ? "Project Room filter is active. No direct contacts shown."
        : "No other assigned users found for this project.";

    container.innerHTML = `<div class="placeholder-box">${chatEscapeHtml(label)}</div>`;
    return;
  }

  container.innerHTML = contacts.map((user) => {
    const directChatId = getDirectChatId(projectCode, uid, user.uid);
    const isActive = chatCurrentChatId === directChatId;

    return `
      <div class="chat-contact-item ${isActive ? "active" : ""}" data-chat-contact="${chatEscapeHtml(user.uid)}">
        <div class="chat-thread-top">
          <div class="chat-thread-title">${chatEscapeHtml(user.fullName || user.email || "User")}</div>
          <div class="chat-thread-meta">${chatEscapeHtml(user.role || "")}</div>
        </div>
        <div class="chat-thread-preview">${chatEscapeHtml(user.email || "")}</div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-chat-contact]").forEach((el) => {
    el.addEventListener("click", async () => {
      const selectedUid = el.getAttribute("data-chat-contact");
      const user = contacts.find((x) => x.uid === selectedUid);
      if (!user) return;

      const chatId = await ensureDirectChat(projectCode, user);
      await openChatById(chatId);
      renderContactsList();
      renderThreadsList();
    });
  });
}

function renderThreadsList() {
  const container = document.getElementById("chatThreadList");
  if (!container) return;

  const projectCode = chatCurrentProjectCode();

  const allProjectThreads = chatThreadsCache
    .filter((chat) => chat.active !== false && chat.projectCode === projectCode)
    .sort((a, b) => chatNowMsFromTimestamp(b.lastMessageAt || b.updatedAt) - chatNowMsFromTimestamp(a.lastMessageAt || a.updatedAt));

  const totalUnread = allProjectThreads.reduce((sum, chat) => sum + getChatUnreadCount(chat), 0);
  updateChatTabBadge(totalUnread);
  updateChatUnreadSummary(totalUnread);
  updateDocumentTitleUnread(totalUnread);

  const visibleThreads = allProjectThreads
    .filter((chat) => threadPassesCurrentFilter(chat))
    .filter((chat) => {
      const title = chat.type === "project"
        ? (chat.title || `${projectCode.toUpperCase()} Project Room`)
        : (chat.title || "Direct Message");

      return chatMatchesSearch([
        title,
        chat.lastMessageText || "",
        chat.projectCode || "",
        chat.type || ""
      ]);
    });

  if (!projectCode) {
    container.innerHTML = `<div class="placeholder-box">Select a project first.</div>`;
    return;
  }

  if (!visibleThreads.length) {
    const filterLabel =
      chatListFilter === "unread" ? "No unread conversations found." :
      chatListFilter === "project" ? "No project room found." :
      chatListFilter === "direct" ? "No direct conversations found." :
      "No conversations yet for this project.";

    container.innerHTML = `<div class="placeholder-box">${chatEscapeHtml(filterLabel)}</div>`;
    return;
  }

  container.innerHTML = visibleThreads.map((chat) => {
    const unread = getChatUnreadCount(chat);
    const isActive = chat.id === chatCurrentChatId;
    const title = chat.type === "project"
      ? (chat.title || `${projectCode.toUpperCase()} Project Room`)
      : (chat.title || "Direct Message");

    const preview = chat.lastMessageText || (chat.type === "project"
      ? "Open the project room to start chatting."
      : "Start a direct message.");

    const timeText = chatFormatTimestamp(chat.lastMessageAt || chat.updatedAt);

    return `
      <div class="chat-thread-item ${isActive ? "active" : ""}" data-chat-thread="${chatEscapeHtml(chat.id)}">
        <div class="chat-thread-top">
          <div class="chat-thread-title">${chatEscapeHtml(title)}</div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${unread ? `<span class="chat-unread-pill">${unread}</span>` : ""}
            <div class="chat-thread-meta">${chatEscapeHtml(timeText)}</div>
          </div>
        </div>
        <div class="chat-thread-preview">${chatEscapeHtml(preview)}</div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-chat-thread]").forEach((el) => {
    el.addEventListener("click", async () => {
      const chatId = el.getAttribute("data-chat-thread");
      await openChatById(chatId);
      renderContactsList();
      updateProjectRoomButtonState();
    });
  });
}

function renderActiveChatHeader(chatDoc) {
  const titleEl = document.getElementById("chatActiveTitle");
  const metaEl = document.getElementById("chatActiveMeta");

  if (!titleEl || !metaEl) return;

  if (!chatDoc) {
    titleEl.textContent = "Select a conversation";
    metaEl.textContent = "Choose a project room or direct message";
    ensureSoundToggleButton();
    return;
  }

  if (chatDoc.type === "project") {
    titleEl.textContent = chatDoc.title || `${String(chatDoc.projectCode || "").toUpperCase()} Project Room`;
  } else {
    titleEl.textContent = getOtherParticipantName(chatDoc) || chatDoc.title || "Direct Message";
  }

  metaEl.textContent = getChatMetaLabel(chatDoc);
  ensureSoundToggleButton();
  renderChatHeaderAvatar(chatDoc);
}

function renderChatHeaderAvatar(chatDoc) {
  const avatar = document.getElementById("chatHeaderAvatar");
  if (!avatar) return;

  if (!chatDoc) {
    avatar.innerHTML = `<i class="fas fa-comments"></i>`;
    return;
  }

  if (chatDoc.type === "project") {
    avatar.innerHTML = `<i class="fas fa-users"></i>`;
    return;
  }

  avatar.innerHTML = `<i class="fas fa-user"></i>`;
}

function renderTypingIndicator(chatDoc) {
  const el = document.getElementById("chatTypingNotice");
  if (!el) return;

  if (!chatDoc || !chatDoc.typingBy) {
    el.classList.add("hidden");
    return;
  }

  const uid = chatCurrentUid();
  const activeTypers = Object.entries(chatDoc.typingBy || {})
    .filter(([typingUid, value]) => typingUid !== uid)
    .filter(([, value]) => {
      const ms = chatNowMsFromTimestamp(value?.at);
      if (!ms) return false;
      return (Date.now() - ms) <= 15000;
    })
    .map(([, value]) => value?.name)
    .filter(Boolean);

  if (!activeTypers.length) {
    el.classList.add("hidden");
    return;
  }

  const label = activeTypers.length === 1
    ? `${activeTypers[0]} is typing...`
    : `${activeTypers.length} people are typing...`;

  el.innerHTML = `<i class="fas fa-keyboard"></i> ${chatEscapeHtml(label)}`;
  el.classList.remove("hidden");
}

function renderMessages(messages) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  if (!messages.length) {
    container.innerHTML = `<div class="placeholder-box">No messages yet. Start the conversation.</div>`;
    return;
  }

  const myUid = chatCurrentUid();

  container.innerHTML = messages.map((msg) => {
    const mine = msg.senderId === myUid;
    const bubbleClass = mine ? "mine" : "theirs";
    const deleted = msg.isDeleted === true;

    const attachmentHtml = !deleted && msg.attachmentUrl
      ? `
        <a class="chat-attachment" href="${chatEscapeHtml(msg.attachmentUrl)}" target="_blank" rel="noopener">
          <i class="fas fa-paperclip"></i>
          <span>${chatEscapeHtml(msg.attachmentName || "Attachment")}</span>
        </a>
      `
      : "";

    const locationHtml = !deleted && msg.location?.mapUrl
      ? `
        <a class="chat-attachment" href="${chatEscapeHtml(msg.location.mapUrl)}" target="_blank" rel="noopener">
          <i class="fas fa-location-dot"></i>
          <span>Shared location</span>
        </a>
      `
      : "";

    const replyHtml = msg.replyToMessageId
      ? `
        <div class="chat-reply-snippet">
          Reply to <strong>${chatEscapeHtml(msg.replyToSenderName || "User")}</strong><br>
          ${chatEscapeHtml(msg.replyToText || "")}
        </div>
      `
      : "";

    const editedHtml = msg.editedAt ? `<span class="chat-edited-badge">(edited)</span>` : "";
    const tickHtml = messageTickHtml(msg);

    const messageText = deleted
      ? `<em>This message was deleted</em>`
      : chatEscapeHtml(msg.text || "");

    const isEditingThisMessage = mine && chatEditingMessageId === msg.id;

    const inlineEditHtml = isEditingThisMessage
      ? `
        <div class="chat-inline-edit-wrap">
          <textarea
            id="chatInlineEditInput_${chatEscapeHtml(msg.id)}"
            class="chat-inline-edit-textarea"
          >${chatEscapeHtml(chatEditingOriginalText || msg.text || "")}</textarea>

          <div class="chat-inline-edit-actions">
            <button type="button" class="chat-mini-btn" data-save-edit-message-id="${chatEscapeHtml(msg.id)}">Save</button>
            <button type="button" class="chat-mini-btn" data-cancel-edit-message-id="${chatEscapeHtml(msg.id)}">Cancel</button>
          </div>
        </div>
      `
      : "";

    const actionHtml = deleted
      ? ``
      : `
        <div class="chat-message-actions">
          <button type="button" class="chat-mini-btn" data-reply-message-id="${chatEscapeHtml(msg.id)}">Reply</button>
          ${
            mine
              ? `
                <button type="button" class="chat-mini-btn" data-edit-message-id="${chatEscapeHtml(msg.id)}">Edit</button>
                <button type="button" class="chat-mini-btn" data-delete-message-id="${chatEscapeHtml(msg.id)}">Delete</button>
              `
              : ``
          }
        </div>
        ${inlineEditHtml}
      `;

    return `
      <div class="chat-message-row ${mine ? "mine" : "theirs"}">
        <div class="chat-bubble ${bubbleClass}">
          <div class="chat-bubble-head">
            <span class="chat-bubble-name">${chatEscapeHtml(msg.senderName || msg.senderEmail || "User")}</span>
            <span>
              ${chatEscapeHtml(chatFormatTimestamp(msg.createdAt))}
              ${editedHtml}
              ${tickHtml}
            </span>
          </div>
          ${replyHtml}
          ${isEditingThisMessage ? "" : `<div class="chat-bubble-text">${messageText}</div>`}
          ${locationHtml}
          ${attachmentHtml}
          ${actionHtml}
        </div>
      </div>
    `;
  }).join("");

  bindMessageActionButtons(messages);
  container.scrollTop = container.scrollHeight;
}

async function markChatRead(chatId) {
  const uid = chatCurrentUid();
  if (!uid || !chatId) return;

  await db.collection("chats").doc(chatId).set({
    memberState: {
      [uid]: {
        lastReadAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    }
  }, { merge: true });
}

async function openChatById(chatId) {
  if (!chatId) return;

  chatCurrentChatId = chatId;

  let matching = chatThreadsCache.find((x) => x.id === chatId) || null;

  if (!matching) {
    try {
      const snap = await db.collection("chats").doc(chatId).get();
      if (snap.exists) {
        matching = { id: snap.id, ...snap.data() };
      }
    } catch (error) {
      console.error("Direct chat doc fetch failed inside openChatById:", error);
    }
  }

  if (!matching) {
    const currentProject = chatCurrentProjectCode();

    if (String(chatId).startsWith("project__")) {
      matching = {
        id: chatId,
        type: "project",
        projectCode: currentProject,
        title: `${String(currentProject || "").toUpperCase()} Project Room`
      };
    } else {
      matching = {
        id: chatId,
        type: "direct",
        projectCode: currentProject,
        title: "Direct Message"
      };
    }
  }

  chatCurrentChatDoc = matching;

  const existingIndex = chatThreadsCache.findIndex((x) => x.id === matching.id);

  if (existingIndex >= 0) {
    chatThreadsCache[existingIndex] = {
      ...chatThreadsCache[existingIndex],
      ...matching
    };
  } else {
    chatThreadsCache.unshift(matching);
  }

  renderThreadsList();
  renderContactsList();
  updateProjectRoomButtonState();
  renderActiveChatHeader(matching);
  renderTypingIndicator(matching);

  await markChatRead(chatId);

  if (typeof logActivity === "function") {
    await logActivity("chat_opened", {
      page: "chat",
      target: chatId
    });
  }

  if (chatMessagesUnsubscribe) {
    chatMessagesUnsubscribe();
    chatMessagesUnsubscribe = null;
  }

  chatMessagesUnsubscribe = db.collection("chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(200)
    .onSnapshot((snapshot) => {
      const messages = [];
      snapshot.forEach((doc) => {
        messages.push({ id: doc.id, ...doc.data() });
      });

      renderMessages(messages);
      markChatRead(chatId).catch(console.error);
    }, (error) => {
      console.error("Chat messages listener failed:", error);
      const container = document.getElementById("chatMessages");
      if (container) {
        container.innerHTML = `<div class="placeholder-box">Failed to load messages.</div>`;
      }
    });
}

async function subscribeThreadsRealtime() {
  const uid = chatCurrentUid();
  if (!uid) return;

  if (chatThreadsUnsubscribe) {
    chatThreadsUnsubscribe();
    chatThreadsUnsubscribe = null;
  }

  chatThreadsUnsubscribe = db.collection("chats")
    .where("members", "array-contains", uid)
    .onSnapshot((snapshot) => {
      const rows = [];
      snapshot.forEach((doc) => {
        rows.push({ id: doc.id, ...doc.data() });
      });

      rows.sort((a, b) => chatNowMsFromTimestamp(b.lastMessageAt || b.updatedAt) - chatNowMsFromTimestamp(a.lastMessageAt || a.updatedAt));
      chatThreadsCache = rows;

      renderThreadsList();
      renderContactsList();
      updateProjectRoomButtonState();

      if (chatCurrentChatId) {
        const refreshed = rows.find((x) => x.id === chatCurrentChatId) || null;
        chatCurrentChatDoc = refreshed;
        renderActiveChatHeader(refreshed);
        renderTypingIndicator(refreshed);
      }

      const totalUnread = rows
        .filter((chat) => chat.projectCode === chatCurrentProjectCode())
        .reduce((sum, chat) => sum + getChatUnreadCount(chat), 0);

      updateChatTabBadge(totalUnread);
      updateChatUnreadSummary(totalUnread);
      updateDocumentTitleUnread(totalUnread);

      rows.forEach((chat) => {
        const lastMessageAtMs = chatNowMsFromTimestamp(chat.lastMessageAt);
        const unread = getChatUnreadCount(chat);
        if (!lastMessageAtMs || !unread) return;
        if (chat.lastMessageBy === uid) return;

        const toastKey = `${chat.id}__${lastMessageAtMs}`;
        if (chatLastNotifiedMap[toastKey]) return;

        chatLastNotifiedMap[toastKey] = true;

        const isChatTabActive = document.getElementById("tab-chat")?.classList.contains("active");
        if (!isChatTabActive || chat.id !== chatCurrentChatId) {
          showChatToast(chat.title || "New message", chat.lastMessageText || "You have a new message.");
          playIncomingMessageSound();
        }
      });
    }, (error) => {
      console.error("Chat thread listener failed:", error);

      const threadList = document.getElementById("chatThreadList");
      const messagesBox = document.getElementById("chatMessages");

      if (threadList) {
        threadList.innerHTML = `
          <div class="placeholder-box">
            Failed to load conversations.<br>
            <small>${chatEscapeHtml(chatExplainFirestoreError(error))}</small>
          </div>
        `;
      }

      if (messagesBox && !chatCurrentChatId) {
        messagesBox.innerHTML = `
          <div class="placeholder-box">
            Conversation list is unavailable for this account.
          </div>
        `;
      }
    });
}

async function refreshContactsForCurrentProject() {
  const projectCode = chatCurrentProjectCode();
  const contactsList = document.getElementById("chatContactsList");

  if (!projectCode) {
    chatCurrentContacts = [];
    renderContactsList();
    return;
  }

  try {
    chatCurrentContacts = await chatFetchProjectUsers(projectCode);
    renderContactsList();
  } catch (error) {
    console.error("chatFetchProjectUsers failed:", error);
    chatCurrentContacts = [];

    if (contactsList) {
      contactsList.innerHTML = `
        <div class="placeholder-box">
          Could not load assigned users for this project.<br>
          <small>${chatEscapeHtml(chatExplainFirestoreError(error))}</small>
        </div>
      `;
    }

    throw error;
  }
}

function getSelectedAttachmentFile() {
  const input = document.getElementById("chatFileInput");
  return input?.files?.[0] || null;
}

function refreshAttachmentLabel() {
  const file = getSelectedAttachmentFile();
  const label = document.getElementById("chatAttachmentName");
  if (!label) return;
  label.textContent = file ? file.name : "";
}

async function uploadChatAttachment(chatId, file) {
  const safeName = `${Date.now()}__${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const path = `chat_uploads/${chatId}/${safeName}`;
  const ref = storage.ref(path);

  await ref.put(file);
  const url = await ref.getDownloadURL();

  return {
    attachmentUrl: url,
    attachmentName: file.name,
    attachmentPath: path,
    attachmentContentType: file.type || "",
    attachmentSize: file.size || 0
  };
}

async function sendTypingState(isTyping) {
  if (!chatCurrentChatId || !chatCurrentUid()) return;

  const uid = chatCurrentUid();
  const docRef = db.collection("chats").doc(chatCurrentChatId);

  if (isTyping) {
    await docRef.set({
      typingBy: {
        [uid]: {
          name: window.currentUserProfile.fullName || window.currentUserProfile.email || "User",
          at: firebase.firestore.FieldValue.serverTimestamp()
        }
      }
    }, { merge: true });
    return;
  }

  await docRef.update({
    [`typingBy.${uid}`]: firebase.firestore.FieldValue.delete()
  }).catch(() => {});
}

async function sendChatMessage() {
  if (!chatCurrentChatId) {
    alert("Please open a conversation first.");
    return;
  }

  const textInput = document.getElementById("chatTextInput");
  const fileInput = document.getElementById("chatFileInput");

  const text = (textInput?.value || "").trim();
  const file = getSelectedAttachmentFile();

  if (!text && !file) {
    return;
  }

  let attachmentPayload = {};

  try {
    const sendBtn = document.getElementById("chatSendBtn");
    if (sendBtn) {
      sendBtn.disabled = true;
    }

    if (file) {
      attachmentPayload = await uploadChatAttachment(chatCurrentChatId, file);

      if (typeof logActivity === "function") {
        await logActivity("chat_attachment_uploaded", {
          page: "chat",
          target: attachmentPayload.attachmentName || ""
        });
      }
    }

    const messagePayload = {
      senderId: chatCurrentUid(),
      senderName: window.currentUserProfile.fullName || "",
      senderEmail: window.currentUserProfile.email || "",
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      isDeleted: false,
      ...(chatPendingLocation
        ? {
            location: {
              latitude: chatPendingLocation.latitude,
              longitude: chatPendingLocation.longitude,
              mapUrl: chatPendingLocation.mapUrl
            }
          }
        : {}),
      ...(chatReplyToMessage
        ? {
            replyToMessageId: chatReplyToMessage.id || "",
            replyToSenderName: chatReplyToMessage.senderName || chatReplyToMessage.senderEmail || "User",
            replyToText: chatReplyToMessage.text || ""
          }
        : {}),
      ...attachmentPayload
    };

    await db.collection("chats")
      .doc(chatCurrentChatId)
      .collection("messages")
      .add(messagePayload);

    await db.collection("chats").doc(chatCurrentChatId).set({
      active: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageText: text || (attachmentPayload.attachmentName ? `Attachment: ${attachmentPayload.attachmentName}` : "Attachment"),
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageBy: chatCurrentUid(),
      lastMessageType: attachmentPayload.attachmentUrl ? (text ? "text_attachment" : "attachment") : "text",
      memberState: {
        [chatCurrentUid()]: {
          lastReadAt: firebase.firestore.FieldValue.serverTimestamp()
        }
      }
    }, { merge: true });

    if (textInput) textInput.value = "";
    if (fileInput) {
      fileInput.value = "";
      fileInput.removeAttribute("accept");
      fileInput.removeAttribute("capture");
    }

    chatReplyToMessage = null;
    chatPendingLocation = null;
    renderReplyPreviewBar();
    refreshAttachmentLabel();
    await sendTypingState(false);

    if (typeof logActivity === "function") {
      await logActivity("chat_message_sent", {
        page: "chat",
        target: chatCurrentChatId
      });
    }
  } catch (error) {
    console.error("Failed to send message:", error);
    alert(error.message || "Failed to send message.");
  } finally {
    const sendBtn = document.getElementById("chatSendBtn");
    if (sendBtn) {
      sendBtn.disabled = false;
    }
  }
}

function bindComposeEvents() {
  const sendBtn = document.getElementById("chatSendBtn");
  const textInput = document.getElementById("chatTextInput");
  const fileInput = document.getElementById("chatFileInput");
  const openProjectRoomBtn = document.getElementById("openProjectRoomBtn");
  const chatSidebarProjectBtn = document.getElementById("chatSidebarProjectBtn");

  ensureReplyPreviewBar();
  updateSoundToggleButton();
  ensureEmojiBar();
  bindChatSearchAndFilters();

  if (sendBtn && !sendBtn.dataset.bound) {
    sendBtn.dataset.bound = "true";
    sendBtn.addEventListener("click", sendChatMessage);
  }

  if (fileInput && !fileInput.dataset.bound) {
    fileInput.dataset.bound = "true";
    fileInput.addEventListener("change", refreshAttachmentLabel);
  }

  if (textInput && !textInput.dataset.bound) {
    textInput.dataset.bound = "true";

    textInput.addEventListener("input", async () => {
      await sendTypingState(true);

      if (chatTypingTimeoutHandle) {
        clearTimeout(chatTypingTimeoutHandle);
      }

      chatTypingTimeoutHandle = setTimeout(() => {
        sendTypingState(false).catch(console.error);
      }, 1800);
    });

    textInput.addEventListener("keydown", async (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        await sendChatMessage();
      }
    });
  }

  async function handleOpenProjectRoom() {
    const projectCode = chatCurrentProjectCode();
    if (!projectCode) {
      alert("Select a project first.");
      return;
    }

    try {
      const chatId = await ensureProjectRoom(projectCode);
      await openChatById(chatId);
      renderThreadsList();
      renderContactsList();
      updateProjectRoomButtonState();
    } catch (error) {
      console.error("Open Project Room failed:", error);

      const messagesBox = document.getElementById("chatMessages");
      if (messagesBox) {
        messagesBox.innerHTML = `
          <div class="placeholder-box">
            Project room could not be opened for this user.<br>
            <small>${chatEscapeHtml(error.message || "Unknown error")}</small>
          </div>
        `;
      }
    }
  }

  if (openProjectRoomBtn && !openProjectRoomBtn.dataset.bound) {
    openProjectRoomBtn.dataset.bound = "true";
    openProjectRoomBtn.addEventListener("click", handleOpenProjectRoom);
  }

  if (chatSidebarProjectBtn && !chatSidebarProjectBtn.dataset.bound) {
    chatSidebarProjectBtn.dataset.bound = "true";
    chatSidebarProjectBtn.addEventListener("click", handleOpenProjectRoom);
  }
}

async function refreshChatContext() {
  const projectCode = chatCurrentProjectCode();

  ensureChatStyles();
  bindAllChatUI();
  chatSetProjectPill();

  const threadList = document.getElementById("chatThreadList");
  const contactsList = document.getElementById("chatContactsList");
  const messagesBox = document.getElementById("chatMessages");

  if (!window.currentUserProfile) return;

  if (!projectCode) {
    if (threadList) {
      threadList.innerHTML = `<div class="placeholder-box">Select a project first.</div>`;
    }
    if (contactsList) {
      contactsList.innerHTML = `<div class="placeholder-box">Select a project first.</div>`;
    }
    if (messagesBox && !chatCurrentChatId) {
      messagesBox.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-icon"><i class="fas fa-comments"></i></div>
          <div class="chat-empty-title">Open a chat to start messaging</div>
          <div class="chat-empty-text">Select a project first, then open the project room or direct message.</div>
        </div>
      `;
    }
    return;
  }

  let projectRoomId = getProjectChatId(projectCode);
  let roomReady = false;
  let contactsReady = false;

  if (threadList) {
    threadList.innerHTML = `<div class="placeholder-box">Loading conversations...</div>`;
  }

  if (contactsList) {
    contactsList.innerHTML = `<div class="placeholder-box">Loading contacts...</div>`;
  }

  try {
    await ensureProjectRoom(projectCode);
    roomReady = true;
  } catch (error) {
    console.error("ensureProjectRoom failed:", error);

    if (threadList) {
      threadList.innerHTML = `
        <div class="placeholder-box">
          Unable to prepare the project room.<br>
          <small>${chatEscapeHtml(error.message || "Permission denied or invalid data.")}</small>
        </div>
      `;
    }

    if (messagesBox) {
      messagesBox.innerHTML = `
        <div class="placeholder-box">
          Project room could not be opened for this user.
        </div>
      `;
    }
  }

  try {
    await refreshContactsForCurrentProject();
    contactsReady = true;
  } catch (error) {
    console.error("refreshContactsForCurrentProject failed:", error);

    if (contactsList) {
      contactsList.innerHTML = `
        <div class="placeholder-box">
          Failed to load assigned users.<br>
          <small>${chatEscapeHtml(error.message || "Permission denied or invalid user records.")}</small>
        </div>
      `;
    }
  }

  try {
    renderThreadsList();
    renderContactsList();
    updateProjectRoomButtonState();
  } catch (error) {
    console.error("renderThreadsList failed:", error);
  }

  if (!roomReady) {
    return;
  }

  try {
    if (
      !chatCurrentChatId ||
      !chatThreadsCache.some((x) => x.id === chatCurrentChatId && x.projectCode === projectCode)
    ) {
      await openChatById(projectRoomId);
    }
  } catch (error) {
    console.error("openChatById failed:", error);

    if (messagesBox) {
      messagesBox.innerHTML = `
        <div class="placeholder-box">
          Conversation exists but messages could not be opened.<br>
          <small>${chatEscapeHtml(chatExplainFirestoreError(error))}</small>
        </div>
      `;
    }
  }

  if (!contactsReady) {
    console.warn("Chat loaded without contacts list.");
  }

  requestAnimationFrame(() => {
    ensureEmojiBar();
  });

  setTimeout(() => {
    ensureEmojiBar();
  }, 50);
}

window.refreshChatContext = refreshChatContext;

window.initializeChatModule = async function () {
  if (!chatCanUse()) return;

  ensureChatStyles();
  bindAllChatUI();

  if (!chatThreadsUnsubscribe) {
    await subscribeThreadsRealtime();
  }

  await refreshChatContext();
};

window.setupChatUI = function () {
  if (chatBound) return;
  chatBound = true;

  ensureChatStyles();
  bindAllChatUI();
};

function bindProjectRoomButton() {
  const btn = document.getElementById("openProjectRoomBtn");
  if (!btn || btn.dataset.bound) return;

  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    const projectCode = chatCurrentProjectCode();
    if (!projectCode) {
      alert("No project selected");
      return;
    }

    try {
      const chatId = await ensureProjectRoom(projectCode);
      await openChatById(chatId);
      renderThreadsList();
      renderContactsList();
      updateProjectRoomButtonState();
    } catch (error) {
      console.error("bindProjectRoomButton failed:", error);
      const messagesBox = document.getElementById("chatMessages");
      if (messagesBox) {
        messagesBox.innerHTML = `
          <div class="placeholder-box">
            Project room could not be opened.<br>
            <small>${chatEscapeHtml(error.message || "Unknown error")}</small>
          </div>
        `;
      }
    }
  });
}

function bindTopProjectIcon() {
  const btn = document.getElementById("chatSidebarProjectBtn");
  if (!btn || btn.dataset.bound) return;

  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    const projectCode = chatCurrentProjectCode();
    if (!projectCode) {
      alert("Select a project first.");
      return;
    }

    try {
      const chatId = await ensureProjectRoom(projectCode);
      await openChatById(chatId);
      renderThreadsList();
      renderContactsList();
      updateProjectRoomButtonState();
    } catch (error) {
      console.error("Top project room icon failed:", error);
    }
  });
}