(function () {
  if (!location.pathname.toLowerCase().includes("walkie")) return;

  function findFrequencyInput() {
    const candidates = Array.from(document.querySelectorAll("input"));
    return candidates.find((input) => {
      const text = `${input.id} ${input.name} ${input.placeholder} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
      return text.includes("frequency") || text.includes("freq") || text.includes("channel");
    }) || candidates.find((input) => input.type === "number");
  }

  function toFrequency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "30.00";
    return Math.min(Math.max(number, 30), 108).toFixed(2);
  }

  function installSlider() {
    const input = findFrequencyInput();
    if (!input || document.getElementById("walkieFrequencySlider")) return;

    input.type = "number";
    input.min = "30";
    input.max = "108";
    input.step = "0.10";
    input.value = toFrequency(input.value || 30);

    const wrap = document.createElement("div");
    wrap.className = "frequency-slider-wrap";
    wrap.innerHTML = `
      <div class="frequency-slider-head">
        <span>Frequency</span>
        <strong id="walkieFrequencyValue">${input.value} FM</strong>
      </div>
      <input id="walkieFrequencySlider" class="frequency-slider" type="range" min="30" max="108" step="0.10" value="${input.value}">
      <div class="frequency-slider-scale">
        <span>30.00</span>
        <span>69.00</span>
        <span>108.00</span>
      </div>
    `;
    input.insertAdjacentElement("afterend", wrap);

    const slider = wrap.querySelector("#walkieFrequencySlider");
    const label = wrap.querySelector("#walkieFrequencyValue");

    function syncFromSlider() {
      input.value = toFrequency(slider.value);
      label.textContent = `${input.value} FM`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function syncFromInput() {
      input.value = toFrequency(input.value);
      slider.value = input.value;
      label.textContent = `${input.value} FM`;
    }

    slider.addEventListener("input", syncFromSlider);
    input.addEventListener("input", syncFromInput);
    input.addEventListener("change", syncFromInput);
  }

  document.addEventListener("DOMContentLoaded", installSlider);
  setInterval(installSlider, 1200);
})();
