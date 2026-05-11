const socket = io();
window.BlackKnightSafety?.bindSocketSafety(socket);
window.BlackKnightSafety?.bindSocketSafety(socket);
const pageMode = document.currentScript.dataset.roomMode;
const profileChipsEl = document.querySelector("#profileChips");
const translateBtnEl = document.querySelector("#translateBtn");

const chatForm = document.querySelector("#chatForm");
const messages = document.querySelector("#messages");
const messageTemplate = document.querySelector("#messageTemplate");
const matchName = document.querySelector("#matchName");
const matchStatus = document.querySelector("#matchStatus");
const reconnectCode = document.querySelector("#reconnectCode");
const privacyWatermark = document.querySelector("#privacyWatermark");
const copyCodeBtn = document.querySelector("#copyCodeBtn");
const remoteLabel = document.querySelector("#remoteLabel");
const cameraBtn = document.querySelector("#cameraBtn");
const micBtn = document.querySelector("#micBtn");
const endCallBtn = document.querySelector("#endCallBtn");
const skipBtn = document.querySelector("#skipBtn");
const blockBtn = document.querySelector("#blockBtn");
const reportBtn = document.querySelector("#reportBtn");
const messageInput = document.querySelector("#messageInput");
const nextAdSlot = document.querySelector("#nextAdSlot");
const typingIndicator = document.querySelector("#typingIndicator");
const localVideo = document.querySelector("#localVideo");
const remoteVideo = document.querySelector("#remoteVideo");

if (chatForm && skipBtn && messageInput && skipBtn.parentElement !== chatForm) {
  skipBtn.classList.add("next-inline-btn");
  chatForm.insertBefore(skipBtn, messageInput);
}

if (pageMode === "video" && endCallBtn) {
  endCallBtn.remove();
}

const storageKeys = {
  pendingProfile: "bk_pending_profile",
  reconnectCode: "bk_reconnect_code",
};

let currentUser = null;
let currentMatch = null;
let videoActive = false;
let localStream = null;
let peerConnection = null;
let wasBanned = false;
let activeReconnectCode = "";
let typingTimer = null;
let remoteTypingTimer = null;
let nextClickCount = 0;
let localMediaReady = false;
let pendingIceCandidates = [];
let outgoingBlurEnabled = false;
let blurCanvasStream = null;
let blurAnimationFrame = null;
let translateEnabled = false;

const translationDictionary = {
  hello: "नमस्ते",
  hi: "नमस्ते",
  thanks: "धन्यवाद",
  friend: "दोस्त",
  game: "खेल",
  sad: "उदास",
  love: "प्यार",
  yes: "हाँ",
  no: "नहीं",
};

let rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function loadProfile() {
  const rawProfile = sessionStorage.getItem(storageKeys.pendingProfile);
  if (!rawProfile) {
    window.location.replace("/");
    return null;
  }

  const profile = JSON.parse(rawProfile);
  profile.mode = pageMode;
  return profile;
}

