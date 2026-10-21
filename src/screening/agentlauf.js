// Die gemeinsame Mechanik, mit der ein Subagent ueberhaupt laeuft.
//
// Eigenes Modul, weil sowohl `subagenten.js` als auch `bericht.js` sie
// brauchen und `tools.js` wiederum `bericht.js` importiert. Lebte das hier
// in subagenten.js, entstuende der Zyklus tools.js <-> subagenten.js. Der
// waere in ESM zwar zulaessig - alle beteiligten Bindings sind gehobene
// Funktionsdeklarationen und werden erst zur Laufzeit gerufen - aber er ist
// eine Fussangel fuer jeden, der spaeter Top-Level-Code ergaenzt.

import { MemorySaver } from "@langchain/langgraph";

import { meldeSchritt } from "./fortschritt.js";

/**
 * Kompilierter Graph je Subagent - MIT eigenem Checkpointer.
 *
 * Hier lag der Fehler, der die Subagenten monatelang lahmgelegt hat:
 * `LLMAgent` setzt beim Modellaufruf intern `checkpointer: true`. In LangGraph
 * heisst das nicht "benutze einen Checkpointer", sondern "ERBE den des
 * uebergeordneten Graphen". Laeuft der Agent unter dem Orchestrator der
 * <arcgis-assistant>, ist dieser Elternteil da. Ruft man dagegen `agent.run()`
 * direkt auf, ist sein Graph ein WURZELGRAPH ohne Elternteil, und LangGraph
 * lehnt ab: "checkpointer: true cannot be used for root graphs."
 *
 * `agent.run()` kompiliert ohne Optionen (`createGraph().compile()`). Wir
 * kompilieren stattdessen selbst und geben einen `MemorySaver` mit - damit
 * existiert der Elternteil, von dem geerbt werden kann.
 *
 * `createGraph` ist in der Typdefinition als `@internal` markiert. Die
 * Alternative waere, die Subagenten aufzugeben und die Passagen direkt an den
 * Hauptagenten zu geben; das wuerde die Arbeitsteilung aufloesen, die den
 * Hauptkontext klein haelt.
 */
const _graphen = new WeakMap();
let _faden = 0;

export function graphVon(agent) {
  let g = _graphen.get(agent);
  if (g) return g;
  try {
    g = agent.createGraph().compile({ checkpointer: new MemorySaver() });
  } catch (err) {
    // Der Graph wird normalerweise beim Erzeugen aufgebaut; falls nicht,
    // einmal nachziehen und erneut versuchen.
    console.warn("[subagent] Graph nicht direkt kompilierbar, generiere nach:", err);
    agent.generate?.();
    g = agent.createGraph().compile({ checkpointer: new MemorySaver() });
  }
  _graphen.set(agent, g);
  return g;
}

/**
 * Ein Durchlauf des Subagenten. Jeder Aufruf bekommt einen eigenen
 * `thread_id`, sonst teilen sich die Kategorien den Gespraechsfaden und der
 * Befund zur zweiten faellt im Licht der ersten aus.
 */
export async function laufen(agent, state, recursionLimit) {
  return graphVon(agent).invoke(state, {
    recursionLimit,
    configurable: { thread_id: `sub-${++_faden}` },
  });
}

/** Ruft einen Subagenten auf und liefert seinen Kurzbefund als Text. */
/** Fehlertexte des Modelldienstes, die als normale Antwort ankommen können. */
// Erkennt eine Abweisung des Modelldienstes IM ANTWORTTEXT.
//
// Die blosse Zahl 429 reicht dafuer NICHT, und das war ein echter Fehler: das
// Muster hiess `/\b429\b|.../` und traf damit in jeder Fachantwort, die
// zufaellig so eine Zahl enthielt. Im Lauf vom 2026-10-11 hat es dreimal
// gefeuert - "Vegetationsflaechen: 429 Objekte" wurde als Dienstfehler
// verworfen, ebenso zwei Antworten, in denen weiter hinten eine Zahl wie
// "1.429" stand (das Wortgrenzenpaar \b429\b trifft auch hinter einem
// Tausenderpunkt). Die Messwerte lagen danach zwar im Store, weil queryLayer
// sie dort unabhaengig hineinschreibt, aber der Hauptagent bekam
// `layerFehlgeschlagen` gemeldet und hat dieselben Kategorien erneut geprueft.
//
// Jetzt zaehlt die Zahl nur in einem Fehlerkontext (HTTP, Statuscode, Error,
// Fehler) - die eindeutigen Wortmarken allein tragen den Rest. 17 Faelle
// geprueft: zehn echte Fehlermeldungen treffen, sieben gueltige Fachantworten
// nicht.
const DIENST_FEHLER =
  /too many requests|rate.?limit|high demand|exceeds the maximum usage size|error during (?:message processing|intent detection)|(?:http|statuscode|status(?:\s*code)?|code|error|fehler)\D{0,10}429\b/i;

