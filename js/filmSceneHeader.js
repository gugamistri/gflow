/**
 * Texto do cabeçalho de cena na filmstrip do editor.
 * why: sceneLabel da cena 1 começa em «Cena 1» / «Scene 1» / «Escena 1», e o
 * cabeçalho já prefixa «Cena {n}». Sem este recorte o rótulo saía duplicado
 * («CENA 1 · CENA 1»), pior no celular em que o nome vai na vertical.
 *
 * @param {string | null | undefined} label
 * @param {number | string} scene
 * @param {(key: string, vars?: Record<string, string | number>) => string} translate
 */
export function filmSceneHeaderText(label, scene, translate) {
  const fallback = translate("filmstrip.scene", { n: Number(scene) || 1 });
  const name = String(label || "").trim();
  if (!name || name.toLowerCase() === fallback.toLowerCase()) return fallback;
  return `${fallback} · ${name}`;
}
