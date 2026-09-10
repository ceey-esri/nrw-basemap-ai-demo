// Screening-Agenten (Hybrid-Architektur).
//
// Custom Agents = LLMAgent / WorkflowAgent (Entscheidung aus CLAUDE.md): laufen
// ueber Esris gehostete Modelle, verbrauchen ArcGIS-Credits, kein eigenes
// Modell-Backend.
//
// Registriert an die <arcgis-assistant>:
//   1. TRIAGE-Agent - ermittelt und begruendet, welche Rechtsgebiete fuer das
//      konkrete Vorhaben relevant sind, und setzt die Pruefbereich-Haken.
//   2. KOORDINATOR ("GesamtScreeningAgent") - prueft die (angehakten)
//      Rechtsgebiete in einem Durchlauf, schreibt Vermerk + Field-Maps-Tasks.
//      Technisch WorkflowAgent (SequentialWorkflow ueber die Fach-Agenten +
//      Synthese-Agent); Fallback: einzelner kombinierter LLMAgent.
//   3. Je Rechtsgebiet ein FACH-Agent - fuer gezielte Einzel-/Nachfragen.

import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/ai-components/components/arcgis-assistant-agent";
import {
  createLLMAgent,
  createWorkflowAgent,
  createSequentialWorkflow,
} from "@arcgis/ai-components/agent-utils/index.js";

import { MODEL_TIER } from "../config.js";
import { PRUEFBEREICHE } from "./pruefbereiche.js";
import { baueTools, baueSyntheseTools } from "./tools.js";

const HAFTUNG =
  'Das ist ein Screening-/Scoping-Beschleuniger, kein Fachgutachten. Keine ' +
  'rechtssicheren Artbestimmungen. Rechtsgrundlagen mit Praefix "PLATZHALTER" ' +
  "sind noch nicht belegt - sage das dazu. Antworte auf Deutsch.";

const BEREICHS_LISTE = PRUEFBEREICHE.map(
  (p) => `- ${p.id}: ${p.titel} - ${p.beschreibung}`,
).join("\n");

// --- Triage -----------------------------------------------------------------
const TRIAGE_PROMPT = `
Du bist der Triage-Schritt eines fachuebergreifenden Genehmigungs-Screenings
(Bauantrag / Bauleitplanung). Ziel: NICHT stur alle Verfahren pruefen, sondern
nur die, die fuer DIESES Vorhaben Sinn ergeben.

Rechtsgebiete:
${BEREICHS_LISTE}

Vorgehen:
1. holeVorhabenKontext aufrufen (Vorhabentyp, Umring, Flaeche).
2. Anhand von Vorhabentyp und Nutzerbeschreibung entscheiden, welche
   Rechtsgebiete relevant sind. Kurze Begruendung je Gebiet - auch fuer die
   NICHT relevanten ("entfaellt, weil ...").
3. setzePruefbereiche mit den relevanten Ids aufrufen.
4. Dem Nutzer die Auswahl + Begruendung zeigen und fragen:
   "Passt das? Dann 'Screening starten' - oder nennen Sie Anpassungen."

Starte NICHT selbst das eigentliche Screening.

${HAFTUNG}
`.trim();

// --- Fach-Agent (ein Rechtsgebiet) ----------------------------------------
function fachPrompt(b) {
  return `
Du bist der Fach-Agent fuer das Rechtsgebiet "${b.titel}" (id: ${b.id}) in einem
fachuebergreifenden Genehmigungs-Screening.

${b.beschreibung}

Vorgehen:
1. holeVorhabenKontext. Steht "${b.id}" NICHT in angehakktePruefbereiche,
   antworte nur "${b.titel}: uebersprungen (nicht als relevant markiert)" und
   rufe KEIN weiteres Tool.
2. beschreibeLayer (ohne Argumente) - welche Layer/Felder gibt es wirklich?
   Die Info kann als Attribut in einem allgemeineren Layer stecken.
3. puffer mit sinnvollem Suchradius (Standard fuer dieses Gebiet: ${b.pufferMeter} m).
4. queryLayer - bei Bedarf mit layerTitel und where (Attributfilter).
5. Nur wenn wirklich keine Datengrundlage existiert: erfrageFehlendeDaten,
   dann meldeBefund mit ampel="ungeprueft".
6. holeRechtsgrundlage fuer die Fundstelle (derzeit Platzhalter).
7. meldeBefund mit Ampel, Aussage, Verfahren, Behoerde, Rechtsgrundlage.
   Genau EIN Befund.
8. Kannst du einen Aspekt nicht abschliessend klaeren (nur vor Ort pruefbar,
   Schwellenwert/Abgrenzung unklar, Datenwiderspruch): merkePruefpunkt aufrufen.

Zustaendige Behoerde (Anhalt): ${b.behoerde}. Typisches Verfahren: ${b.verfahren}.

${HAFTUNG}
`.trim();
}

function fachBeschreibung(b) {
  return (
    `Prueft NUR das Rechtsgebiet "${b.titel}" fuer den gezeichneten Vorhabenumring. ` +
    `Nutze diesen Agent fuer gezielte Einzelfragen oder Nachpruefungen zu diesem Thema. ` +
    `${b.beschreibung}`
  );
}

