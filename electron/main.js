const { app, BrowserWindow, BrowserView, ipcMain, session, shell, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { createKeyStore } = require("./cartesia-store");
const { synthesize } = require("./cartesia-tts");

const ROOT = path.join(__dirname, "..");
const CONTENT_JS = path.join(ROOT, "extension", "content.js");
const DEMO_PAYLOAD = path.join(ROOT, "extension", "lib", "demo-payload.js");

let mainWindow = null;
let captureWindow = null;
let captureView = null;
let captureSession = emptySession();

function emptySession() {
  return { active: false, shots: [], projectName: "" };
}

function randId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function trimTitle(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function publicState(extra = {}) {
  const last = captureSession.shots[captureSession.shots.length - 1];
  return {
    ok: true,
    active: Boolean(captureSession.active),
    count: captureSession.shots.length,
    awaitingHotspot: Boolean(last?.awaitingHotspot),
    projectName: captureSession.projectName || "",
    ...extra,
  };
}

function broadcastState(state) {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.webContents.send("capture:state", state);
  }
  if (captureView && !captureView.webContents.isDestroyed()) {
    captureView.webContents.send("capture:state", state);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "GuiaFlow",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(ROOT, "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isCartesiaKeys(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("file:") || url.startsWith("devtools:");
    if (!allowed) event.preventDefault();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();
  });
}

function layoutCaptureView() {
  if (!captureWindow || !captureView) return;
  const [width, height] = captureWindow.getContentSize();
  const bar = 64;
  captureView.setBounds({ x: 0, y: bar, width, height: Math.max(100, height - bar) });
}

async function injectContentScript() {
  if (!captureView) return;
  const source = fs.readFileSync(CONTENT_JS, "utf8");
  await captureView.webContents.executeJavaScript(source, true);
  await captureView.webContents.executeJavaScript(
    `window.guiaDesktop && window.guiaDesktop.send({ type: "STATUS" })`,
    true
  ).catch(() => {});
}

function createCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.focus();
    return captureWindow;
  }

  captureWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: "Capturar — GuiaFlow",
    webPreferences: {
      preload: path.join(__dirname, "preload-toolbar.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  captureView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, "preload-capture.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:capture",
    },
  });
  captureWindow.setBrowserView(captureView);
  layoutCaptureView();

  captureWindow.loadFile(path.join(__dirname, "capture.html"));
  captureView.webContents.loadURL("about:blank");

  captureWindow.on("resize", layoutCaptureView);
  captureWindow.on("closed", () => {
    captureWindow = null;
    captureView = null;
    captureSession = emptySession();
  });

  captureView.webContents.on("did-finish-load", () => {
    const url = captureView.webContents.getURL();
    if (/^https?:/i.test(url)) injectContentScript().catch(console.error);
  });

  return captureWindow;
}

async function loadDemoPayloadHelpers() {
  const mod = await import(pathToFileURL(DEMO_PAYLOAD).href);
  return mod;
}

async function hideOverlay() {
  if (!captureView) return;
  await captureView.webContents
    .executeJavaScript(
      `(() => {
        const host = document.querySelector("[data-guia-capture]");
        if (host) host.style.setProperty("visibility", "hidden", "important");
      })()`,
      true
    )
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 40));
}

async function captureShot(meta, { withClick }) {
  if (!captureSession.active) return publicState({ ok: false, error: "A captura não está ativa." });
  if (!captureView) return publicState({ ok: false, error: "Janela de captura indisponível." });
  const url = captureView.webContents.getURL();
  if (!/^https?:/i.test(url)) {
    return publicState({ ok: false, error: "Abra uma página http ou https." });
  }

  await hideOverlay();
  let dataUrl;
  try {
    const image = await captureView.webContents.capturePage();
    const jpeg = image.toJPEG(70);
    dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return publicState({ ok: false, error: "Não foi possível fotografar esta página." });
  }

  const { pointFromClick } = await loadDemoPayloadHelpers();
  const stepNumber = captureSession.shots.length + 1;
  captureSession.shots.push({
    imageId: randId("img-"),
    stepId: randId("step-"),
    name: `passo-${stepNumber}.jpg`,
    label: trimTitle(meta?.title) || `Passo ${stepNumber}`,
    dataUrl,
    addedAt: Date.now(),
    clickPoint: withClick ? pointFromClick(meta) : null,
    awaitingHotspot: !withClick,
  });

  const state = publicState({
    status: withClick
      ? `Passo ${stepNumber} salvo com o clique.`
      : "Tela salva. Clique no elemento para marcar o destaque.",
  });
  broadcastState(state);
  return state;
}

async function markHotspot(meta) {
  const { pointFromClick } = await loadDemoPayloadHelpers();
  const last = captureSession.shots[captureSession.shots.length - 1];
  const point = pointFromClick(meta);
  if (!last || !point) return publicState({ ok: false, error: "Clique inválido." });
  last.clickPoint = point;
  last.awaitingHotspot = false;
  const state = publicState({ status: "Destaque marcado. Capture a próxima tela." });
  broadcastState(state);
  return state;
}

