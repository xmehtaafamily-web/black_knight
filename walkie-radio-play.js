(function () {
  if (!location.pathname.toLowerCase().includes("walkie")) return;

  let currentAudio = null;
  let currentRadio = null;

  function findCurrentFrequency() {
    const inputs = Array.from(document.querySelectorAll("input"));
    const freqInput = inputs.find((input) => {
      const text = `${input.id} ${input.name} ${input.placeholder} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
      return text.includes("frequency") || text.includes("freq") || text.includes("channel");
    }) || inputs.find((input) => input.type === "number" || input.type === "range");
    const value = Number(freqInput?.value);
    if (Number.isFinite(value)) return value.toFixed(2);

    const textMatch = (document.body.innerText || "").match(/\b(\d{2,3}\.\d{1,2})\s*(?:fm|frequency)?\b/i);
    return textMatch ? Number(textMatch[1]).toFixed(2) : "";
  }

  async function fetchCurrentRadio() {
    const frequency = findCurrentFrequency();
    if (!frequency) return null;
    try {
      const response = await fetch("/api/walkie/stats", { cache: "no-store" });
      const stats = await response.json();
      const item = Array.isArray(stats) ? stats.find((entry) => String(entry.frequency) === frequency) : null;
      const radio = item?.radio || item;
      if (radio?.streamUrl) {
        currentRadio = { frequency, ...radio };
        return currentRadio;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

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

  async function ensureButton() {
    const radio = await fetchCurrentRadio();
    const streamUrl = radio?.streamUrl || findRadioStreamUrl();
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
    button.textContent = radio?.name ? `Play ${radio.name}` : "Play Radio";
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
        button.textContent = currentRadio?.name ? `Play ${currentRadio.name}` : "Play Radio";
        return;
      }

      currentAudio.src = url;
      try {
        await currentAudio.play();
        button.textContent = currentRadio?.name ? `Pause ${currentRadio.name}` : "Pause Radio";
      } catch (error) {
        button.textContent = "Tap again to play";
        alert("Browser ne autoplay block kiya. Play Radio button dobara tap karo.");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", ensureButton);
  setInterval(ensureButton, 1500);
})();
