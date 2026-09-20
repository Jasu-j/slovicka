// Celá práce s daty v localStorage. Zbytek aplikace na localStorage nesahá,
// takže jde úložiště později vyměnit bez zásahu do obrazovek.
//
// Zápisové funkce při selhání ukládání vrátí stav zpět a vyhodí StorageError
// (zpráva je určená uživateli). Vrácené záznamy jsou kopie, ne živé objekty.

import { STORAGE_KEY } from "./config.js";

const VERSION = 1;
const MAX_TEXT = 500;
const MAX_STREAK = 3;
const COLORS = ["red", "yellow", "green"];
const COUNTS = [10, 20, 50, "all"];
const DIRECTIONS = ["cs", "en", "random"];

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
    this.code = "STORAGE";
  }
}

export class ImportError extends Error {
  constructor(message = "Soubor není platná záloha Slovníčku. Nic se nezměnilo.") {
    super(message);
    this.name = "ImportError";
    this.code = "INVALID";
  }
}

function defaultSettings() {
  return { game: { colors: ["red", "yellow"], count: 20, direction: "en" } };
}

let data = { version: VERSION, words: [], settings: defaultSettings() };

// ---------- pomocné funkce ----------

export function normalizeText(s) {
  return String(s).trim().replace(/\s+/g, " ");
}

export function dupKey(en, cs) {
  return normalizeText(en).toLowerCase() + "|" + normalizeText(cs).toLowerCase();
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // randomUUID existuje jen v zabezpečeném kontextu (HTTPS / localhost);
  // náhrada kvůli testování z telefonu přes http://IP-v-síti.
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function cleanWord(w) {
  if (!w || typeof w !== "object") return null;
  if (typeof w.en !== "string" || typeof w.cs !== "string") return null;
  const en = normalizeText(w.en);
  const cs = normalizeText(w.cs);
  if (!en || !cs || en.length > MAX_TEXT || cs.length > MAX_TEXT) return null;
  return {
    id: typeof w.id === "string" && w.id ? w.id : newId(),
    en,
    cs,
    createdAt: Number.isFinite(w.createdAt) ? w.createdAt : Date.now(),
    streak: Number.isInteger(w.streak) ? Math.min(MAX_STREAK, Math.max(0, w.streak)) : 0,
  };
}

function cleanSettings(s) {
  const def = defaultSettings();
  const g = s && typeof s === "object" && s.game && typeof s.game === "object" ? s.game : {};
  return {
    game: {
      colors: Array.isArray(g.colors)
        ? [...new Set(g.colors.filter((c) => COLORS.includes(c)))]
        : def.game.colors,
      count: COUNTS.includes(g.count) ? g.count : def.game.count,
      direction: DIRECTIONS.includes(g.direction) ? g.direction : def.game.direction,
    },
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    throw new StorageError(
      "Nepodařilo se uložit data. Úložiště je pravděpodobně plné nebo zakázané."
    );
  }
}

function newestFirst(words) {
  return words
    .map((w, i) => [w, i])
    .sort((a, b) => b[0].createdAt - a[0].createdAt || b[1] - a[1])
    .map(([w]) => w);
}

// ---------- načtení ----------

/** Načte data. Vrací {ok} nebo {ok:false, error} (zpráva pro uživatele); aplikace pak běží s prázdnými daty. */
export function load() {
  data = { version: VERSION, words: [], settings: defaultSettings() };

  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      ok: false,
      error: "Prohlížeč nepovoluje ukládání dat. Slovíčka se po zavření aplikace ztratí.",
    };
  }
  if (raw === null) return { ok: true };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.words)) {
      throw new Error("bad shape");
    }
    const seen = new Set();
    const words = [];
    for (const item of parsed.words) {
      const w = cleanWord(item);
      if (!w) continue;
      const key = dupKey(w.en, w.cs);
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(w);
    }
    data = { version: VERSION, words, settings: cleanSettings(parsed.settings) };
    return { ok: true };
  } catch {
    // Poškozená data si odložíme bokem, aby je další uložení nepřepsalo.
    let kept = false;
    try {
      localStorage.setItem(STORAGE_KEY + ".broken", raw);
      kept = true;
    } catch {
      /* nic */
    }
    return {
      ok: false,
      error:
        "Uložená data se nepodařilo přečíst, začínám s prázdnou knihovnou." +
        (kept ? " Původní data zůstala uložena bokem." : ""),
    };
  }
}

