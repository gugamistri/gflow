/**
 * Telefone internacional do botão de WhatsApp (passo final): país (DDI) + número nacional.
 * Dados embutidos e pequenos: ISO → DDI. Nomes vêm do Intl.DisplayNames; bandeiras, dos
 * indicadores regionais Unicode. Armazenamento: E.164 só com dígitos (DDI + número, até 15),
 * o mesmo formato que o wa.me usa — números já salvos continuam iguais (hash do link não muda).
 */

// ISO 3166-1 alfa-2 → DDI. Códigos compartilhados (1, 7, 44, …) têm um país preferido em PREFERRED.
const DIAL_DATA =
  "AF93 AL355 DZ213 AS1 AD376 AO244 AI1 AG1 AR54 AM374 AW297 AU61 AT43 AZ994 BS1 BH973 BD880 BB1 BY375 BE32 " +
  "BZ501 BJ229 BM1 BT975 BO591 BA387 BW267 BR55 IO246 VG1 BN673 BG359 BF226 BI257 KH855 CM237 CA1 CV238 BQ599 " +
  "KY1 CF236 TD235 CL56 CN86 CX61 CC61 CO57 KM269 CG242 CD243 CK682 CR506 CI225 HR385 CU53 CW599 CY357 CZ420 " +
  "DK45 DJ253 DM1 DO1 EC593 EG20 SV503 GQ240 ER291 EE372 SZ268 ET251 FK500 FO298 FJ679 FI358 FR33 GF594 PF689 " +
  "GA241 GM220 GE995 DE49 GH233 GI350 GR30 GL299 GD1 GP590 GU1 GT502 GG44 GN224 GW245 GY592 HT509 HN504 HK852 " +
  "HU36 IS354 IN91 ID62 IR98 IQ964 IE353 IM44 IL972 IT39 JM1 JP81 JE44 JO962 KZ7 KE254 KI686 XK383 KW965 KG996 " +
  "LA856 LV371 LB961 LS266 LR231 LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 " +
  "MR222 MU230 YT262 MX52 FM691 MD373 MC377 MN976 ME382 MS1 MA212 MZ258 MM95 NA264 NR674 NP977 NL31 NC687 NZ64 " +
  "NI505 NE227 NG234 NU683 NF672 KP850 MK389 MP1 NO47 OM968 PK92 PW680 PS970 PA507 PG675 PY595 PE51 PH63 PL48 " +
  "PT351 PR1 QA974 RE262 RO40 RU7 RW250 BL590 SH290 KN1 LC1 MF590 PM508 VC1 WS685 SM378 ST239 SA966 SN221 RS381 " +
  "SC248 SL232 SG65 SX1 SK421 SI386 SB677 SO252 ZA27 KR82 SS211 ES34 LK94 SD249 SR597 SJ47 SE46 CH41 SY963 TW886 " +
  "TJ992 TZ255 TH66 TL670 TG228 TK690 TO676 TT1 TN216 TR90 TM993 TC1 TV688 VI1 UG256 UA380 AE971 GB44 US1 UY598 " +
  "UZ998 VU678 VA39 VE58 VN84 WF681 EH212 YE967 ZM260 ZW263 AX358";

export const COUNTRIES = DIAL_DATA.split(" ").map((item) => ({ iso: item.slice(0, 2), dial: item.slice(2) }));
const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

/** País escolhido ao ler um número salvo cujo DDI é compartilhado. */
const PREFERRED = { 1: "US", 7: "RU", 44: "GB", 47: "NO", 61: "AU", 39: "IT", 212: "MA", 262: "RE", 290: "SH", 358: "FI", 590: "GP", 599: "CW" };

/** Dígitos do número nacional (sem DDI) por DDI: [mín, máx]. Sem regra: 6–13 e total ≤ 15. */
const NATIONAL_LENGTH = {
  1: [10, 10], 55: [10, 11], 54: [10, 11], 52: [10, 11], 34: [9, 9], 351: [9, 9], 57: [10, 10], 56: [9, 9],
  51: [9, 9], 598: [8, 8], 595: [9, 9], 591: [8, 8], 593: [9, 9], 58: [10, 10], 506: [8, 8], 502: [8, 8],
  503: [8, 8], 504: [8, 8], 505: [8, 8], 507: [7, 8], 53: [8, 8], 44: [10, 10], 33: [9, 9], 49: [6, 13],
  39: [6, 11], 91: [10, 10], 86: [11, 11], 81: [9, 10], 61: [9, 9], 244: [9, 9], 258: [9, 9], 238: [7, 7],
};
const DEFAULT_LENGTH = [6, 13];

/** Ordem do topo da lista (mercados do GuiaFlow); o resto vem em ordem alfabética. */
export const TOP_COUNTRIES = ["BR", "PT", "US", "AR", "MX", "ES", "CO", "CL", "PE", "UY"];

const PT_REGIONS = new Set(["BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL"]);
const ES_REGIONS = new Set(["ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ"]);

export function countryByIso(iso) {
  return BY_ISO.get(String(iso || "").toUpperCase()) || null;
}

