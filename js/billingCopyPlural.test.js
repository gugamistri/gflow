import assert from "node:assert/strict";
import test from "node:test";
import { setLocale, t } from "./i18n.js";

test("convidados: singular e plural em pt, en e es; chaves novas sem palavras proibidas", () => {
  const cases = {
    pt: [/^Ainda há 1 convidado\. Remova o convidado /, /^Ainda há 2 convidados\./],
    en: [/^There is still 1 guest\. Remove the guest /, /^There are still 2 guests\./],
    es: [/^Todavía hay 1 invitado\. Quita el invitado /, /^Todavía hay 2 invitados\./],
  };
  for (const [locale, [one, many]] of Object.entries(cases)) {
    setLocale(locale);
    assert.match(t("billing.downgrade.guestsOne", { n: 1 }), one);
    assert.match(t("billing.downgrade.guests", { n: 2 }), many);
    for (const key of ["billing.downgrade.guestsOne", "billing.activeSubscriptionLogin", "billing.paymentFailed"]) {
      const v = t(key);
      assert.notEqual(v, key, `${locale} ${key}`);
      assert.ok(!/plataforma|intelig[eê]ncia|ecossistema|potencializar|platform|intelligence|ecosystem|empower/i.test(v), v);
    }
  }
  setLocale("pt");
});
