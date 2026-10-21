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
import { KATEGORIEN, getKategorie, kategorienListe } from "./kategorien.js";
import {
  makeHoleRegionalplan,
  makeHoleRechtsgrundlage,
  makeErmittleBelange,
  makeBeschreibeLayer,
  makeQueryLayer,
  layerFuerKategorieGesamt,
  mitFortschritt,
} from "./tools.js";
import { frage } from "./agentlauf.js";
import { merkeRecherche, getAnalyse } from "./analyse.js";

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
   RADIUS: <Meterzahl AUS DEM TEXT mit Fundstelle, sonst ->

RADIUS - hier gilt eine harte Regel: Nenne eine Meterzahl NUR, wenn sie im
abgerufenen Text steht. Eine Entfernung, ein Abstandsgebot, eine Breite, ein
Umgebungsschutz - was du angibst, muss im Wortlaut vorkommen, in Ziffern
("1.000 m") oder als Zahlwort ("fünf Meter"). Schreib die Fundstelle dazu.
Steht dort keine Zahl, setze RADIUS auf "-". Erfinde keine, schätze keine,
leite keine aus Erfahrung ab: Der Code prüft die Zahl gegen die Passagen, und
eine nicht belegte Weite wird im Ergebnis als Modellannahme gekennzeichnet.

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
   RADIUS: <Meterzahl AUS DEM TEXT mit Fundstelle, sonst ->

RADIUS - hier gilt eine harte Regel: Nenne eine Meterzahl NUR, wenn sie im
abgerufenen Text steht. Eine Entfernung, ein Abstandsgebot, eine Breite, ein
Umgebungsschutz - was du angibst, muss im Wortlaut vorkommen, in Ziffern
("1.000 m") oder als Zahlwort ("fünf Meter"). Schreib die Fundstelle dazu.
Steht dort keine Zahl, setze RADIUS auf "-". Erfinde keine, schätze keine,
leite keine aus Erfahrung ab: Der Code prüft die Zahl gegen die Passagen, und
eine nicht belegte Weite wird im Ergebnis als Modellannahme gekennzeichnet.

Gib den Wortlaut NICHT wieder. Keine Zulässigkeitsbewertung.
`.trim();

/** Auftrag an einen Recherche-Subagenten - eine Kategorie, ein Vorhaben. */
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
const BELANGE_PROMPT = `
Du klärst, welche Belange bei einem Vorhaben überhaupt zu prüfen sind. Du
entscheidest das NICHT aus eigenem Wissen, sondern liest es im Gesetzestext
nach.

1. Rufe ermittleBelange mit dem Vorhaben auf - genau EINMAL.
2. Du bekommst zwei Quellen zurück, und sie beantworten verschiedene Fragen:
   - passagen: die Aufzählung der öffentlichen Belange, allen voran § 35
     Abs. 3 BauGB. Ein Katalog, über die Suche gefunden.
   - ankernormen: je Kategorie die Norm, die den Tatbestand dieses Belangs
     trägt - § 39 LFoG NRW für die Waldumwandlung, § 9 DSchG NRW für die
     Erlaubnis am Baudenkmal, § 38 WHG für den Gewässerrandstreifen. Die sind
     NICHT gesucht, sondern über ihre Fundstelle geholt. Sie sind also sicher
     die richtige Norm zu dieser Kategorie.
3. Ordne JEDE Kategorie des Katalogs einer von drei Gruppen zu.

Warum beide Quellen nötig sind: § 35 Abs. 3 BauGB ist der Kern des
Planungsrechts, aber NICHT abschliessend - Belange mit eigenem
Genehmigungstatbestand stehen nicht darin. Der Wald ist der Musterfall: die
Waldumwandlung regelt § 39 LFoG NRW, und in den Passagen taucht er deshalb nie
auf. Genau dafür liegen die Ankernormen daneben.

Die Frage je Kategorie lautet: Kann ein Vorhaben dieser Art den Tatbestand
dieser Norm auslösen? Nicht: liegt hier konkret so etwas? Das klärt später die
Kartenabfrage. Und nicht: wozu GEHÖRT das Vorhaben? Gefragt sind die FREMDEN
Belange - bei einer Windenergieanlage ist "Energie" der uninteressanteste.

