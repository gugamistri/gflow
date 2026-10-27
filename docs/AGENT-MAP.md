# Mapa do agente

Abra este arquivo e siga a linha da tarefa. Os caminhos abaixo são a busca. Testes ficam ao lado do módulo (`nome.test.js`).

Dois gits, lado a lado. Este checkout é o editor MIT (`gflow`, porta 4173, Vercel → `guiaflow.pro`). A API dos planos pagos é `../guiaflow-cloud` (porta 4000, Coolify). Nenhum importa o código do outro. O contrato é HTTP.

| Documento | Quando |
| --- | --- |
| `docs/REPOS.md` | Subir os dois na máquina, colaboração na tela, publicar |
| `docs/CLOUD.md` | Contrato HTTP do plano Pro (auth, share, billing, flags) |
| `../guiaflow-cloud/apps/api/src/app.js` | Onde cada rota é registrada |
| `../guiaflow-cloud/apps/api/README.md` | Tabela de rotas e Coolify |
| `../guiaflow-cloud/docs/ARCHITECTURE.md` | Corte OSS vs nuvem |

## Fora de busca

Assets e cópias. Lógica nova não mora aqui.

| Caminho | O que é |
| --- | --- |
| `brand/`, `fonts/`, `vendor/`, `downloads/`, `data/`, `demo/` | Imagem, fonte, biblioteca vendida, fixture |
| `en/`, `es/` | HTML gerado. Fonte: `locale-src/` + `scripts/build-locale-pages.mjs` |
| `node_modules/` | Dependência |
| `../guiaflow-cloud/node_modules/` | Dependência |
| `../guiaflow-cloud/apps/api/vendor/` | Cópia de `packages/`. Edite `packages/` e rode `npm run sync:vendor` na raiz da nuvem |
| `../guiaflow-cloud/packages/tour-schema/` | Cópia de `js/tour-schema/`. A fonte é este repo |

## Linha da tarefa

| Tarefa | Este repo | `../guiaflow-cloud` |
| --- | --- | --- |
| Subir editor + API, deploy | `docs/REPOS.md` | `README.md` (Coolify), `.env.example` |
| URL base, flags, sessão | `js/cloudConfig.js` | `apps/api/src/config.js` |
| Login, magic link, callback | `js/authCallback.js`, `auth/callback.html` | `apps/api/src/routes/auth.js`, `apps/api/src/lib/jwt.js` |
| Plano, checkout, portal | `js/billing.js`, `js/paywall.js` | `apps/api/src/routes/billing.js`, `apps/api/src/lib/stripe-client.js`, `packages/entitlements` |
| Link permanente `/p/:slug` | `js/share.js`, `js/viewShare.js`, `api/p/[slug].js`, `api/lib/permanent-share.cjs` | `apps/api/src/routes/shares.js` |
| Preview de 7 dias `/v/:id` | `api/share.js`, `api/share/[id].js`, `api/v/[id].js`, `api/lib/share-store.cjs`, `api/cron/expire-shares.js` | — |
| Sync de projetos e mídia | `js/cloudSync.js` | `apps/api/src/routes/projects.js`, `apps/api/src/routes/sync.js`, `apps/api/src/lib/object-store.js` |
| Colaboração | `js/collabController.js`, `js/collabModel.js`, `js/collabUi.js`, `js/collabClient.js`, `css/collab.css` | `apps/api/src/routes/collab.js`, `apps/api/src/lib/collab.js`, `apps/api/src/lib/collab-ops.js` |
| IA e voz com chave do usuário | `js/llm.js`, `js/llm-store.js`, `js/cartesia.js`, `js/cartesia-store.js` | — |
| IA e voz hospedadas | `js/hosted.js` | `apps/api/src/routes/ai.js`, `apps/api/src/routes/tts.js`, `apps/api/src/lib/ai.js`, `apps/api/src/lib/tts.js` |
| Chaves de API, MCP, REST `/v1` | `js/apiKeysDialog.js`, `llms.txt`, `ajuda/api.html`, `.well-known/integrations.json` | `apps/api/src/routes/mcp.js`, `apps/api/src/routes/v1.js`, `apps/api/src/routes/oauth.js`, `apps/api/src/routes/api-keys.js`, `apps/api/src/lib/mcp-tools.js` |
| Analytics do link | `js/analyticsDialog.js`, `js/viewAnalytics.js` | `apps/api/src/routes/analytics.js`, `apps/api/src/routes/share-analytics.js` |
| Comentários | `js/comments.js`, `js/commentsUi.js` | `apps/api/src/routes/comments.js` |
| Leads e passos de abertura/fim | `js/leadsDialog.js`, `js/fixedSteps.js`, `js/fixedStepsEditor.js` | `apps/api/src/routes/leads.js` |
| Player e página publicada | `js/player.js`, `js/playback.js`, `js/viewApp.js`, `view.html` | `packages/player-host` |
| Formato do tour | `js/tour-schema/README.md` e os arquivos nomeados lá | cópia em `packages/tour-schema/` |
| Captura no Chrome | `extension/background.js`, `extension/content.js`, `extension/popup.js`, `js/captureInbox.js` | — |
| App desktop | `electron/main.js` | — |
| Casca do editor | `editor.html`, `js/app.js`, `js/editor.js`, `css/app.css` | — |
| Landing e páginas legais | `index.html`, `js/landing.js`, `locale-src/` | `apps/web` é só status + confirmar e-mail |
| Embed e oEmbed | `js/embedSnippet.js`, `api/oembed.js` | — |

`js/app.js` é o índice de imports do editor. Se a linha acima não cobre o assunto, leia o import correspondente nesse arquivo e pare.

## Pastas deste repo

| Pasta | Papel |
| --- | --- |
| `js/` | Editor, player, nuvem no browser. Entrada: `app.js` |
| `js/tour-schema/` | Formato do tour, sem DOM |
| `css/` | Estilo do editor e da colaboração |
| `api/` | Funções Vercel: preview de 7 dias, proxy `/p`, oEmbed, cron |
| `auth/` | Página que troca o code pela sessão |
| `extension/` | Extensão de captura |
| `electron/` | Desktop |
| `scripts/` | `npm start`, locales, empacotar extensão |
| `locale-src/` | Fonte EN/ES |
| `docs/` | `REPOS.md`, `CLOUD.md`, este mapa |

## Pastas da API

Tudo sob `../guiaflow-cloud`.

| Pasta | Papel |
| --- | --- |
| `apps/api/src/routes/` | Um arquivo por área. Registro em `src/app.js` |
| `apps/api/src/lib/` | Stripe, JWT, e-mail, S3, quotas, collab |
| `apps/api/src/index.js` | Sobe o processo na porta 4000 |
| `packages/db` | Postgres ou `memory:` |
| `packages/entitlements` | Plano que libera cada flag |
| `packages/player-host` | HTML mínimo de `/v/:slug` na API |
| `packages/tour-schema` | Cópia do formato; fonte é `js/tour-schema/` daqui |
| `apps/web` | Status. O produto no browser é este repo |
