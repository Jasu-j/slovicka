// Library: všechna slova abecedně podle angličtiny, vyhledávání, mazání a záloha.

import { el, createDot, createIcon, createHeader, showToast, reportError, pluralWords } from "./ui.js";
import { getWords, deleteWord, exportJson, importJson, normalizeText } from "./storage.js";

const collator = new Intl.Collator("en", { sensitivity: "base" });
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// Bez ohledu na velikost písmen a diakritiku: "JÁB" najde "jablko".
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `slovnicek-zaloha-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function mount(root) {
  const list = el("div", { class: "word-list-wrap", tabindex: "-1" });
  const count = el("p", { class: "count", role: "status" });
  const search = el("input", {
    class: "text-input search-input",
    type: "search",
    placeholder: "Hledat…",
    "aria-label": "Hledat slovo",
    autocapitalize: "none",
    autocomplete: "off",
    autocorrect: "off",
    spellcheck: "false",
    oninput: renderList,
  });

  const dialogStatus = el("p", { class: "status", role: "status", hidden: true });
  const fileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: true,
    onchange: onFileChosen,
  });
  const dialog = el(
    "dialog",
    {
      class: "dialog",
      "aria-labelledby": "backup-title",
      onclick: (e) => {
        if (e.target === dialog) dialog.close(); // klepnutí mimo panel
      },
    },
    el("h2", { id: "backup-title" }, "Záloha"),
    el(
      "p",
      { class: "dialog-text" },
      "Export uloží slovíčka do souboru. Import je přidá k těm stávajícím; nic nemaže a duplicity přeskočí."
    ),
    el(
      "div",
      { class: "dialog-actions" },
      el("button", { class: "btn btn--primary", type: "button", onclick: doExport }, "Exportovat"),
      el("button", { class: "btn btn--primary", type: "button", onclick: () => fileInput.click() }, "Importovat")
    ),
    dialogStatus,
    fileInput,
    el("button", { class: "btn", type: "button", onclick: () => dialog.close() }, "Zavřít")
  );

  const header = createHeader("Library", [
    el(
      "button",
      {
        class: "btn btn--small",
        type: "button",
        onclick: () => {
          setDialogStatus("");
          dialog.showModal();
        },
      },
      "Záloha"
    ),
  ]);

  root.replaceChildren(
    el(
      "div",
      { class: "screen" },
      header,
      el(
        "div",
        { class: "search-bar" },
        el("span", { class: "search-icon" }, createIcon("search")),
        search
      ),
      count,
      list,
      dialog
    )
  );

  renderList();

  // ---------- seznam ----------

  function renderList() {
    const all = getWords();
    const query = fold(normalizeText(search.value));

    if (all.length === 0) {
      count.textContent = "";
      list.replaceChildren(el("p", { class: "empty" }, "Knihovna je prázdná."));
      return;
    }

    const shown = all
      .filter((w) => !query || fold(w.en).includes(query) || fold(w.cs).includes(query))
      .sort((a, b) => collator.compare(a.en, b.en) || a.createdAt - b.createdAt);

    count.textContent = query
      ? `Zobrazeno ${shown.length} z ${all.length}`
      : `${all.length} ${pluralWords(all.length)}`;

    if (shown.length === 0) {
      list.replaceChildren(el("p", { class: "empty" }, "Nic nenalezeno."));
      return;
    }

    list.replaceChildren(
      el(
        "ul",
        { class: "word-list" },
        shown.map((w) =>
          el(
            "li",
            { class: "word-row" },
            el("span", { class: "word-text" }, el("span", { class: "en" }, w.en), " – ", el("span", { class: "cs" }, w.cs)),
            createDot(w.streak),
            el(
              "button",
              {
                class: "icon-btn",
                type: "button",
                "aria-label": `Smazat ${w.en} – ${w.cs}`,
                onclick: () => onDelete(w),
              },
              createIcon("trash")
            )
          )
        )
      )
    );
  }

  function onDelete(w) {
    if (!confirm(`Smazat „${w.en} – ${w.cs}“?`)) return;
    try {
      deleteWord(w.id);
    } catch (err) {
      reportError(err);
      return;
    }
    renderList();
    showToast("Smazáno");
  }

  // ---------- záloha ----------

  function setDialogStatus(message, isError = false) {
    dialogStatus.textContent = message;
    dialogStatus.hidden = !message;
    dialogStatus.classList.toggle("status--error", isError);
  }

  function doExport() {
    if (getWords().length === 0) {
      setDialogStatus("Knihovna je prázdná, není co exportovat.", true);
      return;
    }
    const name = backupFileName();
    const url = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
    const link = el("a", { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setDialogStatus(`Záloha vytvořena: ${name}`);
  }

  async function onFileChosen() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ""; // umožní vybrat stejný soubor znovu
    if (!file) return;

    try {
      if (file.size > MAX_IMPORT_BYTES) throw Object.assign(new Error("Soubor je příliš velký."), { code: "INVALID" });
      const { added, skipped } = importJson(await file.text());
      renderList();
      setDialogStatus(`Přidáno: ${added}, přeskočeno (už existují): ${skipped}.`);
    } catch (err) {
      const known = err && ["INVALID", "STORAGE"].includes(err.code);
      setDialogStatus(known ? err.message : "Soubor se nepodařilo přečíst. Nic se nezměnilo.", true);
    }
  }

  return function unmount() {
    if (dialog.open) dialog.close();
  };
}