Antworte ohne Vorrede, je Kategorie eine Zeile:
   <kategorieId>: BELEGT – <Fundstelle>
   <kategorieId>: NICHT BERÜHRT – <Fundstelle, und welches Tatbestandsmerkmal fehlt>
   <kategorieId>: OFFEN – <nur wenn in ankerFehlend, also keine Norm vorlag>

NICHT BERÜHRT nur, wenn ein Vorhaben dieser Bauart den Tatbestand gar nicht
auslösen kann - etwa Waldumwandlung bei einer Anlage ausschliesslich im
Siedlungsbereich. Dass eine hohe Anlage viele Belange berührt, ist fachlich
richtig und kein Fehler; die Abstufung läuft später über den Radius.

Keine Kategorie auslassen. Keine Zulässigkeitsbewertung.
`.trim();

// ── Phase 2: ein Subagent je Kategorie ─────────────────────────────────────
//
// WARUM AUCH HIER EIN SUBAGENT:
// Die Layerabfrage war der letzte Schritt, den der Hauptagent selbst gemacht
// hat - und der teuerste. Je Kategorie braucht sie `beschreibeLayer` fuer die
// Layerliste, dann `beschreibeLayer(layerTitel)` je Layer fuer Felder und
// Domaenen, dann `queryLayer` je Layer. Alle diese Antworten bleiben in der
// Nachrichtenhistorie des Hauptagenten und gehen bei JEDER weiteren Runde
// erneut mit; ein Layer mit langen Domaenenlisten hat einen Lauf schon
// gekippt (daher MAX_FELDER / MAX_CODES in beschreibeLayer).
//
// Hier bleibt all das im Kontext eines kurzlebigen Agenten, der genau EINE
// Kategorie bearbeitet. Zum Hauptagenten kommen wenige Zeilen zurueck. Die
// Zahlen landen davon unabhaengig im Store, weil `queryLayer` sie dort
// hineinschreibt - der Datenweg aendert sich also nicht.
const LAYER_PROMPT = `
Du prüfst für EINE Kategorie, was im Untersuchungsraum liegt. Du bekommst die
Kategorie genannt und arbeitest nur an ihr.

1. beschreibeLayer ohne Argumente - welche Layer gibt es.
   Die Kategorie am Layer ist ein Vorschlag aus einem TITEL-Muster, keine
   Wahrheit. Geh die Liste durch und prüfe auch Layer OHNE passenden Titel: in
   diesem Datenbestand steckt Einschlägiges oft in unscheinbar benannten
   Layern - Schutzgebiete in "Flächen weiterer Nutzung", Leitungen in
   "Bauwerke und Einrichtungen". Die BESCHREIBUNG verrät das, nicht der Titel.

2. Für JEDEN Layer, den du abfragen willst, zuerst beschreibeLayer(layerTitel).
   Ein Layertitel sagt, WO etwas liegt, nicht WAS es fachlich ist:
   "Verkehrswege" enthält Autobahn und Wirtschaftsweg, "Gewässerlinien" Fluss
   und Entwässerungsgraben. Feldnamen und Codes nimmst du von dort. Erfundene
   Feldnamen weist queryLayer zurück.

3. queryLayer für JEDEN passenden Layer - nicht nur den erstbesten. "Wald"
   steckt sowohl in "Laub- und Nadelbäume" als auch in "Vegetationsflächen";
   wer nur einen abfragt, meldet die halbe Wahrheit. Die Abfrage läuft
   automatisch gegen die Zone dieser Kategorie - du musst nichts puffern.
   - where: grenzt auf die Ausprägungen ein, die raumbedeutsam sind. Ein
     Anbauverbot nach § 9 FStrG gilt für klassifizierte Straßen, nicht für
     jeden Feldweg.
   - gruppeFeld: NUR ein Feld aus "klassifizierendeFelder" von
     beschreibeLayer. Nimm das Feld, dessen Ausprägungen raumordnerisch etwas
     unterscheiden - Straßenklasse, Schutzgebietstyp, Gewässerart,
     Vegetationstyp. NICHT Name, Nummer, Datum oder Kennung: die trennen
     Objekte, aber keine Sachverhalte. Ist die Liste leer, frage ohne
     gruppeFeld ab, statt eines zu erfinden.
   - Kommt "filterVerworfen" zurück, traf dein where nichts und es wurde ohne
     Filter gemessen. Das Ergebnis STEHT - nicht wiederholen.
   - 0 Objekte ist ein gültiges Ergebnis. Nicht mit neuen where-Varianten
     nachbohren.

