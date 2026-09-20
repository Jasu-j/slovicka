// Překlad přes MyMemory (zdarma, bez klíče). Jediné místo, které mluví s API,
// takže jde překladač později vyměnit bez zásahu do obrazovek.
//
// Známá rizika:
// - Anonymní limit je 5 000 znaků denně na IP adresu. Mobilní operátoři často
//   sdílejí IP mezi uživateli, takže se limit může vyčerpat dřív (odhad).
// - Kvalita překladu jednotlivých slov EN↔CZ nebyla ověřena a může být nerovnoměrná.
//   Ověřeno při testu: pro "apple" vrací hlavní překlad "apple" a správné "jablko"
//   je jen v poli `matches` (viz pickFromMatches).
// - Zadaná slova se odesílají třetí straně (MyMemory).

import { MYMEMORY_EMAIL, MAX_INPUT_LENGTH, TRANSLATE_TIMEOUT_MS } from "./config.js";

const API_URL = "https://api.mymemory.translated.net/get";
const LANGPAIRS = { "en-cs": "en|cs", "cs-en": "cs|en" };

export const ERROR_MESSAGES = {
  EMPTY: "Napiš slovo, které chceš přeložit.",
  TOO_LONG: `Text je moc dlouhý (max. ${MAX_INPUT_LENGTH} znaků).`,
  OFFLINE: "Nejsi online, překlad teď nejde.",
  TIMEOUT: "Překlad trvá moc dlouho. Zkus to znovu.",
  QUOTA: "Denní limit překladače je vyčerpán. Zkus to zítra.",
  NOT_FOUND: "Překladač pro toto slovo nenašel překlad.",
  BAD_RESPONSE: "Překladač vrátil neočekávanou odpověď.",
};

export class TranslateError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = "TranslateError";
    this.code = code;
  }
}

// Přesné znění varování MyMemory je z paměti (něco jako "MYMEMORY WARNING: YOU USED
// ALL AVAILABLE FREE TRANSLATIONS FOR TODAY..."); při vyčerpání limitu ověřit.
const QUOTA_TEXT = /MYMEMORY WARNING|USED ALL AVAILABLE FREE TRANSLATIONS/i;

/** Oříznutí, sloučení mezer a kontrola délky. Vyhazuje EMPTY / TOO_LONG. */
export function normalizeInput(text) {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!t) throw new TranslateError("EMPTY");
  if (t.length > MAX_INPUT_LENGTH) throw new TranslateError("TOO_LONG");
  return t;
}

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Hlavní překlad je někdy shodný se vstupem (nebo prázdný), i když `matches` obsahuje
// dobrý překlad. Vezmeme nejlépe hodnocenou položku, která se od vstupu liší.
function pickFromMatches(matches, input) {
  if (!Array.isArray(matches)) return "";
  const candidates = matches
    .filter((m) => m && typeof m.translation === "string")
    .map((m) => ({ text: m.translation.trim(), score: Number(m.match) || 0 }))
    .filter((c) => c.text && !same(c.text, input) && !QUOTA_TEXT.test(c.text));
  candidates.sort((a, b) => b.score - a.score); // stabilní: při shodě vyhrává dřívější
  return candidates.length ? candidates[0].text : "";
}

/**
 * @param {string} text
 * @param {"en-cs"|"cs-en"} direction
 * @returns {Promise<string>}
 * @throws {TranslateError}
 */
export async function translate(text, direction) {
  const pair = LANGPAIRS[direction];
  if (!pair) throw new TypeError(`Neznámý směr překladu: ${direction}`);
  const input = normalizeInput(text);

  if (!navigator.onLine) throw new TranslateError("OFFLINE");

  let url = `${API_URL}?q=${encodeURIComponent(input)}&langpair=${encodeURIComponent(pair)}`;
  if (MYMEMORY_EMAIL) url += `&de=${encodeURIComponent(MYMEMORY_EMAIL)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

  let res;
  let body;
  try {
    res = await fetch(url, { signal: controller.signal });
    if (res.status === 429) throw new TranslateError("QUOTA");
    if (!res.ok) throw new TranslateError("BAD_RESPONSE");
    body = await res.json(); // časový limit platí i pro čtení těla odpovědi
  } catch (e) {
    if (e instanceof TranslateError) throw e;
    if (e && e.name === "AbortError") throw new TranslateError("TIMEOUT");
    if (e instanceof SyntaxError) throw new TranslateError("BAD_RESPONSE");
    throw new TranslateError("OFFLINE"); // selhání fetch (síť, DNS, CORS…)
  } finally {
    clearTimeout(timer);
  }

  if (!body || typeof body !== "object") throw new TranslateError("BAD_RESPONSE");

  // responseStatus může být číslo i řetězec, proto Number().
  const status = Number(body.responseStatus);
  const translated = body.responseData && body.responseData.translatedText;
  const details = typeof body.responseDetails === "string" ? body.responseDetails : "";

  if (status === 429 || body.quotaFinished === true) throw new TranslateError("QUOTA");
  if ((typeof translated === "string" && QUOTA_TEXT.test(translated)) || QUOTA_TEXT.test(details)) {
    throw new TranslateError("QUOTA");
  }
  if (status !== 200 || typeof translated !== "string") throw new TranslateError("BAD_RESPONSE");

  let result = translated.trim();
  if (!result || same(result, input)) result = pickFromMatches(body.matches, input);
  if (!result) throw new TranslateError("NOT_FOUND");

  // Překladač občas vrací velké písmeno u slovíček; pokud vstup začíná malým,
  // zmenšíme první písmeno (ne u zkratek typu "NATO").
  const first = input.charAt(0);
  const isLower = first !== first.toUpperCase();
  const r0 = result.charAt(0);
  const r1 = result.charAt(1);
  const resultStartsUpper = r0 !== r0.toLowerCase();
  const looksLikeAcronym = r1 !== "" && r1 !== r1.toLowerCase();
  if (isLower && resultStartsUpper && !looksLikeAcronym) {
    result = r0.toLowerCase() + result.slice(1);
  }

  return result;
}
