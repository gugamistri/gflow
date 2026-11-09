# Assistente: conectar o agente de IA ao GuiaFlow

Implementado no editor (`js/mcpConnect.js`, `js/mcpConnectUi.js`, cartão `#btn-agent-connect` e diálogo `#modal-agent-connect`). O caminho é o mais curto para a pessoa dizer «conecte o Claude, o Codex, o Cursor… ao GuiaFlow» e criar o primeiro tour. A página [Integrações](https://guiaflow.pro/integracoes) continua com o passo a passo; o ChatGPT na web aponta para Plugins → Add custom MCP server.

Os monogramas dos cartões são letras neutras. Não há logo oficial: a licença das marcas não autoriza copiá-las aqui.

Servidor, já no ar: `https://app.guiaflow.pro/mcp` (Streamable HTTP, OAuth 2.1 com PKCE, registro dinâmico de cliente e Client ID Metadata Documents). Metadados: `https://app.guiaflow.pro/.well-known/oauth-protected-resource/mcp`. Plano Pro. A chave `gf_live_…` continua existindo para script; não é o caminho deste assistente.

Fontes conferidas em 9 de novembro de 2026. Onde a documentação oficial não publica um deep link, o passo é comando ou URL para colar. Nenhum link abaixo foi inventado.

## O que já existe

| Peça | Onde | O que faz hoje |
| --- | --- | --- |
| Página /integracoes | `integracoes.html` (en/es gerados) | Um clique para Cursor e VS Code, comando do Claude Code, passo a passo de Claude.ai e ChatGPT, URL do servidor |
| Chaves e apps | `js/apiKeysDialog.js`, diálogo no menu da conta | `GET/POST /api-keys`, `DELETE /api-keys/:id`, `DELETE /api-keys/apps/:id`. Lista chaves, apps OAuth e usos recentes. Trechos para colar: Cursor, Claude Code, URL do Claude.ai/ChatGPT, VS Code, curl |
| Contrato público | `.well-known/integrations.json`, `ajuda/api.html`, `llms.txt` | OAuth ou `Authorization: Bearer`. Ferramentas do MCP, inclusive `create_tour` e `publish` com `dryRun` |
| Cartão Novo projeto | `#btn-new-project` na biblioteca; `#modal-new-project` | Nome, tipo (guia ou galeria) e tema. Não fala de agente |
| Criar com ajuda | `#btn-assistant`, `data-assistant-entry` | Assistente grátis dentro do editor. Outro produto: não chama o MCP |
| «Criado por agente» | `payload.createdBy` em `js/projects.js` e `agentTagInfo` | Se `createdBy.kind === "agent"`, o cartão e a barra mostram a etiqueta. `createdBy.client` (até 60 caracteres) entra no título da etiqueta |

O `GET /api-keys` que o editor já consome devolve `keys`, `apps` (nome, escopos, `createdAt`, `lastUsedAt`), `recent` (`at`, `client`, `action`, `status`), `mcpUrl`, `canCreate` e os escopos. Não devolve um produto normalizado («isto é o Cursor»). O nome do app é o que o cliente OAuth registrou, ou o texto «MCP».

`createdBy` prova que um tour nasceu pela API ou pelo MCP. Não prova que o conector ainda está ligado, nem qual aplicativo está instalado na máquina.

## Onde entra

Dois pontos, o mesmo assistente:

1. Na biblioteca, um terceiro cartão ao lado de **Novo projeto** e **Criar com ajuda**: **Criar com meu agente de IA**. Mesma família visual de `library-action-card`. Selo Pro, como as outras funções do plano. Não substitui os dois cartões.
2. Dentro de **Novo projeto** (`#modal-new-project`), uma linha debaixo do atalho do assistente grátis: «Prefere o seu agente? Conecte Claude, Cursor e outros.» Abre o mesmo assistente e não mexe na escolha guia/galeria.

Não colocar no ⚙. A engrenagem é do projeto aberto (modo, tema, idiomas, narração). Não colocar no menu do Preview.

Quem já tem um app OAuth com uso recente cai direto no passo do prompt, com a opção de trocar de agente. Revogar continua em Chaves de API.

## Assistente em três passos

Diálogo no padrão `studio-modal`. Textos em `js/i18n.js` (pt, en, es) e cópia da extensão via `scripts/sync-extension-lib.mjs`.

### 1. Escolha o agente

Grade com um cliente por cartão e um estado:

- **Conectado · usado há X** — a consulta reconhece aquele produto e há `lastSeenAt` (ou `lastUsedAt`).
- **Não conectado** — sem item, ou a API ainda não expõe a lista.
- **Verificar conexão** — depois do gesto, repete a consulta. Não há como saber que o deep link foi só clicado.
- **Plano** — HTTP 402 mostra o convite ao Pro. Os passos continuam visíveis.

### 2. Um gesto por cliente

Um botão principal ou um comando com Copiar. O detalhe de cada cliente está na seção seguinte. Texto secundário, uma linha: «Na primeira chamada o aplicativo abre o login do GuiaFlow. Você autoriza e volta.»

Sem chave nova neste fluxo. Chave fica no menu da conta, para script e para cliente sem OAuth.

### 3. Prompt do primeiro tour

Campo somente leitura e botão Copiar. A pessoa cola no agente que acabou de conectar. O texto diz para publicar com `dryRun: true` e devolver `preview.url`, que a ferramenta `publish` já oferece. O tour aparece na biblioteca com a etiqueta «criado por agente».

Prompt em português (o que o botão copia quando o editor está em pt):

```text
Crie um tour guiado no GuiaFlow chamado "Demo do produto". Use as capturas que eu enviar. Em cada passo, cubra o botão ou o campo inteiro com o destaque e ponha o clique dentro dele. Título com 2 a 6 palavras e uma ou duas frases. No fim, publique com dryRun true e me mostre o link de prévia.
```

Variante de galeria, oferecida como segunda opção copiável, não como padrão:

```text
Crie uma galeria no GuiaFlow com o modelo produto, chamada "Catálogo". Uma foto por passo, agrupada em seções. Título curto em cada foto. Não use balões nem destaques. No fim, publique com dryRun true e me mostre o link de prévia.
```

Inglês:

```text
Create a guided tour in GuiaFlow named "Product demo". Use the screenshots I send. On each step, cover the whole button or field with the highlight and place the click inside it. Title of 2 to 6 words and one or two sentences. At the end, publish with dryRun true and show me the preview link.
```

```text
Create a GuiaFlow gallery with the product template, named "Catalog". One photo per step, grouped into sections. A short title on each photo. Do not use balloons or highlights. At the end, publish with dryRun true and show me the preview link.
```

Espanhol:

```text
Crea un tour guiado en GuiaFlow llamado "Demo del producto". Usa las capturas que yo envíe. En cada paso, cubre todo el botón o el campo con el destacado y pon el clic dentro. Título de 2 a 6 palabras y una o dos frases. Al final, publica con dryRun true y muéstrame el enlace de vista previa.
```

```text
Crea una galería en GuiaFlow con la plantilla producto, llamada "Catálogo". Una foto por paso, agrupada en secciones. Un título corto en cada foto. No uses globos ni destacados. Al final, publica con dryRun true y muéstrame el enlace de vista previa.
```

## Um passo por cliente

A coluna «Gesto» é o que o assistente mostra. A página /integracoes pode continuar com o JSON para quem prefere colar à mão.

### Claude.ai e Claude Desktop

Os dois usam o conector remoto da conta Claude. O Claude fala com o servidor a partir da nuvem da Anthropic, não da máquina da pessoa. O GuiaFlow já é público em `https://app.guiaflow.pro/mcp`, então não há rede privada para liberar.

Gesto: abrir o link oficial, que preenche nome e URL. A pessoa revisa e confirma. Não adiciona sozinho.

```text
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=GuiaFlow&connectorUrl=https%3A%2F%2Fapp.guiaflow.pro%2Fmcp
```

Plano Team ou Enterprise, quem administra a organização:

```text
https://claude.ai/admin-settings/connectors?modal=add-custom-connector&connectorName=GuiaFlow&connectorUrl=https%3A%2F%2Fapp.guiaflow.pro%2Fmcp
```

Fonte: [Directory connectors vs custom connectors](https://claude.com/docs/connectors/building/directory-vs-custom). O caminho manual, se o link não abrir, está em [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted): Customize → Connectors → Add custom connector, URL do servidor. No plano Free há um conector personalizado só.

Não usar `claude_desktop_config.json` aqui. Esse arquivo é para servidor local, outro mecanismo.

### Claude Code

Gesto: copiar o comando. O escopo `user` deixa o servidor em todos os projetos da pessoa; o padrão do comando é só o projeto atual.

```bash
claude mcp add --transport http --scope user guiaflow https://app.guiaflow.pro/mcp
```

Dentro do Claude Code, `/mcp`, escolher **guiaflow** e entrar. Fonte: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp). Há deep link `claude-cli://` para abrir uma sessão com prompt, não para instalar MCP. Não usar esse esquema neste passo.

### ChatGPT (web)

Não há deep link oficial de «adicionar este servidor». Gesto: instrução curta, com a URL ao lado para copiar.

Pela página atual da OpenAI ([Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)): em ChatGPT, Plugins → botão de adicionar → Add custom MCP server. Nome `GuiaFlow`, URL `https://app.guiaflow.pro/mcp`, autenticação OAuth. Criar como plugin e, na conversa, chamar com `@`.

A página /integracoes ainda descreve Configurações → Apps e conectores → Modo desenvolvedor. Quando o assistente for implementado, alinhar essa página ao texto oficial da época. Não manter os dois textos divergentes.

O ChatGPT na web não lê o `config.toml` do Codex. Fonte: [Codex MCP](https://developers.openai.com/codex/mcp).

### Codex (CLI e app desktop do ChatGPT)

A CLI, a extensão e o app desktop compartilham `~/.codex/config.toml`.

Gesto: copiar os dois comandos.

```bash
codex mcp add guiaflow --url https://app.guiaflow.pro/mcp
codex mcp login guiaflow
```

O `login` é o passo de OAuth documentado («for a server that supports OAuth, run `codex mcp login`»). Não passar `--oauth-client-id`: o GuiaFlow anuncia registro dinâmico e CIMD, e a documentação da OpenAI reserva o client id para servidor que exige cliente pré-registrado.

No app desktop, o mesmo resultado por Settings → MCP servers → Add server → Streamable HTTP, URL acima, depois Authenticate. Na conversa, `/mcp` lista os servidores.

Fonte: [https://developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp). O exemplo `codex mcp add <nome> --url` também aparece em [Docs MCP](https://developers.openai.com/learn/docs-mcp).

### Cursor

Gesto: o botão que /integracoes já publica. Formato oficial em [MCP Install Links](https://cursor.com/docs/mcp/install-links): `cursor://anysphere.cursor-deeplink/mcp/install?name=&config=`, com `config` em base64 do objeto do servidor.

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=guiaflow&config=eyJ1cmwiOiJodHRwczovL2FwcC5ndWlhZmxvdy5wcm8vbWNwIn0=
```

O base64 é `{"url":"https://app.guiaflow.pro/mcp"}`. A pessoa confirma Install no Cursor e entra no GuiaFlow na primeira chamada.

Para um botão dentro de `https://guiaflow.pro`, preferir a forma web do mesmo link. [Deeplinks](https://cursor.com/docs/reference/deeplinks) diz que qualquer deeplink abre por `https://cursor.com/link/` mais o caminho e os parâmetros (o exemplo da página é um prompt; o caminho de instalação é o de MCP Install Links):

```text
https://cursor.com/link/mcp/install?name=guiaflow&config=eyJ1cmwiOiJodHRwczovL2FwcC5ndWlhZmxvdy5wcm8vbWNwIn0=
```

Não colocar chave dentro do link. Base64 não esconde o conteúdo.

### VS Code

Gesto: o wrapper https que a própria documentação pede para sites. [MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) define `vscode:mcp/install?` + `encodeURIComponent(JSON.stringify(config))` e, para página web, `https://vscode.dev/redirect?url=` com esse endereço codificado.

Configuração: `{"name":"guiaflow","type":"http","url":"https://app.guiaflow.pro/mcp"}`.

O botão atual de /integracoes usa `vscode:mcp/install?` com as barras da URL sem codificar. Funciona como atalho direto. No assistente, gerar o link com `encodeURIComponent` e embrulhar em `https://vscode.dev/redirect?url=`, que é o formato da documentação para um site.

Na primeira chamada o VS Code pede o login. JSON alternativo, se a pessoa quiser colar: `.vscode/mcp.json` com `servers.guiaflow` (`type` `http`, `url` acima), já mostrado em /integracoes.

### Windsurf (Devin Desktop)

Não há deep link oficial. A página de MCP do Windsurf aponta para o Devin Desktop: [Windsurf Cascade MCP](https://docs.devin.ai/windsurf/plugins/cascade/mcp).

Gesto: copiar o JSON e indicar o arquivo que essa página abre. OAuth em Streamable HTTP está documentado; não mandar cabeçalho de chave.

```json
{
  "mcpServers": {
    "guiaflow": {
      "serverUrl": "https://app.guiaflow.pro/mcp"
    }
  }
}
```

Arquivo citado na mesma página: `~/.config/devin/mcp_config.json` no macOS e no Linux (`$XDG_CONFIG_HOME/devin/mcp_config.json` se a variável existir) e `%AppData%/devin/mcp_config.json` no Windows. Na interface: Settings → Tools → Windsurf Settings → Add Server, ou Open MCP config file no menu do Cascade.

Não usar um comando `devin mcp add`. Ele aparece em guias de terceiros, não nessa página.

### Gemini CLI

Não há deep link oficial. Gesto: copiar o comando. `--scope user` grava em `~/.gemini/settings.json` para todos os projetos; o padrão é o projeto atual.

```bash
gemini mcp add --transport http --scope user guiaflow https://app.guiaflow.pro/mcp
```

OAuth é descoberto sozinho no 401, sem bloco `oauth` no JSON, para servidor que publica os metadados. Dentro do CLI, `/mcp` mostra o estado. Fonte: [MCP servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/).

## Como saber que conectou

O clique num deep link não chega ao GuiaFlow. «Conectado» só existe depois que o aplicativo abre o servidor (`initialize` do MCP, no máximo a cada 10 minutos). Quem não está logado vê o pedido de entrada antes do diálogo. **Verificar conexão** repete o `GET /api-keys` e explica que é preciso ter usado o GuiaFlow naquele aplicativo ao menos uma vez.

`createdBy.kind === "agent"` num projeto continua sendo histórico («você já tem um tour criado por agente»), não o selo do cartão.

### Contrato que o editor lê

Não existe `GET /v1/me/mcp-clients`. O editor chama só `GET /api-keys`, com o JWT da sessão. A resposta ganha `mcpClients`. Campo ausente ou lista vazia: sem selo. 401 pede para entrar de novo. 402 mostra o convite ao Pro. Nuvem desligada: o assistente abre sem selo.

A gravação acontece no `initialize` do MCP, com throttle de 10 minutos (guiaflow-cloud PR #96, ainda não no ar). Por isso **Verificar conexão** avisa que o aplicativo precisa ter aberto e usado o GuiaFlow ao menos uma vez, e que a atualização pode levar até 10 minutos.

```json
{
  "mcpClients": [
    {
      "product": "cursor",
      "displayName": "Cursor",
      "lastSeenAt": "2026-11-09T12:00:00.000Z",
      "via": "oauth"
    }
  ]
}
```

`product` é `claude`, `claude-code`, `chatgpt`, `codex`, `cursor`, `vscode`, `windsurf`, `gemini-cli` ou `other`. `via` é `oauth` ou `api_key`. Uma linha por produto. `other` usa o `displayName` cru e pode repetir, um cartão por nome. O selo é «Conectado · usado há X» quando há `lastSeenAt`.

Quem já tem um cliente cai no prompt desse, com **Trocar de agente**.

## Textos de interface

Chaves novas em `js/i18n.js`. O cartão e o diálogo usam estas.

| Chave | pt-BR | en | es |
| --- | --- | --- | --- |
| `agentConnect.card` | Criar com meu agente de IA | Create with my AI agent | Crear con mi agente de IA |
| `agentConnect.cardHint` | Conecte Claude, Cursor e outros. O tour aparece aqui. | Connect Claude, Cursor, and others. The tour shows up here. | Conecta Claude, Cursor y otros. El tour aparece aquí. |
| `agentConnect.title` | Conecte seu agente | Connect your agent | Conecta tu agente |
| `agentConnect.lead` | Escolha o aplicativo. Na primeira chamada você entra no GuiaFlow e autoriza. | Pick the app. On the first call you sign in to GuiaFlow and allow access. | Elige la aplicación. En la primera llamada entras en GuiaFlow y autorizas. |
| `agentConnect.connected` | Conectado | Connected | Conectado |
| `agentConnect.waiting` | Aguardando login | Waiting for sign-in | Esperando el acceso |
| `agentConnect.notConnected` | Não conectado | Not connected | No conectado |
| `agentConnect.pro` | A API e o MCP fazem parte do plano Pro. | The API and MCP are part of the Pro plan. | La API y el MCP forman parte del plan Pro. |
| `agentConnect.open` | Abrir | Open | Abrir |
| `agentConnect.copy` | Copiar | Copy | Copiar |
| `agentConnect.copied` | Copiado. | Copied. | Copiado. |
| `agentConnect.thenLogin` | Na primeira chamada o aplicativo abre o login do GuiaFlow. | On the first call the app opens the GuiaFlow sign-in. | En la primera llamada la aplicación abre el acceso de GuiaFlow. |
| `agentConnect.promptTitle` | Peça o primeiro tour | Ask for the first tour | Pide el primer tour |
| `agentConnect.promptGallery` | Versão galeria de fotos | Photo gallery version | Versión galería de fotos |
| `agentConnect.switch` | Trocar de agente | Switch agent | Cambiar de agente |
| `agentConnect.history` | Você já tem um tour criado por agente. | You already have a tour created by an agent. | Ya tienes un tour creado por un agente. |
| `agentConnect.keys` | Chaves e apps conectados | API keys and connected apps | Claves y apps conectadas |
| `agentConnect.newProject` | Prefere o seu agente? Conecte Claude, Cursor e outros. | Rather use your agent? Connect Claude, Cursor, and others. | ¿Prefieres tu agente? Conecta Claude, Cursor y otros. |

Os prompts da seção anterior são as chaves `agentConnect.prompt.guided` e `agentConnect.prompt.gallery` em cada idioma.

## Fora deste assistente

- Não criar chave `gf_live_` automaticamente.
- Não tratar o Smithery como passo do assistente. O selo em /integracoes pode continuar.
- Não mover o modo de exibição para este fluxo. Guia ou galeria já se escolhe em Novo projeto e o agente recebe `template` em `create_tour`.
- Atualizar o texto antigo do ChatGPT em /integracoes só quando o assistente for implementado, no mesmo PR da interface, para os dois não divergirem.
