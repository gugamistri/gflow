/**
 * Campo de telefone internacional do editor: botão de país (bandeira + DDI) com busca
 * e número nacional com formatação leve. Sem biblioteca: lista embutida em phoneCountries.js.
 */
import {
  countryByIso,
  countryOptions,
  filterCountries,
  flagEmoji,
  formatNational,
  nationalDigits,
  parseE164,
  validatePhone,
} from "./phoneCountries.js";

/** Mensagem do erro de telefone (vazio, tamanho do país, DDD do Brasil). */
export function phoneErrorText(result, countryName, t, { emptyKey = "fixed.errPhoneEmpty", fallbackKey = "fixed.errPhone" } = {}) {
  if (result.error === "empty") return t(emptyKey);
  if (result.error === "ddd") return t("fixed.errPhoneDdd");
  if (result.error === "length" && result.min) {
    const digits = result.min === result.max ? String(result.min) : `${result.min}–${result.max}`;
    return t("fixed.errPhoneLength", { country: countryName, digits });
  }
  return t(fallbackKey);
}

/**
 * els: { button, flag, dial, input, pop, search, list, empty }
 * opts: { locale(), defaultIso(), onChange(), t(key) }
 */
export function createPhoneField(els, opts) {
  let iso = opts.defaultIso();
  let options = [];
  let active = -1;

  function country() {
    return countryByIso(iso) || countryByIso("BR");
  }

  function paintButton() {
    const c = country();
    els.flag.textContent = flagEmoji(c.iso);
    els.dial.textContent = `+${c.dial}`;
    const name = options.find((o) => o.iso === c.iso)?.name || c.iso;
    els.button.setAttribute("aria-label", `${opts.t("fixed.end.waCountry")}: ${name} +${c.dial}`);
    els.button.title = `${name} +${c.dial}`;
    els.input.placeholder = c.dial === "55" ? "(11) 99999-8888" : c.dial === "1" ? "(415) 555-0100" : "";
  }

  function renderList() {
    const query = els.search.value;
    const shown = filterCountries(options, query);
    els.list.replaceChildren(
      ...shown.map((c, i) => {
        const li = document.createElement("li");
        li.id = `${els.list.id}-${c.iso}`;
        li.setAttribute("role", "option");
        li.dataset.iso = c.iso;
        li.className = "wa-cc-option";
        li.setAttribute("aria-selected", String(c.iso === iso));
        const flag = document.createElement("span");
        flag.className = "wa-cc-option-flag";
        flag.textContent = c.flag;
        flag.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "wa-cc-option-name";
        name.textContent = c.name;
        const dial = document.createElement("span");
        dial.className = "wa-cc-option-dial";
        dial.textContent = `+${c.dial}`;
        li.append(flag, name, dial);
        if (i === active) li.classList.add("is-active");
        return li;
      })
    );
    els.empty.hidden = shown.length > 0;
    const current = els.list.children[active];
    if (current) {
      els.search.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else {
      els.search.removeAttribute("aria-activedescendant");
    }
    return shown;
  }

  function open() {
    options = countryOptions(opts.locale());
    els.pop.hidden = false;
    opts.onOpen?.();
    els.button.setAttribute("aria-expanded", "true");
    els.search.value = "";
    active = Math.max(0, options.findIndex((o) => o.iso === iso));
    renderList();
    els.search.focus();
  }

  function close({ focus = true } = {}) {
    if (els.pop.hidden) return;
    els.pop.hidden = true;
    els.button.setAttribute("aria-expanded", "false");
    if (focus) els.button.focus();
  }

  function choose(nextIso) {
    if (!countryByIso(nextIso)) return;
    iso = nextIso;
    paintButton();
    reformat();
    close({ focus: false });
    els.input.focus();
    opts.onChange();
  }

  function reformat() {
    const atEnd = els.input.selectionStart === els.input.value.length;
    const formatted = formatNational(country().dial, nationalDigits(els.input.value, country().dial));
    if (atEnd && formatted !== els.input.value) els.input.value = formatted;
  }

  els.button.addEventListener("click", () => (els.pop.hidden ? open() : close()));
  els.search.addEventListener("input", () => {
    active = 0;
    renderList();
  });
  els.search.addEventListener("keydown", (e) => {
    const shown = filterCountries(options, els.search.value);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = Math.min(shown.length - 1, Math.max(0, active + step));
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active].iso);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  els.list.addEventListener("click", (e) => {
    const li = e.target.closest?.("[data-iso]");
    if (li) choose(li.dataset.iso);
  });
  els.pop.addEventListener("focusout", (e) => {
    if (!els.pop.contains(e.relatedTarget) && e.relatedTarget !== els.button) close({ focus: false });
  });
  els.input.addEventListener("input", () => {
    const raw = els.input.value.trim();
    // why: colar "+55 11 …" ou "+1 …" escolhe o país sozinho
    if (/^(\+|00)/.test(raw)) {
      // why: enquanto digita "+351 9…" o texto fica como está; com o DDI e 4+ dígitos troca o país
      const parsed = parseE164(raw.replace(/^00/, ""));
      if (parsed && parsed.national.length >= 4) {
        iso = parsed.iso;
        paintButton();
        els.input.value = formatNational(parsed.dial, parsed.national);
      }
    } else {
      reformat();
    }
    opts.onChange();
  });

  return {
    /** { iso, dial, national, ok, error, digits, min, max } */
    read() {
      const raw = els.input.value.trim();
      const typed = /^(\+|00)/.test(raw) ? parseE164(raw.replace(/^00/, "")) : null;
      if (typed) return { iso: typed.iso, dial: typed.dial, national: typed.national, ...validatePhone(typed.dial, typed.national) };
      const c = country();
      const national = nationalDigits(els.input.value, c.dial);
      return { iso: c.iso, dial: c.dial, national, ...validatePhone(c.dial, national) };
    },
    /** Preenche com um número salvo (E.164 só com dígitos) ou só o país padrão. */
    fill(parsed) {
      options = countryOptions(opts.locale());
      iso = parsed?.iso || opts.defaultIso();
      els.input.value = parsed ? formatNational(parsed.dial, parsed.national) : "";
      paintButton();
      close({ focus: false });
    },
    /** País escolhido no botão: { iso, dial }. */
    country: () => ({ iso: country().iso, dial: country().dial }),
    countryName() {
      const c = country();
      return options.find((o) => o.iso === c.iso)?.name || c.iso;
    },
    close,
  };
}
