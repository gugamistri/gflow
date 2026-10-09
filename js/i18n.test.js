import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  catalogs,
  normalizeLocaleTag,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./i18n.js";

test("resolveLocale mapeia pt e variantes", () => {
  assert.equal(resolveLocale(["pt-BR"]), "pt");
  assert.equal(resolveLocale(["pt-PT", "en"]), "pt");
  assert.equal(resolveLocale(["pt"]), "pt");
});

test("resolveLocale mapeia es e variantes", () => {
  assert.equal(resolveLocale(["es-ES"]), "es");
  assert.equal(resolveLocale(["es-MX", "en-US"]), "es");
});

test("resolveLocale cai em en quando não há pt/es", () => {
  assert.equal(resolveLocale(["fr-FR", "de"]), "en");
  assert.equal(resolveLocale([]), "en");
  assert.equal(resolveLocale(null), "en");
});

test("normalizeLocaleTag rejeita tags vazias", () => {
  assert.equal(normalizeLocaleTag(""), null);
  assert.equal(normalizeLocaleTag("ja-JP"), null);
});

test("métricas do editor existem em pt, es e en", () => {
  assert.match(catalogs.pt["editor.metricsOne"], /1 passo · \{time\}/);
  assert.match(catalogs.pt["editor.metricsMany"], /\{n\} passos · \{time\}/);
  assert.match(catalogs.es["editor.metricsOne"], /1 paso · \{time\}/);
  assert.match(catalogs.es["editor.metricsMany"], /\{n\} pasos · \{time\}/);
  assert.match(catalogs.en["editor.metricsOne"], /1 step · \{time\}/);
  assert.match(catalogs.en["editor.metricsMany"], /\{n\} steps · \{time\}/);
});

test("o diálogo de entrada não mostra o host da API", () => {
  for (const loc of SUPPORTED_LOCALES) {
    for (const [key, value] of Object.entries(catalogs[loc])) {
      if (!key.startsWith("share.cloud.") && !key.startsWith("account.")) continue;
      assert.equal(/api\.guiaflow\.pro/i.test(value), false, `${loc} ${key}`);
      assert.equal(/\bAPI\b/.test(value), false, `${loc} ${key}`);
      assert.equal(/nuvem|nube|\bcloud\b/i.test(value), false, `${loc} ${key}: ${value}`);
    }
    assert.match(catalogs[loc]["share.cloud.sent"], /email/i);
    assert.match(catalogs[loc]["share.cloud.signedIn"], /\{email\}/);
    assert.equal(catalogs[loc]["account.signOut"].toLowerCase().includes("nuvem"), false);
    assert.equal(catalogs[loc]["share.cloud.openSite"], undefined);
  }
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-account"');
  const end = html.indexOf("</dialog>", start);
  const panel = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.equal(/api\.guiaflow\.pro/i.test(panel), false);
  assert.equal(/app\.guiaflow\.pro/i.test(panel), false);
  assert.equal(panel.includes("cloud-open-site"), false);
  assert.match(panel, /Entre com email e senha/);
  assert.match(panel, /id="cloud-email"/);
  assert.match(panel, /id="cloud-password"/);
  assert.match(panel, /id="btn-cloud-password"/);
  assert.ok(panel.indexOf('id="cloud-password"') < panel.indexOf('id="btn-cloud-magic"'));
  assert.ok(panel.indexOf('id="btn-cloud-password"') < panel.indexOf("cloud-login-or"));
  assert.match(panel, /Entrar sem senha/);
  assert.match(panel, />ou</);
  assert.match(panel, /Também cria a conta/);
  assert.equal(panel.includes("cloud-password-fallback"), false);
  assert.equal(/nuvem/i.test(panel), false);
  assert.match(panel, /O link abriu noutro aparelho/);
  assert.match(catalogs.pt["share.cloud.sent"], /Enviamos um link para \{email\}\./);
  assert.match(catalogs.pt["share.cloud.badLogin"], /Entrar sem senha/);
  assert.match(catalogs.es["share.cloud.send"], /sin contraseña/i);
  assert.match(catalogs.en["share.cloud.send"], /without a password/i);
  const shareStart = html.indexOf('id="cloud-share-block"');
  const shareEnd = html.indexOf('id="btn-export-html"');
  const share = html.slice(shareStart, shareEnd);
  assert.equal(/nuvem|nube|Conectado como|Sair da nuvem/i.test(share), false);
  assert.equal(share.includes("cloud-account"), false);
  assert.equal(share.includes('id="cloud-login"'), false);
  assert.match(share, /id="cloud-share-badge"/);
});

