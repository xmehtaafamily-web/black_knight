const profileForm = document.querySelector("#profileForm");
const displayNameInput = document.querySelector("#displayName");
const emailInput = document.querySelector("#emailInput");
const savedCodeInput = document.querySelector("#savedCodeInput");
const ageCheck = document.querySelector("#ageCheck");
const startButton = profileForm.querySelector("button[type='submit']");

const storageKeys = {
  deviceId: "bk_device_id",
  name: "bk_display_name",
  email: "bk_email",
  reconnectCode: "bk_reconnect_code",
  pendingProfile: "bk_pending_profile",
};

function getSelected(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
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
    name: displayNameInput.value.trim() || "Guest",
    email: emailInput.value.trim(),
    deviceId: getDeviceId(),
    savedCode: savedCodeInput.value.trim().toUpperCase(),
    gender: getSelected("gender"),
    preference: getSelected("preference"),
    mode,
  };

  localStorage.setItem(storageKeys.name, profile.name);
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