/**
 * Ruft einen Subagenten auf und liefert seinen Kurzbefund als Text.
 *
 * WARUM DIE LAENGEN EINSTELLBAR SIND:
 * Die Deckel waren fest - 600 Zeichen fuer den Text an den Hauptagenten, 300
 * fuer die Konsole. Fuer einen Recherchebefund (RELEVANT / ZITAT / KERN /
 * RADIUS zu EINER Kategorie) passt das. Fuer die Belange-Einstufung passt es
 * nicht: die traegt eine Zeile je Kategorie, bei acht Kategorien gut 450
 * Zeichen, und mit laengeren Fundstellen mehr. Der Deckel haette dann die
 * letzten Kategorien stillschweigend abgeschnitten.
 *
 * Im Lauf vom 2026-10-11 ist genau das am Logging sichtbar geworden: die
 * Antwort erschien in der Konsole mit fuenf von acht Kategorien und endete
 * nach 299 Zeichen - eine Stelle vor dem Schnitt bei 300. Nicht das Modell
 * hat aufgehoert, sondern `console.info`. Dass der Text an den Hauptagenten
 * mit 600 Zeichen knapp genuegte, war Glueck.
 *
 * @param {object} agent
 * @param {string} auftrag
 * @param {string} label
 * @param {{maxText?: number, maxLog?: number, recursionLimit?: number}} [grenzen]
 * @returns {Promise<{text: string, ok: boolean}>}
 */
export async function frage(agent, auftrag, label, grenzen = {}) {
  const maxText = grenzen.maxText ?? 600;
  const maxLog = grenzen.maxLog ?? 300;
  // 8 Runden genuegen fuer eine Recherche (ein Werkzeugaufruf, dann die
  // Antwort). Die Layerpruefung braucht mehr: beschreibeLayer fuer die Liste,
  // je Layer einmal fuer die Felder, je Layer ein queryLayer.
  const recursionLimit = grenzen.recursionLimit ?? 8;
  try {
    const state = await laufen(
      agent,
      { outputMessage: auftrag, summary: auftrag },
      recursionLimit,
    );
    const antwort = String(state?.outputMessage ?? "").trim();

    // Eine LEERE Antwort war bisher stumm: sie ging als
    // "(… keine Antwort)" an den Hauptagenten, der daraus "keine verwertbaren
    // Zitate" machte und alle acht Kategorien verwarf - während der Lauf nach
    // aussen gesund aussah. Das ist ein Fehler und wird auch so gemeldet.
    if (!antwort) {
      console.warn(`[subagent] ${label}: leere Antwort.`, state);
      meldeSchritt({ typ: "tool", text: `${label} - keine Antwort erhalten`, status: "fehler" });
      return { text: `(${label}: keine Antwort)`, ok: false };
    }
    if (DIENST_FEHLER.test(antwort)) {
      console.warn(`[subagent] ${label}: Modelldienst überlastet.`, antwort.slice(0, 200));
      meldeSchritt({ typ: "tool", text: `${label} - Modelldienst überlastet`, status: "fehler" });
      return { text: antwort.slice(0, 300), ok: false };
    }
    const gekuerzt = antwort.length > maxText;
    if (gekuerzt) {
      console.warn(
        `[subagent] ${label}: Antwort ist ${antwort.length} Zeichen lang und wird auf ` +
          `${maxText} gekuerzt - moeglicherweise fehlt dem Hauptagenten das Ende.`,
      );
    }
    console.info(
      `[subagent] ${label}:`,
      antwort.slice(0, maxLog) + (antwort.length > maxLog ? ` […+${antwort.length - maxLog}]` : ""),
    );
    return { text: antwort.slice(0, maxText), ok: true };
  } catch (err) {
    console.warn(`[subagent] ${label} - Fehler:`, err);
    meldeSchritt({
      typ: "tool",
      text: `${label} - FEHLER: ${String(err).slice(0, 120)}`,
      status: "fehler",
    });
    return { text: `(${label} nicht verfuegbar: ${String(err).slice(0, 160)})`, ok: false };
  }
}
