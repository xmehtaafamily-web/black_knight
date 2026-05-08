(function () {
  if (!location.pathname.toLowerCase().includes("walkie")) return;

  let currentAudio = null;

  function findRadioStreamUrl() {
    const dataNodes = Array.from(document.querySelectorAll("[data-stream-url], [data-radio-stream]"));
    const dataUrl = dataNodes.map((node) => node.dataset.streamUrl || node.dataset.radioStream).find(Boolean);
    if (dataUrl) return dataUrl;

    const text = document.body.innerText || "";
    const match = text.match(/https?:\/\/stream\.zeno\.fm\/[A-Za-z0-9_-]+/i) ||
      text.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|aac|m3u8|ogg|opus|pls)(?:[?#][^\s"'<>]*)?/i);
    return match ? match[0] : "";
  }

  function findRadioPanel() {
    const candidates = Array.from(document.querySelectorAll("section, article, div"));
    return candidates.find((node) => /radio|fm|voice locked|direct stream/i.test(node.textContent || "")) || document.body;
  }

  function ensureButton() {
    const streamUrl = findRadioStreamUrl();
    const existing = document.getElementById("walkiePlayRadioBtn");
    if (!streamUrl) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.dataset.streamUrl = streamUrl;
      return;
    }

    const button = document.createElement("button");
    button.id = "walkiePlayRadioBtn";
    button.type = "button";
    button.className = "walkie-play-radio-btn";
    button.dataset.streamUrl = streamUrl;
    button.textContent = "Play Radio";
    findRadioPanel().appendChild(button);

    button.addEventListener("click", async () => {
      const url = button.dataset.streamUrl;
      if (!currentAudio) {
        currentAudio = new Audio();
        currentAudio.crossOrigin = "anonymous";
        currentAudio.preload = "none";
      }

      if (!currentAudio.paused && currentAudio.src === url) {
        currentAudio.pause();
        button.textContent = "Play Radio";
        return;
      }

      currentAudio.src = url;
      try {
        await currentAudio.play();
        button.textContent = "Pause Radio";
      } catch (error) {
        button.textContent = "Tap again to play";
        alert("Browser ne autoplay block kiya. Play Radio button dobara tap karo.");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", ensureButton);
  setInterval(ensureButton, 1500);
})();
