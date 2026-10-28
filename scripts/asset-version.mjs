// Única fonte da versão do prefixo de assets estáticos (/a/<versão>/...) usada pelos testes.
// Ao subir a versão, troque `a/<n>/` em todos os HTML/CJS e atualize só este número.
export const ASSET_VERSION = 168;
export const ASSET_PREFIX = `a/${ASSET_VERSION}/`;
/** Prefixo escapado para montar RegExp (ex.: `a\/168\/`). */
export const ASSET_PREFIX_RE = ASSET_PREFIX.replace(/\//g, "\\/");