// ---------- slova ----------

/** Všechna slova, nejnovější první. */
export function getWords() {
  return newestFirst(data.words).map((w) => ({ ...w }));
}

export function getWord(id) {
  const w = data.words.find((x) => x.id === id);
  return w ? { ...w } : null;
}

/** @returns {{status: "added"|"duplicate", word: object}} */
export function addWord({ en, cs }) {
  const word = cleanWord({ en, cs, streak: 0, createdAt: Date.now() });
  if (!word) throw new Error("Neplatné slovo.");

  const key = dupKey(word.en, word.cs);
  const existing = data.words.find((w) => dupKey(w.en, w.cs) === key);
  if (existing) return { status: "duplicate", word: { ...existing } };

  data.words.push(word);
  try {
    save();
  } catch (e) {
    data.words.pop();
    throw e;
  }
  return { status: "added", word: { ...word } };
}

export function deleteWord(id) {
  const i = data.words.findIndex((w) => w.id === id);
  if (i < 0) return false;
  const [removed] = data.words.splice(i, 1);
  try {
    save();
  } catch (e) {
    data.words.splice(i, 0, removed);
    throw e;
  }
  return true;
}

/** Nastaví streak (0–3, celé číslo). Vrací false, když slovo neexistuje. */
export function setStreak(id, n) {
  const w = data.words.find((x) => x.id === id);
  if (!w) return false;
  const prev = w.streak;
  w.streak = Math.min(MAX_STREAK, Math.max(0, Math.trunc(n)));
  try {
    save();
  } catch (e) {
    w.streak = prev;
    throw e;
  }
  return true;
}

function findBy(field, text) {
  const key = normalizeText(text).toLowerCase();
  if (!key) return null;
  const matches = data.words.filter((w) => w[field].toLowerCase() === key);
  return matches.length ? { ...newestFirst(matches)[0] } : null;
}

/** Nejnovější záznam se shodným anglickým slovem (bez ohledu na velikost písmen), nebo null. */
export function findByEn(text) {
  return findBy("en", text);
}

/** Nejnovější záznam se shodným českým slovem (bez ohledu na velikost písmen), nebo null. */
export function findByCs(text) {
  return findBy("cs", text);
}

// ---------- nastavení ----------

export function getSettings() {
  return JSON.parse(JSON.stringify(data.settings));
}

export function saveSettings(settings) {
  data.settings = cleanSettings(settings);
  save();
}

// ---------- záloha ----------

export function exportJson() {
  return JSON.stringify(
    { version: VERSION, exportedAt: new Date().toISOString(), words: data.words },
    null,
    2
  );
}

/**
 * Sloučí zálohu do stávajících dat. Existující záznamy se nemažou,
 * duplicity se přeskočí (zůstává stávající záznam).
 * Neplatný soubor vyhodí ImportError a nic se nezmění.
 * @returns {{added: number, skipped: number}}
 */
export function importJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError();
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== VERSION || !Array.isArray(parsed.words)) {
    throw new ImportError();
  }

  const incoming = [];
  for (const item of parsed.words) {
    const w = cleanWord(item);
    if (!w) throw new ImportError();
    incoming.push(w);
  }

  const keys = new Set(data.words.map((w) => dupKey(w.en, w.cs)));
  const ids = new Set(data.words.map((w) => w.id));
  const toAdd = [];
  let skipped = 0;
  for (const w of incoming) {
    const key = dupKey(w.en, w.cs);
    if (keys.has(key)) {
      skipped++;
      continue;
    }
    keys.add(key);
    if (ids.has(w.id)) w.id = newId();
    ids.add(w.id);
    toAdd.push(w);
  }

  if (toAdd.length) {
    const before = data.words;
    data.words = before.concat(toAdd);
    try {
      save();
    } catch (e) {
      data.words = before;
      throw e;
    }
  }
  return { added: toAdd.length, skipped };
}