function setSystemMessage(text) {
  const isWaitingState = /looking|waiting|finding|searching/i.test(text);
  messages.innerHTML = isWaitingState
    ? `<div class="empty-state"><span class="radar-loader"></span><strong>${text}</strong></div>`
    : `<div class="empty-state">${text}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function translateText(text) {
  return text
    .split(/\b/)
    .map((part) => translationDictionary[part.toLowerCase()] || part)
    .join("");
}

function addMessage(author, text, own = false) {
  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("mine", own);
  node.querySelector("span").textContent = author;
  const translated = !own && translateEnabled ? translateText(text) : "";
  node.querySelector("p").innerHTML = translated
    ? `${escapeHtml(translated)} <small class="translated-label">Translated</small><br><span class="original-message">${escapeHtml(text)}</span>`
    : escapeHtml(text);
  if (messages.querySelector(".empty-state")) messages.innerHTML = "";
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function updateMatchUI() {
  if (!currentMatch) {
    matchName.textContent = "Waiting room";
    if (remoteLabel) remoteLabel.textContent = "Match";
    matchStatus.textContent = "Waiting";
    matchStatus.classList.remove("online");
    return;
  }

  matchName.textContent = currentMatch.name;
  if (remoteLabel) remoteLabel.textContent = currentMatch.name;
  if (privacyWatermark) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    privacyWatermark.textContent = `Black_knight · ${currentUser?.name || "Guest"} · ${time}`;
  }
  matchStatus.textContent = "Online";
  matchStatus.classList.add("online");
}

function resetVideoButton() {
  videoActive = false;
  cameraBtn?.classList.remove("active");
  micBtn?.classList.remove("active");
  if (cameraBtn) cameraBtn.textContent = "Camera off";
  if (micBtn) micBtn.textContent = "Mic off";
}

function setVideoTileState() {
  if (!localVideo || !remoteVideo) return;
  localVideo.closest(".video-tile").classList.toggle("has-video", Boolean(localVideo.srcObject));
  remoteVideo.closest(".video-tile").classList.toggle("has-video", Boolean(remoteVideo.srcObject));
}

async function getLocalStream() {
  if (localStream) return localStream;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera is not available in this browser.");
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: "user",
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  localVideo.srcObject = localStream;
  setVideoTileState();
  return localStream;
}

function stopBlurTrack() {
  if (blurAnimationFrame) window.cancelAnimationFrame(blurAnimationFrame);
  blurAnimationFrame = null;
  blurCanvasStream?.getTracks().forEach((track) => track.stop());
  blurCanvasStream = null;
}

function createBlurredVideoTrack() {
  if (!localStream) return null;
  if (blurCanvasStream) return blurCanvasStream.getVideoTracks()[0] || null;

  const sourceVideo = document.createElement("video");
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  sourceVideo.srcObject = localStream;
  sourceVideo.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");

  const draw = () => {
    if (!localStream || !context) return;
    context.save();
    context.filter = "blur(18px)";
    context.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
    context.restore();
    blurAnimationFrame = window.requestAnimationFrame(draw);
  };
  draw();

  blurCanvasStream = canvas.captureStream(24);
  const blurredTrack = blurCanvasStream.getVideoTracks()[0];
  if (blurredTrack) blurredTrack.enabled = localStream.getVideoTracks()[0]?.enabled !== false;
  return blurredTrack || null;
}

async function setOutgoingBlur(enabled) {
  outgoingBlurEnabled = enabled;
  if (!localStream) await getLocalStream();

  const originalTrack = localStream.getVideoTracks()[0];
  const nextTrack = enabled ? createBlurredVideoTrack() : originalTrack;
  if (!nextTrack) return;

  const sender = peerConnection?.getSenders().find((item) => item.track?.kind === "video");
  if (sender) await sender.replaceTrack(nextTrack);
}

async function prepareLocalMedia() {
  if (pageMode !== "video" || localMediaReady) return;

  try {
    await getLocalStream();
    localMediaReady = true;
    cameraBtn?.classList.add("active");
    micBtn?.classList.add("active");
  } catch (error) {
    addMessage("System", "Camera/microphone permission is required. Tap the address bar lock icon and allow camera and microphone.");
    throw error;
  }
}

async function createPeerConnection(options = { requireLocal: true }) {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) socket.emit("video-signal", { type: "ice-candidate", candidate: event.candidate });
  };
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setVideoTileState();
  };

  if (options.requireLocal) {
    const stream = await getLocalStream();
    stream.getTracks().forEach((track) => {
      if (track.kind === "video" && outgoingBlurEnabled) {
        const blurredTrack = createBlurredVideoTrack();
        peerConnection.addTrack(blurredTrack || track, stream);
        return;
      }
      peerConnection.addTrack(track, stream);
    });
  } else {
    peerConnection.addTransceiver("video", { direction: "recvonly" });
    peerConnection.addTransceiver("audio", { direction: "recvonly" });
  }
  peerConnection.addEventListener("connectionstatechange", () => {
    if (peerConnection.connectionState !== "connected") return;

    peerConnection.getSenders().forEach((sender) => {
      if (sender.track?.kind !== "video") return;
      const parameters = sender.getParameters();
      parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      parameters.encodings[0].maxBitrate = 1500000;
      parameters.encodings[0].maxFramerate = 30;
      sender.setParameters(parameters).catch(() => {});
    });
  });

  return peerConnection;
}

async function startVideoCall() {
  if (videoActive) return;
  videoActive = true;
  await prepareLocalMedia();
  const connection = await createPeerConnection();
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  socket.emit("video-signal", { type: "offer", description: connection.localDescription });
}

function stopVideoCall(notifyMatch = true) {
  if (notifyMatch && currentMatch) socket.emit("video-signal", { type: "end" });
  peerConnection?.close();
  peerConnection = null;
  pendingIceCandidates = [];
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  stopBlurTrack();
  outgoingBlurEnabled = false;
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  setVideoTileState();
  resetVideoButton();
}

function startMatching() {
  currentUser = loadProfile();
  if (!currentUser) return;

  updateMatchUI();
  setSystemMessage(pageMode === "video" ? "Waiting for a matching user..." : "Searching another soul...");

  if (pageMode === "video") {
    if (sessionStorage.getItem("bk_video_permission_ready") !== "true") {
      window.location.replace("/");
      return;
    }

    prepareLocalMedia()
      .then(() => socket.emit("join", currentUser))
      .catch(() => setSystemMessage("Allow camera and microphone, then go back and start Video Chat again."));
    return;
  }

  socket.emit("join", currentUser);
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    if (Array.isArray(config.iceServers) && config.iceServers.length) {
      rtcConfig = { iceServers: config.iceServers };
    }
  } catch (error) {
    rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentUser || !currentMatch) {
    setSystemMessage("Wait for a match before sending a message.");
    return;
  }

  const text = messageInput.value.trim();
  if (!text) return;
  addMessage(currentUser.name, text, true);
  socket.emit("chat-message", { text });
  socket.emit("typing", { isTyping: false });
  messageInput.value = "";
});

messageInput.addEventListener("input", () => {
  if (!currentMatch) return;
  socket.emit("typing", { isTyping: Boolean(messageInput.value.trim()) });
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => {
    socket.emit("typing", { isTyping: false });
  }, 1200);
});

cameraBtn?.addEventListener("click", () => {
  if (!localStream) {
    prepareLocalMedia()
      .then(() => addMessage("System", "Camera and microphone are active."))
      .catch(() => addMessage("System", "Camera permission is still blocked."));
    return;
  }

  const videoTrack = localStream?.getVideoTracks()[0];
  if (!videoTrack) return;

  videoTrack.enabled = !videoTrack.enabled;
  const blurredTrack = blurCanvasStream?.getVideoTracks()[0];
  if (blurredTrack) blurredTrack.enabled = videoTrack.enabled;
  cameraBtn.classList.toggle("active", videoTrack.enabled);
  cameraBtn.textContent = videoTrack.enabled ? "Camera off" : "Camera on";
});

micBtn?.addEventListener("click", () => {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (!audioTrack) return;

  audioTrack.enabled = !audioTrack.enabled;
  micBtn.classList.toggle("active", audioTrack.enabled);
  micBtn.textContent = audioTrack.enabled ? "Mic off" : "Mic on";
});

endCallBtn?.addEventListener("click", () => {
  if (!videoActive && !localStream && !peerConnection) return;
  addMessage("System", "Video call ended.");
  stopVideoCall();
});

skipBtn.addEventListener("click", () => {
  nextClickCount += 1;
  if (nextClickCount % 5 === 0) {
    nextAdSlot?.classList.add("visible");
  } else {
    nextAdSlot?.classList.remove("visible");
  }

  currentMatch = null;
  stopVideoCall();
  updateMatchUI();
  setSystemMessage(pageMode === "video" ? "Waiting for a matching user..." : "Searching another soul...");
  socket.emit("next");
});

blockBtn.addEventListener("click", () => {
  if (!currentMatch) return;
  addMessage("System", `${currentMatch.name} was blocked for this session.`);
  currentMatch = null;
  stopVideoCall();
  updateMatchUI();
  socket.emit("block");
});

reportBtn.addEventListener("click", () => {
  if (!currentMatch) return;
  const category = window.BlackKnightSafety?.pickReportCategory?.() || "Abuse";
  const reason = window.prompt("Optional report detail:", category);
  if (!reason) return;
  socket.emit("report", { matchId: currentMatch.id, matchName: currentMatch.name, category, reason });
});

copyCodeBtn?.addEventListener("click", async () => {
  if (!activeReconnectCode) return;
  await navigator.clipboard.writeText(activeReconnectCode);
  copyCodeBtn.textContent = "Copied";
  window.setTimeout(() => {
    copyCodeBtn.textContent = "Copy reconnect code";
  }, 1400);
});

translateBtnEl?.addEventListener("click", () => {
  translateEnabled = !translateEnabled;
  translateBtnEl.classList.toggle("active", translateEnabled);
  translateBtnEl.textContent = translateEnabled ? "Translate on" : "Translate";
});

socket.on("waiting", (payload) => {
  currentMatch = null;
  document.body.classList.remove("is-matched");
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.message || "Waiting for a matching user...");
});

socket.on("matched", (payload) => {
  currentMatch = payload.match;
  document.body.classList.add("is-matched");
  if (profileChipsEl) {
    const moodChip = currentMatch.mood ? `<span class="neon-chip">${escapeHtml(currentMatch.mood)}</span>` : "";
    const reputationChip = `<span class="neon-chip">Rep ${currentMatch.reputationScore || 80}</span>`;
    const badges = (currentMatch.badges || []).map((badge) => `<span class="neon-chip purple">${escapeHtml(badge)}</span>`).join("");
    profileChipsEl.innerHTML = `${moodChip}${reputationChip}${badges}`;
  }
  stopVideoCall(false);
  updateMatchUI();

  if (payload.reconnectCode) {
    activeReconnectCode = payload.reconnectCode;
    localStorage.setItem(storageKeys.reconnectCode, payload.reconnectCode);
    {
      const history = JSON.parse(localStorage.getItem("bk_recent_connections") || "[]");
      const nextHistory = [
        { code: payload.reconnectCode, name: currentMatch?.name || "Guest", mode: pageMode, time: Date.now() },
        ...history.filter((item) => item.code !== payload.reconnectCode),
      ].slice(0, 8);
      localStorage.setItem("bk_recent_connections", JSON.stringify(nextHistory));
    }
    const history = JSON.parse(localStorage.getItem("bk_reconnect_history") || "[]");
    localStorage.setItem(
      "bk_reconnect_history",
      JSON.stringify([
        { code: payload.reconnectCode, name: currentMatch.name, savedAt: new Date().toISOString() },
        ...history.filter((item) => item.code !== payload.reconnectCode),
      ].slice(0, 8)),
    );
    reconnectCode.innerHTML = `Reconnect code: <strong>${payload.reconnectCode}</strong> · /reconnect.html`;
    copyCodeBtn?.classList.add("visible");
  }

  setSystemMessage(
    pageMode === "video"
      ? payload.isInitiator
        ? `Matched with ${currentMatch.name}. Requesting camera and microphone permission...`
        : `Matched with ${currentMatch.name}. Waiting for video connection...`
      : `Matched with ${currentMatch.name}. Say hello to begin.`,
  );

  if (pageMode === "video" && payload.isInitiator) {
    startVideoCall()
      .then(() => {
        cameraBtn?.classList.add("active");
        micBtn?.classList.add("active");
        addMessage("System", "Camera and microphone are active.");
      })
      .catch(() => {
        addMessage("System", "Camera/microphone permission was blocked or unavailable. Allow permission in browser settings.");
        stopVideoCall(false);
      });
  }
});

socket.on("chat-message", (payload) => {
  if (payload?.from && payload.text) {
    typingIndicator.textContent = "";
    addMessage(payload.from.name, payload.text);
  }
});

socket.on("typing", (payload) => {
  window.clearTimeout(remoteTypingTimer);
  typingIndicator.innerHTML = payload?.isTyping
    ? '<div class="typing-bubble" aria-label="Typing"><span></span><span></span><span></span></div>'
    : "";
  if (payload?.isTyping) {
    remoteTypingTimer = window.setTimeout(() => {
      typingIndicator.innerHTML = "";
    }, 1800);
  }
});

socket.on("video-signal", async (payload) => {
  if (!payload?.type || pageMode !== "video") return;
  try {
    if (payload.type === "offer") {
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        pendingIceCandidates = [];
      }

      videoActive = true;
      addMessage("System", "Incoming video call. Requesting camera permission...");
      let hasLocalMedia = true;
      try {
        await prepareLocalMedia();
      } catch (error) {
        hasLocalMedia = false;
        addMessage("System", "Camera is blocked on this device. You can still receive video.");
      }
      const connection = await createPeerConnection({ requireLocal: hasLocalMedia });
      cameraBtn?.classList.add("active");
      micBtn?.classList.add("active");
      await connection.setRemoteDescription(payload.description);
      for (const candidate of pendingIceCandidates) {
        await connection.addIceCandidate(candidate);
      }
      pendingIceCandidates = [];
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit("video-signal", { type: "answer", description: connection.localDescription });
    }
    if (payload.type === "answer" && peerConnection) {
      await peerConnection.setRemoteDescription(payload.description);
      for (const candidate of pendingIceCandidates) {
        await peerConnection.addIceCandidate(candidate);
      }
      pendingIceCandidates = [];
      addMessage("System", "Video call connected.");
    }
    if (payload.type === "ice-candidate") {
      if (!peerConnection || !peerConnection.remoteDescription) {
        pendingIceCandidates.push(payload.candidate);
      } else {
        await peerConnection.addIceCandidate(payload.candidate);
      }
    }
    if (payload.type === "end") {
      addMessage("System", "Video call ended by match.");
      stopVideoCall(false);
    }
  } catch (error) {
    addMessage("System", "Video connection failed. Try again.");
    stopVideoCall(false);
  }
});

socket.on("match-ended", (payload) => {
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.reason || "Match ended. Finding someone new...");
});

socket.on("report-saved", () => addMessage("System", "Report saved for admin review."));

socket.on("moderation-warning", (payload) => {
  addMessage("System", payload.message || "Message blocked by moderation.");
});

socket.on("disconnect", () => {
  if (wasBanned) return;
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage("Connection lost. Refresh when the server is running again.");
});

socket.on("banned", (payload) => {
  wasBanned = true;
  currentUser = null;
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.reason || "This profile has been banned.");
});

loadRuntimeConfig().then(startMatching);

window.addSystemMessage = (text) => addMessage("System", text);

(function addSafetyControls() {
  const controls = document.querySelector(".call-controls");
  if (!controls || document.querySelector("#leaveNowBtn")) return;

  const leave = document.createElement("button");
  leave.id = "leaveNowBtn";
  leave.type = "button";
  leave.className = "danger";
  leave.textContent = "Leave instantly";
  leave.addEventListener("click", () => {
    currentMatch = null;
    stopVideoCall(false);
    socket.emit("next");
    setSystemMessage("You left instantly. Searching another soul...");
  });

  const blur = document.createElement("button");
  blur.id = "blurVideoBtn";
  blur.type = "button";
  blur.textContent = "Blur video";
  blur.addEventListener("click", async () => {
    try {
      await setOutgoingBlur(!outgoingBlurEnabled);
      blur.textContent = outgoingBlurEnabled ? "Unblur me" : "Blur video";
      addMessage("System", outgoingBlurEnabled ? "Your outgoing video is blurred for the match." : "Your outgoing video is clear again.");
    } catch (error) {
      addMessage("System", "Blur could not be applied on this browser.");
    }
  });

  controls.append(leave, blur);
  if (pageMode === "video") {
    [cameraBtn, micBtn, leave, blur].forEach((button) => {
      if (button && button.parentElement !== controls) controls.append(button);
    });
  }
})();

(function addFloatingChatActions() {
  if (document.querySelector("#floatingChatActions")) return;

  const dock = document.createElement("div");
  dock.id = "floatingChatActions";
  dock.className = "floating-chat-actions";
  dock.innerHTML = `
    <button id="floatingActionsToggle" class="floating-actions-toggle" type="button" aria-label="More actions" aria-expanded="false">⋯</button>
    <div class="floating-actions-menu" role="menu"></div>
  `;

  const menu = dock.querySelector(".floating-actions-menu");
  [blockBtn, reportBtn].forEach((button) => {
    if (!button) return;
    button.classList.add("floating-menu-btn");
    menu.append(button);
  });

  const anchor = chatForm || messages || document.querySelector(".chat-panel");
  anchor?.parentElement?.insertBefore(dock, anchor);

  const toggle = dock.querySelector("#floatingActionsToggle");
  toggle.addEventListener("click", () => {
    dock.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(dock.classList.contains("open")));
  });

  document.addEventListener("click", (event) => {
    if (!dock.contains(event.target)) {
      dock.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

(function enableVideoDoubleTapFullscreen() {
  if (pageMode !== "video") return;
  const videoArea = document.querySelector(".call-stage, .video-stage");
  if (!videoArea) return;
  videoArea.dataset.bkFullscreenBound = "true";

  let lastTap = 0;

  async function toggleFullscreen() {
    videoArea.classList.toggle("custom-fullscreen");
    videoArea.classList.toggle("video-expanded", videoArea.classList.contains("custom-fullscreen"));
    document.body.classList.toggle("video-fullscreen-active", videoArea.classList.contains("custom-fullscreen"));
  }

  document.addEventListener("fullscreenchange", () => {
    videoArea.classList.toggle("video-expanded", document.fullscreenElement === videoArea);
    document.body.classList.toggle("video-fullscreen-active", document.fullscreenElement === videoArea);
  });

  videoArea.addEventListener("dblclick", toggleFullscreen);
  videoArea.addEventListener(
    "touchend",
    (event) => {
      const currentTap = Date.now();
      if (currentTap - lastTap < 320) {
        event.preventDefault();
        toggleFullscreen();
      }
      lastTap = currentTap;
    },
    { passive: false },
  );
})();

(function enhanceRoomExperience() {
  window.addSystemMessage = (text) => addMessage("System", text);

  const header = document.querySelector(".match-header");
  if (header && !document.querySelector("#translateToggle")) {
    const toolRow = document.createElement("div");
    toolRow.className = "room-tools";
    toolRow.innerHTML = `
      <button id="translateToggle" type="button" class="tool-pill" aria-pressed="false">Translate off</button>
      <span class="tool-pill mood-display">${currentUser?.mood || "Chill"}</span>
      <span class="tool-pill badge-display">Respectful · 72</span>
    `;
    header.after(toolRow);

    const toggle = toolRow.querySelector("#translateToggle");
    const enabled = localStorage.getItem("bk_translate_enabled") === "true";
    toggle.textContent = enabled ? "Translate on" : "Translate off";
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.addEventListener("click", () => {
      const next = localStorage.getItem("bk_translate_enabled") !== "true";
      localStorage.setItem("bk_translate_enabled", String(next));
      toggle.textContent = next ? "Translate on" : "Translate off";
      toggle.setAttribute("aria-pressed", String(next));
      addMessage("System", next ? "Translation structure enabled. API can be connected later." : "Translation disabled.");
    });
  }

  if (messages && !document.querySelector(".icebreaker-card")) {
    const card = document.createElement("div");
    card.className = "icebreaker-card";
    card.textContent = "Ask them: What changed your life forever?";
    if (pageMode === "video") {
      document.querySelector(".call-stage, .video-stage")?.before(card);
    } else {
      messages.before(card);
    }
  }

  if (pageMode === "video") {
    const card = document.querySelector(".icebreaker-card");
    const videoArea = document.querySelector(".call-stage, .video-stage");
    if (card && videoArea && card.nextElementSibling !== videoArea) {
      videoArea.before(card);
    }
  }
})();

(function addPremiumChatAndVideoControls() {
  let lastOutgoingMessageStatus = null;
  let voiceRecorder = null;
  let voiceChunks = [];
  let usingBackCamera = false;
  let networkTimer = null;

  function emitMediaState() {
    if (pageMode !== "video" || !currentMatch) return;
    const videoTrack = localStream?.getVideoTracks?.()[0];
    const audioTrack = localStream?.getAudioTracks?.()[0];
    socket.emit("video-signal", {
      type: "media-state",
      camera: Boolean(videoTrack?.enabled),
      mic: Boolean(audioTrack?.enabled),
    });
  }

  function addChatStatus(text) {
    if (!chatForm) return;
    if (!lastOutgoingMessageStatus) {
      lastOutgoingMessageStatus = document.createElement("div");
      lastOutgoingMessageStatus.className = "message-status-line";
      chatForm.insertAdjacentElement("beforebegin", lastOutgoingMessageStatus);
    }
    lastOutgoingMessageStatus.textContent = text;
  }

  function addVoiceMessage(author, audio, mimeType, own = false) {
    if (messages.querySelector(".empty-state")) messages.innerHTML = "";
    const node = document.createElement("div");
    node.className = `message ${own ? "mine" : ""}`;
    const label = document.createElement("span");
    label.textContent = author;
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "metadata";
    player.src = audio;
    player.type = mimeType || "audio/webm";
    node.append(label, player);
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
  }

  function createVoiceButton() {
    if (!chatForm || document.querySelector("#voiceNoteBtn")) return;
    const button = document.createElement("button");
    button.id = "voiceNoteBtn";
    button.type = "button";
    button.className = "voice-note-btn";
    button.textContent = "Voice";
    chatForm.insertBefore(button, messageInput?.nextSibling || null);

    button.addEventListener("click", async () => {
      if (!currentMatch) {
        setSystemMessage("Wait for a match before sending a voice note.");
        return;
      }
      if (voiceRecorder?.state === "recording") {
        voiceRecorder.stop();
        button.classList.remove("recording");
        button.textContent = "Voice";
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceChunks = [];
        voiceRecorder = new MediaRecorder(stream);
        voiceRecorder.ondataavailable = (event) => {
          if (event.data?.size) voiceChunks.push(event.data);
        };
        voiceRecorder.onstop = () => {
          const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || "audio/webm" });
          stream.getTracks().forEach((track) => track.stop());
          const reader = new FileReader();
          reader.onloadend = () => {
            const audio = String(reader.result || "");
            addVoiceMessage(currentUser?.name || "You", audio, blob.type, true);
            socket.emit("voice-note", { audio, mimeType: blob.type });
            addChatStatus("Voice note sent");
          };
          reader.readAsDataURL(blob);
        };
        voiceRecorder.start();
        button.classList.add("recording");
        button.textContent = "Stop";
      } catch (error) {
        addMessage("System", "Microphone permission is required for voice notes.");
      }
    });
  }

  async function switchCamera() {
    if (pageMode !== "video") return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    usingBackCamera = !usingBackCamera;
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: usingBackCamera ? { exact: "environment" } : "user" },
      audio: true,
    }).catch(() =>
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: usingBackCamera ? "environment" : "user" },
        audio: true,
      })
    );

    const oldVideo = localStream?.getVideoTracks?.()[0];
    const newVideo = nextStream.getVideoTracks()[0];
    const sender = peerConnection?.getSenders?.().find((item) => item.track?.kind === "video");
    if (sender && newVideo) await sender.replaceTrack(newVideo);
    oldVideo?.stop();
    localStream?.getAudioTracks?.().forEach((track) => track.stop());
    localStream = nextStream;
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(() => {});
    }
    emitMediaState();
  }

  function createVideoTooling() {
    if (pageMode !== "video") return;
    const controls = document.querySelector(".call-controls");
    if (!controls || document.querySelector("#switchCameraBtn")) return;

    const switchBtn = document.createElement("button");
    switchBtn.id = "switchCameraBtn";
    switchBtn.type = "button";
    switchBtn.textContent = "Switch camera";
    switchBtn.addEventListener("click", () => {
      switchCamera().catch(() => addMessage("System", "Camera switch is not available on this device."));
    });
    controls.append(switchBtn);

    const quality = document.createElement("div");
    quality.id = "networkQuality";
    quality.className = "network-quality";
    quality.textContent = "Network: checking";
    document.querySelector(".video-stage, .call-stage")?.append(quality);

    networkTimer = window.setInterval(async () => {
      if (!peerConnection || !quality) return;
      try {
        const stats = await peerConnection.getStats();
        let rtt = 0;
        let packetsLost = 0;
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === "inbound-rtp" && report.kind === "video") packetsLost += Number(report.packetsLost || 0);
        });
        const label = rtt && rtt < 120 && packetsLost < 5 ? "Good" : rtt && rtt < 260 ? "Fair" : "Weak";
        quality.textContent = `Network: ${label}${rtt ? ` ${rtt}ms` : ""}`;
        quality.dataset.quality = label.toLowerCase();
      } catch (error) {
        quality.textContent = "Network: unknown";
      }
    }, 4000);
  }

  cameraBtn?.addEventListener("click", () => window.setTimeout(emitMediaState, 80));
  micBtn?.addEventListener("click", () => window.setTimeout(emitMediaState, 80));

  socket.on("message-delivered", () => addChatStatus("Delivered"));
  socket.on("message-seen", () => addChatStatus("Seen"));
  socket.on("voice-note", (payload) => {
    if (!payload?.audio) return;
    addVoiceMessage(payload.from?.name || "Match", payload.audio, payload.mimeType, false);
    socket.emit("message-seen", { messageId: payload.id || "" });
  });
  socket.on("chat-message", (payload) => {
    if (payload?.id) socket.emit("message-seen", { messageId: payload.id });
  });
  socket.on("video-signal", (payload) => {
    if (payload?.type === "media-state") {
      const camera = payload.camera ? "camera on" : "camera off";
      const mic = payload.mic ? "mic on" : "mic off";
      addMessage("System", `Match ${camera}, ${mic}.`);
    }
    if (payload?.type === "reconnect-request" && pageMode === "video" && currentMatch) {
      startVideoCall().catch(() => addMessage("System", "Video reconnect failed. Try Next or start again."));
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    createVoiceButton();
    createVideoTooling();
  });
  createVoiceButton();
  createVideoTooling();

  const nativeCreatePeerConnection = createPeerConnection;
  createPeerConnection = async function enhancedCreatePeerConnection(options) {
    const connection = await nativeCreatePeerConnection(options);
    if (!connection.__bkReconnectHooked) {
      connection.__bkReconnectHooked = true;
      connection.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected"].includes(connection.connectionState) && currentMatch) {
          addMessage("System", "Video connection dropped. Trying to reconnect...");
          socket.emit("video-signal", { type: "reconnect-request" });
        }
      });
    }
    return connection;
  };

  window.addEventListener("beforeunload", () => {
    if (networkTimer) window.clearInterval(networkTimer);
  });
})();

(function installCustomVideoFullscreen() {
  if (pageMode !== "video") return;
  const videoStage = document.querySelector(".video-stage.call-stage, .call-stage, .video-stage");
  if (!videoStage) return;
  if (videoStage.dataset.bkFullscreenBound === "true") return;
  videoStage.addEventListener("dblclick", (event) => {
    event.preventDefault();
    videoStage.classList.toggle("custom-fullscreen");
    document.body.classList.toggle("video-fullscreen-active", videoStage.classList.contains("custom-fullscreen"));
  });
})();
