const socket = io();
window.BlackKnightSafety?.bindSocketSafety(socket);

const frequencyGrid = document.querySelector("#frequencyGrid");
const frequencyForm = document.querySelector("#frequencyForm");
const frequencyInput = document.querySelector("#frequencyInput");
const statusText = document.querySelector("#walkieStatus");
const messages = document.querySelector("#walkieMessages");
const radioLockPanel = document.querySelector("#radioLockPanel");
const walkieRadioAudio = document.querySelector("#walkieRadioAudio");
const voiceStatus = document.querySelector("#voiceStatus");
const form = document.querySelector("#walkieForm");
const input = document.querySelector("#walkieInput");
const talkBtn = document.querySelector("#talkBtn");
const lockFrequencyInput = document.querySelector("#lockFrequencyInput");
const lockFrequencyBtn = document.querySelector("#lockFrequencyBtn");

let activeFrequency = "";
let localAudioStream = null;
let activeRadioLock = null;
let activePrivateLock = null;
let activeFrequencyOwner = false;
let micEnabled = false;
let audioRecorder = null;
let audioChunks = [];
let voiceStatusTimer = null;
let liveAudioContext = null;
let liveSource = null;
let liveProcessor = null;
let playbackContext = null;
let playbackTime = 0;
let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let selfPeerId = "";
const walkiePeers = new Map();
const pendingIce = new Map();

function getProfile() {
  return {
    name: localStorage.getItem("bk_display_name") || "",
    gender: localStorage.getItem("bk_gender") || "",
  };
}

function requireProfile() {
  const profile = getProfile();
  if (!profile.name || !profile.gender) {
    addMessage("System", "Please fill your display name and gender on the home page first. Walkie Talkie cannot start without a profile.");
    return null;
  }
  return profile;
}

function addMessage(author, text) {
  if (messages.querySelector(".empty-state")) messages.innerHTML = "";
  const node = document.createElement("article");
  node.className = "message";
  const safeAuthor = window.BlackKnightSafety?.escapeText(author) || author;
  const safeText = window.BlackKnightSafety?.escapeText(text) || text;
  node.innerHTML = `<span>${safeAuthor}</span><p>${safeText}</p>`;
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function showVoiceStatus(text) {
  if (!voiceStatus) return;
  window.clearTimeout(voiceStatusTimer);
  voiceStatus.textContent = text;
  voiceStatus.classList.toggle("visible", Boolean(text));
  if (text) {
    voiceStatusTimer = window.setTimeout(() => {
      voiceStatus.textContent = "";
      voiceStatus.classList.remove("visible");
    }, 10000);
  }
}

function floatToBase64(floatSamples, inputRate, outputRate = 16000) {
  const ratio = inputRate / outputRate;
  const length = Math.floor(floatSamples.length / ratio);
  const pcm = new Int16Array(length);

  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[Math.floor(i * ratio)] || 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  let binary = "";
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToFloat(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const floats = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) floats[i] = pcm[i] / 0x8000;
  return floats;
}

async function startLiveAudio() {
  if (!activeFrequency || !(await ensureMic())) return;
  liveAudioContext = liveAudioContext || new AudioContext();
  if (liveAudioContext.state === "suspended") await liveAudioContext.resume();

  localAudioStream.getAudioTracks().forEach((track) => {
    track.enabled = true;
  });

  liveSource = liveAudioContext.createMediaStreamSource(localAudioStream);
  liveProcessor = liveAudioContext.createScriptProcessor(2048, 1, 1);
  liveProcessor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    socket.emit("walkie-live-audio", {
      chunk: floatToBase64(input, liveAudioContext.sampleRate),
    });
  };

  liveSource.connect(liveProcessor);
  liveProcessor.connect(liveAudioContext.destination);
}

function stopLiveAudio() {
  liveProcessor?.disconnect();
  liveSource?.disconnect();
  liveProcessor = null;
  liveSource = null;
  localAudioStream?.getAudioTracks().forEach((track) => {
    track.enabled = false;
  });
}

async function playLiveAudio(chunk) {
  playbackContext = playbackContext || new AudioContext({ sampleRate: 16000 });
  if (playbackContext.state === "suspended") await playbackContext.resume();

  const samples = base64ToFloat(chunk);
  const buffer = playbackContext.createBuffer(1, samples.length, 16000);
  buffer.copyToChannel(samples, 0);

  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);

  const startAt = Math.max(playbackContext.currentTime + 0.03, playbackTime);
  source.start(startAt);
  playbackTime = startAt + buffer.duration;
}

