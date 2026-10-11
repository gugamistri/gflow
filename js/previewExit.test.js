import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNarrationController } from "./playback.js";
import { pointInHighlight, highlightClickAdvances } from "./highlightClick.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- X do balão -----------------------------------------------------------

test("X do balão fica acima do título (clicável) e tem foco visível", () => {
  const css = read("css/theme.css");
  const block = css.match(/\.driver-popover\.demo-popover \.driver-popover-close-btn \{[^}]*\}/)?.[0] || "";
  assert.match(block, /all: unset/);
  assert.match(block, /z-index:\s*[1-9]/, "all: unset zera o z-index do Driver; o título cobria o X");
  const title = css.match(/\.driver-popover\.demo-popover \.driver-popover-title \{[^}]*\}/)?.[0] || "";
  assert.match(title, /padding-right:\s*2\dpx/);
  assert.match(css, /\.driver-popover-close-btn:focus-visible \{[^}]*outline:/);
});

test("X tem rótulo acessível: «Sair da prévia» no editor, «Fechar tour» nos players", () => {
  const i18n = read("js/i18n.js");
  for (const key of ["player.closeTour", "player.exitPreview"]) {
    const n = i18n.split(`"${key}":`).length - 1;
    assert.equal(n, 3, `${key} em PT/ES/EN`);
  }
  assert.match(read("js/app.js"), /closeLabelKey: "player\.exitPreview"/);
  const player = read("js/player.js");
  assert.match(player, /labelCloseButton\(popover\?\.closeButton, t\(ctx\.closeLabelKey \|\| "player\.closeTour"\)\)/);
  assert.match(read("js/standalonePlayer.js"), /closeButton\.setAttribute\("aria-label", gfT\("player\.closeTour"\)\)/);
});

// --- clique no destaque = Próximo ----------------------------------------

const rect = { left: 100, top: 50, width: 200, height: 40 };
const el = (inside = null) => ({ nodeType: 1, closest: (sel) => (inside && sel.includes(inside) ? {} : null) });

test("pointInHighlight inclui a folga do recorte do Driver", () => {
  assert.equal(pointInHighlight(150, 60, rect), true);
  assert.equal(pointInHighlight(96, 47, rect), true, "folga de 6px");
  assert.equal(pointInHighlight(90, 60, rect), false);
  assert.equal(pointInHighlight(150, 60, { ...rect, width: 0 }), false);
  assert.equal(pointInHighlight(150, 60, null), false);
});

test("clique no destaque avança só durante o tour, em passo de captura", () => {
  const base = { presenting: true, driverActive: true, stepType: "screen", button: 0, target: el(), x: 150, y: 60, rect };
  assert.equal(highlightClickAdvances(base), true);
  assert.equal(highlightClickAdvances({ ...base, presenting: false }), false, "modo edição: destaque é para arrastar");
  assert.equal(highlightClickAdvances({ ...base, driverActive: false }), false);
  assert.equal(highlightClickAdvances({ ...base, stepType: "slide" }), false, "slide tem handler próprio");
  assert.equal(highlightClickAdvances({ ...base, button: 2 }), false);
  assert.equal(highlightClickAdvances({ ...base, x: 20 }), false, "fora do destaque");
  assert.equal(highlightClickAdvances({ ...base, target: el(".driver-popover") }), false, "balão por cima");
  assert.equal(highlightClickAdvances({ ...base, target: el("button") }), false);
});

