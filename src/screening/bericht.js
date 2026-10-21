// Der Berichts-Subagent: formuliert den Abschlusstext aus übergebenen Fakten.
//
// WARUM EIN EIGENES MODUL:
// `fasseZusammen` in tools.js braucht ihn, und subagenten.js importiert
// umgekehrt aus tools.js. Lebte der Agent dort, entstünde der Zyklus
// tools.js <-> subagenten.js.
//
// WARUM EIN AGENT OHNE WERKZEUGE:
// Er kann nichts nachschlagen und nichts messen - genau das ist der Punkt. Er
// bekommt fertige Zahlen und darf sie nur in Sätze gießen. Alles, was er
// zusätzlich täte, wäre eine Aussage ohne Grundlage.
//
// WARUM ES NUR NOCH EINEN WEG DORTHIN GIBT:
// Vorher gab es zwei. `schreibeBericht` ließ den Subagenten formulieren und
// gab den Text zurück mit der Anweisung, ihn "unverändert an fasseZusammen
// weiterzugeben" - ein Handschlag in zwei Schritten, auf den sich das Modell
// halten musste. Im Lauf vom 2026-10-11 hat es `schreibeBericht` schlicht
// übersprungen und direkt `fasseZusammen` gerufen; der Abschlusstext kam damit
// vom Hauptagenten. `schreibeBericht` ist deshalb entfallen, und
// `fasseZusammen` läuft selbst durch diesen Agenten - es gibt keinen Weg
// vorbei, der nur an einem Prompt-Appell hängt.

import { createLLMAgent } from "@arcgis/ai-components/agent-utils/index.js";

import { MODEL_TIER } from "../config.js";
import { frage } from "./agentlauf.js";

const BERICHT_PROMPT = `
Du schreibst den Abschlusstext eines räumlichen Erstscreenings.

Du bekommst die Befunde als Fakten übergeben - Region, geprüfte Belange,
Fundstellen, gefundene Objekte mit Zahlen. Mach daraus 3 bis 6 kurze Sätze.

Regeln, die nicht verhandelbar sind:
- ÜBERNIMM die Zahlen wörtlich. Rechne nichts um, runde nichts, addiere nichts.
  Die Zahlen stammen aus Messungen; eine davon abweichende Angabe im Text ist
  ein Fehler, auch wenn sie plausibler klingt. Der Code prüft jede Ziffernfolge
  in deinem Text gegen die Fakten - was dort nicht steht, lässt den ganzen Text
  verwerfen.
- BEWERTE NICHT die Raumverträglichkeit oder Zulässigkeit. Du stellst fest,
  was im Untersuchungsraum liegt, und benennst, was vertieft zu betrachten ist.
- Keine Spekulation über nicht erfasste Objekte, kein "möglicherweise
  unvollständig". Fehlt etwas, sag was fehlt.
- Nenne die Planungsregion und den geltenden Plan beim Namen.

Kein Vorspann, keine Überschrift, keine Aufzählungszeichen - nur die Sätze.
`.trim();

let _agent = null;

async function agentHolen() {
  if (!_agent) {
    _agent = await createLLMAgent({
      name: "BerichtAgent",
      description: "Formuliert den Abschlusstext aus den übergebenen Befunden.",
      prompt: BERICHT_PROMPT,
      modelTier: MODEL_TIER,
      tools: [],
    });
  }
  return _agent;
}

/**
 * Lässt den BerichtAgent aus den übergebenen Fakten formulieren.
 *
 * @param {string} fakten Die Befunde in Stichpunkten, mit allen Zahlen.
 * @returns {Promise<{text: string, ok: boolean}>}
 */
export async function formuliereBericht(fakten) {
  const agent = await agentHolen();
  return frage(agent, `Befunde:\n${fakten}`, "Bericht-Agent");
}
