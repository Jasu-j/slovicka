// Sdílené pomůcky pro obrazovky: tvorba DOM, ikony, barevné tečky, hlavička, toasty.
// Text z uživatele nebo z API se do stránky vkládá jen přes textContent / createTextNode.

/**
 * Malý helper na tvorbu prvků. Řetězcové potomky vkládá jako text (nikdy jako HTML).
 * attrs: class, dataset, on* (posluchače), true/false pro boolean atributy, jinak setAttribute.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
  }
  return node;
}

// ---------- ikony (inline SVG, 24×24, jen obrysy) ----------

const ICONS = {
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12", "M9 7V4h6v3"],
  search: ["M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M20 20l-4-4"],
  translate: ["M4 8h14", "M14 4l4 4-4 4", "M20 16H6", "M10 12l-4 4 4 4"],
  library: ["M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z", "M5 17a3 3 0 0 1 3-3h11"],
  flashcards: [
    "M3 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z",
    "M8 7V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1",
  ],
  undo: ["M9 14L4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"],
  check: ["M5 12l5 5L20 7"],
  cross: ["M6 6l12 12", "M18 6L6 18"],
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// ---------- barevné tečky ----------

export const LEVELS = {
  red: { symbol: "✕", label: "Neznám", chip: "Červená" },
  yellow: { symbol: "–", label: "Učím se", chip: "Žlutá" },
  green: { symbol: "✓", label: "Znám", chip: "Zelená" },
};

/** streak 0 = red, 1–2 = yellow, 3 = green */
export function levelOf(streak) {
  if (streak >= 3) return "green";
  if (streak >= 1) return "yellow";
  return "red";
}

/** Tečka nese vždy i symbol, aby barva nebyla jediným nositelem informace. */
export function createDot(streak) {
  const level = levelOf(streak);
  return el(
    "span",
    { class: `dot dot--${level}`, role: "img", "aria-label": LEVELS[level].label },
    LEVELS[level].symbol
  );
}

// ---------- text ----------

export function pluralWords(n) {
  if (n === 1) return "slovo";
  if (n >= 2 && n <= 4) return "slova";
  return "slov";
}

// ---------- hlavička ----------

/** Hlavička s hamburgerem vlevo. Menu se otevírá událostí zachycenou v app.js. */
export function createHeader(title, actions = []) {
  return el(
    "header",
    { class: "app-header" },
    el(
      "button",
      {
        class: "icon-btn",
        type: "button",
        "aria-label": "Otevřít menu",
        onclick: () => document.dispatchEvent(new CustomEvent("menu:open")),
      },
      createIcon("menu")
    ),
    el("h1", { class: "app-title" }, title),
    el("div", { class: "header-actions" }, actions)
  );
}

// ---------- toasty ----------

const TOAST_MS = 2500;

export function showToast(message, ms = TOAST_MS) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const toast = el("div", { class: "toast" }, message);
  host.append(toast);
  setTimeout(() => toast.remove(), ms);
}

/** Zobrazí srozumitelnou hlášku z chyby (StorageError, ImportError, TranslateError…). */
export function reportError(err) {
  const known = err && ["STORAGE", "INVALID"].includes(err.code);
  showToast(known ? err.message : "Něco se nepovedlo. Zkus to prosím znovu.");
}

/** Nastaví, jak vysoko nad spodním okrajem se toasty zobrazují (vstup na hlavní obrazovce). */
export function setToastOffset(px) {
  const root = document.documentElement.style;
  if (px == null) root.removeProperty("--toast-bottom");
  else root.setProperty("--toast-bottom", `${px}px`);
}
