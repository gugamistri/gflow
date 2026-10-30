# @guiaflow/tour-schema

GuiaFlow's tour format in plain JS (no DOM), used by the editor, the player, and the public API (guiaflow-cloud).

| File | What |
|---|---|
| `geometry.js` | highlight (`hotspot`, % of the image) and simulated click anchored to the highlight |
| `fixedSteps.js`, `phoneCountries.js` | start step (lead capture) and end step (CTAs, WhatsApp E.164); sticky WhatsApp button during the tour (`playback.stickyWhatsAppFromStep`) |
| `scenes.js` | scenes (groups of steps) |
| `theme.js` | ready-made themes and theme copy |
| `video.js` | optional `step.video` (YouTube/Vimeo link only): URL parsing, embed/watch URLs, poster sources, progress milestones |
| `richText.js` | light text formatting stored as markers, never HTML: `**bold**`, `*italic*`, `++underline++`, `- ` list lines (one level). Parser, DOM render (createElement only), `richTextHtml` for driver.js (escaped segments), `stripRichText` for TTS/captions/AI/alt/canvas, `normalizeRichText` for AI/agent input, toolbar edit helpers |
| `playbackMode.js` | display mode `playback.mode`: `"guided"` (default: balloons, highlights, autoplay, narration) or `"gallery"` (full-screen photo carousel for real estate) |
| `agent.js` | agent/API input: 0..1 coordinates, `video` (YouTube/Vimeo URL or null), LLM-readable errors, pre-publish checks |

This directory is the source. guiaflow-cloud keeps a copy in `packages/tour-schema/` (`npm run sync:tour-schema`); a test there checks that the copy matches the commit recorded in `SOURCE`.

## Sticky WhatsApp button (`playback.stickyWhatsAppFromStep`)

Optional integer, 1 = first tour step. From that step on, the player shows a fixed "WhatsApp" button that uses the end step's
number, message and label (`endStep.whatsapp`), so it only appears when the end step is on and the number is valid.
Absent, `0` or invalid = off (old behavior). It lives in `playback` (not in `endStep`) on purpose: `playback` travels as a
whole object through the editor payload, project sync, collaboration and the Cloud share snapshot, while `normalizeEndStep`
rebuilds `endStep` field by field and would drop an unknown key. Tours without the field keep the same share hash.

## Light text formatting (`richText.js`)

Applies to the balloon text (`popover.description`), slide body and start/end card `body`. Titles, labels, narration and
alt stay plain text. Rules that keep old tours unchanged: an unmatched marker is literal (`*Imagens ilustrativas`),
`*` next to a letter or digit never opens or closes italic (`5*10*2`), markers do not cross lines and need non-space text
right inside, and `\*`, `\+`, `\-`, `\\` are literal. Text without markers renders exactly like before (escaped, `\n` → `<br>`).
The offline HTML player has an inline copy (`node scripts/sync-rich-text.mjs` in gflow; `js/richText.test.js` checks it).

## Display mode (`playback.mode`)

`"guided"` (default, also when absent or unknown) or `"gallery"`. Gallery is a full-screen photo carousel: counter "N of M",
one-line caption (title, or the text without markers) with "Details" for the formatted text, pinch/double-tap zoom,
section chips from named scenes (`sceneLabels`, shown with 2+ sections), thumbnails, video steps as a click-to-load facade
and text slides as cards. No balloons, highlights, simulated click, autoplay or narration. Start step (lead capture), sticky
WhatsApp button (`playback.stickyWhatsAppFromStep`) and end step keep working, and every photo shown still reports a step view.
`setPlaybackMode(playback, "guided")` deletes the field, so guided tours keep the same share hash. Same reason as the sticky
button for living in `playback`. The offline HTML player has an inline copy of the gallery (`node scripts/sync-gallery.mjs`).
