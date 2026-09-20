// Start aplikace: načtení dat, router (hash routy), postranní menu, service worker.

import { el, createIcon, showToast } from "./ui.js";
import { load } from "./storage.js";
import * as home from "./home.js";
import * as library from "./library.js";
import * as flashcards from "./flashcards.js";

const ROUTES = {
  "/": { label: "Translate", icon: "translate", screen: home },
  "/library": { label: "Library", icon: "library", screen: library },
  "/flashcards": { label: "Flashcards", icon: "flashcards", screen: flashcards },
};

const screenRoot = document.getElementById("app");
const menuRoot = document.getElementById("menu-root");

// ---------- menu ----------

const links = Object.entries(ROUTES).map(([path, route]) =>
  el(
    "a",
    { class: "menu-link", href: `#${path}`, dataset: { path }, onclick: () => closeMenu(false) },
    createIcon(route.icon),
    route.label
  )
);

menuRoot.append(
  el("div", { class: "menu-backdrop", onclick: () => closeMenu() }),
  el(
    "nav",
    { class: "menu", "aria-label": "Hlavní menu" },
    el("p", { class: "menu-title" }, "Slovníček"),
    el("ul", {}, links.map((link) => el("li", {}, link)))
  )
);
menuRoot.inert = true;

let menuOpener = null;

function openMenu() {
  menuOpener = document.activeElement;
  menuRoot.inert = false;
  menuRoot.classList.add("open");
  (links.find((l) => l.getAttribute("aria-current") === "page") ?? links[0]).focus();
}

function closeMenu(restoreFocus = true) {
  if (!menuRoot.classList.contains("open")) return;
  menuRoot.classList.remove("open");
  menuRoot.inert = true;
  if (restoreFocus && menuOpener && menuOpener.isConnected) menuOpener.focus();
  menuOpener = null;
}

document.addEventListener("menu:open", openMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

// ---------- router ----------

let unmountCurrent = null;

function currentPath() {
  const path = location.hash.replace(/^#/, "");
  return path in ROUTES ? path : "/";
}

function navigate() {
  closeMenu(false);

  if (typeof unmountCurrent === "function") {
    try {
      unmountCurrent();
    } catch (err) {
      console.error(err);
    }
  }
  unmountCurrent = null;

  const path = currentPath();
  // Neznámou nebo prázdnou adresu srovnáme na platnou, aniž bychom přidávali záznam do historie.
  if (location.hash !== `#${path}`) history.replaceState(null, "", `#${path}`);

  screenRoot.replaceChildren();
  try {
    unmountCurrent = ROUTES[path].screen.mount(screenRoot);
  } catch (err) {
    console.error(err);
    screenRoot.replaceChildren(el("p", { class: "empty" }, "Něco se pokazilo. Zkus aplikaci znovu otevřít."));
  }

  for (const link of links) {
    if (link.dataset.path === path) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", navigate);

// ---------- start ----------

const loaded = load();
navigate();
if (!loaded.ok) showToast(loaded.error, 6000);

// Pokus o trvalé úložiště, aby prohlížeč data nesmazal při nedostatku místa. Výsledek nás nezajímá.
try {
  navigator.storage?.persist?.().catch(() => {});
} catch {
  /* nic */
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.error("Service worker:", err));
}
