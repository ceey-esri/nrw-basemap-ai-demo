// Zwei Recherche-Subagenten: einer für den Regionalplan, einer für das
// Fachrecht. Der Hauptagent spricht beide über EIN Werkzeug an.
//
// WARUM ALS SUBAGENT UND NICHT ALS WERKZEUG DES HAUPTAGENTEN:
// Eine RAG-Antwort umfasst mehrere Gesetzes- bzw. Planpassagen. Laufen die
// Aufrufe direkt im Hauptagenten, landet jede Passage in seiner
// Nachrichtenhistorie - und die wird bei JEDER weiteren Modellrunde erneut
// übertragen. Nach einem Dutzend Recherchen ist der Kontext aufgebläht.
//
// Hier läuft die Recherche in einem eigenen, kurzlebigen Agenten. Die
// Passagen bleiben in dessen Kontext; zum Hauptagenten kommt nur ein
// verdichtetes Ergebnis von wenigen Zeilen zurück. Der Volltext steht
// weiterhin im Ergebnispanel, weil die Werkzeuge ihn in den Store schreiben.
//
// WARUM EIN WERKZEUG FUER BEIDES (Tempo):
// Regionalplan- und Gesetzesrecherche hängen nicht voneinander ab. Als zwei
// getrennte Werkzeuge braucht der Hauptagent pro Kategorie zwei Modellrunden
// und beide RAG-Läufe nacheinander. Gebündelt laufen sie über Promise.all
// gleichzeitig und kosten den Hauptagenten nur EINE Runde - bei acht
// Kategorien also 8 statt 16 Runden. Zusätzlich cacht `_cache` je
// (Region, Kategorie), damit eine Wiederholung gar nicht erst ans Modell geht.

import { createFunctionTool, createSchema } from "@arcgis/ai-components/agent-utils/index.js";
import { createLLMAgent } from "@arcgis/ai-components/agent-utils/index.js";

import { MODEL_TIER } from "../config.js";
import { KATEGORIEN, getKategorie } from "./kategorien.js";
import { makeHoleRegionalplan, makeHoleRechtsgrundlage, mitFortschritt } from "./tools.js";
import { meldeSchritt } from "./fortschritt.js";
import { merkeRecherche } from "./analyse.js";

const FB_IDS = KATEGORIEN.map((f) => f.id);

const RP_PROMPT = `
Du recherchierst im geltenden Regionalplan. Du bekommst eine Kategorie und ein
Vorhaben genannt.

Deine Frage: Kann ein Vorhaben DIESER ART den Belang räumlich oder funktional
BERÜHREN? Nicht die Lage des Einzelfalls, sondern die Art des Vorhabens.

WICHTIG - so ist ein Regionalplan gebaut: Er regelt GEBIETE, nicht
Vorhabenarten. In den Zielen und Grundsätzen steht "Vorranggebiet für den
Schutz der Natur", nicht "Windenergieanlagen". Du darfst deshalb NICHT
verlangen, dass eine Festlegung den Vorhabentyp namentlich nennt - dann fändest
du fast nie etwas. Gesucht ist die Festlegung, die dieser Vorhabentyp berühren
KANN.

RELEVANT: ja  wenn ein Vorhaben dieser Art Flächen, Funktionen oder
  Schutzzwecke dieses Belangs in Anspruch nehmen, überbauen, zerschneiden,
  überprägen oder in seinem Wirkraum beeinträchtigen kann. Das ZITAT nennt
  dann die einschlägigste Festlegung.

Verwechsle NICHT Zugehörigkeit mit Wirkung: Dass das Vorhaben selbst zu einem
Fachbereich gehört (eine Windenergieanlage zu "Energie", eine Strasse zu
"Verkehr"), sagt nichts darüber, ob es DIESEN Belang berührt. Gefragt ist die
Wirkung auf den genannten Belang, nicht die Einordnung des Vorhabens.

RELEVANT: nein nur wenn ein Vorhaben dieser Art den Belang seiner Bauart nach
  typischerweise gar nicht berühren kann - etwa Wald bei einer Anlage
  ausschliesslich im Siedlungsbereich, oder Gewässer bei einem Mobilfunkmast
  auf einem Bestandsgebäude.

Die Feinabstufung machst du NICHT über ja/nein, sondern über RADIUS: ein
Belang mit weitem Wirkraum bekommt einen grossen, ein nur bei direkter
Inanspruchnahme berührter Belang einen kleinen Radius (0 = nur die
Vorhabenfläche). So bleibt sichtbar, was stark und was schwach betroffen ist,
ohne dass ein Belang aus dem Screening verschwindet.

Du darfst NIE mit "ohne Kenntnis der konkreten Lage nicht anzunehmen"
antworten - ob im Umfeld etwas liegt, klärt danach die räumliche Analyse.

1. Rufe holeRegionalplan mit kategorieId UND vorhaben auf - genau EINMAL.
2. Antworte in HÖCHSTENS 4 Zeilen, ohne Vorrede:
   RELEVANT: ja | nein
   ZITAT: <Nummer und Titel der einschlägigsten Festlegung, sonst ->
   KERN: <ein Satz: WIE dieser Vorhabentyp den Belang berühren kann>
   RADIUS: <Metervorschlag mit halbem Satz Herleitung, sonst ->

Gib den Wortlaut NICHT wieder - er steht dem Nutzer bereits zur Verfügung.
Bewerte NICHT, ob das Vorhaben einem Ziel widerspricht.
Findet die Suche gar nichts, antworte trotzdem nach der Sachlage und setze
ZITAT auf "-".
`.trim();

