// Fortschritts-/Schritt-Bus.
//
// Agenten- und Tool-Middleware (agents.js / tools.js) melden hier, welcher
// Agent läuft, welche Kategorie gerade geprüft wird und welches Tool bzw.
// welcher Modell-Schritt ausgeführt wird. Die UI (app.js) zeigt daraus einen
// groben Balken + eine aufklappbare Schrittliste.

/** @typedef {"idle"|"triage"|"screening"|"fertig"|"fehler"} Phase */

let phase = /** @type {Phase} */ ("idle");
let kategorie = "";
/** @type {Array<{t:number, typ:string, name?:string, text:string, status?:string, info?:string}>} */
let schritte = [];
const listeners = new Set();

function notify() {
  const snap = { phase, kategorie, schritte: [...schritte] };
  listeners.forEach((fn) => fn(snap));
}

export function onFortschritt(fn) {
  listeners.add(fn);
  fn({ phase, kategorie, schritte: [...schritte] });
  return () => listeners.delete(fn);
}

export function fortschrittReset() {
  phase = "idle";
  kategorie = "";
  schritte = [];
  notify();
}

/** @param {Phase} p */
export function setzePhase(p) {
  phase = p;
  notify();
}

export function getPhase() {
  return phase;
}

/** Aktuell geprüftes Rechtsgebiet (Label + Abschnitts-Trenner im Schritt-Log). */
export function setzeKategorie(titel) {
  const neu = titel ?? "";
  if (neu && neu !== kategorie) {
    schritte.push({ t: Date.now(), typ: "kategorie", text: neu });
  }
  kategorie = neu;
  notify();
}

export function meldeSchritt(eintrag) {
  schritte.push({ t: Date.now(), ...eintrag });
  if (schritte.length > 400) schritte = schritte.slice(-400);
  // In der Oberfläche steht nur der aktuelle Schritt. Die vollständige
  // Kette geht in die Konsole - sonst wäre ein Lauf ohne Ergebnis nicht
  // mehr nachvollziehbar.
  if (eintrag.status === "fehler") console.warn("[Schritt]", eintrag.text ?? eintrag.name);
  else console.info("[Schritt]", eintrag.text ?? eintrag.name);
  notify();
}

/** Letzter Fehler-Schritt eines Laufs, für die Diagnose im Ergebnispanel. */
export function letzterFehler() {
  return [...schritte].reverse().find((s) => s.status === "fehler")?.text ?? null;
}
