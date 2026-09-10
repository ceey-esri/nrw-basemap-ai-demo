// RAG-Nachvollziehbarkeit: welche Passagen hat das Backend geliefert.
//
// Schlüssel: "regionalplan:<kategorieId>" bzw. "gesetz:<kategorieId>",
// damit sich die Fundstellen der Kategorie zuordnen lassen, für die sie
// geholt wurden.

/**
 * @typedef {{ zitat: string, ueberschrift?: string, stand?: string,
 *   quelle_url?: string, score?: number, text?: string }} Fundstelle
 */

/** @type {Map<string, Fundstelle[]>} */
const fundstellen = new Map();

/** @param {string} schluessel @param {Fundstelle[]} liste */
export function setzeFundstellen(schluessel, liste) {
  if (schluessel) fundstellen.set(schluessel, liste ?? []);
}

/** @param {string} schluessel @returns {Fundstelle[]} */
export function getFundstellen(schluessel) {
  return fundstellen.get(schluessel) ?? [];
}

/**
 * Alle Fundstellen, deren Schlüssel mit dem Präfix beginnt - ohne Dubletten
 * (dasselbe Zitat kann für mehrere Kategorien geliefert worden sein).
 * @param {string} praefix z.B. "regionalplan:"
 */
export function alleFundstellen(praefix) {
  const raus = [];
  const gesehen = new Set();
  for (const [k, liste] of fundstellen) {
    if (!k.startsWith(praefix)) continue;
    for (const f of liste) {
      if (gesehen.has(f.zitat)) continue;
      gesehen.add(f.zitat);
      raus.push(f);
    }
  }
  return raus;
}

export function ragLeeren() {
  fundstellen.clear();
}
