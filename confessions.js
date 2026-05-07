const confessionForm = document.querySelector("#confessionForm");
const confessionInput = document.querySelector("#confessionInput");
const confessionFeed = document.querySelector("#confessionFeed");

let page = 0;
let loading = false;

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hours ago`;
}

function renderConfession(item) {
  const card = document.createElement("article");
  card.className = "feature-card confession-card";
  card.innerHTML = `
    <p>${item.text}</p>
    <span>${timeAgo(item.createdAt)}</span>
    <div class="reaction-row">
      ${["❤️", "🔥", "😢"]
        .map((emoji) => `<button type="button" data-id="${item.id}" data-reaction="${emoji}">${emoji} ${item.reactions[emoji] || 0}</button>`)
        .join("")}
    </div>
  `;
  confessionFeed.append(card);
}

async function loadConfessions() {
  if (loading) return;
  loading = true;
  const response = await fetch(`/api/confessions?page=${page}`);
  const items = await response.json();
  items.forEach(renderConfession);
  page += 1;
  loading = false;
}

confessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = confessionInput.value.trim();
  if (!text) return;
  const response = await fetch("/api/confessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    window.alert("Confession blocked by moderation or spam protection.");
    return;
  }
  confessionInput.value = "";
  confessionFeed.innerHTML = "";
  page = 0;
  loadConfessions();
});

confessionFeed.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-reaction]");
  if (!button) return;
  await fetch(`/api/confessions/${button.dataset.id}/react`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reaction: button.dataset.reaction }),
  });
  confessionFeed.innerHTML = "";
  page = 0;
  loadConfessions();
});

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY > document.body.offsetHeight - 500) loadConfessions();
});

loadConfessions();
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
