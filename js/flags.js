/**
 * Bandeiras em SVG local (Windows não desenha emoji de bandeira). viewBox 30×20, cantos arredondados no CSS.
 * Idioma → país: o mais comum para quem fala (pt→BR, en→GB, es→ES); região explícita vence (pt-PT, en-US, es-MX).
 * Sem bandeira conhecida: chip com o código do idioma (nunca adivinhar um país).
 */
const H = (...stripes) => stripes.map((c, i, a) => `<rect y="${(20 / a.length) * i}" width="30" height="${20 / a.length + 0.01}" fill="${c}"/>`).join("");
const V = (...stripes) => stripes.map((c, i, a) => `<rect x="${(30 / a.length) * i}" width="${30 / a.length + 0.01}" height="20" fill="${c}"/>`).join("");
const star = (cx, cy, r, fill) => {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.4 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
};

export const FLAGS = {
  BR: `<rect width="30" height="20" fill="#009b3a"/><polygon points="15,2.5 27.5,10 15,17.5 2.5,10" fill="#fedf00"/><circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.2c3-.9 6.3-.5 8.8 1.1" stroke="#fff" stroke-width=".9" fill="none"/>`,
  PT: `<rect width="30" height="20" fill="#da291c"/><rect width="12" height="20" fill="#046a38"/><circle cx="12" cy="10" r="3.6" fill="#ffe900"/><circle cx="12" cy="10" r="2.2" fill="#da291c"/>`,
  GB: `<rect width="30" height="20" fill="#012169"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.6"/><path d="M15 0V20M0 10H30" stroke="#fff" stroke-width="6"/><path d="M15 0V20M0 10H30" stroke="#c8102e" stroke-width="3.4"/>`,
  US: `${H("#b22234", "#fff", "#b22234", "#fff", "#b22234", "#fff", "#b22234")}<rect width="13" height="10.8" fill="#3c3b6e"/><g fill="#fff">${[2, 5, 8, 11].map((x) => [2.2, 5.4, 8.6].map((y) => `<circle cx="${x}" cy="${y}" r=".8"/>`).join("")).join("")}</g>`,
  ES: `<rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/>`,
  MX: `${V("#006847", "#fff", "#ce1126")}<circle cx="15" cy="10" r="2.4" fill="#8c5a2b"/>`,
  FR: V("#0055a4", "#fff", "#ef4135"),
  IT: V("#009246", "#fff", "#ce2b37"),
  DE: H("#000", "#dd0000", "#ffce00"),
  NL: H("#ae1c28", "#fff", "#21468b"),
  RU: H("#fff", "#0039a6", "#d52b1e"),
  PL: H("#fff", "#dc143c"),
  UA: H("#0057b7", "#ffd700"),
  SE: `<rect width="30" height="20" fill="#006aa7"/><path d="M11 0V20M0 10H30" stroke="#fecc00" stroke-width="4"/>`,
  JP: `<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>`,
  CN: `<rect width="30" height="20" fill="#de2910"/>${star(6, 6, 3.4, "#ffde00")}${star(11.5, 2.6, 1.1, "#ffde00")}${star(13.4, 5.2, 1.1, "#ffde00")}${star(13.4, 8.6, 1.1, "#ffde00")}${star(11.5, 11, 1.1, "#ffde00")}`,
  KR: `<rect width="30" height="20" fill="#fff"/><path d="M10 10a5 5 0 0 1 10 0z" fill="#cd2e3a"/><path d="M10 10a5 5 0 0 0 10 0z" fill="#0047a0"/><g stroke="#000" stroke-width="1"><path d="M4 4.5l2.5-2M5 5.6l2.5-2M6 6.7l2.5-2M21.5 2.5l2.5 2M22.5 13.3l2.5 2M3.9 15.4l2.5-2"/></g>`,
  IN: `${H("#ff9933", "#fff", "#138808")}<circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width=".8"/>`,
  TR: `<rect width="30" height="20" fill="#e30a17"/><circle cx="12" cy="10" r="5" fill="#fff"/><circle cx="13.3" cy="10" r="4" fill="#e30a17"/>${star(19, 10, 2.4, "#fff")}`,
};

/** Base do idioma → país padrão. */
const LANG_COUNTRY = { pt: "BR", en: "GB", es: "ES", fr: "FR", it: "IT", de: "DE", nl: "NL", ru: "RU", pl: "PL", uk: "UA", sv: "SE", ja: "JP", zh: "CN", ko: "KR", hi: "IN", tr: "TR" };

export function flagCountry(tag) {
  const [base, region] = String(tag || "").split("-");
  if (region && FLAGS[region.toUpperCase()]) return region.toUpperCase();
  return LANG_COUNTRY[String(base || "").toLowerCase()] || "";
}

/** `<svg>` da bandeira (decorativa: o nome do idioma vem ao lado ou no aria-label do controle). */
export function flagSvg(tag, { className = "gf-flag" } = {}) {
  if (tag === "all") {
    return `<svg class="${className} gf-flag-globe" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }
  const c = flagCountry(tag);
  if (!c) {
    const code = String(tag || "?").split("-")[0].slice(0, 3).toUpperCase();
    return `<span class="${className} gf-flag-code" aria-hidden="true">${code.replace(/[^A-Z]/g, "")}</span>`;
  }
  return `<svg class="${className}" viewBox="0 0 30 20" aria-hidden="true" focusable="false" data-flag="${c}">${FLAGS[c]}</svg>`;
}
