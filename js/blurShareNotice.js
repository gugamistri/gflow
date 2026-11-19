/**
 * Aviso "o link publicado ainda mostra a versão sem desfoque" + "Republicar agora".
 * Não bloqueia: uma faixa no canvas. Aparece no primeiro desfoque de cada sessão da ferramenta
 * enquanto houver link desatualizado; some ao republicar, ao fechar (vale para a sessão) ou quando
 * o link deixa de estar desatualizado (republicado pelo menu, desfoque removido).
 * Parte pura (testada); o DOM fica em app.js.
 */

/** Links que a pessoa pode republicar agora, na ordem em que o botão republica. */
export function staleLinkKinds({ permanent = false, permanentStale = false, permanentEnabled = false, temporary = false, temporaryStale = false, canPublish = true } = {}) {
  if (!canPublish) return [];
  const kinds = [];
  if (permanent && permanentStale && permanentEnabled) kinds.push("permanent");
  if (temporary && temporaryStale) kinds.push("temporary");
  return kinds;
}

/** Chave de i18n da frase: um link ou os dois. */
export function blurNoticeTextKey(kinds) {
  return kinds.length > 1 ? "blur.shareStaleBoth" : "blur.shareStale";
}

export function createBlurNoticeState() {
  const dismissed = new Set();
  let visibleFor = null;
  return {
    /** Depois de um desfoque gravado. true = mostrar. */
    onBlur(session, kinds) {
      if (!kinds.length || dismissed.has(session)) {
        visibleFor = null;
        return false;
      }
      visibleFor = session;
      return true;
    },
    dismiss() {
      if (visibleFor != null) dismissed.add(visibleFor);
      visibleFor = null;
    },
    /** Republicado (pelo aviso ou pelo menu): some até o próximo desfoque. */
    republished() {
      visibleFor = null;
    },
    /** Nada mais desatualizado (ou trocou de projeto): esconde. */
    sync(kinds) {
      if (!kinds.length) visibleFor = null;
      return visibleFor != null;
    },
    get visible() {
      return visibleFor != null;
    },
  };
}
