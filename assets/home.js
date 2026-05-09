const profileForm = document.querySelector("#profileForm");
const displayNameInput = document.querySelector("#displayName");
const emailInput = document.querySelector("#emailInput");
const savedCodeInput = document.querySelector("#savedCodeInput");
const ageCheck = document.querySelector("#ageCheck");
const startButton = profileForm.querySelector("button[type='submit']");

const storageKeys = {
  deviceId: "bk_device_id",
  name: "bk_display_name",
  gender: "bk_gender",
  email: "bk_email",
  reconnectCode: "bk_reconnect_code",
  reconnectHistory: "bk_reconnect_history",
  pendingProfile: "bk_pending_profile",
};

function getSelected(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function renderRecentConnections() {
  const target = document.querySelector("#recentConnections");
  if (!target) return;

  const history = JSON.parse(localStorage.getItem(storageKeys.reconnectHistory) || "[]").slice(0, 5);
  target.innerHTML = history.length
    ? `
      <p class="eyebrow">Recent Connections</p>
      <div class="recent-list">
        ${history
          .map(
            (item) => `
              <a href="./reconnect.html" class="recent-chip" data-code="${item.code}">
                <strong>${item.code}</strong>
                <span>${new Date(item.savedAt).toLocaleString()}</span>
              </a>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  target.querySelectorAll("[data-code]").forEach((item) => {
    item.addEventListener("click", () => localStorage.setItem(storageKeys.reconnectCode, item.dataset.code));
  });
}

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

function updateStartButtonText() {
  const mode = getSelected("chatMode");
  startButton.textContent = mode === "video" ? "Allow camera and start video chat" : "Start random chat";
}

async function requestVideoPermissionIfNeeded(mode) {
  if (mode !== "video") return true;

  if (!navigator.mediaDevices?.getUserMedia) {
    window.alert("Camera is not available in this browser.");
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    window.alert("Camera and microphone permission is required for Video Chat. Allow permission in browser settings and try again.");
    return false;
  }
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!ageCheck.checked) {
    window.alert("Please confirm you are 18 or older before matching.");
    return;
  }

  const requiredName = displayNameInput.value.trim();
  if (!requiredName) {
    window.alert("Please enter a display name first. Name is required for Chat, Video Chat and Walkie Talkie.");
    displayNameInput.focus();
    return;
  }

  const mode = getSelected("chatMode");
  startButton.disabled = true;
  startButton.textContent = mode === "video" ? "Requesting camera..." : "Starting...";

  const hasVideoPermission = await requestVideoPermissionIfNeeded(mode);
  if (!hasVideoPermission) {
    startButton.disabled = false;
    updateStartButtonText();
    return;
  }

  const profile = {
    name: requiredName,
    email: "",
    deviceId: getDeviceId(),
    savedCode: savedCodeInput.value.trim().toUpperCase(),
    gender: getSelected("gender"),
    preference: getSelected("preference"),
    mood: getSelected("mood"),
    mode,
    mood: document.querySelector('input[name="mood"]:checked')?.value || localStorage.getItem("bk_mood") || "Chill",
  };

  localStorage.setItem(storageKeys.name, profile.name);
  localStorage.setItem(storageKeys.gender, profile.gender);
  localStorage.setItem(storageKeys.email, profile.email);
  sessionStorage.setItem(storageKeys.pendingProfile, JSON.stringify(profile));
  sessionStorage.setItem("bk_video_permission_ready", mode === "video" ? "true" : "false");
  window.location.assign(mode === "video" ? "/video.html" : "/chat.html");
});

document.querySelectorAll('input[name="chatMode"]').forEach((input) => {
  input.addEventListener("change", updateStartButtonText);
});

loadSavedProfile();
updateStartButtonText();

if (emailInput?.closest("label")) {
  emailInput.closest("label").style.display = "none";
}

window.BlackKnightSafety?.ensureGuestSession?.();
window.BlackKnightSafety?.showSafetyPopup?.();

