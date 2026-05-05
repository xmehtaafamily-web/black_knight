const profileForm = document.querySelector("#profileForm");
const displayNameInput = document.querySelector("#displayName");
const emailInput = document.querySelector("#emailInput");
const savedCodeInput = document.querySelector("#savedCodeInput");
const ageCheck = document.querySelector("#ageCheck");

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

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!ageCheck.checked) {
    window.alert("Please confirm you are 18 or older before matching.");
    return;
  }

  const mode = getSelected("chatMode");
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
  window.location.assign(mode === "video" ? "/video.html" : "/chat.html");
});

loadSavedProfile();
