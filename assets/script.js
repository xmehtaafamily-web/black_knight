const socket = io();

const appShell = document.querySelector(".app-shell");
const chatPanel = document.querySelector("#chatPanel");
const profileForm = document.querySelector("#profileForm");
const chatForm = document.querySelector("#chatForm");
const messages = document.querySelector("#messages");
const messageTemplate = document.querySelector("#messageTemplate");
const displayNameInput = document.querySelector("#displayName");
const emailInput = document.querySelector("#emailInput");
const savedCodeInput = document.querySelector("#savedCodeInput");
const ageCheck = document.querySelector("#ageCheck");
const matchName = document.querySelector("#matchName");
const matchStatus = document.querySelector("#matchStatus");
const modeStatus = document.querySelector("#modeStatus");
const reconnectCode = document.querySelector("#reconnectCode");
const remoteLabel = document.querySelector("#remoteLabel");
const videoBtn = document.querySelector("#videoBtn");
const skipBtn = document.querySelector("#skipBtn");
const blockBtn = document.querySelector("#blockBtn");
const reportBtn = document.querySelector("#reportBtn");
const messageInput = document.querySelector("#messageInput");
const localVideo = document.querySelector("#localVideo");
const remoteVideo = document.querySelector("#remoteVideo");

let currentUser = null;
let currentMatch = null;
let videoActive = false;
let localStream = null;
let peerConnection = null;
let wasBanned = false;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const storageKeys = {
  deviceId: "bk_device_id",
  name: "bk_display_name",
  email: "bk_email",
  reconnectCode: "bk_reconnect_code",
};

function getDeviceId() {
  let deviceId = localStorage.getItem(storageKeys.deviceId);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(storageKeys.deviceId, deviceId);
  }
  return deviceId;
}

function loadSavedProfile() {
  displayNameInput.value = localStorage.getItem(storageKeys.name) || "";
  emailInput.value = localStorage.getItem(storageKeys.email) || "";
  savedCodeInput.value = localStorage.getItem(storageKeys.reconnectCode) || "";
}

function saveProfile() {
  localStorage.setItem(storageKeys.name, currentUser.name);
  localStorage.setItem(storageKeys.email, currentUser.email || "");
}

function getSelected(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function setSystemMessage(text) {
  messages.innerHTML = `<div class="empty-state">${text}</div>`;
}

function addMessage(author, text, own = false) {
  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("mine", own);
  node.querySelector("span").textContent = author;
  node.querySelector("p").textContent = text;

  const emptyState = messages.querySelector(".empty-state");
  if (emptyState) messages.innerHTML = "";

  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function updateMatchUI() {
  const modeLabel = currentUser?.mode === "video" ? "Video Chat" : "Chat";
  modeStatus.textContent = `${modeLabel} mode`;

  if (!currentMatch) {
    matchName.textContent = "Waiting room";
    remoteLabel.textContent = "Match";
    matchStatus.textContent = "Waiting";
    matchStatus.classList.remove("online");
    return;
  }

  matchName.textContent = `${currentMatch.name}${currentMatch.verified ? " · Verified" : ""}`;
  remoteLabel.textContent = currentMatch.name;
  matchStatus.textContent = "Online";
  matchStatus.classList.add("online");
}

function enterRoom() {
  appShell.classList.add("in-room");
  chatPanel.classList.remove("idle", "chat-mode", "video-mode");
  chatPanel.classList.add(currentUser?.mode === "video" ? "video-mode" : "chat-mode");
}

function resetVideoButton() {
  videoActive = false;
  videoBtn.classList.remove("active");
  videoBtn.textContent = currentUser?.mode === "video" ? "Start video" : "Chat only";
}

function setVideoTileState() {
  localVideo.closest(".video-tile").classList.toggle("has-video", Boolean(localVideo.srcObject));
  remoteVideo.closest(".video-tile").classList.toggle("has-video", Boolean(remoteVideo.srcObject));
}

async function getLocalStream() {
  if (localStream) return localStream;

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  localVideo.srcObject = localStream;
  setVideoTileState();
  return localStream;
}

async function createPeerConnection() {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("video-signal", {
        type: "ice-candidate",
        candidate: event.candidate,
      });
    }
  };

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setVideoTileState();
  };

  const stream = await getLocalStream();
  stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

  return peerConnection;
}

