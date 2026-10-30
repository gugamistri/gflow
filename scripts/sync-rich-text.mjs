// Copia o núcleo de js/tour-schema/richText.js para dentro de js/standalonePlayer.js (script clássico,
// sem imports). Rode depois de mudar o parser: `node scripts/sync-rich-text.mjs`. Teste: js/richText.test.js.
import { readFileSync, writeFileSync } from "node:fs";

export const BEGIN = "/* <gf-rich-text> cópia gerada de js/tour-schema/richText.js (node scripts/sync-rich-text.mjs) */";
export const END = "/* </gf-rich-text> */";
const EDIT_MARK = "// ---- edição";

export function inlineRichTextBlock(moduleSource) {
  const head = moduleSource.slice(0, moduleSource.indexOf(EDIT_MARK)).trimEnd();
  const body = head.replace(/^export /gm, "");
  return `${BEGIN}\nvar gfRichText = (function () {\n${body}\n\nreturn { parseRichText, renderRichText, richTextHtml, stripRichText };\n})();\n${END}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const modPath = new URL("../js/tour-schema/richText.js", import.meta.url);
  const playerPath = new URL("../js/standalonePlayer.js", import.meta.url);
  const block = inlineRichTextBlock(readFileSync(modPath, "utf8"));
  const src = readFileSync(playerPath, "utf8");
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < 0) throw new Error("marcadores <gf-rich-text> não encontrados em standalonePlayer.js");
  writeFileSync(playerPath, src.slice(0, a) + block + src.slice(b + END.length));
  console.log("standalonePlayer.js: bloco de texto formatado atualizado");
}
