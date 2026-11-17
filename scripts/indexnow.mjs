#!/usr/bin/env node
/**
 * IndexNow: avisa Bing, Yandex, Seznam, Naver e Yep (via api.indexnow.org) que URLs do
 * guiaflow.pro mudaram. A chave é pública por desenho: fica em /<chave>.txt na raiz.
 * why: o índice do Bing alimenta parte da busca dos assistentes de IA (plano de AEO, 15/11).
 *
 * Uso, depois de publicar em produção:
 *   node scripts/indexnow.mjs              # todas as URLs do sitemap.xml
 *   node scripts/indexnow.mjs /para-agencias /llms.txt   # só as que mudaram
 *   node scripts/indexnow.mjs --dry-run    # mostra o corpo e não envia
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const HOST = "guiaflow.pro";
export const INDEXNOW_KEY = "1b2482937f25957c629417c219ce63ab";
export const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;
export const ENDPOINT = "https://api.indexnow.org/indexnow";

/** URLs <loc> do sitemap, sem repetir. */
export function sitemapUrls(xml) {
  return [...new Set([...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
}

/** Corpo do POST do IndexNow; caminhos relativos viram https://guiaflow.pro/…; outros hosts ficam de fora. */
export function indexNowBody(urls) {
  const urlList = [...new Set(urls.map((u) => (u.startsWith("/") ? `https://${HOST}${u}` : u)))]
    .filter((u) => new URL(u).host === HOST);
  return { host: HOST, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION, urlList };
}

async function main(argv) {
  const dry = argv.includes("--dry-run");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const urls = paths.length ? paths : sitemapUrls(readFileSync(join(ROOT, "sitemap.xml"), "utf8"));
  const body = indexNowBody(urls);
  if (dry) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  console.log(`indexnow: HTTP ${res.status} · ${body.urlList.length} URLs`);
  // 200 = aceito; 202 = aceito, chave ainda em validação. Qualquer outro código é falha.
  if (res.status !== 200 && res.status !== 202) {
    console.error(await res.text().catch(() => ""));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