const GESETZ_PROMPT = `
Du recherchierst im Gesetzeskorpus (Bundes- und NRW-Recht). Du bekommst eine
Kategorie und ein Vorhaben genannt.

Deine Frage: Kann ein Vorhaben DIESER ART den Belang räumlich oder funktional
BERÜHREN, sodass das Fachrecht dieses Belangs zur Anwendung kommt? Nicht die
Lage des Einzelfalls, sondern die Art des Vorhabens.

WICHTIG: Fachgesetze sind schutzgutbezogen formuliert, nicht
vorhabenbezogen - das BNatSchG spricht von Eingriffen, nicht von
Windenergieanlagen. Verlange deshalb NICHT, dass eine Norm den Vorhabentyp
namentlich nennt. Eine allgemeine Eingriffs-, Genehmigungs- oder
Ausgleichsregelung, die dieser Vorhabentyp auslösen kann, genügt.

RELEVANT: ja  wenn ein Vorhaben dieser Art den Schutzgegenstand berühren und
  damit die Normen dieses Belangs auslösen kann.

Verwechsle NICHT Zugehörigkeit mit Wirkung: Dass das Vorhaben selbst zu einem
Fachbereich gehört (eine Windenergieanlage zu "Energie", eine Strasse zu
"Verkehr"), sagt nichts darüber, ob es DIESEN Belang berührt. Gefragt ist die
Wirkung auf den genannten Belang, nicht die Einordnung des Vorhabens.

RELEVANT: nein nur wenn ein Vorhaben dieser Art den Schutzgegenstand seiner
  Bauart nach typischerweise gar nicht berührt.

Die Feinabstufung machst du NICHT über ja/nein, sondern über RADIUS.

Antworte NIE mit "ohne Kenntnis der konkreten Lage nicht anzunehmen" - ob im
Umfeld etwas liegt, klärt danach die räumliche Analyse.

1. Rufe holeRechtsgrundlage mit kategorieId UND vorhaben auf - genau EINMAL.
2. Antworte in HÖCHSTENS 4 Zeilen, ohne Vorrede:
   RELEVANT: ja | nein
   ZITAT: <Gesetz und Paragraph, sonst ->
   KERN: <ein Satz: WIE dieser Vorhabentyp den Belang berührt>
   RADIUS: <Metervorschlag aus einem Abstandserfordernis, sonst ->

Gib den Wortlaut NICHT wieder. Keine Zulässigkeitsbewertung.
`.trim();

/** Ruft einen Subagenten auf und liefert seinen Kurzbefund als Text. */
/** Fehlertexte des Modelldienstes, die als normale Antwort ankommen können. */
const DIENST_FEHLER = /\b429\b|too many requests|rate.?limit|high demand/i;

/**
 * Ruft einen Subagenten auf und liefert seinen Kurzbefund als Text.
 *
 * @returns {Promise<{text: string, ok: boolean}>}
 */