/** 🇧🇷 a partir de "BR" (indicadores regionais). */
export function flagEmoji(iso) {
  const code = String(iso || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const nameCache = new Map();
/** Nome do país no idioma da interface (Intl.DisplayNames); sem suporte, o código ISO. */
export function countryName(iso, locale = "pt") {
  const key = `${locale}:${iso}`;
  if (nameCache.has(key)) return nameCache.get(key);
  let name = iso;
  try {
    const lang = locale === "pt" ? "pt-BR" : locale;
    name = new Intl.DisplayNames([lang], { type: "region" }).of(iso) || iso;
  } catch {
    name = iso;
  }
  nameCache.set(key, name);
  return name;
}

/** Lista para o seletor: os principais primeiro, depois todos em ordem alfabética do idioma. */
export function countryOptions(locale = "pt") {
  const top = TOP_COUNTRIES.map(countryByIso).filter(Boolean);
  const rest = COUNTRIES.filter((c) => !TOP_COUNTRIES.includes(c.iso)).sort((a, b) =>
    countryName(a.iso, locale).localeCompare(countryName(b.iso, locale), locale)
  );
  return [...top, ...rest].map((c) => ({ ...c, name: countryName(c.iso, locale), flag: flagEmoji(c.iso) }));
}

/** Busca por nome (sem acento), ISO ou DDI ("+55", "55", "bra", "br"). */
export function filterCountries(options, query) {
  const q = fold(query).replace(/^\+/, "");
  if (!q) return options;
  if (/^\d+$/.test(q)) return options.filter((c) => c.dial.startsWith(q));
  const starts = [];
  const contains = [];
  for (const c of options) {
    const name = fold(c.name);
    if (name.startsWith(q) || c.iso.toLowerCase() === q) starts.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  return [...starts, ...contains];
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Região do navegador ("es-AR" → "AR"), na ordem de navigator.languages. */
export function browserRegion(languages = []) {
  for (const tag of languages) {
    const m = String(tag || "").match(/^[a-z]{2,3}[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2})\b/);
    if (m && BY_ISO.has(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  return "";
}

/**
 * País padrão do campo: PT → Brasil (ou outro país lusófono da região do navegador),
 * ES → país hispânico da região (es-AR, es-MX…; senão Espanha), EN → EUA; demais → região do navegador.
 */
export function defaultCountry(locale = "pt", languages = []) {
  const region = browserRegion(languages);
  if (locale === "pt") return PT_REGIONS.has(region) ? region : "BR";
  if (locale === "es") return ES_REGIONS.has(region) ? region : "ES";
  if (locale === "en") return region && region !== "BR" && !ES_REGIONS.has(region) && !PT_REGIONS.has(region) ? region : "US";
  return region || "US";
}

/** Separa dígitos E.164 ("5511999998888") em país + número nacional pelo DDI mais longo. */
export function parseE164(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return null;
  for (let len = Math.min(3, digits.length - 1); len >= 1; len -= 1) {
    const dial = digits.slice(0, len);
    const matches = COUNTRIES.filter((c) => c.dial === dial);
    if (!matches.length) continue;
    const iso = PREFERRED[dial] || matches[0].iso;
    return { iso, dial, national: digits.slice(len) };
  }
  return null;
}

/** Só dígitos do número nacional; tira 0 de tronco (011…, 07…), menos na Itália. */
export function nationalDigits(input, dial) {
  let d = String(input ?? "").replace(/\D/g, "");
  if (String(dial) !== "39") d = d.replace(/^0+/, "");
  return d;
}

/**
 * Valida DDI + número nacional. ok → digits (E.164 só com dígitos).
 * error: "empty" | "length" | "ddd" (Brasil) | "country".
 */
export function validatePhone(dial, national) {
  const code = String(dial ?? "").replace(/\D/g, "");
  if (!code || !COUNTRIES.some((c) => c.dial === code)) return { ok: false, error: "country", digits: "" };
  const nat = nationalDigits(national, code);
  if (!nat) return { ok: false, error: "empty", digits: "" };
  const [min, max] = NATIONAL_LENGTH[code] || DEFAULT_LENGTH;
  const digits = code + nat;
  if (nat.length < min || nat.length > max || digits.length > 15 || digits.length < 8) {
    return { ok: false, error: "length", digits: "", min, max };
  }
  if (code === "55") {
    // DDD 11–99 sem zero; celular (11 dígitos) começa com 9 depois do DDD
    if (!/^[1-9][1-9]/.test(nat)) return { ok: false, error: "ddd", digits: "" };
    if ((nat.length === 11 && nat[2] !== "9") || (nat.length === 10 && !/[2-5]/.test(nat[2]))) {
      return { ok: false, error: "length", digits: "", min, max };
    }
  }
  if (code === "1" && !/^[2-9]\d{2}[2-9]/.test(nat)) return { ok: false, error: "length", digits: "", min, max };
  return { ok: true, error: "", digits };
}

/** Número E.164 salvo (só dígitos) é válido para o botão do WhatsApp? */
export function isValidE164Digits(input) {
  const parsed = parseE164(input);
  return Boolean(parsed && validatePhone(parsed.dial, parsed.national).ok);
}

/** Formatação leve do número nacional enquanto digita. */
export function formatNational(dial, input) {
  const code = String(dial ?? "");
  const d = String(input ?? "").replace(/\D/g, "").slice(0, 14);
  if (!d) return "";
  if (code === "55") {
    const n = d.slice(0, 11);
    if (n.length <= 2) return `(${n}`;
    const rest = n.slice(2);
    if (rest.length <= 4) return `(${n.slice(0, 2)}) ${rest}`;
    if (n.length <= 10) return `(${n.slice(0, 2)}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `(${n.slice(0, 2)}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  }
  if (code === "1") {
    const n = d.slice(0, 10);
    if (n.length <= 3) return n;
    if (n.length <= 6) return `(${n.slice(0, 3)}) ${n.slice(3)}`;
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  const groups = d.length === 8 ? [4, 4] : d.length === 10 ? [3, 3, 4] : null;
  const out = [];
  let i = 0;
  if (groups) {
    for (const g of groups) {
      out.push(d.slice(i, i + g));
      i += g;
    }
  } else {
    while (i < d.length) {
      out.push(d.slice(i, i + 3));
      i += 3;
    }
  }
  return out.filter(Boolean).join(" ");
}
