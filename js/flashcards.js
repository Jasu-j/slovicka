// Flashcards: nastavení hry, procvičování kartiček (klepnutí = otočit, přejetí = hodnocení),
// pravidla tečky (streak) a vícekrokové „Zpět".

import { el, createIcon, createHeader, LEVELS, levelOf, pluralWords, reportError } from "./ui.js";
import { getWords, getWord, setStreak, getSettings, saveSettings } from "./storage.js";

const COUNT_OPTIONS = [
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: "all", label: "Všechna" },
];
const DIRECTION_OPTIONS = [
  { value: "cs", label: "Česky" },
  { value: "en", label: "Anglicky" },
  { value: "random", label: "Náhodně" },
];

const LANG_TAG = { en: "EN", cs: "CZ" };

const SWIPE_MIN_PX = 80; // práh přejetí: 25 % šířky karty, nejméně 80 px
const SWIPE_RATIO = 0.25;
const TAP_SLOP_PX = 10; // menší posun se ještě počítá jako klepnutí
const FLY_OUT_MS = 220;

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function shuffle(array) {
  // Fisher–Yates
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function wordsMatching(words, colors) {
  const wanted = new Set(colors);
  return words.filter((w) => wanted.has(levelOf(w.streak)));
}

/** Sestaví balíček: filtr podle barev, zamíchání, prvních N, směr karty (u „Náhodně" určený jednou). */
function buildDeck(words, game) {
  const pool = shuffle(wordsMatching(words, game.colors));
  const n = game.count === "all" ? pool.length : Math.min(game.count, pool.length);
  return pool.slice(0, n).map((w) => ({
    id: w.id,
    en: w.en,
    cs: w.cs,
    front: game.direction === "random" ? (Math.random() < 0.5 ? "en" : "cs") : game.direction,
    attempted: false, // už měla první pokus v této hře?
  }));
}

function chip(type, name, label, checked, onChange) {
  const input = el("input", { type, name, checked, onchange: () => onChange(input.checked) });
  return el("label", { class: "chip" }, input, el("span", { class: "chip-label" }, label));
}

function fieldset(legend, chips) {
  return el("fieldset", { class: "field" }, el("legend", {}, legend), el("div", { class: "chips" }, chips));
}

export function mount(root) {
  let cleanupGame = () => {};

  showSetup();

  // ---------- nastavení ----------

  function showSetup() {
    cleanupGame();
    cleanupGame = () => {};

    const words = getWords();
    if (words.length === 0) {
      root.replaceChildren(
        el(
          "div",
          { class: "screen" },
          createHeader("Flashcards"),
          el(
            "div",
            { class: "panel" },
            el("p", { class: "empty" }, "Nejdřív přelož nějaká slovíčka."),
            el("a", { class: "btn btn--primary", href: "#/" }, "Přejít na překlad")
          )
        )
      );
      return;
    }

    const settings = getSettings();
    const game = settings.game;

    const info = el("p", { class: "match-info", role: "status" });
    const hint = el("p", { class: "match-hint", role: "status" });
    const startBtn = el("button", { class: "btn btn--primary btn--large", type: "button", onclick: start }, "Začít");

    function refresh() {
      const n = wordsMatching(words, game.colors).length;
      info.textContent = `Odpovídá ${n} ${pluralWords(n)}`;
      hint.textContent =
        n > 0 ? "" : game.colors.length === 0 ? "Vyber alespoň jednu barvu." : "Žádné slovo nemá zvolenou barvu. Zvol jiné.";
      hint.hidden = n > 0;
      startBtn.disabled = n === 0;
    }

    function persist() {
      try {
        saveSettings(settings);
      } catch (err) {
        reportError(err);
      }
      refresh();
    }

    const colorChips = Object.entries(LEVELS).map(([key, level]) =>
      chip("checkbox", "colors", `${level.symbol} ${level.chip}`, game.colors.includes(key), (checked) => {
        game.colors = checked ? [...game.colors, key] : game.colors.filter((c) => c !== key);
        persist();
      })
    );
    const countChips = COUNT_OPTIONS.map((o) =>
      chip("radio", "count", o.label, game.count === o.value, () => {
        game.count = o.value;
        persist();
      })
    );
    const directionChips = DIRECTION_OPTIONS.map((o) =>
      chip("radio", "direction", o.label, game.direction === o.value, () => {
        game.direction = o.value;
        persist();
      })
    );

    root.replaceChildren(
      el(
        "div",
        { class: "screen" },
        createHeader("Flashcards"),
        el(
          "div",
          { class: "panel" },
          fieldset("Barvy", colorChips),
          fieldset("Počet slovíček", countChips),
          fieldset("Nejdřív zobrazit", directionChips),
          info,
          hint,
          startBtn
        )
      )
    );
    refresh();

    function start() {
      const deck = buildDeck(getWords(), game);
      if (deck.length) startGame(deck);
    }
  }

  // ---------- hra ----------

  function startGame(deck) {
    const total = deck.length;
    let firstCorrect = 0;
    const history = []; // záznamy pro „Zpět"
    let revealed = false; // hodnotit lze až po otočení
    let showingBack = false;
    let busy = false; // probíhá animace odchodu karty
    let drag = null;
    let flyTimer = null;
    let active = true;

    cleanupGame = () => {
      active = false;
      clearTimeout(flyTimer);
    };

    const counter = el("span", { class: "counter", role: "status" });
    const undoBtn = el(
      "button",
      { class: "btn btn--small", type: "button", onclick: undo },
      createIcon("undo"),
      "Zpět"
    );
    const endBtn = el("button", { class: "btn btn--small", type: "button", onclick: showSetup }, "Ukončit");

    const frontTag = el("span", { class: "lang-tag" });
    const frontText = el("span", { class: "card-text" });
    const backTag = el("span", { class: "lang-tag" });
    const backText = el("span", { class: "card-text" });
    const front = el("div", { class: "face face--front" }, frontTag, frontText);
    const back = el("div", { class: "face face--back" }, backTag, backText);
    const inner = el("div", { class: "card-inner" }, front, back);
    const stampOk = el("span", { class: "stamp stamp--ok", "aria-hidden": "true" }, "✓");
    const stampBad = el("span", { class: "stamp stamp--bad", "aria-hidden": "true" }, "✕");
    const card = el("div", { class: "card-wrap", tabindex: "0", role: "button" }, inner, stampOk, stampBad);
    const stage = el("div", { class: "stage" }, card);

    const badBtn = el(
      "button",
      { class: "btn rate-btn", type: "button", onclick: () => commit(false) },
      createIcon("cross"),
      "Špatně"
    );
    const okBtn = el(
      "button",
      { class: "btn rate-btn", type: "button", onclick: () => commit(true) },
      createIcon("check"),
      "Správně"
    );
    const rateHint = el("p", { class: "rate-hint" });
    const rateBar = el("div", { class: "rate-bar" }, rateHint, el("div", { class: "rate-buttons" }, badBtn, okBtn));

    const summaryText = el("p", { class: "summary-text" });
    const summary = el(
      "div",
      { class: "summary", hidden: true },
      el("h2", {}, "Hotovo!"),
      summaryText,
      el("button", { class: "btn btn--primary btn--large", type: "button", onclick: showSetup }, "Nová hra"),
      el("a", { class: "btn btn--large", href: "#/" }, "Zpět na překlad")
    );

    root.replaceChildren(
      el(
        "div",
        { class: "screen" },
        createHeader("Flashcards", [endBtn]),
        el("div", { class: "game-bar" }, counter, undoBtn),
        stage,
        rateBar,
        summary
      )
    );

    renderCard();

    // ---------- vykreslení karty ----------

    function setFlipped(flipped, animate = true) {
      showingBack = flipped;
      if (!animate) inner.classList.add("no-anim");
      inner.classList.toggle("flipped", flipped);
      if (!animate) {
        void inner.offsetWidth; // aplikovat bez přechodu
        inner.classList.remove("no-anim");
      }
      front.setAttribute("aria-hidden", String(flipped));
      back.setAttribute("aria-hidden", String(!flipped));
      updateLabel();
    }

    function updateLabel() {
      const c = deck[0];
      if (!c) return;
      const lang = showingBack ? (c.front === "en" ? "cs" : "en") : c.front;
      card.setAttribute(
        "aria-label",
        `Karta ${LANG_TAG[lang]}: ${c[lang]}. ${revealed ? "Klepnutím otočíš zpět." : "Klepnutím otočíš."}`
      );
    }

    function updateControls() {
      const playing = deck.length > 0;
      counter.textContent = `Zbývá: ${deck.length}`;
      undoBtn.disabled = busy || history.length === 0;
      okBtn.disabled = badBtn.disabled = !playing || !revealed || busy;
      rateHint.textContent = revealed ? "Přejeď doprava = správně, doleva = špatně." : "Klepni na kartu a odhal překlad.";
    }

    function resetCardPosition() {
      card.classList.remove("flying", "dragging");
      card.style.transform = "";
      delete card.dataset.swipe;
    }

    function renderCard() {
      if (deck.length === 0) {
        renderSummary();
        return;
      }
      summary.hidden = true;
      stage.hidden = false;
      rateBar.hidden = false;

      const c = deck[0];
      const other = c.front === "en" ? "cs" : "en";
      frontTag.textContent = LANG_TAG[c.front];
      frontText.textContent = c[c.front];
      backTag.textContent = LANG_TAG[other];
      backText.textContent = c[other];

      revealed = false;
      resetCardPosition();
      setFlipped(false, false);
      if (!prefersReducedMotion()) {
        card.classList.remove("enter");
        void card.offsetWidth;
        card.classList.add("enter");
      }
      updateControls();
    }

    function renderSummary() {
      stage.hidden = true;
      rateBar.hidden = true;
      summary.hidden = false;
      summaryText.textContent = `Napoprvé správně: ${firstCorrect} z ${total}`;
      updateControls();
    }

    // ---------- hodnocení ----------

    function flip() {
      if (busy || deck.length === 0) return;
      revealed = true;
      setFlipped(!showingBack);
      updateControls();
    }

    /** Změní stav hry a streak (uloží se okamžitě). Karta se z DOM odstraní až po animaci. */
    function applyRating(ok) {
      const c = deck[0];
      const stored = getWord(c.id);
      const entry = {
        card: c,
        ok,
        firstTry: !c.attempted,
        prevStreak: stored ? stored.streak : 0,
        prevFirstCorrect: firstCorrect,
      };

      // Počítá se jen první pokus karty v této hře.
      if (!c.attempted) {
        try {
          setStreak(c.id, ok ? Math.min(3, entry.prevStreak + 1) : 0);
        } catch (err) {
          reportError(err);
        }
        c.attempted = true;
        if (ok) firstCorrect++;
      }

      deck.shift();
      if (!ok) deck.push(c); // špatná karta se vrací na konec balíčku
      history.push(entry);
    }

    function commit(ok) {
      if (busy || !revealed || deck.length === 0) return;
      busy = true;
      applyRating(ok);
      updateControls();

      const advance = () => {
        if (!active) return;
        busy = false;
        renderCard();
      };

      if (prefersReducedMotion()) {
        advance();
        return;
      }
      card.classList.remove("dragging");
      card.classList.add("flying");
      card.dataset.swipe = ok ? "ok" : "bad";
      card.style.transform = `translateX(${(ok ? 1 : -1) * window.innerWidth}px) rotate(${ok ? 18 : -18}deg)`;
      flyTimer = setTimeout(advance, FLY_OUT_MS);
    }

    function undo() {
      if (busy || history.length === 0) return;
      const entry = history.pop();

      if (!entry.ok) {
        const i = deck.lastIndexOf(entry.card); // vrácená karta je na konci balíčku
        if (i >= 0) deck.splice(i, 1);
      }
      deck.unshift(entry.card);

      if (entry.firstTry) {
        entry.card.attempted = false;
        try {
          setStreak(entry.card.id, entry.prevStreak);
        } catch (err) {
          reportError(err);
        }
      }
      firstCorrect = entry.prevFirstCorrect;

      renderCard();
      // Karta se vrací už odhalená, aby ji šlo hned znovu ohodnotit.
      revealed = true;
      setFlipped(true, false);
      updateControls();
    }

    // ---------- gesta (Pointer Events) ----------

    card.addEventListener("pointerdown", (e) => {
      if (busy || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, moved: false };
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* ukazatel už zanikl; gesto zvládneme i bez zachycení */
      }
    });

    card.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) {
        drag.moved = true;
        if (revealed) card.classList.add("dragging");
      }
      drag.dx = dx;
      if (drag.moved && revealed) {
        card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
        card.dataset.swipe = dx > 30 ? "ok" : dx < -30 ? "bad" : "";
      }
    });

    function endDrag(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      card.classList.remove("dragging");

      if (!cancelled && !d.moved) {
        flip();
        return;
      }
      const threshold = Math.max(SWIPE_MIN_PX, card.offsetWidth * SWIPE_RATIO);
      if (!cancelled && revealed && Math.abs(d.dx) >= threshold) {
        commit(d.dx > 0);
      } else {
        resetCardPosition(); // nedosažený práh: karta se vrátí
      }
    }
    card.addEventListener("pointerup", (e) => endDrag(e, false));
    card.addEventListener("pointercancel", (e) => endDrag(e, true));

    // Klávesnice (přístupnost).
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      } else if (revealed && e.key === "ArrowRight") commit(true);
      else if (revealed && e.key === "ArrowLeft") commit(false);
    });
  }

  return function unmount() {
    cleanupGame();
  };
}
