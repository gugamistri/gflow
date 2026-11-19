import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const PT_TITLE = "GuiaFlow: demos interativas de código aberto, alternativa ao Getdemo";
const PT_DESC = "Editor de código aberto (MIT) para guias e galerias a partir de capturas de tela. Grátis no navegador, sem cadastro. Uma alternativa ao Getdemo, ao Arcade, ao Supademo e ao Storylane. O Pro custa R$ 36/mês.";
const PT_SUB = "Código aberto (MIT). Grátis no navegador, sem cadastro. Uma alternativa ao Getdemo, ao Arcade, ao Supademo e ao Storylane. Monte um guia ou uma galeria de produto — para o seu software ou para o cliente da agência. O Pro custa R$ 36/mês.";
const EN_TITLE = "GuiaFlow — open-source (MIT) interactive demos, an alternative to Arcade, Supademo and Storylane";
const EN_DESC = "Open-source (MIT) editor for guides and product galleries from screenshots. Free in the browser, no sign-up. An alternative to Arcade, Supademo and Storylane. Pro is US$ 7/month, or R$ 36/month in Brazil.";
const EN_SUB = "Open source (MIT). Free in the browser, no sign-up. An alternative to Arcade, Supademo and Storylane. Build a guide or a product gallery — for your software or for your client. Pro is US$ 7/month, or R$ 36/month in Brazil.";

function head(html) {
  return html.slice(0, html.indexOf("</head>"));
}

function assertHomeCopy(file, { title, desc, sub, h1 }) {
  const html = read(file);
  const top = head(html);
  assert.ok(top.includes(`<title data-i18n="lp.doc.title">${title}</title>`), `${file} title`);
  assert.ok(top.includes(`<meta name="description" content="${desc}" />`), `${file} description`);
  assert.ok(top.includes(`<meta property="og:title" content="${title}" />`), `${file} og:title`);
  assert.ok(top.includes(`<meta property="og:description" content="${desc}" />`), `${file} og:description`);
  assert.ok(top.includes(`<meta name="twitter:title" content="${title}" />`), `${file} twitter:title`);
  assert.ok(top.includes(`<meta name="twitter:description" content="${desc}" />`), `${file} twitter:description`);
  const heroSub = html.match(/class="hero-sub"[^>]*>([^<]*)</)?.[1] || "";
  assert.equal(heroSub, sub, `${file} hero-sub`);
  const visibleH1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] || "";
  assert.equal(visibleH1, h1, `${file} H1 unchanged`);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  const app = ld["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  assert.equal(app.description, desc, `${file} JSON-LD description`);
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower|leverage/i.test(title + desc + sub), false);
}

test("home PT: código aberto e alternativa ao Getdemo no title; Getdemo, Arcade, Supademo e Storylane na meta e no subtítulo; H1 intacto", () => {
  assertHomeCopy("index.html", {
    title: PT_TITLE,
    desc: PT_DESC,
    sub: PT_SUB,
    h1: "Entregue uma demo, não mais uma reunião.",
  });
});

test("home /en: open source (MIT) and Arcade/Supademo/Storylane in title, meta and subtitle; H1 intact", () => {
  assertHomeCopy("en.html", {
    title: EN_TITLE,
    desc: EN_DESC,
    sub: EN_SUB,
    h1: "Deliver a demo, not another meeting.",
  });
});

test("home /es is unchanged by this copy", () => {
  const html = read("es.html");
  assert.match(html, /<title data-i18n="lp.doc.title">Entrega una demo, no otra reunión. — GuiaFlow<\/title>/);
  assert.match(html, /<h1 data-i18n="lp.hero.title">Entrega una demo, no otra reunión\.<\/h1>/);
  const heroSub = html.match(/class="hero-sub"[^>]*>([^<]*)</)?.[1] || "";
  assert.equal(
    heroSub,
    "Arma una guía o una galería de producto, para tu software o para el cliente de la agencia. Empieza ahora: gratis, sin registro y sin una llamada. Pro cuesta US$ 7 al mes, o R$ 36 al mes en Brasil."
  );
  assert.equal(/Arcade|Supademo|Storylane/.test(html), false);
});
