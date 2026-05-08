(function () {
  const storageKey = "bk_floating_menu_position";
  const selectors = [
    "#moreBtn",
    "#menuBtn",
    "#floatingMenuBtn",
    ".more-btn",
    ".menu-btn",
    ".floating-menu-btn",
    "[aria-label*='more' i]",
    "[aria-label*='menu' i]"
  ];

  function findMenuButton() {
    const direct = selectors.map((selector) => {
      try {
        return document.querySelector(selector);
      } catch (error) {
        return null;
      }
    }).find(Boolean);
    if (direct) return direct;

    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"));
    const icon = candidates.find((element) => {
      const text = String(element.textContent || element.getAttribute("aria-label") || "").trim().toLowerCase();
      const id = String(element.id || "").toLowerCase();
      const cls = String(element.className || "").toLowerCase();
      return text === "⋮" ||
        text === "..." ||
        text === "•••" ||
        text.includes("⋮") ||
        text.includes("more") ||
        id.includes("more") ||
        id.includes("menu") ||
        cls.includes("more") ||
        cls.includes("menu");
    });

    return icon?.closest("button, [role='button'], a, div") || icon;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function applySavedPosition(button) {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    const defaultLeft = window.innerWidth - 76;
    const defaultTop = Math.max(90, window.innerHeight * 0.42);
    const left = saved?.left ?? defaultLeft;
    const top = saved?.top ?? defaultTop;

    button.style.left = `${clamp(left, 10, window.innerWidth - 64)}px`;
    button.style.top = `${clamp(top, 10, window.innerHeight - 64)}px`;
  }

  function makeDraggable(button) {
    if (!button || button.dataset.bkDraggableMenu === "1") return;
    button.dataset.bkDraggableMenu = "1";
    button.classList.add("bk-draggable-menu-btn");
    if (!button.textContent.trim()) {
      button.textContent = "⋮";
    }
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", button.getAttribute("aria-label") || "More menu");
    applySavedPosition(button);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let buttonX = 0;
    let buttonY = 0;

    button.addEventListener("pointerdown", (event) => {
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      buttonX = button.offsetLeft;
      buttonY = button.offsetTop;
      button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const left = clamp(buttonX + dx, 10, window.innerWidth - button.offsetWidth - 10);
      const top = clamp(buttonY + dy, 10, window.innerHeight - button.offsetHeight - 10);
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      event.preventDefault();
    });

    button.addEventListener("pointerup", (event) => {
      if (!dragging) return;
      dragging = false;
      button.releasePointerCapture?.(event.pointerId);
      localStorage.setItem(storageKey, JSON.stringify({
        left: button.offsetLeft,
        top: button.offsetTop
      }));
    });

    button.addEventListener("click", (event) => {
      if (!moved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      moved = false;
    }, true);

    window.addEventListener("resize", () => applySavedPosition(button));
  }

  function init() {
    makeDraggable(findMenuButton());
  }

  document.addEventListener("DOMContentLoaded", init);
  setInterval(init, 1200);
})();
