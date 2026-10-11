/**
 * Cartões dos passos fixos (início e fim) no player do /v e /p e na prévia do editor.
 * why: tudo com textContent e href validado em fixedSteps.js — nunca innerHTML com texto do autor.
 */
import { t } from "./i18n.js";
import { endStepActions, normalizeEndStep } from "./fixedSteps.js";

const WA_ICON =
  "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z";

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = textContent;
  return node;
}

function svgIcon(path) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}

export function cardShell(kind) {
  const card = el("div", `fixed-card fixed-card-${kind}`);
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "false");
  return card;
}

/**
 * Cartão final. opts: { tour, link, nome, contactForm, preview, onReplay, onContactForm, onAction }
 * Devolve o elemento (o chamador o coloca no palco).
 */
export function renderEndCard(rawStep, opts = {}) {
  const step = normalizeEndStep(rawStep);
  const card = cardShell("end");
  const title = el("h2", "fixed-card-title", step.title || t("fixed.end.defaultTitle"));
  title.id = `fixed-end-title-${opts.preview ? "preview" : "live"}`;
  card.setAttribute("aria-labelledby", title.id);
  card.append(title);
  const bodyText = step.body || t("fixed.end.defaultBody");
  if (bodyText) card.append(el("p", "fixed-card-body", bodyText));

  const actions = el("div", "fixed-card-actions");
  const list = endStepActions(step, {
    tour: opts.tour || "",
    link: opts.link || "",
    nome: opts.nome || "",
    contactForm: Boolean(opts.contactForm),
  });
  for (const action of list) {
    if (action.kind === "contact-form") {
      const btn = el("button", "btn fixed-card-btn fixed-card-contact");
      btn.type = "button";
      btn.textContent = action.label || t("fixed.end.contactLabel");
      btn.addEventListener("click", () => {
        opts.onAction?.(action);
        opts.onContactForm?.();
      });
      actions.append(btn);
      continue;
    }
    const a = el("a", `btn fixed-card-btn ${action.kind === "whatsapp" ? "fixed-card-wa" : "fixed-card-contact"}`);
    a.href = action.href;
    if (!action.href.startsWith("mailto:")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    if (action.kind === "whatsapp") a.append(svgIcon(WA_ICON));
    a.append(
      el(
        "span",
        "",
        action.label || (action.kind === "whatsapp" ? t("fixed.end.waLabel") : t("fixed.end.contactLabel"))
      )
    );
    a.addEventListener("click", (event) => {
      if (opts.preview) {
        event.preventDefault();
        return;
      }
      opts.onAction?.(action);
    });
    actions.append(a);
  }
  if (actions.childElementCount) card.append(actions);

  if (step.showReplay) {
    const replay = el("button", "fixed-card-replay");
    replay.type = "button";
    replay.textContent = `↺ ${t("view.replay")}`;
    replay.addEventListener("click", () => opts.onReplay?.());
    card.append(replay);
  }
  return card;
}