Antworte danach ohne Vorrede, je abgefragtem Layer eine Zeile:
   <Layertitel>: <Anzahl> Objekte, <Fläche oder Länge>, Aufteilung nach <Feld>
Und eine Zeile je Layer, den du bewusst NICHT abgefragt hast:
   <Layertitel>: übersprungen – <halber Satz, warum fachlich nicht einschlägig>

Übernimm die Zahlen wörtlich aus queryLayer. Rechne nichts um, runde nichts.
Keine Bewertung der Raumverträglichkeit oder Zulässigkeit.
`.trim();

const _cache = new Map();

export function rechercheCacheLeeren() {
  _cache.clear();
}

/**
 * Baut die beiden Subagenten und das Werkzeug, über das der Hauptagent sie
 * anspricht.
 */
export async function baueRechercheTools() {
  const [rpTool, gesetzTool, belangeTool, beschreibeTool, queryTool] = await Promise.all([
    makeHoleRegionalplan(),
    makeHoleRechtsgrundlage(),
    makeErmittleBelange(),
    makeBeschreibeLayer(),
    makeQueryLayer(),
  ]);

  const [rpAgent, gesetzAgent, belangeAgent, layerAgent] = await Promise.all([
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
    createLLMAgent({
      name: "BelangeAgent",
      description:
        "Liest im Gesetzestext nach, welche öffentlichen Belange bei einem Vorhaben " +
        "dieser Art zu prüfen sind.",
      prompt: BELANGE_PROMPT,
      modelTier: MODEL_TIER,
      tools: [belangeTool],
    }),
    createLLMAgent({
      name: "LayerAgent",
      description:
        "Fragt für EINE Kategorie die passenden Kartenlayer ab und verschneidet sie mit " +
        "deren Untersuchungszone.",
      prompt: LAYER_PROMPT,
      modelTier: MODEL_TIER,
      tools: [beschreibeTool, queryTool],
    }),
  ]);

  // ── Belange klären ──────────────────────────────────────────────────────
  const klaereBelange = await createFunctionTool({
    name: "klaereBelange",
    description:
      "ERSTER fachlicher Schritt, GENAU EINMAL je Lauf. Lässt im Gesetzestext nachlesen, " +
      "welche Belange bei einem Vorhaben dieser Art zu prüfen sind - allen voran die " +
      "Aufzählung in § 35 Abs. 3 BauGB, dazu je Kategorie die Ankernorm, die den Tatbestand " +
      "des Belangs trägt (§ 39 LFoG NRW für die Waldumwandlung). Liefert je Kategorie " +
      "BELEGT, NICHT BERÜHRT (beides mit Fundstelle) oder OFFEN. Du bildest diese Liste " +
      "NICHT aus eigenem Wissen; recherchiere danach ALLE Gruppen einzeln.",
    inputSchema: await createSchema({
      vorhaben: {
        type: "string",
        description:
          "Die geplante Maßnahme in Kurzform, z. B. \"Errichtung einer Windenergieanlage " +
          "im Außenbereich\". Nimm den Nutzerkommentar mit auf, falls einer vorliegt.",
        required: true,
      },
    }),
    execute: async ({ vorhaben }) => {
      const auftrag =
        `Vorhaben: ${vorhaben}\n` +
        `Katalog der Kategorien:\n${kategorienListe()}\n` +
        `Rufe ermittleBelange mit vorhaben="${vorhaben}" auf und ordne danach jede ` +
        "Kategorie zu.";
      // Acht Zeilen Einstufung brauchen Platz - mit dem Standarddeckel von
      // 600 Zeichen fielen die letzten Kategorien stillschweigend weg.
      let b = await frage(belangeAgent, auftrag, "Belange-Agent", {
        maxText: 2000,
        maxLog: 1200,
      });

      // VOLLSTÄNDIGKEIT, deterministisch geprüft und einmal nachgefasst.
      //
      // Im Lauf vom 2026-10-11 hat der Subagent nach `verkehr` abgebrochen und
      // nur 5 der 8 Kategorien eingestuft - energie, landwirtschaft und
      // kulturlandschaft fehlten, obwohl der Prompt "Keine Kategorie auslassen"
      // verlangt. Folgeschaden gab es nicht, weil der Hauptagent trotzdem alle
      // acht recherchierte; verlassen kann man sich darauf aber nicht.
      //
      // Erkennung im Code, Korrektur durch das Modell - dasselbe Muster wie
      // `fehlendeKategorien()` und `offeneLayer()`. Genau EINE Nachfrage: eine
      // Schleife würde bei einem hartnäckig schweigenden Modell den Lauf
      // blockieren, und das Ergebnis ist ohnehin nur eine Vorprüfung.
      if (b.ok) {
        const fehlen = FB_IDS.filter((id) => !new RegExp(`\\b${id}\\b`, "i").test(b.text));
        if (fehlen.length) {
          console.warn(
            `[subagent] Belange-Agent: ${fehlen.length} Kategorie(n) nicht eingestuft, fasse nach:`,
            fehlen.join(", "),
          );
          const nach = await frage(
            belangeAgent,
            `Diese Kategorien fehlen in deiner Einstufung: ${fehlen.join(", ")}.\n` +
              "Stufe NUR diese ein, im selben Format, je Kategorie eine Zeile. " +
              "Die Ankernormen liegen dir vor; rufe ermittleBelange NICHT erneut auf.",
            "Belange-Agent (Nachfrage)",
            { maxText: 1200, maxLog: 800 },
          );
          if (nach.ok) b = { ...b, text: `${b.text}\n${nach.text}` };
        }
      }

      if (!b.ok) {
        return {
          belangeFehlgeschlagen: true,
          text: b.text,
          naechsterSchritt:
            "Die Belange-Klärung ist ausgefallen. Arbeite ersatzweise den vollständigen " +
            "Katalog ab und recherchiere jede Kategorie einzeln.",
        };
      }
      return {
        vorhaben,
        einstufung: b.text,
        naechsterSchritt:
          "Recherchiere jetzt JEDE genannte Kategorie einzeln mit recherchiere - BELEGTE, " +
          "NICHT BERÜHRTE und OFFENE. Verworfen wird erst danach und nur mit Begründung; " +
          "die Einstufung hier ist die Vorprüfung, nicht das Ergebnis.",
      };
    },
  });

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

  // ── Phase 2: Layerabfrage je Kategorie ──────────────────────────────────
  const pruefeKategorie = await createFunctionTool({
    name: "pruefeKategorie",
    description:
      "PHASE 2 für EINE Kategorie, je relevanter Kategorie GENAU EINMAL. Lässt einen " +
      "eigenen Subagenten die passenden Kartenlayer finden, deren Felder prüfen und sie " +
      "gegen die Untersuchungszone dieser Kategorie verschneiden. Er fragt ALLE passenden " +
      "Layer ab, nicht nur den erstbesten, und liefert je Layer Anzahl, Maß und " +
      "Aufteilung. Die Zahlen stehen damit im Ergebnis - du musst sie nicht übernehmen. " +
      "Voraussetzung ist eine Relevanzmeldung: ohne Zone bricht die Abfrage ab.",
    inputSchema: await createSchema({
      kategorieId: {
        type: "string",
        description: "Die zu prüfende Kategorie. Nur Kategorien mit meldeRelevanz.",
        required: true,
        enum: FB_IDS,
      },
    }),
    execute: async ({ kategorieId }) => {
      const fb = getKategorie(kategorieId);
      if (!fb) return { fehler: `Unbekannte Kategorie "${kategorieId}".` };

      // Ohne Zone bricht queryLayer ohnehin ab - dann aber erst im Subagenten,
      // nach einer vollen Modellrunde. Hier ist es eine Zeile.
      const an = getAnalyse();
      const relevant = an.relevanz.some((r) => r.kategorieId === kategorieId);
      if (!relevant) {
        return {
          fehler: `Für "${fb.titel}" liegt keine Relevanzmeldung vor.`,
          naechsterSchritt:
            "Melde die Kategorie zuerst mit meldeRelevanz - dort entsteht die Zone, " +
            "gegen die verschnitten wird.",
        };
      }

      // Was in dieser Kategorie schon abgefragt wurde, geht mit: beim
      // Nachfassen (offeneLayer) laeuft pruefeKategorie ein zweites Mal, und
      // der Subagent soll dann die offenen Layer nehmen, nicht die fertigen.
      const fertig = an.abfragen
        .filter((x) => x.kategorieId === kategorieId)
        .map((x) => x.layer);
      const vorschlag = layerFuerKategorieGesamt(kategorieId).map((x) => x.layer.title);

      const auftrag =
        `Kategorie: ${fb.titel} (id: ${kategorieId})
