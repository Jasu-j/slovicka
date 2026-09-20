// Hlavní obrazovka: seznam uložených slov + vstup a tlačítka překladu.

import { el, createDot, createHeader, showToast, reportError, setToastOffset } from "./ui.js";
import { getWords, addWord, findByEn, findByCs } from "./storage.js";
import { translate, normalizeInput, TranslateError } from "./translate.js";

const HIGHLIGHT_MS = 1500;

export function mount(root) {
  let active = true;
  let highlightTimer = null;

  const list = el("div", { class: "word-list-wrap", tabindex: "-1" });

  const status = el("p", { class: "status", role: "status", hidden: true });
  const input = el("input", {
    class: "text-input",
    type: "text",
    placeholder: "Přelož slovo…",
    "aria-label": "Slovo k překladu",
    autocapitalize: "none",
    autocomplete: "off",
    autocorrect: "off",
    spellcheck: "false",
  });
  // Enter záměrně nedělá nic, aby nebylo nejasné, který směr se použije.
  const btnCsEn = el("button", { class: "btn btn--primary", type: "button", onclick: () => run("cs-en") }, "CZ→EN");
  const btnEnCs = el("button", { class: "btn btn--primary", type: "button", onclick: () => run("en-cs") }, "EN→CZ");
  const composer = el(
    "div",
    { class: "composer" },
    status,
    input,
    el("div", { class: "composer-buttons" }, btnCsEn, btnEnCs)
  );

  root.replaceChildren(el("div", { class: "screen" }, createHeader("Translate"), list, composer));

  // Toasty mají být nad vstupem, i když se jeho výška změní (klávesnice, otočení).
  const observer = new ResizeObserver(() => setToastOffset(composer.offsetHeight + 8));
  observer.observe(composer);

  input.addEventListener("input", () => {
    if (!input.disabled) showStatus("");
  });

  renderList();

  // ---------- vykreslení ----------

  function renderList() {
    const words = getWords();
    if (words.length === 0) {
      list.replaceChildren(
        el("p", { class: "empty" }, "Zatím nemáš žádná slovíčka. Napiš slovo dole a zvol směr překladu.")
      );
      return;
    }
    list.replaceChildren(
      el(
        "ul",
        { class: "word-list" },
        words.map((w) =>
          el(
            "li",
            { class: "word-row", dataset: { id: w.id } },
            el("span", { class: "word-text" }, el("span", { class: "en" }, w.en), " – ", el("span", { class: "cs" }, w.cs)),
            createDot(w.streak)
          )
        )
      )
    );
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("status--error", isError);
  }

  function setBusy(busy) {
    input.disabled = busy;
    btnCsEn.disabled = busy;
    btnEnCs.disabled = busy;
  }

  function highlight(id) {
    const row = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Řádek zůstává na svém místě; odscrolluje se na něj jen když není vidět.
    row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    clearTimeout(highlightTimer);
    list.querySelectorAll(".word-row--highlight").forEach((r) => r.classList.remove("word-row--highlight"));
    row.classList.add("word-row--highlight");
    highlightTimer = setTimeout(() => row.classList.remove("word-row--highlight"), HIGHLIGHT_MS);
  }

  // ---------- překlad ----------

  async function run(direction) {
    let text;
    try {
      text = normalizeInput(input.value); // prázdný nebo příliš dlouhý vstup se vůbec neodešle
    } catch (err) {
      showStatus(err.message, true);
      input.focus();
      return;
    }

    setBusy(true);
    showStatus("Překládám…");

    try {
      // Nejdřív lokální knihovna: šetří denní limit API.
      const local = direction === "en-cs" ? findByEn(text) : findByCs(text);
      let en;
      let cs;
      if (local) {
        ({ en, cs } = local);
      } else {
        const result = await translate(text, direction);
        [en, cs] = direction === "en-cs" ? [text, result] : [result, text];
      }

      const { status: outcome, word } = addWord({ en, cs });

      if (outcome === "duplicate") showToast("Už máš uloženo");
      if (active) {
        showStatus("");
        input.value = "";
        renderList();
        if (outcome === "added") list.scrollTop = 0;
        else highlight(word.id);
      }
    } catch (err) {
      if (active) {
        if (err instanceof TranslateError) showStatus(err.message, true);
        else {
          showStatus("");
          reportError(err);
        }
      }
    } finally {
      if (active) {
        setBusy(false);
        input.focus({ preventScroll: true });
      }
    }
  }

  return function unmount() {
    active = false;
    observer.disconnect();
    clearTimeout(highlightTimer);
    setToastOffset(null);
  };
}
