import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_CLIENTS,
  NO_CLIENT,
  assignClient,
  clientOf,
  clientsProblem,
  countByClient,
  createClientsStore,
  filterChips,
  filterProjects,
  normalizeClients,
  resolveFilter,
} from "./workspaceClients.js";

const clients = normalizeClients([
  { id: "c2", name: "beta", projectCount: 1 },
  { id: "c1", name: "Acme", logoUrl: "http://inseguro/logo.png" },
  { id: "", name: "sem id" },
  { name: "x" },
]);
const projects = [
  { id: "p1", name: "Antigo" },
  { id: "p2", name: "Da Acme", workspaceClientId: "c1" },
  { id: "p3", name: "Da Beta", workspaceClientId: "c2" },
  { id: "p4", name: "Cliente apagado", workspaceClientId: "sumiu" },
];

test("normaliza a lista: só válidos, em ordem de nome, logo só https", () => {
  assert.deepEqual(clients.map((c) => c.id), ["c1", "c2"]);
  assert.equal(clients[0].logoUrl, null);
});

test("projeto antigo e cliente apagado ficam em «Sem cliente», sem perder nada", () => {
  assert.equal(clientOf(projects[0], clients), null);
  assert.equal(clientOf(projects[3], clients), null);
  assert.equal(clientOf(projects[1], clients), "c1");
  assert.deepEqual(countByClient(projects, clients), { [NO_CLIENT]: 2, c1: 1, c2: 1 });
  assert.deepEqual(filterProjects(projects, NO_CLIENT, clients).map((p) => p.id), ["p1", "p4"]);
  assert.deepEqual(filterProjects(projects, "c2", clients).map((p) => p.id), ["p3"]);
  assert.equal(filterProjects(projects, ALL_CLIENTS, clients).length, 4);
});

test("sem clientes não há filtro: time de uma marca não vê nada novo", () => {
  assert.deepEqual(filterChips(projects, []), []);
  assert.equal(filterProjects(projects, "c1", []).length, 4, "filtro velho volta a Todos");
  assert.equal(resolveFilter("c9", clients), ALL_CLIENTS);
  const chips = filterChips(projects, clients);
  assert.deepEqual(chips.map((c) => c.id), [ALL_CLIENTS, "c1", "c2", NO_CLIENT]);
  assert.deepEqual(chips.map((c) => c.count), [4, 1, 1, 2]);
});

test("mover grava workspaceClientId e tirar remove a chave", () => {
  const moved = assignClient(projects[0], "c1");
  assert.equal(moved.workspaceClientId, "c1");
  assert.equal(projects[0].workspaceClientId, undefined, "não muta o original");
  assert.equal(Object.hasOwn(assignClient(moved, null), "workspaceClientId"), false);
});

test("erros da nuvem viram chaves de texto", () => {
  assert.equal(clientsProblem({ ok: false, status: 402 }), "paywall");
  assert.equal(clientsProblem({ ok: false, status: 409, data: { error: "client_name_taken" } }), "taken");
  assert.equal(clientsProblem({ ok: false, status: 409, data: { error: "client_limit" } }), "limit");
  assert.equal(clientsProblem({ ok: false, status: 401 }), "auth");
  assert.equal(clientsProblem({ ok: true }), "");
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

test("sem login: nenhuma chamada de rede e lista vazia (projetos locais seguem iguais)", async () => {
  let calls = 0;
  const store = createClientsStore({ fetch: async () => (calls++, { ok: true, data: {} }), account: () => "", storage: memoryStorage() });
  const res = await store.refresh();
  assert.equal(res.ok, true);
  assert.deepEqual(store.list(), []);
  assert.equal(calls, 0);
});

test("com login: carrega, cria e guarda cache por conta", async () => {
  const storage = memoryStorage();
  const seen = [];
  let server = [{ id: "c1", name: "Acme", projectCount: 2 }];
  const fetch = async (path, init) => {
    seen.push(`${init.method} ${path}`);
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.name.toLowerCase() === "acme") return { ok: false, status: 409, data: { error: "client_name_taken" } };
      server = [...server, { id: "c2", name: body.name }];
      return { ok: true, status: 201, data: { client: server.at(-1) } };
    }
    return { ok: true, status: 200, data: { clients: server, canEdit: true } };
  };
  const store = createClientsStore({ fetch, account: () => "a@example.com", storage });
  await store.refresh();
  assert.equal(store.list()[0].projectCount, 2);
  assert.equal(store.canEdit(), true);
  const dup = await store.create({ name: " acme " });
  assert.equal(dup.problem, "taken");
  const made = await store.create({ name: "  Nova   Marca " });
  assert.equal(made.ok, true);
  assert.deepEqual(store.list().map((c) => c.name), ["Acme", "Nova Marca"]);
  assert.ok(seen.includes("POST /clients"));
  const offline = createClientsStore({ fetch: async () => ({ ok: false, error: "network" }), account: () => "a@example.com", storage });
  assert.equal(offline.list().length, 2, "cache da conta serve offline");
});
