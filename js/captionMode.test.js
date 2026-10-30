import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PORTRAIT_QUERY,
  isPortraitCompact,
  readingChunkAt,
  readingTotalMs,
  speechProgress,
  splitSubtitleChunks,
  stepCaptionParts,
  subtitleChunkAt,
  subtitleMaxChars,
  MIN_CHUNK_MS,
} from "./captionMode.js";
import { catalogs } from "./i18n.js";
import { applyAgentStepInput } from "./tour-schema/agent.js";

const words = (s) => s.split(/\s+/).filter(Boolean);

test("legenda curta = título (com o atributo-chave); o texto vai para Detalhes", () => {
  const step = { label: "x", popover: { title: "🛏️ 2 dorms. · 32,06 m² · Torres A e C", description: "Finais 02, 05…\n🔊 Narração gerada por IA" } };
  assert.deepEqual(stepCaptionParts(step), {
    title: "🛏️ 2 dorms. · 32,06 m² · Torres A e C",
    details: "Finais 02, 05…\n🔊 Narração gerada por IA",
    hasDetails: true,
  });
});

test("sem título usa o rótulo; sem título nem rótulo o texto não fica escondido", () => {
  assert.equal(stepCaptionParts({ label: "Piscina", popover: { title: "", description: "a" } }).title, "Piscina");
  const none = stepCaptionParts({ popover: { title: "", description: "Só texto" } });
  assert.equal(none.hasDetails, false);
  assert.equal(stepCaptionParts({ popover: { title: "Só título", description: "  " } }).hasDetails, false);
  assert.equal(stepCaptionParts(null).hasDetails, false);
});

test("compatível: tour antigo e passo criado pelo agente (MCP) já têm tudo o que a legenda usa", () => {
  // why: nenhum campo novo no JSON — o título que o agente grava é o que vira a legenda curta
  const { step } = applyAgentStepInput({ title: "🌿 Com terraço · 34,09 m²", text: "2 dorms. · Finais 03 e 04." });
  const parts = stepCaptionParts(step);
  assert.equal(parts.title, "🌿 Com terraço · 34,09 m²");
  assert.equal(parts.details, "2 dorms. · Finais 03 e 04.");
  assert.equal(parts.hasDetails, true);
  assert.ok(!("captionShort" in step.popover) && !("subtitle" in step.popover));
});

test("pedaços da legenda: cabem no limite, mantêm todas as palavras e a ordem", () => {
  const text =
    "Oi! Eu vou te mostrar o Meu Plano e Interlagos, Condomínio Fugulin, da Plano e Plano, na Rua Zike Tuma, em Interlagos. São apartamentos de dois dormitórios, a partir de duzentos e trinta e sete mil reais.";
  for (const max of [40, 60, 84, 90]) {
    const chunks = splitSubtitleChunks(text, max);
    assert.ok(chunks.length >= 2, `max ${max}`);
    for (const c of chunks) assert.ok(c.length <= max, `"${c}" > ${max}`);
    assert.deepEqual(words(chunks.join(" ")), words(text));
  }
});

test("pedaços: texto curto fica inteiro; frases curtas vizinhas se juntam; vazio = nenhum", () => {
  assert.deepEqual(splitSubtitleChunks("Na torre D.", 84), ["Na torre D."]);
  assert.deepEqual(splitSubtitleChunks("Oi. Tudo bem? Vamos lá.", 84), ["Oi. Tudo bem? Vamos lá."]);
  assert.deepEqual(splitSubtitleChunks("   ", 84), []);
  assert.deepEqual(splitSubtitleChunks("Agora as plantas. Essa é a de trinta e dois vírgula zero seis metros quadrados, com dois dormitórios, nas torres A e C.", 60)[0], "Agora as plantas.");
});

test("pedaços: palavra maior que o limite não some", () => {
  const long = "x".repeat(50);
  const chunks = splitSubtitleChunks(`abc ${long} def`, 24);
  assert.deepEqual(words(chunks.join(" ")), ["abc", long, "def"]);
});

