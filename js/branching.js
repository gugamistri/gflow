/**
 * Micro-branching (Escolha de caminhos por Cenas).
 * Permite que um passo/slide apresente opções elegantes (2 a 3 botões)
 * para direcionar o visitante a capítulos específicos do tour sem teias de fluxo.
 */

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Confere se um passo possui configuração válida de branching.
 * @param {object|null|undefined} step
 * @returns {boolean}
 */
export function isBranchingStep(step) {
  if (!step || typeof step !== "object") return false;
  const b = step.branching;
  if (!b || typeof b !== "object") return false;
  return Array.isArray(b.options) && b.options.length >= 2;
}

/**
 * Normaliza os dados de branching respeitando limites de produto (2 a no máx 3 opções).
 * @param {object|null|undefined} raw
 * @returns {{ title: string, subtitle: string, options: Array<{ title: string, description: string, targetScene: number|null, targetStepIndex?: number|null }> }}
 */
export function normalizeBranching(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      title: "O que você gostaria de ver primeiro?",
      subtitle: "",
      options: [],
    };
  }

  const title = String(raw.title || "O que você gostaria de ver primeiro?").trim();
  const subtitle = String(raw.subtitle || "").trim();

  const options = (Array.isArray(raw.options) ? raw.options : [])
    .slice(0, 3) // limite de produto: no máximo 3 opções
    .map((opt, idx) => {
      const optTitle = String(opt?.title || opt?.label || `Opção ${idx + 1}`).trim();
      const desc = String(opt?.description || "").trim();
      const sceneNum = Number(opt?.targetScene);
      const targetScene = Number.isFinite(sceneNum) && sceneNum > 0 ? sceneNum : null;
      const stepIdx = Number(opt?.targetStepIndex);
      const targetStepIndex = Number.isFinite(stepIdx) && stepIdx >= 0 ? stepIdx : null;
      return {
        title: optTitle,
        description: desc,
        targetScene,
        ...(targetStepIndex !== null ? { targetStepIndex } : {}),
      };
    });

  return { title, subtitle, options };
}

/**
 * Encontra o índice do primeiro passo de uma cena no demo.
 * @param {object} option
 * @param {object} demo
 * @returns {number} índice do passo no array demo.steps (0 se não encontrado)
 */
export function resolveBranchTarget(option, demo) {
  if (!demo || !Array.isArray(demo.steps) || demo.steps.length === 0) return 0;
  
  if (option && Number.isFinite(option.targetScene) && option.targetScene > 0) {
    const idx = demo.steps.findIndex((s) => Number(s.scene) === Number(option.targetScene));
    if (idx >= 0) return idx;
  }

  if (option && Number.isFinite(option.targetStepIndex) && option.targetStepIndex >= 0) {
    const idx = Math.min(demo.steps.length - 1, Math.max(0, Math.floor(option.targetStepIndex)));
    return idx;
  }

  return 0;
}

/**
 * Renderiza o HTML do card modal de branching.
 * @param {object} branching
 * @returns {string} HTML seguro
 */
export function renderBranchingHtml(branching) {
  const norm = normalizeBranching(branching);
  const subtitleHtml = norm.subtitle
    ? `<p class="gf-branch-subtitle">${escapeHtml(norm.subtitle)}</p>`
    : "";

  const optionsHtml = norm.options
    .map(
      (opt, idx) => `
    <button type="button" class="gf-branch-btn" data-branch-idx="${idx}">
      <div class="gf-branch-btn-text">
        <span class="gf-branch-btn-title">${escapeHtml(opt.title)}</span>
        ${opt.description ? `<span class="gf-branch-btn-desc">${escapeHtml(opt.description)}</span>` : ""}
      </div>
      <svg class="gf-branch-arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 10h12M11 5l5 5-5 5"/>
      </svg>
    </button>
  `
    )
    .join("");

  return `
    <div class="gf-branch-card" role="dialog" aria-modal="true" aria-labelledby="gf-branch-title">
      <div class="gf-branch-header">
        <h2 class="gf-branch-title" id="gf-branch-title">${escapeHtml(norm.title)}</h2>
        ${subtitleHtml}
      </div>
      <div class="gf-branch-options" role="group" aria-label="${escapeHtml(norm.title)}">
        ${optionsHtml}
      </div>
    </div>
  `.trim();
}