async function frage(agent, auftrag, label) {
  try {
    const state = await agent.run(
      { outputMessage: auftrag, summary: auftrag },
      { recursionLimit: 8 },
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
    console.info(`[subagent] ${label}:`, antwort.slice(0, 300));
    return { text: antwort.slice(0, 600), ok: true };
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

function auftragstext(fbId, vorhaben) {
  const fb = getKategorie(fbId);
  return (
    `Vorhaben: ${vorhaben || "(nicht genannt)"}\n` +
    `Kategorie: ${fb?.titel ?? fbId} (id: ${fbId})\n` +
    (vorhaben
      ? `Rufe das Recherche-Werkzeug mit kategorieId="${fbId}" und vorhaben="${vorhaben}" auf.`
      : `Rufe das Recherche-Werkzeug mit kategorieId="${fbId}" auf.`)
  );
}

/** Ergebnisse je (Region, Kategorie, Vorhaben) - eine Wiederholung kostet nichts. */
const _cache = new Map();

export function rechercheCacheLeeren() {
  _cache.clear();
}

/**
 * Baut die beiden Subagenten und das Werkzeug, über das der Hauptagent sie
 * anspricht.
 */
export async function baueRechercheTools() {
  const [rpTool, gesetzTool] = await Promise.all([
    makeHoleRegionalplan(),
    makeHoleRechtsgrundlage(),
  ]);

  const [rpAgent, gesetzAgent] = await Promise.all([
    createLLMAgent({
      name: "RegionalplanAgent",
      description: "Recherchiert Ziele und Grundsätze im geltenden Regionalplan.",
      prompt: RP_PROMPT,
      modelTier: MODEL_TIER,
      tools: [rpTool],
    }),
    createLLMAgent({
      name: "GesetzAgent",
      description: "Recherchiert einschlägige Normen im Gesetzeskorpus.",
      prompt: GESETZ_PROMPT,
      modelTier: MODEL_TIER,
      tools: [gesetzTool],
    }),
  ]);

  const recherchiere = await createFunctionTool({
    name: "recherchiere",
    description:
      "Lässt Regionalplan und Fachrecht zu EINER Kategorie GLEICHZEITIG recherchieren. " +
      "Liefert zwei Kurzbefunde im Format RELEVANT / ZITAT / KERN / RADIUS - einen aus dem " +
      "geltenden Regionalplan, einen aus dem Gesetzeskorpus. Das ist die einzige Recherche, " +
      "die du brauchst: rufe sie je Kategorie GENAU EINMAL auf. " +
      "Der volle Wortlaut der Passagen erscheint automatisch im Ergebnispanel.",
    inputSchema: await createSchema({
      kategorieId: {
        type: "string",
        description: "Die zu recherchierende Kategorie.",
        required: true,
        enum: FB_IDS,
      },
      vorhaben: {
        type: "string",
        description:
          "Die geplante Maßnahme in Kurzform, z. B. \"Neubau einer Straße\" oder \"Errichtung " +
          "einer Windenergieanlage\". PFLICHT - ohne sie sucht die Recherche nach dem Belang " +
          "an sich statt nach der Wirkung des Vorhabens auf ihn.",
        required: true,
      },
    }),
    execute: async ({ kategorieId, vorhaben }) => {
      // Der Vermerk gehört VOR die Recherche und unabhängig vom Befund: das
      // Modell hat schon alle acht Kategorien recherchiert und danach keine
      // einzige gemeldet. Das Ergebnispanel schrieb dann "nicht betrachtet" -
      // betrachtet wurden sie sehr wohl, nur nicht eingestuft.
      merkeRecherche(kategorieId);
      const key = `${kategorieId}|${vorhaben ?? ""}`;
      if (_cache.has(key)) return { ..._cache.get(key), ausCache: true };

      const auftrag = auftragstext(kategorieId, vorhaben);
      const [rp, gs] = await Promise.all([
        frage(rpAgent, auftrag, "Regionalplan-Agent"),
        frage(gesetzAgent, auftrag, "Gesetzes-Agent"),
      ]);

      // Hat KEINER der beiden geantwortet, ist das ein Ausfall der Recherche -
      // kein fachlicher Befund. Ohne diese Unterscheidung verwarf der
      // Hauptagent bei einem Dienstausfall alle acht Kategorien mit der
      // Begründung "keine verwertbaren Zitate"; das Ergebnis sah dann aus wie
      // eine Prüfung, war aber keine. Das Zwischenergebnis wird in diesem Fall
      // NICHT gecacht, damit ein späterer Versuch es erneut probiert.
      if (!rp.ok && !gs.ok) {
        return {
          kategorieId,
          rechercheFehlgeschlagen: true,
          regionalplan: rp.text,
          fachrecht: gs.text,
          naechsterSchritt:
            "Die Recherche ist AUSGEFALLEN - beide Quellen haben nicht geantwortet. Melde " +
            "diese Kategorie deshalb WEDER mit meldeRelevanz NOCH mit meldeNichtRelevant: " +
            "ein Ausfall der Werkzeuge ist kein fachlicher Befund. Sag im Text, dass die " +
            "Recherche nicht verfügbar war, und mach mit der nächsten Kategorie weiter.",
        };
      }

      const ergebnis = {
        kategorieId,
        regionalplan: rp.text,
        fachrecht: gs.text,
        // Der Punkt, an dem die Entscheidung faellt - deshalb steht die
        // Meldepflicht hier und nicht nur im Prompt.
        naechsterSchritt:
          "Melde diese Kategorie JETZT: meldeRelevanz, sobald WENIGSTENS EINER der beiden " +
          "Kurzbefunde auf \"RELEVANT: ja\" steht - ein leeres ZITAT ist dafür kein " +
          "Hindernis, entscheidend ist, OB dieser Vorhabentyp den Belang berühren kann. " +
          "meldeNichtRelevant nur, wenn BEIDE auf \"nein\" stehen UND du in einem Satz " +
          "sagen kannst, warum ein Vorhaben dieser Art den Belang gar nicht berührt. " +
          "Genau eine der beiden Meldungen, keine Kategorie ohne Meldung.",
      };
      _cache.set(key, ergebnis);
      return ergebnis;
    },
  });

  return mitFortschritt([recherchiere]);
}