// --- Synthese -------------------------------------------------------------
const SYNTHESE_PROMPT = `
Du bist der Abschluss-Schritt des Genehmigungs-Screenings. Die Fach-Agenten
haben ihre Befunde gemeldet.

1. holeBisherigeBefunde aufrufen.
2. schreibeVermerk mit einem kurzen, lesbaren, fachuebergreifenden
   Scoping-Vermerk:
   - ausgeloeste / zu pruefende Verfahren je Rechtsgebiet (Behoerde,
     Rechtsgrundlage),
   - davon klar getrennt die Punkte "nicht geprueft" (Datengrundlage fehlt) -
     diese duerfen NICHT wie unauffaellige Punkte aussehen,
   - Rechtsgebiete ohne Befund.
3. erzeugeTasks aufrufen (schreibt die offenen Pruefpunkte nach ArcGIS Field
   Maps). Wenn 0 Punkte offen sind, trotzdem kurz erwaehnen.
4. Dem Nutzer eine kurze Zusammenfassung geben (2-4 Saetze) inkl. Zahl der
   erzeugten Field-Maps-Aufgaben.

${HAFTUNG}
`.trim();

// --- Fallback-Koordinator (einzelner LLMAgent) --------------------------
const KOORDINATOR_PROMPT = `
Du bist der Koordinator des fachuebergreifenden Genehmigungs-Screenings.

1. holeVorhabenKontext. Ist keine Vorauswahl getroffen bzw. wirken die Haken
   unpassend zum Vorhabentyp: kurz begruenden, welche Rechtsgebiete relevant
   sind, und setzePruefbereiche aufrufen.
2. Fuer JEDES angehakte Rechtsgebiet der Reihe nach:
   beschreibeLayer -> puffer -> queryLayer (ggf. layerTitel/where) ->
   holeRechtsgrundlage -> meldeBefund. Offene Aspekte: merkePruefpunkt.
   Rechtsgebiete:
${BEREICHS_LISTE}
3. holeBisherigeBefunde -> schreibeVermerk (fachuebergreifend, offene Punkte
   klar getrennt) -> erzeugeTasks.
4. Kurze Zusammenfassung fuer den Nutzer.

Wenn ein Treffer auf FFH-Gebiet, Denkmal, Gewaesser o.ae. hindeutet, ziehe die
passende Folgepruefung von dir aus nach.

${HAFTUNG}
`.trim();

const KOORDINATOR_BESCHREIBUNG =
  "Fuehrt das komplette Genehmigungs-Screening fuer den gezeichneten " +
  "Vorhabenumring durch (die als relevant markierten Rechtsgebiete in einem " +
  "Durchlauf), schreibt den Scoping-Vermerk und die Field-Maps-Aufgaben. Nutze " +
  "diesen Agent, wenn der Nutzer das Screening starten will oder allgemein " +
  "fragt, welche Genehmigungen ein Vorhaben ausloest.";

// ---------------------------------------------------------------------------

async function baueTriageAgent() {
  return createLLMAgent({
    name: "TriageAgent",
    description:
      "Ermittelt und begruendet, welche Rechtsgebiete fuer das konkrete Vorhaben " +
      "relevant sind, und setzt die Pruefbereich-Auswahl. ZUERST nutzen - bevor " +
      "das vollstaendige Screening laeuft. Nutze diesen Agent bei Fragen wie " +
      "'welche Genehmigungen koennten relevant sein?' oder 'was muss ich pruefen?'.",
    prompt: TRIAGE_PROMPT,
    modelTier: MODEL_TIER,
    tools: await baueSyntheseTools(),
  });
}

async function baueFachAgent(bereich) {
  return createLLMAgent({
    name: `FachAgent_${bereich.id}`,
    description: fachBeschreibung(bereich),
    prompt: fachPrompt(bereich),
    modelTier: MODEL_TIER,
    tools: await baueTools(bereich.id),
  });
}

async function baueSyntheseAgent() {
  return createLLMAgent({
    name: "SyntheseAgent",
    description: "Fasst die Befunde zu Vermerk + Field-Maps-Aufgaben zusammen.",
    prompt: SYNTHESE_PROMPT,
    modelTier: MODEL_TIER,
    tools: await baueSyntheseTools(),
  });
}

async function baueKoordinator(fachAgenten) {
  try {
    const synthese = await baueSyntheseAgent();
    const workflow = await createSequentialWorkflow({
      agents: [...fachAgenten, synthese],
    });
    return await createWorkflowAgent({
      name: "GesamtScreeningAgent",
      description: KOORDINATOR_BESCHREIBUNG,
      workflow,
    });
  } catch (err) {
    console.warn(
      "[Screening] WorkflowAgent-Koordinator nicht verfuegbar, nutze einzelnen LLMAgent:",
      err,
    );
    const tools = [...(await baueTools()), ...(await baueSyntheseTools())];
    return createLLMAgent({
      name: "GesamtScreeningAgent",
      description: KOORDINATOR_BESCHREIBUNG,
      prompt: KOORDINATOR_PROMPT,
      modelTier: MODEL_TIER,
      tools,
    });
  }
}

/**
 * Baut alle Agenten und haengt sie als <arcgis-assistant-agent> in die
 * uebergebene (noch losgeloeste) <arcgis-assistant>.
 * @param {HTMLElement} assistantEl
 */
export async function initAgents(assistantEl) {
  const [triage, fachAgenten] = await Promise.all([
    baueTriageAgent(),
    Promise.all(PRUEFBEREICHE.map(baueFachAgent)),
  ]);
  const koordinator = await baueKoordinator(fachAgenten);

  for (const agent of [koordinator, triage, ...fachAgenten]) {
    const el = document.createElement("arcgis-assistant-agent");
    el.agent = agent.registration;
    assistantEl.appendChild(el);
  }

  console.info(
    `[Screening] ${2 + fachAgenten.length} Agenten registriert ` +
      `(Koordinator + Triage + ${fachAgenten.length} Fach-Agenten).`,
  );
  return { koordinator, triage, fachAgenten };
}