test("o player liga o clique no destaque em todo contexto e o editor não duplica", () => {
  const player = read("js/player.js");
  assert.match(player, /window\.addEventListener\(\s*"click",[\s\S]{0,200}highlightClickAdvances\(highlightClickInfo\(e\)\)[\s\S]{0,200}clickDriverNext\(\)/);
  assert.match(player, /highlightContains,/);
  const editor = read("js/editor.js");
  assert.doesNotMatch(editor, /els\.hotspot\.addEventListener\("click"/);
  // /p: a folga em volta do destaque não conta como «clique fora»
  assert.match(read("js/viewApp.js"), /player\?\.highlightContains\?\.\(event\.clientX, event\.clientY\)/);
});

// --- áudio para em toda saída -------------------------------------------

test("player cala o áudio em toda saída e invalida avanço em voo", () => {
  const player = read("js/player.js");
  const requestExit = player.match(/function requestExit\(reason\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(requestExit, /silenceAudio\(\)/);
  const stop = player.match(/function stop\(\{ silent = false \} = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(stop, /driveToken \+= 1/);
  assert.match(stop, /silenceAudio\(\)/);
  assert.match(player, /onDestroyed: \(\) => \{[\s\S]{0,200}driveToken \+= 1/);
  assert.match(player, /addEventListener\("pagehide", \(\) => silenceAudio\(\)\)/);
  // why: buildAndDrive para antes de pegar o token (senão o stop invalidaria o próprio tour)
  assert.match(player, /stop\(\{ silent: true \}\);\n    const token = \+\+driveToken;/);
});

test("/p para o player antes de voltar/fechar a aba; editor cala áudio ao trocar de projeto", () => {
  assert.match(read("js/viewApp.js"), /player\?\.stop\?\.\(\{ silent: true \}\);\n    if \(tryLeaveSharedPreview\(\)\) return;/);
  const app = read("js/app.js");
  assert.match(app, /exitPresentation\(\);\n    editor\.stopAudio\?\.\(\);\n    project = loaded;/);
  assert.match(app, /function showLibrary\(\) \{[\s\S]{0,80}editor\.stopAudio\?\.\(\)/);
  assert.match(app, /"pagehide", \(\) => editor\.stopAudio\?\.\(\)/);
});

function withFakeAudio(fn, { blockFirstPlay = false } = {}) {
  const prevAudio = globalThis.Audio;
  const prevWindow = globalThis.window;
  const audios = [];
  const listeners = {};
  globalThis.window = {
    addEventListener: (type, cb) => (listeners[type] ||= new Set()).add(cb),
    removeEventListener: (type, cb) => listeners[type]?.delete(cb),
  };
  globalThis.Audio = class {
    constructor(src = "") {
      this.src = src;
      this.paused = true;
      this.plays = 0;
      this.dataset = {};
      this.listeners = {};
      audios.push(this);
    }
    addEventListener(type, cb) {
      this.listeners[type] = cb;
    }
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
    load() {}
    pause() {
      this.paused = true;
    }
    play() {
      this.plays += 1;
      if (blockFirstPlay && this.plays === 1) {
        const err = new Error("blocked");
        err.name = "NotAllowedError";
        return Promise.reject(err);
      }
      this.paused = false;
      return Promise.resolve();
    }
  };
  const gesture = (type) => [...(listeners[type] || [])].forEach((cb) => cb({ type }));
  return Promise.resolve(fn({ audios, gesture })).finally(() => {
    globalThis.Audio = prevAudio;
    globalThis.window = prevWindow;
  });
}

const narratedStep = {
  caption: "Olá",
  narrationAudio: { source: "upload", clips: ["data:audio/mpeg;base64,YQ=="], playbackRate: 1 },
};
const narratedDemo = {
  narration: { enabled: true, voiceURI: "", rate: 1, background: { dataUrl: "data:audio/mpeg;base64,Yg==" } },
};

test("stop() pausa e descarta narração e trilha de fundo", () =>
  withFakeAudio(async ({ audios }) => {
    const ctrl = createNarrationController({ captionEl: { textContent: "", hidden: true } });
    await ctrl.startTour(narratedDemo);
    ctrl.enterStep(narratedStep, narratedDemo, { speak: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(audios.some((a) => !a.paused), "tocando antes de sair");
    ctrl.stop();
    assert.equal(audios.filter((a) => !a.paused).length, 0);
    assert.ok(audios.every((a) => a.src === ""), "src descartado (reset)");
  }));

test("o gesto de saída (Esc/clique) não destrava uma narração já parada", () =>
  withFakeAudio(
    async ({ audios, gesture }) => {
      const ctrl = createNarrationController({ captionEl: { textContent: "", hidden: true } });
      ctrl.enterStep(narratedStep, { narration: { enabled: true, rate: 1, background: null } }, { speak: true });
      await new Promise((r) => setTimeout(r, 0));
      const clip = audios.at(-1);
      assert.equal(clip.plays, 1, "autoplay bloqueado, aguardando gesto");
      ctrl.stop();
      gesture("keydown");
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(clip.plays, 1, "não retenta depois de parar");
      assert.equal(clip.paused, true);
    },
    { blockFirstPlay: true }
  ));
