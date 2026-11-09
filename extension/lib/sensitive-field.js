/**
 * O que a captura pode gravar de um campo. Senha, código e cartão nunca entram.
 * A opção da extensão nasce desligada; isto só roda se ela for ligada.
 */

export const TYPE_TEXT_MAX = 200;

const SECRET_AUTO = new Set(["current-password", "new-password", "one-time-code"]);
const SECRET_NAME = /(password|passwd|senha|pwd|cvv|cvc|csc|cc-?number|cc-?csc|cc-?exp|cc-?name|cardnumber|card-number|cart[aã]o|creditcard|debitcard)/i;

export function fieldIsSensitive(field) {
  if (!field || typeof field !== "object") return true;
  const type = String(field.type || "").toLowerCase();
  if (type === "password") return true;
  const tokens = String(field.autocomplete || "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.some((token) => SECRET_AUTO.has(token) || token.startsWith("cc-"))) return true;
  if (SECRET_NAME.test(`${field.name || ""} ${field.id || ""}`)) return true;
  return false;
}

export function clipTypeText(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, TYPE_TEXT_MAX);
}

/** null = não gravar. x/y já em % da tela. */
export function typeActionFromInput(field, text, point) {
  if (fieldIsSensitive(field)) return null;
  const clean = clipTypeText(text);
  if (!clean) return null;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return null;
  const t = Number(point?.t);
  return {
    t: Number.isFinite(t) ? Math.max(0, Math.round(t)) : 0,
    kind: "type",
    text: clean,
    x,
    y,
  };
}

/** Segunda passagem antes de gravar no passo: corta texto e descarta item sem texto. */
export function clipStoredActions(raw) {
  if (!Array.isArray(raw)) return null;
  const actions = [];
  for (const item of raw) {
    if (!item || (item.kind !== "type" && item.kind !== "click")) continue;
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) continue;
    const t = Number.isFinite(Number(item.t)) ? Math.max(0, Math.round(Number(item.t))) : 0;
    if (item.kind === "click") {
      actions.push({ t, kind: "click", x, y });
      continue;
    }
    if (item.field && fieldIsSensitive(item.field)) continue;
    const text = clipTypeText(item.text);
    if (!text) continue;
    actions.push({ t, kind: "type", text, x, y });
  }
  return actions.length ? actions : null;
}
