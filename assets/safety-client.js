(function () {
  const seenKey = "bk_safety_seen_v2";
  const categories = ["Abuse", "Spam", "Nudity", "Harassment", "Fake/Bot", "Threat"];

  function escapeText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function ensureGuestSession() {
    try {
      const response = await fetch("/api/guest-session", { credentials: "same-origin" });
      return response.ok ? response.json() : null;
    } catch (error) {
      return null;
    }
  }

  function showSafetyPopup() {
    if (localStorage.getItem(seenKey)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "safety-overlay";
      overlay.innerHTML = `
        <div class="safety-modal" role="dialog" aria-modal="true">
          <div class="safety-chip">Stay Safe</div>
          <h2>Anonymous means careful.</h2>
          <p>No login is needed. Do not share phone number, address, OTP, password, payment details, or private photos.</p>
          <ul>
            <li>Report abusive users</li>
            <li>Block unsafe matches</li>
            <li>Leave instantly if something feels wrong</li>
          </ul>
          <div class="safety-actions">
            <button type="button" class="btn secondary" data-close>Leave</button>
            <button type="button" class="btn primary" data-ok>I understand</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-ok]").addEventListener("click", () => {
        localStorage.setItem(seenKey, "1");
        overlay.remove();
        resolve(true);
      });
      overlay.querySelector("[data-close]").addEventListener("click", () => {
        overlay.remove();
        resolve(false);
      });
    });
  }

  function pickReportCategory() {
    const answer = window.prompt(`Report category: ${categories.join(", ")}`, "Abuse");
    if (!answer) return "";
    return categories.find((item) => item.toLowerCase() === answer.trim().toLowerCase()) || "Abuse";
  }

  function bindSocketSafety(socket) {
    if (!socket) return;
    socket.on("safety-warning", (payload = {}) => {
      const message = payload.message || "Action blocked for safety.";
      if (window.addSystemMessage) window.addSystemMessage(message);
      else window.alert(message);
    });
    socket.on("connect_error", (error) => {
      const message = error?.message || "Connection blocked for safety.";
      if (window.addSystemMessage) window.addSystemMessage(message);
      else window.alert(message);
    });
  }

  document.addEventListener("contextmenu", (event) => {
    if (event.target.closest("video, .video-stage, .call-stage")) event.preventDefault();
  });

  window.BlackKnightSafety = {
    bindSocketSafety,
    ensureGuestSession,
    escapeText,
    pickReportCategory,
    showSafetyPopup,
  };
})();
