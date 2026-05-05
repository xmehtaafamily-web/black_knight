const socket = io();

const appShell = document.querySelector(".app-shell");
const chatPanel = document.querySelector("#chatPanel");
const reconnectForm = document.querySelector("#reconnectForm");
const chatForm = document.querySelector("#chatForm");
const messages = document.querySelector("#messages");
const messageTemplate = document.querySelector("#messageTemplate");
const displayNameInput = document.querySelector("#displayName");
const codeInput = document.querySelector("#codeInput");
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

let rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const storageKeys = {
  name: "bk_display_name",
  reconnectCode: "bk_reconnect_code",
};

function loadSavedReconnect() {
  displayNameInput.value = localStorage.getItem(storageKeys.name) || "";
  codeInput.value = localStorage.getItem(storageKeys.reconnectCode) || "";
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
  if (messages.querySelector(".empty-state")) messages.innerHTML = "";
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

  matchName.textContent = currentMatch.name;
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
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  setVideoTileState();
  return localStream;
}

async function createPeerConnection() {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) socket.emit("video-signal", { type: "ice-candidate", candidate: event.candidate });
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
  socket.emit("video-signal", { type: "offer", description: connection.localDescription });
}

function stopVideoCall(notifyMatch = true) {
  if (notifyMatch && currentMatch) socket.emit("video-signal", { type: "end" });
  peerConnection?.close();
  peerConnection = null;
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  setVideoTileState();
  resetVideoButton();
}

reconnectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ageCheck.checked) {
    setSystemMessage("Please confirm you are 18 or older before joining.");
    return;
  }

  currentUser = {
    name: displayNameInput.value.trim() || "Guest",
    code: codeInput.value.trim().toUpperCase(),
    mode: getSelected("chatMode"),
  };

  localStorage.setItem(storageKeys.name, currentUser.name);
  localStorage.setItem(storageKeys.reconnectCode, currentUser.code);

  currentMatch = null;
  enterRoom();
  updateMatchUI();
  reconnectCode.innerHTML = `Reconnect code: <strong>${currentUser.code}</strong>`;
  setSystemMessage("Joining private room...");
  socket.emit("join-reconnect", currentUser);
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentUser || !currentMatch) {
    setSystemMessage("Wait for the other person before sending a message.");
    return;
  }

  const text = messageInput.value.trim();
  if (!text) return;
  addMessage(currentUser.name, text, true);
  socket.emit("chat-message", { text });
  messageInput.value = "";
});

videoBtn.addEventListener("click", async () => {
  if (!currentMatch || currentUser?.mode !== "video") return;
  if (videoActive) {
    stopVideoCall();
    addMessage("System", "Video call ended.");
    return;
  }

  try {
    videoActive = true;
    videoBtn.classList.add("active");
    videoBtn.textContent = "End video";
    await startVideoCall();
  } catch (error) {
    addMessage("System", "Camera or microphone permission was not allowed.");
    stopVideoCall(false);
  }
});

skipBtn.addEventListener("click", () => window.location.assign("/"));
blockBtn.addEventListener("click", () => addMessage("System", "This private room user was blocked for this session."));
reportBtn.addEventListener("click", () => {
  if (!currentMatch) return;
  const reason = window.prompt("Report reason", "Abusive or unsafe behavior");
  if (reason) socket.emit("report", { matchId: currentMatch.id, matchName: currentMatch.name, reason });
});

socket.on("waiting", (payload) => {
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.message || "Waiting for the other person...");
});

socket.on("matched", (payload) => {
  currentMatch = payload.match;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(`Connected with ${currentMatch.name}.`);
});

socket.on("chat-message", (payload) => {
  if (payload?.from && payload.text) addMessage(payload.from.name, payload.text);
});

socket.on("video-signal", async (payload) => {
  if (!payload?.type || currentUser?.mode !== "video") return;
  try {
    if (payload.type === "offer") {
      videoActive = true;
      videoBtn.classList.add("active");
      videoBtn.textContent = "End video";
      const connection = await createPeerConnection();
      await connection.setRemoteDescription(payload.description);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit("video-signal", { type: "answer", description: connection.localDescription });
    }
    if (payload.type === "answer" && peerConnection) await peerConnection.setRemoteDescription(payload.description);
    if (payload.type === "ice-candidate" && peerConnection) await peerConnection.addIceCandidate(payload.candidate);
    if (payload.type === "end") stopVideoCall(false);
  } catch (error) {
    addMessage("System", "Video connection failed. Try again.");
    stopVideoCall(false);
  }
});

socket.on("match-ended", (payload) => {
  currentMatch = null;
  stopVideoCall(false);
  updateMatchUI();
  setSystemMessage(payload.reason || "The other person left.");
});

socket.on("report-saved", () => addMessage("System", "Report saved for admin review."));

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

loadRuntimeConfig().then(loadSavedReconnect);
