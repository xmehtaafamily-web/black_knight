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

  function readSelectedGenderFromPage() {
    const selected = Array.from(document.querySelectorAll(".selected, .active, [aria-pressed='true'], [data-selected='true']"))
      .find((element) => {
        const text = String(element.textContent || element.getAttribute("aria-label") || "").toLowerCase();
        return /\b(male|female)\b/.test(text);
      });
    const text = String(selected?.textContent || selected?.getAttribute?.("aria-label") || "").toLowerCase();
    if (text.includes("female")) return "female";
    if (text.includes("male")) return "male";
    return "";
  }

  function readSelectedNameFromPage() {
    const input = document.querySelector("input[name*='name' i], input[id*='name' i], input[placeholder*='name' i]");
    return String(input?.value || "").trim();
  }

  function hasRequiredProfile() {
    const name = readAny(nameKeys) || readSelectedNameFromPage();
    const gender = readAny(genderKeys) || readSelectedGenderFromPage();
    if (name) localStorage.setItem("bk_display_name", name);
    if (gender) localStorage.setItem("bk_gender", gender);
    return Boolean(name && gender);
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
    const clickedText = String(event.target.closest("button, [role='button'], label")?.textContent || "").toLowerCase();
    if (/\bmale\b/.test(clickedText) || /\bfemale\b/.test(clickedText)) {
      localStorage.setItem("bk_gender", clickedText.includes("female") ? "female" : "male");
    }

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
