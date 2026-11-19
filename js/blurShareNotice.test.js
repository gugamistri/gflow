import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blurNoticeTextKey, createBlurNoticeState, staleLinkKinds } from "./blurShareNotice.js";
import { catalogs as STRINGS } from "./i18n.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("quais links o aviso republica", () => {
  assert.deepEqual(staleLinkKinds({}), [], "sem link publicado: sem aviso");
  assert.deepEqual(staleLinkKinds({ permanent: true, permanentStale: true, permanentEnabled: true }), ["permanent"]);
  assert.deepEqual(staleLinkKinds({ temporary: true, temporaryStale: true }), ["temporary"]);
  assert.deepEqual(
    staleLinkKinds({ permanent: true, permanentStale: true, permanentEnabled: true, temporary: true, temporaryStale: true }),
    ["permanent", "temporary"],
  );
  assert.deepEqual(staleLinkKinds({ permanent: true, permanentStale: false, permanentEnabled: true }), [], "link já atualizado");
  assert.deepEqual(staleLinkKinds({ permanent: true, permanentStale: true, permanentEnabled: false }), [], "permanente sem Cloud");
  assert.deepEqual(staleLinkKinds({ temporary: true, temporaryStale: true, canPublish: false }), [], "convidado não publica");
  assert.equal(blurNoticeTextKey(["temporary"]), "blur.shareStale");
  assert.equal(blurNoticeTextKey(["permanent", "temporary"]), "blur.shareStaleBoth");
});

test("uma vez por sessão do desfoque, até republicar ou fechar", () => {
  const s = createBlurNoticeState();
  assert.equal(s.onBlur(1, []), false, "sem link desatualizado");
  assert.equal(s.onBlur(1, ["permanent"]), true);
  assert.equal(s.onBlur(1, ["permanent"]), true, "mover/mudar o retângulo mantém o aviso");
  s.dismiss();
  assert.equal(s.visible, false);
  assert.equal(s.onBlur(1, ["permanent"]), false, "fechado: não volta na mesma sessão");
  assert.equal(s.onBlur(2, ["permanent"]), true, "nova sessão do desfoque: volta");
  s.republished();
  assert.equal(s.visible, false);
  assert.equal(s.onBlur(2, ["permanent"]), true, "desfocou de novo depois de republicar: link desatualizado de novo");
  assert.equal(s.sync(["permanent"]), true);
  assert.equal(s.sync([]), false, "republicado pelo menu (ou desfoque removido): some");
});

test("textos do aviso em pt/en/es, curtos e sem palavras proibidas", () => {
  for (const lang of ["pt", "en", "es"]) {
    for (const key of ["blur.shareStale", "blur.shareStaleBoth", "blur.shareRepublish", "blur.shareDismiss"]) {
      const v = STRINGS[lang]?.[key];
      assert.ok(typeof v === "string" && v.length > 0 && v.length < 90, `${lang} ${key}`);
      assert.ok(!/plataforma|intelig[eê]ncia|ecossistema|potencializar|platform|intelligence|ecosystem|empower/i.test(v), v);
    }
  }
  assert.equal(STRINGS.pt["blur.shareStale"], "O link publicado ainda mostra a versão sem desfoque.");
  assert.equal(STRINGS.pt["blur.shareRepublish"], "Republicar agora");
});

test("aviso fora de modal, e o botão usa os caminhos de republicar que já existem", () => {
  const html = read("../editor.html");
  const box = html.match(/<div class="blur-share-notice"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(box, /role="status"/);
  assert.match(box, /id="blur-share-republish"/);
  assert.match(box, /id="blur-share-dismiss"/);
  assert.doesNotMatch(box, /<dialog/);
  const app = read("./app.js");
  const wire = app.match(/republishStaleLinks = async \(kinds\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.match(wire, /runCloudPublish\(\)/, "permanente: mesmo caminho do botão Republicar");
  assert.match(wire, /runSharePublish\(\{ update: true \}\)/, "temporário: mesmo caminho do botão Republicar");
  assert.match(read("./editor.js"), /ctx\.onBlurCommitted\?\.\(info\)/);
});
