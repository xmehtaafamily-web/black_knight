(function () {
  const genderKeys = ["bk_gender", "gender", "userGender", "selectedGender"];
  const nameKeys = ["bk_display_name", "displayName", "userName", "guestName"];

  function readAny(keys) {
    for (const key of keys) {
      const value = String(localStorage.getItem(key) || sessionStorage.getItem(key) || "").trim();
      if (value) return value;
    }
    return "";
  }

  function hasRequiredProfile() {
    return Boolean(readAny(nameKeys) && readAny(genderKeys));
  }

  function showProfileRequired() {
    alert("Pehle name aur Your gender select karo. Uske bina chat, video aur walkie talkie start nahi hoga.");
  }

  function isStartAction(element) {
    const text = String(element.textContent || element.getAttribute("aria-label") || "").toLowerCase();
    const id = String(element.id || "").toLowerCase();
    const href = String(element.getAttribute("href") || "").toLowerCase();
    const cls = String(element.className || "").toLowerCase();
    return text.includes("start") ||
      text.includes("chat") ||
      text.includes("video") ||
      text.includes("walkie") ||
      id.includes("start") ||
      id.includes("chat") ||
      id.includes("video") ||
      id.includes("walkie") ||
      href.includes("chat.html") ||
      href.includes("video.html") ||
      href.includes("walkie.html") ||
      cls.includes("start");
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("a, button");
    if (!target || !isStartAction(target)) return;
    if (hasRequiredProfile()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showProfileRequired();
  }, true);

  window.BlackKnightRequiredProfile = {
    hasRequiredProfile,
    gender: () => readAny(genderKeys),
    name: () => readAny(nameKeys)
  };
})();
