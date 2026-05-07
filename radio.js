const stations = [
  {
    name: "Radio Mirchi",
    frequency: "98.3",
    city: "India / major cities",
    streamUrl: "",
    pageUrl: "https://onlineradiofm.in/stations/mirchi",
  },
  { name: "Red FM", frequency: "93.5", city: "India / major cities", streamUrl: "", pageUrl: "https://onlineradiofm.com.in/red-fm" },
  { name: "Big FM", frequency: "92.7", city: "India / major cities", streamUrl: "", pageUrl: "https://onlineradiofm.in/stations/big" },
  { name: "Ishq FM", frequency: "104.8", city: "Delhi / Mumbai", streamUrl: "", pageUrl: "https://onlineradiofm.in/stations/ishq" },
  { name: "AIR FM Gold", frequency: "106.4", city: "Delhi", streamUrl: "", pageUrl: "https://onlineradiofm.in/stations/fm-gold" },
  { name: "AIR Vividh Bharati", frequency: "102.8", city: "India", streamUrl: "", pageUrl: "" },
];

const radioGrid = document.querySelector("#radioGrid");
const radioAudio = document.querySelector("#radioAudio");
const radioStatus = document.querySelector("#radioStatus");
const nowPlaying = document.querySelector("#nowPlaying");
const streamForm = document.querySelector("#streamForm");
const streamUrlInput = document.querySelector("#streamUrlInput");

function renderStations() {
  radioGrid.innerHTML = stations
    .map(
      (station, index) => `
        <button class="radio-card" data-index="${index}" type="button">
          <span>${station.frequency} FM</span>
          <strong>${station.name}</strong>
          <small>${station.city}</small>
          <em>${station.streamUrl ? "Stream ready" : station.pageUrl ? "Station page added" : "Needs official stream URL"}</em>
        </button>
      `,
    )
    .join("");
}

function playStream({ name, frequency, streamUrl }) {
  if (!streamUrl) {
    radioStatus.textContent = "Stream URL needed";
    nowPlaying.textContent = `${name} ${frequency} FM`;
    streamUrlInput.focus();
    return;
  }

  radioAudio.src = streamUrl;
  nowPlaying.textContent = `${name} ${frequency} FM`;
  radioStatus.textContent = "Loading...";
  radioAudio
    .play()
    .then(() => {
      radioStatus.textContent = "Playing";
    })
    .catch(() => {
      radioStatus.textContent = "Tap play";
    });
}

radioGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-index]");
  if (!card) return;
  const station = stations[Number(card.dataset.index)];
  if (!station.streamUrl && station.pageUrl) {
    radioStatus.textContent = "Opening station page";
    nowPlaying.textContent = `${station.name} ${station.frequency} FM`;
    window.open(station.pageUrl, "_blank", "noopener,noreferrer");
    return;
  }
  playStream(station);
});

streamForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const streamUrl = streamUrlInput.value.trim();
  if (!streamUrl) return;
  playStream({ name: "Custom Radio", frequency: "Live", streamUrl });
});

radioAudio.addEventListener("playing", () => {
  radioStatus.textContent = "Playing";
});

radioAudio.addEventListener("error", () => {
  radioStatus.textContent = "Stream failed";
});

renderStations();