test("a cópia de assinatura não diz nuvem e o diálogo oferece Mensal e Anual", () => {
  for (const loc of SUPPORTED_LOCALES) {
    for (const [key, value] of Object.entries(catalogs[loc])) {
      if (!key.startsWith("billing.")) continue;
      assert.equal(/nuvem|nube/i.test(value), false, `${loc} ${key}: ${value}`);
      assert.equal(/R\$|\$\d|€/.test(value), false, `${loc} ${key}`);
    }
  }
  assert.equal(catalogs.pt["billing.monthly"], "Mensal");
  assert.equal(catalogs.pt["billing.annual"], "Anual");
  assert.equal(catalogs.pt["billing.savePercent"], "economize {percent}%");
  assert.equal(catalogs.pt["billing.already"], "Já é assinante? Entrar");
  for (const [key, value] of Object.entries(catalogs.pt)) {
    assert.equal(/Já assino/.test(String(value)), false, key);
  }
  assert.equal(catalogs.pt["billing.billedMonth"], "cobrado todo mês");
  assert.equal(catalogs.pt["billing.billedYear"], "cobrado {price} por ano");
  assert.equal(catalogs.pt["billing.freeMonths"], "{n} meses grátis");
  assert.equal(catalogs.pt["billing.payMonths"], "Pague {paid} meses, use {total}");
  assert.equal(catalogs.pt["billing.subscribe"], "Assinar Pro");
  assert.equal(catalogs.pt["billing.subscribeMonthly"], "Assinar Pro mensal");
  assert.equal(catalogs.pt["billing.subscribeAnnual"], "Assinar Pro anual");
  assert.equal(catalogs.pt["account.subscribeOrSignIn"], "Assinar / Entrar");
  assert.equal(catalogs.pt["billing.planCloud"], "GuiaFlow\u00a0Pro");
  assert.equal(catalogs.pt["billing.badge"], "Pro");
  assert.equal(catalogs.pt["billing.title"], "GuiaFlow\u00a0Pro");
  assert.equal(catalogs.pt["billing.subscribeMenu"], "Assinar Pro");
  assert.equal(catalogs.pt["billing.emailMissing"], "Esse e-mail ainda não tem GuiaFlow\u00a0Pro.");
  assert.equal(catalogs.pt["billing.localSave"], "Salvo só neste navegador");
  assert.match(catalogs.pt["billing.localSaveTip"], /cache/);
  assert.equal(catalogs.pt["billing.hostedAiTitle"], "Gerar texto com IA faz parte do GuiaFlow\u00a0Pro");
  assert.equal(catalogs.pt["billing.ttsTitle"], "Gerar áudio com IA faz parte do GuiaFlow\u00a0Pro");
  assert.equal(/GuiaFlow Cloud/.test(catalogs.pt["billing.message"]), false);
  assert.equal(/grátis|gratis|free plan/i.test(catalogs.pt["billing.heroLead"]), false);
  assert.equal(/grátis|gratis/i.test(catalogs.pt["export.removeMarkDesc"]), false);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-upgrade"');
  const end = html.indexOf("</dialog>", start);
  const dialog = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.equal(/nuvem/i.test(dialog), false);
  assert.match(dialog, /GuiaFlow(?:&nbsp;|\s)Pro/);
  assert.equal(dialog.includes("GuiaFlow Cloud"), false);
  assert.match(html, /id="i-crown"/);
  assert.match(html, /id="pro-badge-copy"/);
  assert.match(html, /id="pro-badge-audio"/);
  assert.match(html, /id="btn-export-unbrand"/);
  assert.match(html, /Remover marca GuiaFlow/);
  assert.equal(html.includes(">Cloud<"), false);
  assert.match(dialog, /Mensal/);
  assert.match(dialog, /Anual/);
  assert.match(dialog, /Assinar Pro mensal/);
  assert.match(dialog, /Já é assinante\? Entrar/);
  assert.equal(/Já assino/.test(dialog), false);
  assert.match(dialog, /name="billing-interval" value="month" checked/);
  assert.equal(/name="billing-interval" value="year" checked/.test(dialog), false);
  assert.match(dialog, /paywall-benefits/);
  assert.equal(/grátis|gratis/i.test(dialog), false);
  assert.match(html, /Assinar \/ Entrar/);
  assert.match(html, /Salvo só neste navegador/);
});

test("catálogos compartilham as mesmas chaves", () => {
  const keys = Object.keys(catalogs.pt).sort();
  for (const loc of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[loc]).sort(), keys, loc);
  }
  assert.ok(keys.length > 50);
});
