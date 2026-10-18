/**
 * Comentários do Team (cliente): rede e funções puras. Sem DOM.
 * O texto do comentário é SEMPRE texto: aqui só se separa em pedaços (texto, link, menção) e quem
 * desenha usa textContent. `request(path, init)` é o `cloudFetch` ({ ok, status, error, data }).
 */
export const COMMENT_MAX = 2000;
export const COMMENT_FIELDS = Object.freeze(["title", "text", "caption", "alt"]);
export const COMMENT_LINK_MAX = 3;

export function createCommentsClient({ request, projectId }) {
  const base = `/projects/${encodeURIComponent(projectId)}/comments`;
  const json = (method, path, body) => request(`${base}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}), timeoutMs: 15_000 });
  const tid = (id) => encodeURIComponent(id);
  return {
    list: (status = "all") => json("GET", `/threads?status=${status}`),
    createThread: (input) => json("POST", "/threads", input),
    reply: (threadId, input) => json("POST", `/threads/${tid(threadId)}/comments`, input),
    edit: (commentId, input) => json("PATCH", `/comments/${tid(commentId)}`, input),
    remove: (commentId) => json("DELETE", `/comments/${tid(commentId)}`),
    resolve: (threadId) => json("POST", `/threads/${tid(threadId)}/resolve`, {}),
    reopen: (threadId) => json("POST", `/threads/${tid(threadId)}/reopen`, {}),
    markRead: (threadId) => json("POST", `/threads/${tid(threadId)}/read`, {}),
    setPrefs: (emailMuted) => json("PUT", "/prefs", { emailMuted }),
  };
}

const LINK_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAIL_RE = /[.,;:!?)\]]+$/;

/** URL só http(s). Qualquer outra coisa vira texto. */
export function safeHref(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Quebra o texto em pedaços: { type: "text"|"link"|"mention", value, href? }.
 * `names` são os nomes de quem pode ser mencionado (a menção só vale com o nome exato após o @).
 */
export function commentSegments(body, names = []) {
  const text = String(body ?? "");
  const out = [];
  const pushText = (chunk) => {
    if (!chunk) return;
    const list = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!list.length) { out.push({ type: "text", value: chunk }); return; }
    const re = new RegExp(`(^|\\s)@(${list.map(escapeRe).join("|")})(?=$|[\\s.,;:!?)])`, "g");
    let last = 0;
    let m;
    while ((m = re.exec(chunk))) {
      const start = m.index + m[1].length;
      if (start > last) out.push({ type: "text", value: chunk.slice(last, start) });
      out.push({ type: "mention", value: `@${m[2]}` });
      last = start + 1 + m[2].length;
    }
    if (last < chunk.length) out.push({ type: "text", value: chunk.slice(last) });
  };
  let last = 0;
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) {
    let url = m[0];
    const trail = url.match(TRAIL_RE)?.[0] || "";
    if (trail) url = url.slice(0, -trail.length);
    const href = safeHref(url);
    pushText(text.slice(last, m.index));
    if (href) out.push({ type: "link", value: url, href });
    else out.push({ type: "text", value: url });
    if (trail) out.push({ type: "text", value: trail });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

/** Há @ aberto antes do cursor? { start, query } ou null. */
export function mentionQuery(value, caret) {
  const before = String(value ?? "").slice(0, Math.max(0, caret ?? 0));
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

export function filterMembers(members, query, selfId = "") {
  const q = String(query || "").toLowerCase();
  return (members || [])
    .filter((m) => m && m.userId !== selfId && m.name && m.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, 6);
}

export function applyMention(value, state, name, caret) {
  const head = String(value).slice(0, state.start);
  const tail = String(value).slice(caret);
  const insert = `@${name} `;
  return { value: `${head}${insert}${tail.replace(/^\s/, "")}`, caret: head.length + insert.length };
}

/** Ids de quem foi mencionado de fato (nome exato após o @). */
export function mentionedIds(value, members, selfId = "") {
  const text = String(value ?? "");
  const ids = [];
  for (const m of members || []) {
    if (!m?.userId || m.userId === selfId || !m.name || ids.includes(m.userId)) continue;
    if (new RegExp(`(^|\\s)@${escapeRe(m.name)}(?=$|[\\s.,;:!?)])`).test(text)) ids.push(m.userId);
  }
  return ids.slice(0, 10);
}

export function countLinks(value) {
  return (String(value ?? "").match(LINK_RE) || []).length;
}

/** Validação local (o servidor repete): devolve a chave de erro ou "". */
export function validateDraft(value) {
  const v = String(value ?? "").trim();
  if (!v) return "invalid_body";
  if (v.length > COMMENT_MAX) return "body_too_long";
  if (/<\/?[a-z!][^>]*>/i.test(v)) return "html_not_allowed";
  if (countLinks(v) > COMMENT_LINK_MAX) return "too_many_links";
  return "";
}

/** Agrupa por passo na ordem do projeto; órfãs e "projeto inteiro" no fim. */
export function groupThreads(threads, stepOrder = []) {
  const order = new Map(stepOrder.map((id, i) => [id, i]));
  const groups = new Map();
  const put = (key, kind, thread) => {
    if (!groups.has(key)) groups.set(key, { key, kind, stepId: kind === "step" ? key : null, n: kind === "step" ? (order.get(key) ?? 0) + 1 : 0, threads: [] });
    groups.get(key).threads.push(thread);
  };
  for (const t of threads || []) {
    if (!t.stepId) put("_project", "project", t);
    else if (t.orphaned || !order.has(t.stepId)) put("_orphan", "orphan", t);
    else put(t.stepId, "step", t);
  }
  const rank = (g) => (g.kind === "step" ? g.n : g.kind === "project" ? 100_000 : 200_000);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

export function filterThreads(threads, filter, selfId) {
  if (filter === "resolved") return threads.filter((t) => t.status === "resolved");
  if (filter === "mine") return threads.filter((t) => t.createdBy?.id === selfId || t.comments.some((c) => c.author?.id === selfId));
  return threads.filter((t) => t.status === "open");
}

/** Comentários de outras pessoas que não estavam na lista anterior (para o toast). */
export function newFromOthers(prevThreads, nextThreads, selfId) {
  const seen = new Set();
  for (const t of prevThreads || []) for (const c of t.comments) seen.add(c.id);
  const out = [];
  for (const t of nextThreads || []) {
    for (const c of t.comments) {
      if (seen.has(c.id) || c.deleted || !c.author || c.author.id === selfId) continue;
      out.push({ thread: t, comment: c, first: t.comments[0]?.id === c.id });
    }
  }
  return out;
}

export function openCountForStep(summary, stepId) {
  return Number(summary?.byStep?.[stepId]?.open) || 0;
}

export function fieldThreads(threads, stepId, fieldKey) {
  return (threads || []).filter((t) => t.stepId === stepId && (t.fieldKey || null) === (fieldKey || null) && t.status !== "archived");
}

/** Deep link do e-mail: #/comments/<projectId>/<threadId>. */
export function parseCommentLink(hash) {
  const m = /^#\/comments\/([A-Za-z0-9_-]{1,64})(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(String(hash || ""));
  return m ? { projectId: m[1], threadId: m[2] || null } : null;
}

export function errorKey(res) {
  const code = res?.data?.error || res?.error || "";
  if (!res?.status || res.status >= 500 || code === "network" || code === "timeout") return "comments.errors.network";
  return `comments.errors.${code}`;
}