function renderFrequencies(rows) {
  frequencyGrid.innerHTML = rows
    .map(
      (item) => `
        <button class="frequency-card ${item.frequency === activeFrequency ? "active" : ""}" data-frequency="${item.frequency}" type="button">
          <span>${item.frequency} FM</span>
          <strong>${item.locked ? item.radio?.name || "Radio locked" : `${item.activeUsers}/${item.limit}`}</strong>
          <small>M ${item.male || 0} · F ${item.female || 0}</small>
          ${item.locked ? "<em>Radio · Chat only</em>" : item.privateLocked ? "<em>Private locked</em>" : ""}
        </button>
      `,
    )
    .join("");
}

function renderRadioLock(radio) {
  activeRadioLock = radio || null;
  if (!radioLockPanel) return;
  if (!radio) {
    radioLockPanel.innerHTML = "";
    radioLockPanel.classList.remove("visible");
    if (walkieRadioAudio) {
      walkieRadioAudio.pause();
      walkieRadioAudio.removeAttribute("src");
      walkieRadioAudio.classList.remove("visible");
    }
    talkBtn.disabled = !activeFrequency;
    talkBtn.textContent = micEnabled ? "Mic on" : "Mic off";
    return;
  }

  radioLockPanel.classList.add("visible");
  radioLockPanel.innerHTML = `
    <div>
      <span>Radio frequency locked</span>
      <strong>${window.BlackKnightSafety?.escapeText(radio.name) || radio.name}</strong>
      <small>${radio.streamUrl ? "Live radio will play automatically." : "Direct stream URL needed for auto live audio. Chat is open."}</small>
    </div>
    <a href="${radio.pageUrl}" target="_blank" rel="noopener noreferrer">Open live radio</a>
    <iframe title="${window.BlackKnightSafety?.escapeText(radio.name) || radio.name}" src="${radio.pageUrl}" loading="lazy" allow="autoplay"></iframe>
  `;
  talkBtn.disabled = true;
  talkBtn.textContent = "Radio only";
  setMicEnabled(false);

  if (walkieRadioAudio) {
    if (radio.streamUrl) {
      walkieRadioAudio.src = radio.streamUrl;
      walkieRadioAudio.classList.add("visible");
      walkieRadioAudio.play().catch(() => showVoiceStatus("Tap play to start radio audio."));
    } else {
      walkieRadioAudio.pause();
      walkieRadioAudio.removeAttribute("src");
      walkieRadioAudio.classList.remove("visible");
      showVoiceStatus("A direct stream URL is required. A page URL cannot autoplay radio audio.");
    }
  }
}

function normalizeFrequency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 30 || number > 100) return "";
  return number.toFixed(2);
}

async function loadFrequencies() {
  const response = await fetch("/api/walkie/frequencies");
  renderFrequencies(await response.json());
}

async function loadRtcConfig() {
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

frequencyGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-frequency]");
  if (!button) return;
  const profile = requireProfile();
  if (!profile) return;
  activeFrequency = button.dataset.frequency;
  frequencyInput.value = activeFrequency;
  socket.emit("join-walkie", { frequency: activeFrequency, ...profile });
});

frequencyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const frequency = normalizeFrequency(frequencyInput.value);
  if (!frequency) {
    addMessage("System", "Frequency must be between 30.00 and 100.00.");
    return;
  }
  const profile = requireProfile();
  if (!profile) return;
  activeFrequency = frequency;
  frequencyInput.value = frequency;
  socket.emit("join-walkie", { frequency, ...profile });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeFrequency) {
    addMessage("System", "Select a frequency first.");
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  socket.emit("walkie-message", { text });
  input.value = "";
});

async function ensureMic() {
  if (localAudioStream) return true;
  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    showVoiceStatus("Microphone ready. Tap Mic on to speak.");
    return true;
  } catch (error) {
    showVoiceStatus("Microphone permission is required for voice.");
    return false;
  }
}

function getOrCreateRemoteAudio(peerId) {
  let audio = document.querySelector(`audio[data-walkie-peer="${peerId}"]`);
  if (audio) return audio;
  audio = document.createElement("audio");
  audio.dataset.walkiePeer = peerId;
  audio.autoplay = true;
  audio.playsInline = true;
  audio.controls = false;
  document.body.appendChild(audio);
  return audio;
}

