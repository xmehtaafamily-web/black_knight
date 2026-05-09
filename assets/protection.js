document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

document.addEventListener("selectstart", (event) => {
  if (event.target.matches("input, textarea")) return;
  event.preventDefault();
});

document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("privacy-blur", document.hidden);
});

window.addEventListener("blur", () => {
  document.body.classList.add("privacy-blur");
});

window.addEventListener("focus", () => {
  document.body.classList.remove("privacy-blur");
});
