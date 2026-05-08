(function () {
  const pageType = document.body?.dataset?.roomType ||
    (location.pathname.includes("video") ? "video" : location.pathname.includes("chat") ? "chat" : "site");
  const counterKey = `bk_${pageType}_switch_count`;
  const shownKey = `bk_${pageType}_last_interstitial_at`;
  const sponsorCampaigns = [
    {
      name: "Apple Music",
      url: "https://bywiola.com/c/78tuvzaw8k1895f3294b0267b86f6e/",
      image: "/assets/banner-india-ppp_300x250_2024-01-24.aa31.png",
      title: "Listen to millions of songs"
    },
    {
      name: "Sponsor",
      url: "https://grfpr.com/g/exe221unkp1895f3294bddf84d4c0b/",
      image: "/assets/banner-india-ppp_300x250_2024-01-24.aa31.png",
      title: "Featured offer"
    },
    {
      name: "NordPass",
      url: "https://nordpass.com/",
      image: "/assets/nordpass.webp",
      title: "Securely store and autofill passwords"
    },
    {
      name: "Alibaba",
      url: "https://offer.alibaba.com/",
      image: "/assets/alibaba.jpg",
      title: "Explore global wholesale deals"
    },
    {
      name: "Ulike",
      url: "https://www.ulike.com",
      image: "/assets/ulike.jpg",
      title: "Future beauty made easy"
    },
    {
      name: "SHEIN",
      url: "https://www.shein.com/",
      html: "/assets/shein.html",
      title: "Shop trending fashion"
    }
  ];

  function getCount() {
    return Number(localStorage.getItem(counterKey) || 0);
  }

  function setCount(value) {
    localStorage.setItem(counterKey, String(value));
  }

  function buildOverlay() {
    const campaign = sponsorCampaigns[Math.floor(Math.random() * sponsorCampaigns.length)];
    const media = campaign.html
      ? `<iframe class="bk-interstitial-frame" src="${campaign.html}" title="${campaign.name} sponsored offer" loading="lazy" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe>`
      : `<img src="${campaign.image}" alt="${campaign.name} sponsored offer" onerror="this.closest('.bk-interstitial-link').classList.add('bk-interstitial-fallback'); this.remove();">`;
    const overlay = document.createElement("div");
    overlay.className = "bk-interstitial";
    overlay.innerHTML = `
      <div class="bk-interstitial-card">
        <button class="bk-interstitial-close" type="button" aria-label="Close ad" hidden>×</button>
        <p class="bk-interstitial-kicker">Sponsored · ${campaign.name}</p>
        <a class="bk-interstitial-link" href="${campaign.url}" target="_blank" rel="nofollow sponsored noopener">
          ${media}
        </a>
        <h2>${campaign.title}</h2>
        <p class="bk-interstitial-copy">Ad dekhne se site free chalti rahegi. Cross kuch seconds me active ho jayega.</p>
        <p class="bk-interstitial-timer">Close in 3</p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showInterstitial() {
    if (document.querySelector(".bk-interstitial")) return;
    localStorage.setItem(shownKey, String(Date.now()));
    const overlay = buildOverlay();
    const closeBtn = overlay.querySelector(".bk-interstitial-close");
    const timer = overlay.querySelector(".bk-interstitial-timer");
    let seconds = 3;

    const tick = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        timer.textContent = `Close in ${seconds}`;
        return;
      }
      clearInterval(tick);
      timer.textContent = "You can close now";
      closeBtn.hidden = false;
    }, 1000);

    closeBtn.addEventListener("click", () => overlay.remove());
  }

  function recordSwitch() {
    const next = getCount() + 1;
    setCount(next);
    if (next >= 3) {
      setCount(0);
      showInterstitial();
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    const text = String(target.textContent || target.getAttribute("aria-label") || "").toLowerCase();
    const id = String(target.id || "").toLowerCase();
    const className = String(target.className || "").toLowerCase();
    if (text.includes("next") || id.includes("next") || className.includes("next")) {
      recordSwitch();
    }
  }, true);

  window.BlackKnightInterstitial = { recordSwitch, showInterstitial };
})();
