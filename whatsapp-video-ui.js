(function () {
  if (!location.pathname.toLowerCase().includes("video")) return;

  document.body.classList.add("whatsapp-video-ui");

  function findButton(words) {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((button) => {
      const text = String(button.textContent || button.getAttribute("aria-label") || "").toLowerCase();
      return words.some((word) => text.includes(word));
    });
  }

  function clickExisting(words) {
    const button = findButton(words);
    if (button) button.click();
  }

  function toggleChatPanel() {
    document.body.classList.toggle("whatsapp-chat-open");
  }

  function buildDock() {
    if (document.querySelector(".wa-call-dock")) return;

    const dock = document.createElement("nav");
    dock.className = "wa-call-dock";
    dock.setAttribute("aria-label", "Video call controls");
    dock.innerHTML = `
      <button type="button" class="wa-call-btn" data-action="camera" aria-label="Camera">Cam</button>
      <button type="button" class="wa-call-btn" data-action="mic" aria-label="Microphone">Mic</button>
      <button type="button" class="wa-call-btn" data-action="chat" aria-label="Chat">Chat</button>
      <button type="button" class="wa-call-btn" data-action="next" aria-label="Next">Next</button>
      <button type="button" class="wa-call-btn wa-call-end" data-action="leave" aria-label="Leave instantly">End</button>
    `;
    document.body.appendChild(dock);

    dock.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (!action) return;
      if (action === "camera") clickExisting(["camera"]);
      if (action === "mic") clickExisting(["mic"]);
      if (action === "next") clickExisting(["next"]);
      if (action === "leave") clickExisting(["leave", "end"]);
      if (action === "chat") toggleChatPanel();
    });
  }

  function markChatArea() {
    const input = document.querySelector("input[placeholder*='message' i], textarea[placeholder*='message' i]");
    const chatArea = input?.closest("section, article, div");
    if (chatArea && !chatArea.classList.contains("wa-chat-panel")) {
      chatArea.classList.add("wa-chat-panel");
    }
  }

  function markVideos() {
    const remote = document.getElementById("remoteVideo") ||
      document.querySelector("video:not(#localVideo)");
    const local = document.getElementById("localVideo") ||
      Array.from(document.querySelectorAll("video")).find((video) => video !== remote);

    if (remote) remote.classList.add("wa-remote-video");
    if (local) local.classList.add("wa-local-video");
  }

  function sync() {
    buildDock();
    markVideos();
    markChatArea();
  }

  document.addEventListener("DOMContentLoaded", sync);
  setInterval(sync, 1200);
})();
