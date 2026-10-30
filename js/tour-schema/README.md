# @guiaflow/tour-schema

GuiaFlow's tour format in plain JS (no DOM), used by the editor, the player, and the public API (guiaflow-cloud).

| File | What |
|---|---|
| `geometry.js` | highlight (`hotspot`, % of the image) and simulated click anchored to the highlight |
| `fixedSteps.js`, `phoneCountries.js` | start step (lead capture) and end step (CTAs, WhatsApp E.164); sticky WhatsApp button during the tour (`playback.stickyWhatsAppFromStep`) |
| `scenes.js` | scenes (groups of steps) |
| `theme.js` | ready-made themes and theme copy |
| `video.js` | optional `step.video` (YouTube/Vimeo link only): URL parsing, embed/watch URLs, poster sources, progress milestones |
| `agent.js` | agent/API input: 0..1 coordinates, `video` (YouTube/Vimeo URL or null), LLM-readable errors, pre-publish checks |

This directory is the source. guiaflow-cloud keeps a copy in `packages/tour-schema/` (`npm run sync:tour-schema`); a test there checks that the copy matches the commit recorded in `SOURCE`.

## Sticky WhatsApp button (`playback.stickyWhatsAppFromStep`)

Optional integer, 1 = first tour step. From that step on, the player shows a fixed "WhatsApp" button that uses the end step's
number, message and label (`endStep.whatsapp`), so it only appears when the end step is on and the number is valid.
Absent, `0` or invalid = off (old behavior). It lives in `playback` (not in `endStep`) on purpose: `playback` travels as a
whole object through the editor payload, project sync, collaboration and the Cloud share snapshot, while `normalizeEndStep`
rebuilds `endStep` field by field and would drop an unknown key. Tours without the field keep the same share hash.
