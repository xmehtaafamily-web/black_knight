const socket = io();
window.BlackKnightSafety?.bindSocketSafety(socket);

const frequencyGrid = document.querySelector("#frequencyGrid");
const frequencyForm = document.querySelector("#frequencyForm");
const frequencyInput = document.querySelector("#frequencyInput");
const statusText = document.querySelector("#walkieStatus");
const messages = document.querySelector("#walkieMessages");
const form = document.querySelector("#walkieForm");
const input = document.querySelector("#walkieInput");
const talkBtn = document.querySelector("#talkBtn");

let activeFrequency = "";
let localAudioStream = null;

function getProfile() {
  return {
    name: localStorage.getItem("bk_display_name") || "",
    gender: localStorage.getItem("bk_gender") || "",
  };
}

function requireProfile() {
  const profile = getProfile();
  if (!profile.name || !profile.gender) {
    addMessage("System", "Pehle home page par display name aur gender fill karo. Bina profile Walkie Talkie join nahi hoga.");
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

function renderFrequencies(rows) {
  frequencyGrid.innerHTML = rows
    .map(
      (item) => `
        <button class="frequency-card ${item.frequency === activeFrequency ? "active" : ""}" data-frequency="${item.frequency}" type="button">
          <span>${item.frequency} FM</span>
          <strong>${item.activeUsers}/${item.limit}</strong>
          <small>M ${item.male || 0} · F ${item.female || 0}</small>
        </button>
      `,
    )
    .join("");
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
    addMessage("System", "Frequency 30.00 se 100.00 ke beech honi chahiye.");
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
    return true;
  } catch (error) {
    addMessage("System", "Microphone permission is required for voice.");
    return false;
  }
}

async function startTalking() {
  if (!activeFrequency || !(await ensureMic())) return;
  talkBtn.classList.add("active");
  talkBtn.textContent = "Talking...";
  socket.emit("walkie-voice", { speaking: true });
}

function stopTalking() {
  talkBtn.classList.remove("active");
  talkBtn.textContent = "Hold to talk";
  socket.emit("walkie-voice", { speaking: false });
}

talkBtn.addEventListener("mousedown", startTalking);
talkBtn.addEventListener("touchstart", (event) => {
  event.preventDefault();
  startTalking();
});
["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((eventName) => {
  talkBtn.addEventListener(eventName, stopTalking);
});

socket.on("walkie-joined", (payload) => {
  activeFrequency = payload.frequency;
  statusText.textContent = `${payload.frequency} FM · ${payload.activeUsers}/${payload.limit} · M ${payload.male || 0} · F ${payload.female || 0}`;
  talkBtn.disabled = false;
  addMessage("System", `Joined ${payload.frequency} FM.`);
  loadFrequencies();
});

socket.on("walkie-presence", (payload) => {
  if (payload.frequency === activeFrequency) {
    statusText.textContent = `${payload.frequency} FM · ${payload.activeUsers}/${payload.limit} · M ${payload.male || 0} · F ${payload.female || 0}`;
  }
  loadFrequencies();
});

socket.on("walkie-message", (payload) => {
  addMessage(payload.guest || "Anonymous", payload.text);
});

socket.on("walkie-voice", (payload) => {
  addMessage("Voice", payload.speaking ? "Someone is talking..." : "Voice ended.");
});

socket.on("walkie-error", (payload) => {
  addMessage("System", payload.message || "Walkie channel error.");
});

loadFrequencies();
