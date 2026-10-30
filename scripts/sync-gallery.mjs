// Copia js/gallery.js (modo Galeria) para dentro de js/standalonePlayer.js (script clássico, sem imports).
// Rode depois de mudar a galeria: `node scripts/sync-gallery.mjs`. Teste: js/gallery.test.js.
import { readFileSync, writeFileSync } from "node:fs";

export const BEGIN = "/* <gf-gallery> cópia gerada de js/gallery.js (node scripts/sync-gallery.mjs) */";
export const END = "/* </gf-gallery> */";
const ANCHOR = "/* </gf-rich-text> */";

export function inlineGalleryBlock(moduleSource) {
  if (/^\s*import\s/m.test(moduleSource)) throw new Error("js/gallery.js não pode ter imports (vai inteiro para o HTML offline)");
  const body = moduleSource.replace(/^export /gm, "").trimEnd();
  return `${BEGIN}\nvar gfGallery = (function () {\n${body}\n\nreturn { createGallery, galleryCaption, gallerySections };\n})();\n${END}`;
}

/** Devolve o standalonePlayer.js com o bloco novo (cria logo depois do bloco do texto formatado). */
export function withGalleryBlock(playerSource, block) {
  const a = playerSource.indexOf(BEGIN);
  const b = playerSource.indexOf(END);
  if (a >= 0 && b >= 0) return playerSource.slice(0, a) + block + playerSource.slice(b + END.length);
  const at = playerSource.indexOf(ANCHOR);
  if (at < 0) throw new Error("marcador </gf-rich-text> não encontrado em standalonePlayer.js");
  const end = at + ANCHOR.length;
  return `${playerSource.slice(0, end)}\n\n${block}${playerSource.slice(end)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const modPath = new URL("../js/gallery.js", import.meta.url);
  const playerPath = new URL("../js/standalonePlayer.js", import.meta.url);
  const block = inlineGalleryBlock(readFileSync(modPath, "utf8"));
  writeFileSync(playerPath, withGalleryBlock(readFileSync(playerPath, "utf8"), block));
  console.log("standalonePlayer.js: bloco da Galeria atualizado");
}