async function handlePageMessage(msg) {
  switch (msg?.type) {
    case "STATUS":
      return publicState();
    case "CAPTURE_FROM_PAGE":
      return captureShot(msg, { withClick: false });
    case "PAGE_CLICK": {
      const { nextClickAction } = await loadDemoPayloadHelpers();
      if (nextClickAction(captureSession.shots) === "mark") return markHotspot(msg);
      return captureShot(msg, { withClick: true });
    }
    case "UNDO": {
      if (!captureSession.shots.length) return publicState({ ok: false, error: "Nada para desfazer." });
      captureSession.shots.pop();
      const state = publicState({ status: "Último passo removido." });
      broadcastState(state);
      return state;
    }
    case "CANCEL": {
      captureSession = emptySession();
      const state = publicState({ show: false, status: "Captura cancelada." });
      broadcastState(state);
      return state;
    }
    case "CREATE_PROJECT":
      return finishCapture();
    default:
      return publicState({ ok: false, error: "Comando desconhecido." });
  }
}

async function finishCapture() {
  if (!captureSession.shots.length) {
    return publicState({ ok: false, error: "Capture ao menos uma tela." });
  }
  const { buildDemoPayload } = await loadDemoPayloadHelpers();
  let payload;
  try {
    payload = buildDemoPayload({
      name: captureSession.projectName || "Projeto capturado",
      shots: captureSession.shots,
    });
  } catch (err) {
    return publicState({ ok: false, error: err?.message || "Falha ao montar o projeto." });
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return publicState({ ok: false, error: "O editor não está aberto." });
  }

  mainWindow.webContents.send("capture:import", payload);
  mainWindow.focus();

  captureSession = emptySession();
  const state = publicState({ show: false, status: "Projeto enviado ao editor." });
  broadcastState(state);
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close();
  return state;
}

function isCartesiaKeys(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "play.cartesia.ai";
  } catch {
    return false;
  }
}

let cartesiaLibPromise = null;
function cartesiaLib() {
  if (!cartesiaLibPromise) {
    cartesiaLibPromise = import(pathToFileURL(path.join(ROOT, "js", "cartesia.js")).href);
  }
  return cartesiaLibPromise;
}

function cartesiaKeys() {
  return createKeyStore({
    directory: path.join(app.getPath("userData"), "secrets"),
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("encryption-unavailable");
      }
      return safeStorage.encryptString(value);
    },
    decrypt(buffer) {
      return safeStorage.decryptString(buffer);
    },
  });
}

function registerIpc() {
  ipcMain.handle("desktop:is", () => true);

  ipcMain.handle("cartesia:status", async () => {
    const { maskApiKey } = await cartesiaLib();
    const store = cartesiaKeys();
    if (!store.configured()) return { ok: true, configured: false, masked: "" };
    try {
      return { ok: true, configured: true, masked: maskApiKey(store.read()) };
    } catch {
      return { ok: false, configured: false, masked: "", error: "Não li a chave salva." };
    }
  });

  ipcMain.handle("cartesia:save-key", async (_event, apiKey) => {
    const key = String(apiKey || "").trim();
    const { isPlausibleApiKey, maskApiKey } = await cartesiaLib();
    if (!isPlausibleApiKey(key)) {
      return { ok: false, error: "Use uma chave que comece com sk_car_." };
    }
    try {
      cartesiaKeys().save(key);
    } catch {
      return { ok: false, error: "O chaveiro do sistema não está disponível." };
    }
    return { ok: true, configured: true, masked: maskApiKey(key) };
  });

  ipcMain.handle("cartesia:logout", async () => {
    cartesiaKeys().clear();
    return { ok: true, configured: false };
  });

  ipcMain.handle("cartesia:speak", async (_event, payload) => {
    const { redactSecret, ttsRequest } = await cartesiaLib();
    const store = cartesiaKeys();
    if (!store.configured()) {
      return { ok: false, error: "Salve a chave da Cartesia." };
    }
    let apiKey = "";
    try {
      apiKey = store.read();
    } catch {
      return { ok: false, error: "Não li a chave salva." };
    }
    const text = String(payload?.text || "").trim();
    if (!text || text.length > 2000) {
      return { ok: false, error: "O texto da narração é inválido." };
    }
    const spoken = await synthesize({
      apiKey,
      body: ttsRequest({ text, voiceURI: payload?.voiceURI, rate: payload?.rate }),
      redact: redactSecret,
    });
    if (!spoken.ok) return { ok: false, error: spoken.error || "A síntese falhou." };
    return { ok: true, audioBase64: spoken.audioBase64, mime: spoken.mime };
  });

  ipcMain.handle("capture:open", () => {
    createCaptureWindow();
    return { ok: true };
  });

  ipcMain.handle("capture:navigate", async (_event, rawUrl) => {
    createCaptureWindow();
    let url = String(rawUrl || "").trim();
    if (!url) return publicState({ ok: false, error: "Informe um endereço." });
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      await captureView.webContents.loadURL(url);
      return publicState({ status: `Carregando ${url}` });
    } catch (err) {
      return publicState({ ok: false, error: err?.message || "Não abri este endereço." });
    }
  });

  ipcMain.handle("capture:start", async () => {
    createCaptureWindow();
    if (!captureView) return publicState({ ok: false, error: "Janela indisponível." });
    const url = captureView.webContents.getURL();
    if (!/^https?:/i.test(url)) {
      return publicState({ ok: false, error: "Abra a página do produto (http ou https) e inicie de novo." });
    }
    captureSession.active = true;
    await injectContentScript();
    const state = publicState({
      status: "Captura ligada. Congele a tela e depois clique no destaque.",
    });
    broadcastState(state);
    return state;
  });

  ipcMain.handle("capture:toolbar", async (_event, msg) => handlePageMessage(msg));
  ipcMain.handle("capture:page-message", async (_event, msg) => handlePageMessage(msg));
  ipcMain.handle("capture:status", () => publicState());
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