(function enhanceHomeExperience() {
  const moodOptions = ["Chill", "Deep Talk", "Night Owl"];
  const introCopy = document.querySelector(".intro-copy");
  if (introCopy) {
    introCopy.innerHTML = `
      <p class="eyebrow">Random chat and video matching</p>
      <h1>Enter The Unknown</h1>
      <p>Meet strangers instantly through text or live video.</p>
      <div class="live-stats" aria-label="Live platform stats">
        <span><strong>12,421</strong> Online</span>
        <span><strong>1,281</strong> Video Chats Live</span>
        <span><strong>85</strong> Countries Active</span>
      </div>
    `;
  }

  if (!document.querySelector("#moodSelector")) {
    const modeGroup = document.querySelector('input[name="chatMode"]')?.closest(".field-group");
    const savedMood = localStorage.getItem("bk_mood") || "Chill";
    const moodBlock = document.createElement("div");
    moodBlock.className = "field-group mood-section";
    moodBlock.innerHTML = `
      <span>Choose mood</span>
      <div id="moodSelector" class="mood-grid" role="radiogroup" aria-label="Mood">
        ${moodOptions
          .map(
            (mood) => `
              <label class="mood-option">
                <input type="radio" name="mood" value="${mood}" ${mood === savedMood ? "checked" : ""} />
                <span>${mood}</span>
              </label>
            `,
          )
          .join("")}
      </div>
    `;
    modeGroup?.after(moodBlock);
    moodBlock.querySelectorAll('input[name="mood"]').forEach((input) => {
      input.addEventListener("change", () => localStorage.setItem("bk_mood", input.value));
    });
  }

  if (!document.querySelector(".feature-docks")) {
    const form = document.querySelector("#profileForm");
    const recent = JSON.parse(localStorage.getItem("bk_recent_connections") || "[]");
    const docks = document.createElement("div");
    docks.className = "feature-docks";
    docks.innerHTML = `
      <a href="/rooms.html" class="feature-card">
        <span>Midnight Rooms</span>
        <strong>3AM Thoughts, Deep Talks, Chill Zone</strong>
      </a>
      <a href="/confessions.html" class="feature-card">
        <span>Confession Wall</span>
        <strong>Anonymous confessions with reactions</strong>
      </a>
      <a href="/walkie.html" class="feature-card">
        <span>Walkie Talkie</span>
        <strong>Frequency channels with voice + chat</strong>
      </a>
      <a href="/radio.html" class="feature-card">
        <span>Live Radio</span>
        <strong>Play official internet radio streams</strong>
      </a>
      <div class="feature-card">
        <span>Recent Connections</span>
        <strong>${recent.length ? recent.slice(0, 3).map((item) => item.code).join(" · ") : "Saved reconnect codes appear here"}</strong>
      </div>
    `;
    form?.after(docks);
  }
})();

(function removeDuplicateMoodSections() {
  cleanupDuplicateHomepageSections();
})();

function cleanupDuplicateHomepageSections() {
  const keepFirst = (selector) => {
    document.querySelectorAll(selector).forEach((node, index) => {
      if (index > 0) node.remove();
    });
  };

  keepFirst(".live-stats");
  keepFirst(".feature-docks");

  const moodSections = Array.from(document.querySelectorAll(".field-group")).filter((section) => {
    const title = section.querySelector("span")?.textContent?.trim().toLowerCase();
    return title === "choose mood" || section.querySelector('input[name="mood"]');
  });
  moodSections.slice(1).forEach((section) => section.remove());

  const recentCards = Array.from(document.querySelectorAll(".feature-card")).filter((card) =>
    card.textContent.toLowerCase().includes("recent connections"),
  );
  recentCards.slice(1).forEach((card) => card.remove());
}

window.addEventListener("DOMContentLoaded", cleanupDuplicateHomepageSections);
window.setTimeout(cleanupDuplicateHomepageSections, 100);

document.addEventListener("click", (event) => {
  const walkieLink = event.target.closest('a[href$="walkie.html"], a[href="/walkie.html"]');
  if (!walkieLink) return;
  if (!displayNameInput.value.trim() && !localStorage.getItem(storageKeys.name)) {
    event.preventDefault();
    window.alert("Walkie Talkie use karne ke liye pehle display name fill karo.");
    displayNameInput.focus();
    return;
  }
  if (displayNameInput.value.trim()) {
    localStorage.setItem(storageKeys.name, displayNameInput.value.trim());
    localStorage.setItem(storageKeys.gender, getSelected("gender"));
  }
});
renderRecentConnections();
