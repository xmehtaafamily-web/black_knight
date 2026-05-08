(function () {
  const privateMarkers = ["private", "privateRoom", "private-room", "invite", "reconnect"];
  const urlText = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
  const isPrivateRoomUrl = privateMarkers.some((marker) => urlText.includes(marker.toLowerCase()));

  if (!isPrivateRoomUrl) return;

  document.documentElement.classList.add("private-room-video");
  window.__bkPrivateMediaAllowedUntil = 0;

  function allowPrivateMediaTemporarily() {
    window.__bkPrivateMediaAllowedUntil = Date.now() + 12000;
  }

  function isMediaControl(element) {
    const text = String(element?.textContent || element?.getAttribute?.("aria-label") || "").toLowerCase();
    const id = String(element?.id || "").toLowerCase();
    const cls = String(element?.className || "").toLowerCase();
    return text.includes("camera") ||
      text.includes("cam") ||
      text.includes("mic") ||
      text.includes("microphone") ||
      id.includes("camera") ||
      id.includes("cam") ||
      id.includes("mic") ||
      cls.includes("camera") ||
      cls.includes("cam") ||
      cls.includes("mic");
  }

  document.addEventListener("pointerdown", (event) => {
    const control = event.target.closest("button, [role='button'], a, label, input");
    if (isMediaControl(control)) allowPrivateMediaTemporarily();
  }, true);

  document.addEventListener("click", (event) => {
    const control = event.target.closest("button, [role='button'], a, label, input");
    if (isMediaControl(control)) allowPrivateMediaTemporarily();
  }, true);

  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function privateRoomGetUserMedia(constraints) {
      const allowed = Date.now() < window.__bkPrivateMediaAllowedUntil;
      if (!allowed) {
        return new MediaStream();
      }
      return originalGetUserMedia(constraints);
    };
  }

  function markPrivateVideoLayout() {
    document.body?.classList.add("private-room-video-page");
    const stage = document.querySelector(".video-stage, .call-stage, .video-grid, .video-room, .call-video-wrap");
    stage?.classList.add("private-call-stage", "call-stage");

    const remote = document.getElementById("remoteVideo") || document.querySelector("video:not(#localVideo)");
    const local = document.getElementById("localVideo") || Array.from(document.querySelectorAll("video")).find((video) => video !== remote);

    remote?.closest(".video-tile, .video-box, .remote-video-box, div")?.classList.add("video-tile", "remote");
    local?.closest(".video-tile, .video-box, .local-video-box, div")?.classList.add("video-tile", "local", "self-preview");

    if (remote) {
      remote.setAttribute("autoplay", "");
      remote.setAttribute("playsinline", "");
    }
    if (local) {
      local.setAttribute("autoplay", "");
      local.setAttribute("playsinline", "");
      local.muted = true;
    }
  }

  document.addEventListener("DOMContentLoaded", markPrivateVideoLayout);
  setInterval(markPrivateVideoLayout, 1200);
})();
