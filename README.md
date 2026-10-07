# GuiaFlow

![Editor do GuiaFlow](docs/editor.png)

![Tour de exemplo](docs/tour.gif)

Editor e player de tours com capturas de tela, destaque, clique simulado e narração. Inclui uma extensão Chrome para gravar o produto e um app desktop (Electron) com captura embutida.

A interface está em português, espanhol e inglês. O idioma segue o do navegador; se não for um desses três, cai em inglês. No editor, o seletor fica na barra superior (PT, ES, EN). Na extensão, o mesmo seletor fica no popup e vale também para a barra de captura na página.

## Começar no navegador

```bash
npm start
```

Abre em `http://localhost:4173`. O editor publicado é [https://guiaflow.pro](https://guiaflow.pro). O endereço antigo `https://guiaflow-seven.vercel.app` redireciona para lá, com o mesmo caminho e a mesma query. Na primeira visita a biblioteca recebe o projeto **Como usar o Guia**.

### Extensão de captura

Instale pela [Chrome Web Store](https://chromewebstore.google.com/detail/guiaflow-%E2%80%94-captura/bogjjfmcceccnepkpijiohglllbgbofd). O manual está em [`ajuda.html`](ajuda.html).

Para desenvolver a extensão localmente:

1. `npm run pack:extension` (ou carregue a pasta `extension/`)
2. Em `chrome://extensions`, ative o modo do desenvolvedor e carregue a pasta da extensão
3. No popup, o campo Editor deve ser a mesma origem do site (`https://guiaflow.pro`, ou `http://localhost:4173` no desenvolvimento). Depois de atualizar a extensão, recarregue o card em `chrome://extensions`.
4. No popup, escolha PT, ES ou EN se quiser um idioma diferente do navegador
5. Inicie a captura na aba do produto, fotografe, marque o clique e crie o projeto

## App desktop

```bash
npm install
npm run desktop
```

Gera a pasta de distribuição local (sem assinatura):

```bash
npm run dist:desktop
```

No desktop, use **Capturar** no editor: abre uma janela com a página do produto, fotografa e monta o projeto. No navegador continue com a extensão.

## Exportar

- **HTML navegável** — um arquivo único com o tour
- **Vídeo MP4** — frames do tour via WebCodecs; se o encoder não existir, cai em `MediaRecorder` (pode sair WebM)
- **Preview temporário** — no menu Compartilhar; publica um endereço curto `/v/…` só para ver o tour, por 7 dias (requer Blob na Vercel)
- **Link permanente** — no mesmo menu, quando a nuvem está configurada (`https://guiaflow.pro` no app publicado). Pede sessão por link mágico e devolve `https://guiaflow.pro/v/…`

## Testes

```bash
node --test extension/lib/*.test.js scripts/*.test.js
```

## Cloud

O editor e o player deste repositório continuam MIT e gratuitos. IA e narração seguem com a sua própria chave. O GuiaFlow Cloud é um companheiro privado opcional, noutro código. Sem URL base, nada é chamado. Com URL base, o editor só publica o link permanente. Detalhes em [`docs/CLOUD.md`](docs/CLOUD.md).

## Licença

MIT — ver [`LICENSE`](LICENSE).

### Terceiros

- [driver.js](https://github.com/kamranahmedse/driver.js) 1.3.6 — MIT © Kamran Ahmed (`vendor/driver/`)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) — MIT (`vendor/mp4-muxer/`)
- O build Electron inclui Chromium; o empacotador gera os avisos em `LICENSES.chromium.html` na pasta de saída

Este repositório não empacota ffmpeg nem libx264.
