/**
 * Clientes/marcas do workspace (GUI-33).
 * why: agências cuidam de vários clientes; cada projeto pode pertencer a um. O vínculo mora no
 *      próprio projeto (`workspaceClientId`), sobe junto no sync do Pro e a nuvem só aceita
 *      cliente da mesma conta. Sem cliente (ou cliente apagado) = grupo «Sem cliente».
 * hazard: projeto local (sem nuvem, sem login) nunca depende disto; tudo aqui é opcional.
 */

export const NO_CLIENT = "none";
export const ALL_CLIENTS = "all";
export const CLIENT_NAME_MAX = 80;
const CACHE_PREFIX = "guiaflow.clients.v1:";

/** Lista vinda da nuvem → [{ id, name, logoUrl, projectCount }], só itens válidos. */
export function normalizeClients(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!id || !name) continue;
    const logoUrl = typeof item.logoUrl === "string" && /^https:\/\//i.test(item.logoUrl) ? item.logoUrl : null;
    out.push({ id, name, logoUrl, projectCount: Number(item.projectCount) || 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function cleanClientName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, CLIENT_NAME_MAX);
}

/** Id do cliente do projeto, só se o cliente ainda existe. Senão null («Sem cliente»). */
export function clientOf(project, clients) {
  const id = typeof project?.workspaceClientId === "string" ? project.workspaceClientId : "";
  if (!id) return null;
  return clients.some((c) => c.id === id) ? id : null;
}

/** Contagem por cliente a partir dos projetos deste navegador (inclui «Sem cliente»). */
export function countByClient(projects, clients) {
  const counts = { [NO_CLIENT]: 0 };
  for (const c of clients) counts[c.id] = 0;
  for (const p of projects || []) {
    const id = clientOf(p, clients);
    counts[id || NO_CLIENT] += 1;
  }
  return counts;
}

/** Filtro da biblioteca: "all", "none" ou id de cliente. Filtro de cliente sumido volta a "all". */
export function resolveFilter(filter, clients) {
  if (filter === NO_CLIENT) return NO_CLIENT;
  if (filter && filter !== ALL_CLIENTS && clients.some((c) => c.id === filter)) return filter;
  return ALL_CLIENTS;
}

export function filterProjects(projects, filter, clients) {
  const active = resolveFilter(filter, clients);
  if (active === ALL_CLIENTS) return [...(projects || [])];
  return (projects || []).filter((p) => (clientOf(p, clients) || NO_CLIENT) === active);
}

/** Chips da biblioteca: Todos · Cliente (n) … · Sem cliente (n). Vazio quando a conta não tem clientes. */
export function filterChips(projects, clients) {
  if (!clients.length) return [];
  const counts = countByClient(projects, clients);
  return [
    { id: ALL_CLIENTS, count: (projects || []).length },
    ...clients.map((c) => ({ id: c.id, name: c.name, count: counts[c.id] || 0 })),
    { id: NO_CLIENT, count: counts[NO_CLIENT] || 0 },
  ];
}

/** Grava o vínculo no projeto. null tira do cliente (não deixa a chave vazia no payload). */
export function assignClient(project, clientId) {
  const next = { ...project };
  if (clientId) next.workspaceClientId = String(clientId);
  else delete next.workspaceClientId;
  return next;
}

/** Erro da nuvem → chave de texto. */
export function clientsProblem(res) {
  if (!res || res.ok) return "";
  if (res.status === 401) return "auth";
  if (res.status === 402) return "paywall";
  if (res.data?.error === "client_name_taken") return "taken";
  if (res.data?.error === "client_limit") return "limit";
  if (res.status === 400) return "invalid";
  return "load";
}

function storageOk(storage) {
  return storage && typeof storage.getItem === "function";
}

/**
 * Cache dos clientes da conta, para a biblioteca funcionar offline.
 * deps: { fetch: cloudFetch, storage, account: () => email|"" }
 */
export function createClientsStore(deps = {}) {
  let clients = [];
  let canEdit = false;
  let loadedFor = "";
  const listeners = new Set();
  const storage = deps.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  const key = () => `${CACHE_PREFIX}${deps.account?.() || ""}`;

  function emit() {
    for (const fn of listeners) fn(clients);
  }

  function readCache() {
    const who = deps.account?.() || "";
    if (!who) {
      clients = [];
      canEdit = false;
      loadedFor = "";
      return;
    }
    if (loadedFor === who) return;
    loadedFor = who;
    try {
      const raw = storageOk(storage) ? storage.getItem(key()) : null;
      const data = raw ? JSON.parse(raw) : null;
      clients = normalizeClients(data?.clients);
      canEdit = Boolean(data?.canEdit);
    } catch {
      clients = [];
    }
  }

  function writeCache() {
    if (!storageOk(storage) || !deps.account?.()) return;
    try {
      storage.setItem(key(), JSON.stringify({ clients, canEdit }));
    } catch {
      /* cache é só conveniência */
    }
  }

  async function call(path, init) {
    return deps.fetch(path, { headers: { Accept: "application/json" }, ...init });
  }

  return {
    list() {
      readCache();
      return clients;
    },
    canEdit() {
      readCache();
      return canEdit;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Sem login: lista vazia, nada de rede. */
    async refresh() {
      readCache();
      if (!deps.account?.()) {
        emit();
        return { ok: true, clients };
      }
      const res = await call("/clients", { method: "GET" });
      if (res?.stub) return { ok: true, clients };
      if (!res?.ok) return { ok: false, problem: clientsProblem(res) };
      clients = normalizeClients(res.data?.clients);
      canEdit = Boolean(res.data?.canEdit);
      writeCache();
      emit();
      return { ok: true, clients };
    },
    async create({ name, logoUrl } = {}) {
      const body = { name: cleanClientName(name) };
      if (logoUrl) body.logoUrl = String(logoUrl).trim();
      const res = await call("/clients", { method: "POST", body: JSON.stringify(body) });
      if (!res?.ok) return { ok: false, problem: clientsProblem(res) };
      await this.refresh();
      return { ok: true, client: res.data?.client };
    },
    async update(id, patch = {}) {
      const body = {};
      if (patch.name !== undefined) body.name = cleanClientName(patch.name);
      if (patch.logoUrl !== undefined) body.logoUrl = patch.logoUrl ? String(patch.logoUrl).trim() : null;
      const res = await call(`/clients/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res?.ok) return { ok: false, problem: clientsProblem(res) };
      await this.refresh();
      return { ok: true, client: res.data?.client };
    },
    async remove(id) {
      const res = await call(`/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res?.ok) return { ok: false, problem: clientsProblem(res) };
      await this.refresh();
      return { ok: true, released: Number(res.data?.releasedProjects) || 0 };
    },
    reset() {
      clients = [];
      canEdit = false;
      loadedFor = "";
      emit();
    },
  };
}
