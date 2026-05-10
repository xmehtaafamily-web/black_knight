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
    const checkedInput = document.querySelector("input[name='gender']:checked, input[name='userGender']:checked, input[name*='gender' i]:checked");
    const checkedValue = String(checkedInput?.value || "").toLowerCase();
    if (checkedValue.includes("female")) return "female";
    if (checkedValue.includes("male")) return "male";

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
    const input = document.querySelector("#displayName, input[name*='name' i], input[id*='name' i], input[placeholder*='name' i]");
    return String(input?.value || "").trim();
  }

  function saveProfileFromPage() {
    const name = readSelectedNameFromPage();
    const gender = readSelectedGenderFromPage();
    if (name) {
      for (const key of nameKeys) localStorage.setItem(key, name);
      sessionStorage.setItem("bk_display_name", name);
    }
    if (gender) {
      for (const key of genderKeys) localStorage.setItem(key, gender);
      sessionStorage.setItem("bk_gender", gender);
    }
  }

  function hasRequiredProfile() {
    saveProfileFromPage();
    const name = readAny(nameKeys) || readSelectedNameFromPage();
    const gender = readAny(genderKeys) || readSelectedGenderFromPage();
    if (name) localStorage.setItem("bk_display_name", name);
    if (gender) localStorage.setItem("bk_gender", gender);
    return Boolean(name && gender);
  }

  function showProfileRequired() {
    alert("Please enter your name and select your gender first. Chat, video chat and walkie talkie will not start without them.");
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
    saveProfileFromPage();
    const clickedText = String(event.target.closest("button, [role='button'], label")?.textContent || "").toLowerCase();
    if (/\bmale\b/.test(clickedText) || /\bfemale\b/.test(clickedText)) {
      const gender = clickedText.includes("female") ? "female" : "male";
      for (const key of genderKeys) localStorage.setItem(key, gender);
      sessionStorage.setItem("bk_gender", gender);
    }

    const target = event.target.closest("a, button");
    if (!target || !isStartAction(target)) return;
    if (hasRequiredProfile()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showProfileRequired();
  }, true);

  document.addEventListener("input", saveProfileFromPage, true);
  document.addEventListener("change", saveProfileFromPage, true);

  window.BlackKnightRequiredProfile = {
    hasRequiredProfile,
    gender: () => readAny(genderKeys),
    name: () => readAny(nameKeys)
  };
})();
