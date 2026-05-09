const socket = io();
const roomsGrid = document.querySelector("#roomsGrid");
const roomChat = document.querySelector("#roomChat");
const activeRoomName = document.querySelector("#activeRoomName");
const leaveRoomBtn = document.querySelector("#leaveRoomBtn");
const roomMessages = document.querySelector("#roomMessages");
const roomForm = document.querySelector("#roomForm");
const roomInput = document.querySelector("#roomInput");

let activeRoom = "";

function roomCard(room) {
  return `
    <article class="feature-card room-card" data-room="${room.name}">
      <span class="live-dot online">Live</span>
      <h2>${room.name}</h2>
      <p>${room.description}</p>
      <strong>${room.activeUsers} active</strong>
      <button class="primary-action" type="button">Join Room</button>
    </article>
  `;
}

async function loadRooms() {
  const response = await fetch("/api/rooms");
  const rooms = await response.json();
  roomsGrid.innerHTML = rooms.map(roomCard).join("");
}

function addRoomMessage(message) {
  const item = document.createElement("article");
  item.className = "message";
  item.innerHTML = `<span>${message.name || "Anonymous"}</span><p>${message.text}</p>`;
  roomMessages.append(item);
  roomMessages.scrollTop = roomMessages.scrollHeight;
}

roomsGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-room]");
  if (!card) return;
  activeRoom = card.dataset.room;
  activeRoomName.textContent = activeRoom;
  roomMessages.innerHTML = '<div class="empty-state"><span class="radar-loader"></span><strong>Connected to room.</strong></div>';
  roomChat.classList.remove("hidden");
  socket.emit("join-public-room", { room: activeRoom, name: localStorage.getItem("bk_display_name") || "Guest" });
});

leaveRoomBtn.addEventListener("click", () => {
  if (activeRoom) socket.emit("leave-public-room", { room: activeRoom });
  activeRoom = "";
  roomChat.classList.add("hidden");
});

roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = roomInput.value.trim();
  if (!activeRoom || !text) return;
  socket.emit("public-room-message", { room: activeRoom, text, name: localStorage.getItem("bk_display_name") || "Guest" });
  roomInput.value = "";
});

socket.on("public-room-message", addRoomMessage);
socket.on("rooms-updated", loadRooms);
socket.on("moderation-warning", (payload) => window.alert(payload.message || "Message blocked by moderation."));

loadRooms();
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
