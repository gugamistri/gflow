# @guiaflow/tour-schema

Formato do tour do GuiaFlow em JS puro (sem DOM), usado pelo editor, pelo player e pela API pública (guiaflow-cloud).

| Arquivo | O quê |
|---|---|
| `geometry.js` | destaque (`hotspot`, % da imagem) e clique simulado preso ao destaque |
| `fixedSteps.js`, `phoneCountries.js` | passo inicial (captura de lead) e final (CTAs, WhatsApp E.164) |
| `scenes.js` | cenas (blocos de passos) |
| `theme.js` | temas prontos e cópia de tema |
| `agent.js` | entrada de agentes/API: coordenadas 0..1, erros legíveis por LLM, checagem antes de publicar |

A fonte é este diretório. O guiaflow-cloud guarda uma cópia em `packages/tour-schema/` (`npm run sync:tour-schema`); um teste lá confere que a cópia bate com o commit anotado em `SOURCE`.
