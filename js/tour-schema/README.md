# @guiaflow/tour-schema

GuiaFlow's tour format in plain JS (no DOM), used by the editor, the player, and the public API (guiaflow-cloud).

| File | What |
|---|---|
| `geometry.js` | highlight (`hotspot`, % of the image) and simulated click anchored to the highlight |
| `fixedSteps.js`, `phoneCountries.js` | start step (lead capture) and end step (CTAs, WhatsApp E.164) |
| `scenes.js` | scenes (groups of steps) |
| `theme.js` | ready-made themes and theme copy |
| `agent.js` | agent/API input: 0..1 coordinates, LLM-readable errors, pre-publish checks |

This directory is the source. guiaflow-cloud keeps a copy in `packages/tour-schema/` (`npm run sync:tour-schema`); a test there checks that the copy matches the commit recorded in `SOURCE`.
