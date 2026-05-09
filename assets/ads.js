window.BlackKnightAds = {
  provider: "affiliate",
  affiliate: {
    href: "https://bywiola.com/c/78tuvzaw8k1895f3294b0267b86f6e/",
    label: "Sponsored",
    title: "Listen to music",
    image: "./assets/banner-india-ppp_300x250_2024-01-24.aa31.png",
    offers: [
      {
        href: "https://bywiola.com/c/78tuvzaw8k1895f3294b0267b86f6e/",
        title: "Listen to music",
        image: "./assets/banner-india-ppp_300x250_2024-01-24.aa31.png",
      },
      {
        href: "https://grfpr.com/g/exe221unkp1895f3294bddf84d4c0b/",
        title: "Sponsored offer",
        image: "./assets/banner-india-ppp_300x250_2024-01-24.aa31.png",
      },
    ],
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

    const offers = config.affiliate.offers?.length ? config.affiliate.offers : [config.affiliate];
    const offer = offers[Math.floor(Math.random() * offers.length)];

    slot.innerHTML = offer.image
      ? `
        <a class="ad-link ad-image-link" href="${offer.href}" target="_blank" rel="sponsored noopener">
          <img src="${offer.image}" alt="${offer.title}" loading="lazy" />
        </a>
      `
      : `
        <a class="ad-link" href="${offer.href}" target="_blank" rel="sponsored noopener">
          <span>${config.affiliate.label}</span>
          <strong>${offer.title}</strong>
        </a>
      `;
  });
}

document.addEventListener("DOMContentLoaded", renderBlackKnightAds);
