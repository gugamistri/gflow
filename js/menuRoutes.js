/**
 * Onde cada ação dos menus mora (GUI-32) e a transição dos lugares antigos.
 * why: Projetos, Novo, Abrir e Importar apareciam no ☰ e no menu do nome do projeto; Ajuda, Modo e
 *      Idioma iam para o chip da Conta. Agora cada ação tem um lugar só, e os lugares antigos ganham
 *      um atalho "mudou de lugar" que leva ao novo, por duas versões.
 */

/** Cada ação aparece em um menu só. As chaves batem com `data-menu` / `data-menu-action` no editor.html. */
export const MENU_HOME = Object.freeze({
  app: Object.freeze(["projects", "new", "import", "signin", "help", "shortcuts", "feedback", "about", "theme", "locale"]),
  project: Object.freeze(["rename", "move-client", "export", "optimize", "restore", "capture-desktop", "delete"]),
  account: Object.freeze(["settings", "signout"]),
  publish: Object.freeze(["capture", "share", "results"]),
});

/**
 * Destinos antigos → novo lugar. `from` é o menu onde a ação estava; `to` é o menu que a pessoa
 * abre ao tocar no aviso; `action` é a ação que ela procura lá.
 */
export const MOVED_ENTRIES = Object.freeze([
  { from: "project", old: "projects", to: "app", action: "projects" },
  { from: "project", old: "new", to: "app", action: "new" },
  { from: "project", old: "open", to: "app", action: "projects" },
  { from: "project", old: "import", to: "app", action: "import" },
  { from: "app", old: "open", to: "app", action: "projects" },
  { from: "app", old: "results", to: "publish", action: "results" },
  { from: "account", old: "help", to: "app", action: "help" },
  { from: "account", old: "theme", to: "app", action: "theme" },
  { from: "account", old: "locale", to: "app", action: "locale" },
]);

/**
 * Primeira versão com os menus novos e a primeira em que os avisos de mudança somem (duas versões depois).
 * why: a versão seguinte à 0.3.1 foi a 0.4.0, então as duas versões com aviso são 0.3.1 e 0.4.0.
 */
export const MOVED_SINCE = "0.3.1";
export const MOVED_UNTIL = "0.4.1";

/** Compara versões x.y.z (sem sufixo). Negativo se a < b. */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Os avisos "mudou de lugar" valem de MOVED_SINCE até antes de MOVED_UNTIL. */
export function movedHintsActive(version, { since = MOVED_SINCE, until = MOVED_UNTIL } = {}) {
  if (!version) return false;
  return compareVersions(version, since) >= 0 && compareVersions(version, until) < 0;
}

/** Para onde leva uma ação antiga. `null` se a ação não mudou. */
export function movedTarget(from, old) {
  const hit = MOVED_ENTRIES.find((e) => e.from === from && e.old === old);
  return hit ? { menu: hit.to, action: hit.action } : null;
}

/** Ações que aparecem em mais de um menu (deve ser vazio). */
export function duplicateActions(home = MENU_HOME) {
  const seen = new Map();
  const dup = new Set();
  for (const [menu, actions] of Object.entries(home)) {
    for (const a of actions) {
      if (seen.has(a) && seen.get(a) !== menu) dup.add(a);
      seen.set(a, menu);
    }
  }
  return [...dup];
}
