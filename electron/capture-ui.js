import { initLocale, applyI18n, bindLocaleSelect, t } from "../js/i18n.js";

initLocale();
applyI18n(document);

const urlInput = document.getElementById("url");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
let lastState = null;

function applyState(state) {
  lastState = state;
  if (!state) return;
  const count = state.count || 0;
  countEl.textContent = count === 1 ? t("ext.stepOne") : t("ext.stepsN", { n: count });
  statusEl.textContent = state.error || state.status || t("capture.statusDefault");
  statusEl.classList.toggle("is-error", Boolean(state.error));
}

bindLocaleSelect(document.getElementById("locale-select"), () => {
  applyI18n(document);
  applyState(lastState);
});

async function run(action) {
  const state = await action();
  applyState(state);
}

document.getElementById("btn-go").addEventListener("click", () => {
  run(() => window.captureToolbar.navigate(urlInput.value));
});
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run(() => window.captureToolbar.navigate(urlInput.value));
  }
});
document.getElementById("btn-start").addEventListener("click", () => {
  run(() => window.captureToolbar.start());
});
document.getElementById("btn-capture").addEventListener("click", () => {
  run(() =>
    window.captureToolbar.send({
      type: "CAPTURE_FROM_PAGE",
      title: document.title,
      url: urlInput.value,
    })
  );
});
document.getElementById("btn-undo").addEventListener("click", () => {
  run(() => window.captureToolbar.send({ type: "UNDO" }));
});
document.getElementById("btn-create").addEventListener("click", () => {
  run(() => window.captureToolbar.send({ type: "CREATE_PROJECT" }));
});
document.getElementById("btn-cancel").addEventListener("click", () => {
  run(() => window.captureToolbar.send({ type: "CANCEL" }));
});

window.captureToolbar.onState(applyState);
window.captureToolbar.status().then(applyState);
