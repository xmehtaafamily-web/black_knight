(function () {
  const key = "bk_visitor_id";

  function getVisitorId() {
    let id = localStorage.getItem(key);
    if (!id) {
      id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function trackVisit() {
    if (navigator.doNotTrack === "1") return;

    fetch("/api/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: getVisitorId(),
        page: location.pathname || "/",
        referrer: document.referrer || "",
      }),
      keepalive: true,
    }).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackVisit, { once: true });
  } else {
    trackVisit();
  }
})();
