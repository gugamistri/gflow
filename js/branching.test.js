import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  branchingEditorOptionsHtml,
  isBranchingStep,
  normalizeBranching,
  renderBranchingHtml,
  resolveBranchTarget,
  sceneChoicesHtml,
} from "./branching.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const SCENE_PAYLOAD = "<img src=x onerror=alert(1)>";

/** Nomes de tags reais no HTML (entidades tipo &lt;img não entram). */
function tagNames(html) {
  return [...String(html).matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)/g)].map((m) => m[1].toLowerCase());
}

function editorLabels(scenes) {
  return {
    optionHeading: (n) => `Opção ${n}`,
    optionTitle: "Título",
    optionDesc: "Descrição",
    goToScene: "Ir para a cena",
    removeOption: "Remover opção",
    sceneChoices: (selected) => sceneChoicesHtml(scenes, selected),
  };
}

test("isBranchingStep: valida presença de branching com ao menos 2 opções", () => {
  assert.equal(isBranchingStep(null), false);
  assert.equal(isBranchingStep({}), false);
  assert.equal(isBranchingStep({ branching: { options: [] } }), false);
  assert.equal(isBranchingStep({ branching: { options: [{ title: "A" }] } }), false);
  assert.equal(
    isBranchingStep({
      branching: {
        options: [{ title: "A" }, { title: "B" }],
      },
    }),
    true
  );
});

test("normalizeBranching: impõe limite de 3 opções e sanitiza campos", () => {
  const raw = {
    title: " Escolha o fluxo ",
    subtitle: " Detalhes ",
    options: [
      { title: " Op 1 ", description: " Desc 1 ", targetScene: 2 },
      { label: " Op 2 ", targetScene: "3" },
      { title: " Op 3 ", targetStepIndex: 5 },
      { title: " Op 4 (excesso) " },
    ],
  };

  const norm = normalizeBranching(raw);
  assert.equal(norm.title, "Escolha o fluxo");
  assert.equal(norm.subtitle, "Detalhes");
  assert.equal(norm.options.length, 3, "corta a 4ª opção por regra de produto");
  assert.deepEqual(norm.options[0], {
    title: "Op 1",
    description: "Desc 1",
    targetScene: 2,
  });
  assert.deepEqual(norm.options[1], {
    title: "Op 2",
    description: "",
    targetScene: 3,
  });
  assert.deepEqual(norm.options[2], {
    title: "Op 3",
    description: "",
    targetScene: null,
    targetStepIndex: 5,
  });
});

test("resolveBranchTarget: localiza o primeiro passo da cena de destino", () => {
  const demo = {
    steps: [
      { id: "s1", scene: 1 },
      { id: "s2", scene: 1 },
      { id: "s3", scene: 2 },
      { id: "s4", scene: 2 },
      { id: "s5", scene: 3 },
    ],
  };

  assert.equal(resolveBranchTarget({ targetScene: 2 }, demo), 2);
  assert.equal(resolveBranchTarget({ targetScene: 3 }, demo), 4);
  assert.equal(resolveBranchTarget({ targetScene: 99 }, demo), 0, "fallback para o início");
  assert.equal(resolveBranchTarget({ targetStepIndex: 3 }, demo), 3);
});

test("renderBranchingHtml: escapa HTML e inclui setas com estrutura acessível", () => {
  const html = renderBranchingHtml({
    title: "Deseja ver <script>alert(1)</script>?",
    subtitle: "Clique abaixo",
    options: [
      { title: "Ver Imóvel", description: "Fotos e plantas", targetScene: 1 },
      { title: "Ver Lazer", description: "Piscina e academia", targetScene: 2 },
    ],
  });

  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('class="gf-branch-card"'));
  assert.ok(html.includes('class="gf-branch-btn"'));
  assert.ok(html.includes('data-branch-idx="0"'));
  assert.ok(html.includes('data-branch-idx="1"'));
});

test("sceneChoicesHtml: o nome da cena aparece como texto e não vira elemento", () => {
  const html = sceneChoicesHtml(
    [
      { n: 1, label: "Início" },
      { n: 2, label: SCENE_PAYLOAD },
    ],
    2
  );
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "o payload sai escapado");
  assert.equal(html.includes("<img"), false, "não abre uma tag img");
  assert.deepEqual(tagNames(html), ["option", "option"]);
  assert.match(html, /<option value="2" selected>&lt;img src=x onerror=alert\(1\)&gt;<\/option>/);
  assert.match(html, /<option value="1">Início<\/option>/);
});

test("branchingEditorOptionsHtml: título e descrição no value saem com escape completo", () => {
  const scenes = [
    { n: 1, label: SCENE_PAYLOAD },
    { n: 2, label: "Lazer" },
  ];
  const html = branchingEditorOptionsHtml(
    [
      { title: SCENE_PAYLOAD, description: '"><img src=x onerror=alert(1)>', targetScene: 1 },
      { title: "Ver Lazer", description: 'fotos & "plantas"', targetScene: 2 },
    ],
    editorLabels(scenes)
  );
  assert.equal(html.includes("<img"), false, "payloads não viram elemento");
  assert.ok(html.includes('value="&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(html.includes('value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(html.includes("fotos &amp; &quot;plantas&quot;"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;</option>"));
  assert.deepEqual(
    [...new Set(tagNames(html))].sort(),
    ["div", "input", "label", "option", "select", "span", "strong"].sort()
  );
});

test("editor.js monta o painel Caminhos pelas funções que escapam", () => {
  const src = read("./editor.js");
  assert.match(src, /sceneChoicesHtml\(/);
  assert.match(src, /branchingEditorOptionsHtml\(/);
  assert.doesNotMatch(src, /\$\{label\}<\/option>/);
  assert.doesNotMatch(src, /opt\.title \|\| ""\)\.replace\(\/"\/g/);
  assert.doesNotMatch(src, /opt\.description \|\| ""\)\.replace\(\/"\/g/);
});

