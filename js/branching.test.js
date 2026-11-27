import assert from "node:assert/strict";
import test from "node:test";
import {
  isBranchingStep,
  normalizeBranching,
  renderBranchingHtml,
  resolveBranchTarget,
} from "./branching.js";

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