async function createWalkiePeer(peerId, initiator = false) {
  if (!peerId || peerId === selfPeerId) return null;
  if (walkiePeers.has(peerId)) return walkiePeers.get(peerId);
  await ensureMic();

  const connection = new RTCPeerConnection(rtcConfig);
  walkiePeers.set(peerId, connection);

  localAudioStream.getAudioTracks().forEach((track) => {
    track.enabled = false;
    connection.addTrack(track, localAudioStream);
  });

  connection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("walkie-webrtc-ice", { to: peerId, candidate: event.candidate });
    }
  };

  connection.ontrack = (event) => {
    const audio = getOrCreateRemoteAudio(peerId);
    audio.srcObject = event.streams[0];
    audio.play().catch(() => showVoiceStatus("Tap once to allow live audio playback."));
  };

  connection.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
      closeWalkiePeer(peerId);
    }
  };

  const queued = pendingIce.get(peerId) || [];
  for (const candidate of queued) {
    await connection.addIceCandidate(candidate).catch(() => {});
  }
  pendingIce.delete(peerId);

  if (initiator) {
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    socket.emit("walkie-webrtc-offer", { to: peerId, description: connection.localDescription });
  }

  return connection;
}

function closeWalkiePeer(peerId) {
  walkiePeers.get(peerId)?.close();
  walkiePeers.delete(peerId);
  document.querySelector(`audio[data-walkie-peer="${peerId}"]`)?.remove();
}

function closeAllWalkiePeers() {
  for (const peerId of walkiePeers.keys()) closeWalkiePeer(peerId);
}

async function joinFrequency(frequency) {
  const profile = requireProfile();
  if (!profile) return;
  closeAllWalkiePeers();
  setMicEnabled(false);
  activeFrequency = frequency;
  frequencyInput.value = frequency;
  socket.emit("join-walkie", { frequency, lockFrequency: Boolean(lockFrequencyInput?.checked), ...profile });
}

frequencyGrid.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest("[data-frequency]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    joinFrequency(button.dataset.frequency);
  },
  true,
);

frequencyForm.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const frequency = normalizeFrequency(frequencyInput.value);
    if (!frequency) {
      addMessage("System", "Frequency must be between 30.00 and 100.00.");
      return;
    }
    joinFrequency(frequency);
  },
  true,
);

function updateLockButton() {
  if (!lockFrequencyBtn) return;
  const owned = Boolean(activePrivateLock?.owned);
  lockFrequencyBtn.disabled = !activeFrequency || Boolean(activeRadioLock) || (!activeFrequencyOwner && !owned);
  lockFrequencyBtn.textContent = owned ? "Unlock frequency" : activePrivateLock ? "Frequency locked" : "Lock frequency";
}

function setMicEnabled(enabled) {
  micEnabled = Boolean(enabled);
  localAudioStream?.getAudioTracks().forEach((track) => {
    track.enabled = micEnabled;
  });
  talkBtn?.classList.toggle("active", micEnabled);
  if (talkBtn && !activeRadioLock) {
    talkBtn.textContent = micEnabled ? "Mic on" : "Mic off";
    talkBtn.dataset.state = micEnabled ? "on" : "off";
    talkBtn.setAttribute("aria-pressed", String(micEnabled));
    talkBtn.title = micEnabled ? "Your microphone is on" : "Your microphone is off";
  }
  if (activeFrequency) socket.emit("walkie-voice", { speaking: micEnabled });
}

async function toggleMic() {
  if (activeRadioLock) {
    showVoiceStatus("Voice is disabled on radio channels. Use chat instead.");
    return;
  }
  if (!activeFrequency || !(await ensureMic())) return;
  setMicEnabled(!micEnabled);
  showVoiceStatus(micEnabled ? "Mic is on. Tap again to mute." : "Mic is off.");
}

talkBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  await toggleMic();
});

talkBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});

lockFrequencyBtn?.addEventListener("click", () => {
  if (!activeFrequency || activeRadioLock || (activePrivateLock && !activePrivateLock.owned)) return;
  socket.emit("walkie-lock-frequency", { locked: !activePrivateLock?.owned });
});

document.addEventListener("click", async () => {
  if (!playbackContext) {
    playbackContext = new AudioContext({ sampleRate: 16000 });
    await playbackContext.resume().catch(() => {});
  }
});

