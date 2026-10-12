function sceneNumber(step) {
  const n = Number(step?.scene);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function sceneBlocks(steps) {
  const blocks = [];
  for (const step of steps || []) {
    const scene = sceneNumber(step);
    const last = blocks[blocks.length - 1];
    if (!last || last.scene !== scene) blocks.push({ scene, steps: [step] });
    else last.steps.push(step);
  }
  return blocks;
}

function labelText(labels, scene) {
  const raw = labels?.[scene] ?? labels?.[String(scene)] ?? "";
  return String(raw || "").trim();
}

export function renumberScenes(demo) {
  if (!demo) return false;
  const steps = Array.isArray(demo.steps) ? demo.steps : [];
  const labels = demo.sceneLabels && typeof demo.sceneLabels === "object" ? demo.sceneLabels : {};
  const beforeScenes = steps.map((step) => sceneNumber(step)).join(",");
  const beforeLabels = JSON.stringify(compactLabels(labels));
  const blocks = sceneBlocks(steps);
  const nextLabels = {};
  blocks.forEach((block, index) => {
    const n = index + 1;
    const name = labelText(labels, block.scene);
    if (name) nextLabels[String(n)] = name;
    for (const step of block.steps) step.scene = n;
  });

  const afterScenes = steps.map((step) => step.scene).join(",");
  demo.sceneLabels = nextLabels;
  return beforeScenes !== afterScenes || beforeLabels !== JSON.stringify(nextLabels);
}

function compactLabels(labels) {
  const out = {};
  Object.keys(labels || {}).forEach((key) => {
    const n = Number(key);
    if (!Number.isFinite(n) || n <= 0) return;
    const text = String(labels[key] || "").trim();
    if (text) out[String(n)] = text;
  });
  return out;
}

export function moveScene(demo, fromScene, toScene, place) {
  const from = Number(fromScene);
  const to = Number(toScene);
  if (!demo || !Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  const blocks = sceneBlocks(demo.steps);
  const fromIdx = blocks.findIndex((block) => block.scene === from);
  if (fromIdx < 0 || !blocks.some((block) => block.scene === to)) return false;
  const [block] = blocks.splice(fromIdx, 1);
  const toIdx = blocks.findIndex((item) => item.scene === to);
  const insertAt = place === "after" ? toIdx + 1 : toIdx;
  blocks.splice(insertAt, 0, block);
  demo.steps = blocks.flatMap((item) => item.steps);
  renumberScenes(demo);
  return true;
}

export function insertSceneAfter(demo, afterScene, step, name) {
  if (!demo || !step) return -1;
  if (!Array.isArray(demo.steps)) demo.steps = [];
  const blocks = sceneBlocks(demo.steps);
  const used = blocks.map((block) => block.scene);
  const temp = Math.max(0, ...used, 0) + 1;
  step.scene = temp;
  if (!demo.sceneLabels || typeof demo.sceneLabels !== "object") demo.sceneLabels = {};
  const title = String(name || "").trim();
  if (title) demo.sceneLabels[String(temp)] = title;

  let index = demo.steps.length;
  const after = Number(afterScene);
  if (Number.isFinite(after) && after > 0) {
    const block = blocks.find((item) => item.scene === after);
    if (block) {
      const last = block.steps[block.steps.length - 1];
      index = demo.steps.indexOf(last) + 1;
    }
  }
  demo.steps.splice(index, 0, step);
  renumberScenes(demo);
  return demo.steps.indexOf(step);
}