test("limite de caracteres pela largura (2 linhas a 14px numa tela de 390px)", () => {
  assert.equal(subtitleMaxChars(354, 14), 90);
  assert.ok(subtitleMaxChars(200, 14) < subtitleMaxChars(354, 14));
  assert.equal(subtitleMaxChars(0), 84);
  assert.ok(subtitleMaxChars(10, 14) >= 24);
});

test("sincronia com o áudio: pedaço da vez segue o progresso, ponderado pelo tamanho", () => {
  const chunks = ["a".repeat(10), "b".repeat(30), "c".repeat(60)];
  assert.equal(subtitleChunkAt(chunks, 0), 0);
  assert.equal(subtitleChunkAt(chunks, 0.05), 0);
  assert.equal(subtitleChunkAt(chunks, 0.2), 1);
  assert.equal(subtitleChunkAt(chunks, 0.39), 1);
  assert.equal(subtitleChunkAt(chunks, 0.41), 2);
  assert.equal(subtitleChunkAt(chunks, 1), 2);
  assert.equal(subtitleChunkAt(["só"], 0.7), 0);
  let prev = 0;
  for (let p = 0; p <= 1; p += 0.01) {
    const i = subtitleChunkAt(chunks, p);
    assert.ok(i >= prev);
    prev = i;
  }
});

test("progresso da fala com vários clipes (também com som mudo, o relógio do clipe anda)", () => {
  assert.equal(speechProgress({ index: 0, count: 1, currentTime: 3, duration: 6 }), 0.5);
  assert.equal(speechProgress({ index: 1, count: 2, currentTime: 0, duration: 4 }), 0.5);
  assert.equal(speechProgress({ index: 1, count: 2, currentTime: 4, duration: 4 }), 1);
  assert.equal(speechProgress({ index: 0, count: 1, currentTime: 2, duration: NaN }), 0);
});

test("sem áudio: ritmo de leitura e o autoplay espera a legenda inteira", () => {
  const chunks = ["a".repeat(15), "b".repeat(45)];
  assert.equal(readingChunkAt(chunks, 0), 0);
  assert.equal(readingChunkAt(chunks, MIN_CHUNK_MS - 1), 0);
  assert.equal(readingChunkAt(chunks, MIN_CHUNK_MS + 10), 1);
  assert.equal(readingChunkAt(chunks, 999999), 1);
  assert.equal(readingTotalMs(chunks), MIN_CHUNK_MS + 3000);
  assert.equal(readingTotalMs([]), 0);
});

test("modo em pé segue a mesma media query do CSS", () => {
  assert.equal(isPortraitCompact((q) => ({ matches: q === PORTRAIT_QUERY })), true);
  assert.equal(isPortraitCompact(() => ({ matches: false })), false);
  assert.equal(isPortraitCompact(undefined), false);
  const css = readFileSync(new URL("../css/theme.css", import.meta.url), "utf8");
  assert.ok(css.includes(`@media ${PORTRAIT_QUERY}`));
});

test("CSS: Detalhes só esconde o texto em pé, com título e texto, e fechado", () => {
  const css = readFileSync(new URL("../css/theme.css", import.meta.url), "utf8");
  assert.match(css, /\.driver-popover\.demo-popover \.gf-details-toggle \{\s*display: none;/);
  assert.match(css, /\.gf-has-details:not\(\.is-details-open\) \.driver-popover-description \{\s*display: none !important;/);
  // título não pode ser cortado em pé
  assert.match(css, /-webkit-line-clamp: unset;/);
});

test("i18n: Detalhes em pt, en e es", () => {
  for (const [lang, word] of [["pt", "Detalhes"], ["en", "Details"], ["es", "Detalles"]]) {
    const cat = catalogs[lang];
    assert.equal(cat["player.details"], word);
    assert.ok(cat["player.detailsShow"]);
    assert.ok(cat["player.detailsHide"]);
  }
});
