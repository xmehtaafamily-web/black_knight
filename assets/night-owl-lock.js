(function () {
  const moodText = "night owl";
  const storageKeys = ["bk_mood", "selectedMood", "mood"];

  function isNightOwlHour() {
    return new Date().getHours() === 3;
  }

  function clearNightOwlSelection() {
    for (const key of storageKeys) {
      if (String(localStorage.getItem(key) || "").toLowerCase() === moodText) {
        localStorage.removeItem(key);
      }
    }
  }

  function getNightOwlButtons() {
    return Array.from(document.querySelectorAll("button, [role='button'], label, .mood-chip, .mood-btn, .option-chip"))
      .filter((element) => String(element.textContent || element.getAttribute("aria-label") || "").toLowerCase().includes(moodText));
  }

  function applyLockState() {
    const unlocked = isNightOwlHour();
    getNightOwlButtons().forEach((button) => {
      button.classList.toggle("night-owl-locked", !unlocked);
      button.classList.toggle("night-owl-unlocked", unlocked);
      button.setAttribute("aria-disabled", unlocked ? "false" : "true");
      if ("disabled" in button) button.disabled = !unlocked;
      if (!button.dataset.originalTitle) {
        button.dataset.originalTitle = button.getAttribute("title") || "";
      }
      button.setAttribute("title", unlocked ? "Night Owl unlocked" : "Night Owl unlocks at 3 AM");
      if (!button.querySelector(".night-owl-lock-badge")) {
        const badge = document.createElement("span");
        badge.className = "night-owl-lock-badge";
        badge.textContent = unlocked ? "3AM" : "LOCKED";
        button.appendChild(badge);
      } else {
        button.querySelector(".night-owl-lock-badge").textContent = unlocked ? "3AM" : "LOCKED";
      }
    });

    if (!unlocked) clearNightOwlSelection();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, [role='button'], label, .mood-chip, .mood-btn, .option-chip");
    if (!target) return;
    const isNightOwl = String(target.textContent || target.getAttribute("aria-label") || "").toLowerCase().includes(moodText);
    if (!isNightOwl || isNightOwlHour()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    alert("Night Owl mood sirf 3 AM se 3:59 AM tak unlock hota hai.");
  }, true);

  document.addEventListener("DOMContentLoaded", applyLockState);
  setInterval(applyLockState, 30000);
})();
