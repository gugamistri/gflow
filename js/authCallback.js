/**
 * Página /auth/callback. why: a nuvem manda o browser para cá com ?code=
 * e o editor troca esse code pela sessão antes de voltar à raiz.
 */
import {
  completeCloudAuthCallback,
  stashCloudAuthError,
} from "./cloudConfig.js";

const status = document.getElementById("status");

function goHome(href) {
  let next = "/";
  try {
    const url = new URL(href || "/", location.origin);
    if (url.origin === location.origin) {
      next = `${url.pathname}${url.search}${url.hash}` || "/";
    }
  } catch {
    next = "/";
  }
  location.replace(next);
}

try {
  const result = await completeCloudAuthCallback(location.href);
  if (result.consumed && !result.ok) stashCloudAuthError(result.error || "invalid_token");
  goHome(result.href);
} catch {
  if (status) status.textContent = "Não foi possível entrar. Volte ao GuiaFlow e peça outro link.";
  setTimeout(() => goHome("/"), 1600);
}
