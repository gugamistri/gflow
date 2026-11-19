/**
 * Exemplos empacotados no front (landing + biblioteca do editor + player em /exemplos/:id).
 * why: não dependem de um tour publicado em /p ou /v; o JSON e as imagens vão no repositório.
 */
export const PACKAGED_EXAMPLE_IDS = Object.freeze(["guia", "galeria", "processo"]);

export const PACKAGED_EXAMPLES = Object.freeze({
  guia: Object.freeze({
    id: "guia",
    file: "/data/demo.json",
    mode: "guided",
    stockName: "Como usar o Guia",
  }),
  galeria: Object.freeze({
    id: "galeria",
    file: "/data/examples/galeria-produto.json",
    mode: "gallery",
    stockName: "Luminária Arco Liana",
  }),
  processo: Object.freeze({
    id: "processo",
    file: "/data/examples/guia-processo.json",
    mode: "guided",
    stockName: "Como solicitar um reembolso",
  }),
  // QA das transições automáticas (fora da lista: não aparece na landing nem na biblioteca). why: preview sem /p nem /v.
  "qa-transicoes": Object.freeze({
    id: "qa-transicoes",
    file: "/data/examples/qa-transicoes.json",
    mode: "guided",
    stockName: "qa-transicoes",
  }),
});

const EXAMPLE_PATH = /^\/(?:(en|es)\/)?exemplos\/([A-Za-z0-9][A-Za-z0-9_-]{0,40})\/?$/;

/** Rota do player de um exemplo empacotado, ou null. */
export function parseExampleRoute(pathname) {
  const m = String(pathname || "").match(EXAMPLE_PATH);
  if (!m) return null;
  const id = m[2];
  if (!PACKAGED_EXAMPLES[id]) return null;
  return { kind: "example", id, pathLocale: m[1] || null };
}

export function isPackagedExampleId(id) {
  return Boolean(PACKAGED_EXAMPLES[String(id || "")]);
}

export function packagedExampleUrl(id) {
  return PACKAGED_EXAMPLES[id]?.file || "";
}

/**
 * Link público do exemplo: /exemplos/<id>, com ?lang= em en/es e ?embed=1 no iframe da landing.
 * locale já pode vir normalizado (pt|en|es) ou como tag (en-US).
 */
export function landingExampleHref(id, { locale = "pt", embed = false } = {}) {
  if (!PACKAGED_EXAMPLES[id]) return "";
  const lang = String(locale || "").toLowerCase().split("-")[0];
  const params = new URLSearchParams();
  if (lang === "en" || lang === "es") params.set("lang", lang);
  if (embed) params.set("embed", "1");
  const q = params.toString();
  return q ? `/exemplos/${id}?${q}` : `/exemplos/${id}`;
}

/** Locale no caminho (/en/..., /es/...), ou "". */
export function localeFromPathname(pathname) {
  const m = String(pathname || "").match(/^\/(en|es)(?:\/|$)/);
  return m ? m[1] : "";
}
