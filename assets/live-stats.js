(function () {
  if (!location.pathname.endsWith("/") && !location.pathname.includes("index.html")) return;

  const statMap = [
    { keys: ["online"], label: "Online", value: "online" },
    { keys: ["video"], label: "Video Chats Live", value: "video" },
    { keys: ["chat"], label: "Only Chat Live", value: "chat" },
    { keys: ["countries"], label: "Countries Active", value: "countries" }
  ];

  function findStatCard(labelText) {
    const cards = Array.from(document.querySelectorAll("section, article, div, li"));
    return cards.find((card) => {
      const text = String(card.textContent || "").toLowerCase();
      return text.includes(labelText.toLowerCase());
    });
  }

  function setCardValue(labelText, value) {
    const card = findStatCard(labelText);
    if (!card) return;
    const strong = card.querySelector("strong, b, .stat-number, .stats-number, h2, h3") ||
      Array.from(card.children).find((child) => /^\s*[\d,]+\s*$/.test(child.textContent || ""));
    if (strong) {
      strong.textContent = String(value);
      return;
    }
    const firstTextNode = Array.from(card.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent || ""));
    if (firstTextNode) firstTextNode.textContent = String(value);
  }

  function ensureMissingCards() {
    let wrap = document.getElementById("realLiveStats");
    if (wrap) return wrap;
    const existing = findStatCard("Countries Active")?.parentElement || findStatCard("Online")?.parentElement;
    wrap = document.createElement("section");
    wrap.id = "realLiveStats";
    wrap.className = "real-live-stats";
    wrap.innerHTML = statMap.map((item) => `
      <article class="real-live-stat-card" data-live-stat="${item.value}">
        <strong>0</strong>
        <span>${item.label}</span>
      </article>
    `).join("");
    if (existing) existing.insertAdjacentElement("afterend", wrap);
    else document.body.prepend(wrap);
    return wrap;
  }

  function updateFallbackCards(data) {
    const wrap = ensureMissingCards();
    for (const item of statMap) {
      const card = wrap.querySelector(`[data-live-stat="${item.value}"]`);
      if (!card) continue;
      card.querySelector("strong").textContent = String(data[item.value] ?? 0);
    }
  }

  async function refreshStats() {
    try {
      const response = await fetch("/api/live-stats", { cache: "no-store" });
      const data = await response.json();
      setCardValue("Online", data.online ?? 0);
      setCardValue("Video Chats Live", data.video ?? 0);
      setCardValue("Only Chat Live", data.chat ?? 0);
      setCardValue("Countries Active", data.countries ?? 0);
      updateFallbackCards(data);
    } catch (error) {
      updateFallbackCards({ online: 0, video: 0, chat: 0, countries: 0 });
    }
  }

  document.addEventListener("DOMContentLoaded", refreshStats);
  setInterval(refreshStats, 5000);
})();