` +
        `Fachlicher Rahmen: ${fb.rechtsrahmen}
` +
        (vorschlag.length ? `Layer-Vorschlag aus den Titelmustern: ${vorschlag.join(", ")}
` : "") +
        (fertig.length
          ? `BEREITS abgefragt, nicht wiederholen: ${fertig.join(", ")}
`
          : "") +
        `Arbeite die Schritte 1 bis 3 für kategorieId="${kategorieId}" ab.`;

      // Hoeheres Limit als bei der Recherche: je Kategorie faellt
      // beschreibeLayer einmal fuer die Liste, dann je Layer einmal fuer die
      // Felder, dann je Layer ein queryLayer - bei vier Layern sind das rund
      // ein Dutzend Schritte. Mit dem Recherche-Limit von 8 braeche er
      // mitten im zweiten Layer ab.
      // 1500 Zeichen waren zu knapp: im Lauf vom 2026-10-11 war die Antwort
      // fuer "energie" 2234 Zeichen lang und wurde gekuerzt. Je Layer eine
      // Zeile plus die uebersprungenen summiert sich bei Kategorien mit
      // vielen Layern.
      const b = await frage(layerAgent, auftrag, `Layer-Agent (${kategorieId})`, {
        maxText: 3000,
        maxLog: 900,
        recursionLimit: 40,
      });

      const danach = getAnalyse().abfragen.filter((x) => x.kategorieId === kategorieId);
      if (!b.ok) {
        return {
          layerFehlgeschlagen: true,
          kategorieId,
          text: b.text,
          abgefragteLayer: danach.map((x) => x.layer),
          naechsterSchritt:
            "Die Layerprüfung ist ausgefallen. Fahre mit der nächsten Kategorie fort; " +
            "was bereits gemessen wurde, steht im Ergebnis.",
        };
      }
      return {
        kategorieId,
        kategorie: fb.titel,
        befund: b.text,
        abgefragteLayer: danach.map((x) => ({
          layer: x.layer,
          anzahl: x.anzahl,
          flaecheM2: x.flaecheM2,
          laengeM: x.laengeM,
        })),
        naechsterSchritt:
          "Die Zahlen stehen im Ergebnis. Nimm die nächste relevante Kategorie, und wenn " +
          "alle durch sind, fasseZusammen.",
      };
    },
  });

  // `schreibeBericht` ist absichtlich NICHT mehr dabei: der Abschlusstext
  // laeuft jetzt ueber fasseZusammen -> formuliereBericht(), damit es keinen
  // zweiten Weg gibt, den das Modell umgehen kann.
  return mitFortschritt([klaereBelange, recherchiere, pruefeKategorie]);
}