socket.on("walkie-joined", (payload) => {
  activeFrequency = payload.frequency;
  selfPeerId = payload.peerId || "";
  activeFrequencyOwner = Boolean(payload.frequencyOwner);
  statusText.textContent = `${payload.frequency} FM · ${payload.activeUsers}/${payload.limit} · M ${payload.male || 0} · F ${payload.female || 0}`;
  activePrivateLock = payload.privateLocked ? { owned: Boolean(payload.privateLockOwned || activePrivateLock?.owned) } : null;
  renderRadioLock(payload.locked ? payload.radio : null);
  talkBtn.disabled = Boolean(payload.locked);
  updateLockButton();
  messages.innerHTML = '<div class="empty-state">Channel joined. Typed messages will appear here.</div>';
  showVoiceStatus(payload.locked ? `${payload.radio?.name || "Radio"} locked channel joined` : payload.privateLocked ? `Joined locked ${payload.frequency} FM` : `Joined ${payload.frequency} FM`);
  if (!payload.locked) (payload.peers || []).forEach((peerId) => createWalkiePeer(peerId, true));
  loadFrequencies();
});

socket.on("walkie-peer-joined", (payload) => {
  if (!payload?.peerId) return;
  if (activeRadioLock) return;
  createWalkiePeer(payload.peerId, false);
});

socket.on("walkie-peer-left", (payload) => {
  if (payload?.peerId) closeWalkiePeer(payload.peerId);
});

socket.on("walkie-presence", (payload) => {
  if (payload.frequency === activeFrequency) {
    statusText.textContent = `${payload.frequency} FM · ${payload.activeUsers}/${payload.limit} · M ${payload.male || 0} · F ${payload.female || 0}`;
    activePrivateLock = payload.privateLocked ? { owned: Boolean(payload.privateLockOwned || activePrivateLock?.owned) } : null;
    updateLockButton();
  }
  loadFrequencies();
});

socket.on("walkie-message", (payload) => {
  addMessage(payload.guest || "Anonymous", payload.text);
});

socket.on("walkie-voice", (payload) => {
  if (payload.speaking) showVoiceStatus("Someone is talking...");
});

socket.on("walkie-audio", (payload) => {
  if (!payload?.audio) return;
  const audio = new Audio(payload.audio);
  audio.preload = "auto";
  audio.volume = 1;
  audio.play().catch(() => {
    addMessage("System", "Tap the page once to allow walkie audio playback.");
  });
});

socket.on("walkie-live-audio", (payload) => {
  if (!payload?.chunk) return;
  playLiveAudio(payload.chunk).catch(() => {
    showVoiceStatus("Tap once to allow live audio playback.");
  });
});

socket.on("walkie-webrtc-offer", async (payload) => {
  if (!payload?.from || !payload.description) return;
  const connection = await createWalkiePeer(payload.from, false);
  await connection.setRemoteDescription(payload.description);
  const queued = pendingIce.get(payload.from) || [];
  for (const candidate of queued) await connection.addIceCandidate(candidate).catch(() => {});
  pendingIce.delete(payload.from);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
  socket.emit("walkie-webrtc-answer", { to: payload.from, description: connection.localDescription });
});

socket.on("walkie-webrtc-answer", async (payload) => {
  const connection = walkiePeers.get(payload?.from);
  if (!connection || !payload.description) return;
  await connection.setRemoteDescription(payload.description).catch(() => {});
});

socket.on("walkie-webrtc-ice", async (payload) => {
  if (!payload?.from || !payload.candidate) return;
  const connection = walkiePeers.get(payload.from);
  if (!connection || !connection.remoteDescription) {
    const queued = pendingIce.get(payload.from) || [];
    queued.push(payload.candidate);
    pendingIce.set(payload.from, queued);
    return;
  }
  await connection.addIceCandidate(payload.candidate).catch(() => {});
});

socket.on("walkie-error", (payload) => {
  addMessage("System", payload.message || "Walkie channel error.");
});

socket.on("walkie-lock-updated", (payload) => {
  if (payload.frequency !== activeFrequency) return;
  activeFrequencyOwner = Boolean(payload.frequencyOwner || activeFrequencyOwner);
  activePrivateLock = payload.privateLocked ? { owned: Boolean(payload.privateLockOwned) } : null;
  updateLockButton();
  showVoiceStatus(
    payload.privateLocked
      ? payload.privateLockOwned
        ? "You control this locked frequency."
        : "Frequency locked. Only current users can stay."
      : payload.frequencyOwner
        ? "You now control this frequency."
        : "Frequency unlocked.",
  );
  loadFrequencies();
});

loadRtcConfig().then(loadFrequencies);
