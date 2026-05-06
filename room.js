const socket = io();
const pageMode = document.currentScript.dataset.roomMode;

const chatForm = document.querySelector("#chatForm");
const messages = document.querySelector("#messages");
const messageTemplate = document.querySelector("#messageTemplate");
const matchName = document.querySelector("#matchName");
const matchStatus = document.querySelector("#matchStatus");
const reconnectCode = document.querySelector("#reconnectCode");
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
  messages.innerHTML = `<div class="empty-state">${text}</div>`;
}

function addMessage(author, text, own = false) {
  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("mine", own);
  node.querySelector("span").textContent = author;
  node.querySelector("p").textContent = text;
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

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  setVideoTileState();
  return localStream;
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
    stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
  } else {
    peerConnection.addTransceiver("video", { direction: "recvonly" });
    peerConnection.addTransceiver("audio", { direction: "recvonly" });
  }
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
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  setVideoTileState();
  resetVideoButton();
}

function startMatching() {
  currentUser = loadProfile();
  if (!currentUser) return;

  updateMatchUI();
  setSystemMessage(pageMode === "video" ? "Looking for a video chat match..." : "Looking for a chat match...");

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
  setSystemMessage(pageMode === "video" ? "Finding next video chat match..." : "Finding next chat match...");
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
  const reason = window.prompt("Report reason: harassment, spam, nudity, underage, scam, or other", "Abusive or unsafe behavior");
  if (!reason) return;
  socket.emit("report", { matchId: currentMatch.id, matchName: currentMatch.name, reason });
});

copyCodeBtn?.addEventListener("click", async () => {
  if (!activeReconnectCode) return;
  await navigator.clipboard.writeText(activeReconnectCode);
  copyCodeBtn.textContent = "Copied";
  window.setTimeout(() => {
    copyCodeBtn.textContent = "Copy reconnect code";
  }, 1400);
});

socket.on("waiting", (payload) => {
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.message || "Waiting for a matching user...");
});

socket.on("matched", (payload) => {
  currentMatch = payload.match;
  stopVideoCall(false);
  updateMatchUI();

  if (payload.reconnectCode) {
    activeReconnectCode = payload.reconnectCode;
    localStorage.setItem(storageKeys.reconnectCode, payload.reconnectCode);
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
