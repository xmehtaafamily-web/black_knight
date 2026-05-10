(function () {
  if (!location.pathname.toLowerCase().includes("walkie")) return;

  let currentAudio = null;
  let currentRadio = null;
  const knownStreams = {
    "92.70": {
      frequency: "92.70",
      name: "Big FM",
      pageUrl: "https://onlineradiofm.in/stations/big",
      streamUrl: "https://stream.zeno.fm/dbstwo3dvhhtv"
    },
    "93.50": {
      frequency: "93.50",
      name: "Red FM",
      pageUrl: "https://onlineradiofm.com.in/red-fm",
      streamUrl: "https://stream.zeno.fm/9phrkb1e3v8uv"
    }
  };

  function findCurrentFrequency() {
    const selectedText = Array.from(document.querySelectorAll(".active, .selected, [aria-pressed='true'], [data-active='true'], [data-selected='true']"))
      .map((node) => node.textContent || "")
      .join(" ");
    const selectedMatch = selectedText.match(/\b(\d{2,3}\.\d{1,2})\s*FM\b/i);
    if (selectedMatch) return Number(selectedMatch[1]).toFixed(2);

    const radioPanelText = (findRadioPanel()?.textContent || "");
    const panelMatch = radioPanelText.match(/\b(\d{2,3}\.\d{1,2})\s*FM\b/i);
    if (panelMatch) return Number(panelMatch[1]).toFixed(2);

    const bodyMatch = (document.body.innerText || "").match(/\b(92\.70|93\.50|98\.30)\s*FM\b/i);
    if (bodyMatch) return Number(bodyMatch[1]).toFixed(2);

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
    if (knownStreams[frequency]) {
      currentRadio = knownStreams[frequency];
      return currentRadio;
    }
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
    return candidates.find((node) => /radio frequency locked|radio only|radio|fm|voice locked|direct stream/i.test(node.textContent || "")) || document.body;
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
      existing.textContent = radio?.name ? `Play ${radio.name}` : "Play Radio";
      return;
    }

    const button = document.createElement("button");
    button.id = "walkiePlayRadioBtn";
    button.type = "button";
    button.className = "walkie-play-radio-btn";
    button.dataset.streamUrl = streamUrl;
    button.textContent = radio?.name ? `Play ${radio.name}` : "Play Radio";
    const panel = findRadioPanel();
    if (panel && panel !== document.body) {
      panel.appendChild(button);
    } else {
      button.classList.add("walkie-play-radio-floating");
      document.body.appendChild(button);
    }

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
        alert("The browser blocked autoplay. Tap the Play Radio button again.");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", ensureButton);
  setInterval(ensureButton, 1500);
})();
