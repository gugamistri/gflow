# Dois repositórios

A pasta `Tools/guiaflow` é o clone de `gugamistri/gflow` (editor MIT, porta 4173). Ao lado, `Tools/guiaflow-cloud` é o clone privado de `gugamistri/guiaflow-cloud` (API, porta 4000). Cada um tem o próprio git, o próprio `main` e o próprio host. Nenhum importa o código do outro.

O contrato entre eles é HTTP. O mapa do que a nuvem acrescenta está em `docs/CLOUD.md`. O Coolify da API está no README de `guiaflow-cloud`.

## Par local

Pronto quando `GET http://localhost:4000/health` responde `ok`, `http://localhost:4173/editor` abre, e o `localStorage` desta origem tem as duas chaves abaixo.

API, na raiz de `guiaflow-cloud`:

1. `npm install`
2. Copiar `.env.example` para `.env` (gitignored). Ajustar a linha de atribuição, não o comentário:
   - `NODE_ENV=development`
   - `DATABASE_URL=memory:` (zera a cada reinício)
   - `AUTH_SECRET` com uma string longa
   - `EDITOR_ORIGIN=http://localhost:4173` e `CORS_ORIGINS=http://localhost:4173`
   - `AUTH_BASE_URL`, `APP_ORIGIN` e `API_PUBLIC_URL` em `http://localhost:4000`
   - `SUPERADMIN_EMAILS` com o e-mail que entra como Team sem Stripe
   - `GUIAFLOW_DEV_TOKEN=1` e `RESEND_API_KEY` vazio. O `POST /auth/magic-link` devolve `devToken` e `delivered: false`
   - `COLLAB_ENABLED=1`. Com `0`, as rotas `/collab` respondem 404
3. Subir com `node --env-file=.env --watch apps/api/src/index.js`. O script `npm run dev:api` não lê o `.env`.

Editor, na raiz de `gflow`:

1. `npm install` e `npm start`
2. Em `http://localhost:4173/editor`, no console: `localStorage.setItem("guiaflow.cloud.baseUrl","http://localhost:4000")` e `localStorage.setItem("guiaflow.collab","1")`, depois recarregar
3. Janela anônima repete as duas chaves. Cada janela entra com um e-mail

`npm test` em cada repo antes de abrir PR.

## Colaboração na tela

A API já manda presença (`stepId`, `field`) e ops. Esta mudança é só do editor.

- Foco no painel (`#props-body`) ou no palco (`[data-inline]` dentro de `#canvas-stage`) vira o campo da presença. O mapa está em `fieldForDomTarget` (`js/collabModel.js`): `data-inline="description"` é o campo `text`.
- Quem está no mesmo passo vê anel e nome no texto visível e no campo do painel (`paintFieldMarks` em `js/collabUi.js`, estilos em `css/collab.css`). O balão (`#editor-popover`) ou o slide (`#canvas-slide`) ganha contorno.
- Quando a op chega, o campo pisca cerca de 2 s (`flashField`). Controles que não são texto (lado, tempo, imagem, tipo) piscam só no painel (`EXTRA_FLASH_IDS`).
- Texto novo para o leitor de tela: `collab.live.field` em `js/collabI18n.js`.
- Ops e fila: `js/collabController.js`. Rotas no outro repo: `apps/api/src/routes/collab.js` e `apps/api/src/lib/collab-ops.js`.
- `PATCH /projects/:id` com colaboradores ativos responde 409 `collab_active`. O sync legado para de reenviar esse projeto e passa a tratá-lo como colaborativo.

## Deploy

Cada publicação mexe num host só.

**Editor (este repo).** Não há GitHub Action. Produção é `vercel deploy --prod` na raiz do `gflow`, que publica `guiaflow.pro`. O gancho `.cursor/hooks/deploy-vercel-on-push.sh` roda esse comando depois de um `git push` com sucesso feito pelo Cursor. Um merge no GitHub, sem esse push local, não publica o site. Preview de branch continua sendo outro deploy, sem `--prod`.

**API (`guiaflow-cloud`).** Merge em `main` publica no Coolify sozinho. Base `/apps/api`, porta `4000`, comando `node src/index.js`. Produção fica com `DATABASE_URL` Postgres e sem `GUIAFLOW_DEV_TOKEN`. `COLLAB_ENABLED` é variável do host. Um commit só de editor não entra nesse repo e não pede deploy da API.

Antes de publicar a API, o diff tem de ser só de `guiaflow-cloud`. Antes de publicar o editor, o diff tem de ser só de `gflow`. `.env` não entra em nenhum dos dois.