async function startVideoCall() {
  const connection = await createPeerConnection();
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  socket.emit("video-signal", {
    type: "offer",
    description: connection.localDescription,
  });
}

function stopVideoCall(notifyMatch = true) {
  if (notifyMatch && currentMatch) {
    socket.emit("video-signal", { type: "end" });
  }

  peerConnection?.close();
  peerConnection = null;

  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  setVideoTileState();
  resetVideoButton();
}

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!ageCheck.checked) {
    setSystemMessage("Please confirm you are 18 or older before matching.");
    return;
  }

  currentUser = {
    name: displayNameInput.value.trim() || "Guest",
    email: emailInput.value.trim(),
    deviceId: getDeviceId(),
    savedCode: savedCodeInput.value.trim().toUpperCase(),
    gender: getSelected("gender"),
    preference: getSelected("preference"),
    mode: getSelected("chatMode"),
  };

  wasBanned = false;
  saveProfile();
  currentMatch = null;
  stopVideoCall(false);
  enterRoom();
  updateMatchUI();
  setSystemMessage(currentUser.mode === "video" ? "Looking for a video chat match..." : "Looking for a chat match...");
  socket.emit("join", currentUser);
});

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
  messageInput.value = "";
});

videoBtn.addEventListener("click", async () => {
  if (!currentMatch) {
    setSystemMessage("Find a match before starting video.");
    return;
  }

  if (currentUser?.mode !== "video") {
    addMessage("System", "This match is chat-only. Choose Video Chat before matching to use camera.");
    return;
  }

  if (videoActive) {
    addMessage("System", "Video call ended.");
    stopVideoCall();
    return;
  }

  try {
    videoActive = true;
    videoBtn.classList.add("active");
    videoBtn.textContent = "End video";
    addMessage("System", "Starting video call...");
    await startVideoCall();
  } catch (error) {
    addMessage("System", "Camera or microphone permission was not allowed.");
    stopVideoCall(false);
  }
});

skipBtn.addEventListener("click", () => {
  if (!currentUser) {
    setSystemMessage("Create your profile first.");
    return;
  }

  currentMatch = null;
  stopVideoCall();
  updateMatchUI();
  setSystemMessage("Finding your next match...");
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

  const reason = window.prompt("Report reason", "Abusive or unsafe behavior");
  if (!reason) return;

  socket.emit("report", {
    matchId: currentMatch.id,
    matchName: currentMatch.name,
    reason,
  });
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
  reconnectCode.innerHTML = payload.reconnectCode
    ? `Reconnect code: <strong>${payload.reconnectCode}</strong> · /reconnect.html`
    : "";
  if (payload.reconnectCode) {
    localStorage.setItem(storageKeys.reconnectCode, payload.reconnectCode);
    savedCodeInput.value = payload.reconnectCode;
  }
  setSystemMessage(`Matched with ${currentMatch.name}. Say hello to begin.`);
});

socket.on("chat-message", (payload) => {
  if (!payload?.from || !payload.text) return;
  addMessage(payload.from.name, payload.text);
});

socket.on("video-signal", async (payload) => {
  if (!payload?.type || currentUser?.mode !== "video") return;

  try {
    if (payload.type === "offer") {
      videoActive = true;
      videoBtn.classList.add("active");
      videoBtn.textContent = "End video";
      addMessage("System", `${currentMatch?.name || "Match"} started a video call.`);

      const connection = await createPeerConnection();
      await connection.setRemoteDescription(payload.description);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit("video-signal", {
        type: "answer",
        description: connection.localDescription,
      });
    }

    if (payload.type === "answer" && peerConnection) {
      await peerConnection.setRemoteDescription(payload.description);
      addMessage("System", "Video call connected.");
    }

    if (payload.type === "ice-candidate" && peerConnection) {
      await peerConnection.addIceCandidate(payload.candidate);
    }

    if (payload.type === "end") {
      addMessage("System", "Video call ended by match.");
      stopVideoCall(false);
    }
  } catch (error) {
    addMessage("System", "Video connection failed. Try starting the call again.");
    stopVideoCall(false);
  }
});

socket.on("match-ended", (payload) => {
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.reason || "Match ended. Finding someone new...");
});

socket.on("report-saved", () => {
  addMessage("System", "Report saved for admin review.");
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

loadSavedProfile();
