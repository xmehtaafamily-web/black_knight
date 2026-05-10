(function () {
  const isAdmin = location.pathname.toLowerCase().includes("admin");
  const endpoint = isAdmin ? "/api/admin/ai" : "/api/ai";
  const title = isAdmin ? "Admin AI" : "AI Help";
  const starters = isAdmin
    ? [
        "Summarize today's reports",
        "What should I fix first?",
        "Show traffic insights",
      ]
    : [
        "How do I stay safe?",
        "How does reconnect work?",
        "What can I ask a stranger?",
      ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function createWidget() {
    if (document.getElementById("bkAiAgent")) return;

    const widget = document.createElement("section");
    widget.id = "bkAiAgent";
    widget.className = "bk-ai-agent";
    widget.innerHTML = `
      <button id="bkAiToggle" class="bk-ai-toggle" type="button" aria-label="${title}">${title}</button>
      <div id="bkAiPanel" class="bk-ai-panel" hidden>
        <div class="bk-ai-head">
          <div><span>Black_knight</span><strong>${title}</strong></div>
          <button id="bkAiClose" type="button" aria-label="Close">x</button>
        </div>
        <div class="bk-ai-starters">
          ${starters.map((item) => `<button type="button" data-ai-prompt="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
        </div>
        <div id="bkAiMessages" class="bk-ai-messages">
          <article class="ai"><p>${isAdmin ? "Free local AI is active. Ask about reports, visits, safety, or feedback." : "Free local AI is active. Ask for help, safety tips, or chat ideas."}</p></article>
        </div>
        <form id="bkAiForm" class="bk-ai-form">
          <input id="bkAiInput" type="text" maxlength="900" placeholder="${isAdmin ? "Ask admin AI..." : "Ask AI help..."}" />
          <button type="submit">Send</button>
        </form>
      </div>
    `;
    document.body.appendChild(widget);
  }

  function addMessage(kind, text) {
    const box = document.getElementById("bkAiMessages");
    if (!box) return;
    const item = document.createElement("article");
    item.className = kind;
    item.innerHTML = `<p>${escapeHtml(text)}</p>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  async function ask(message) {
    const clean = String(message || "").trim();
    if (!clean) return;
    addMessage("user", clean);
    addMessage("ai loading", "Thinking...");

    const loading = document.querySelector("#bkAiMessages .loading:last-child");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean }),
      });
      const data = await response.json();
      if (loading) loading.remove();
      addMessage("ai", data.answer || data.error || "No response.");
    } catch (error) {
      if (loading) loading.remove();
      addMessage("ai", "AI connect nahi ho pa raha. Thodi der baad try karo.");
    }
  }

  function bind() {
    const panel = document.getElementById("bkAiPanel");
    const input = document.getElementById("bkAiInput");
    document.getElementById("bkAiToggle")?.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) input?.focus();
    });
    document.getElementById("bkAiClose")?.addEventListener("click", () => {
      panel.hidden = true;
    });
    document.getElementById("bkAiForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const message = input.value;
      input.value = "";
      ask(message);
    });
    document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
      button.addEventListener("click", () => ask(button.dataset.aiPrompt));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    createWidget();
    bind();
  });
})();
