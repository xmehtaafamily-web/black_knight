window.BlackKnightAds = {
  provider: "adsense",
  affiliate: {
    href: "https://black-knight.onrender.com/safety.html",
    label: "Sponsored",
    title: "Advertise on Black_knight",
  },
  adsense: {
    enabled: true,
    client: "ca-pub-6577633980455130",
    slots: {
      start: "0000000000",
      chat: "0000000000",
      video: "0000000000",
    },
  },
};

function renderBlackKnightAds() {
  const config = window.BlackKnightAds;
  const slots = document.querySelectorAll("[data-ad-slot]");

  if (config.provider === "adsense" && config.adsense.enabled && !document.querySelector("script[data-adsense]")) {
    const script = document.createElement("script");
    script.async = true;
    script.dataset.adsense = "true";
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.adsense.client}`;
    document.head.append(script);
  }

  slots.forEach((slot) => {
    const slotName = slot.dataset.adSlot;

    if (config.provider === "adsense" && config.adsense.enabled) {
      slot.innerHTML = `
        <ins class="adsbygoogle"
          style="display:block"
          data-ad-client="${config.adsense.client}"
          data-ad-slot="${config.adsense.slots[slotName] || config.adsense.slots.start}"
          data-ad-format="auto"
          data-full-width-responsive="true"></ins>
      `;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (error) {
        slot.innerHTML = "<span>Sponsored</span><strong>Ad loading...</strong>";
      }
      return;
    }

    slot.innerHTML = `
      <a class="ad-link" href="${config.affiliate.href}" target="_blank" rel="sponsored noopener">
        <span>${config.affiliate.label}</span>
        <strong>${config.affiliate.title}</strong>
      </a>
    `;
  });
}

document.addEventListener("DOMContentLoaded", renderBlackKnightAds);
