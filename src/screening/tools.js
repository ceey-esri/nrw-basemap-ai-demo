// Werkzeuge der Screening-Agenten.
//
// Aufteilung nach Konzept: Der geometrische Verschnitt ist deterministisch und
// braucht keine KI - diese Tools kapseln ihn. Der Agent entscheidet nur, WELCHES
// Tool mit WELCHEN Parametern laeuft und wie die Befunde zu bewerten sind.
//
// `baueTools(bereichId)`:
//   - ohne bereichId  -> generische Tools (pruefbereichId ist ein Parameter);
//                        fuer den Koordinator, der alle Rechtsgebiete abdeckt.
//   - mit bereichId   -> Tools sind fest auf EIN Rechtsgebiet gebunden, der
//                        Parameter pruefbereichId entfaellt; fuer die
//                        Fach-Agenten je Rechtsgebiet.
//
// Stand "Funktionsgeruest":
//   puffer, queryLayer, meldeBefund, erfrageFehlendeDaten  -> voll funktionsfaehig (clientseitig)
//   bilanziereEingriff, holeRechtsgrundlage                -> markierte Stubs (Backend folgt)

import { createFunctionTool, createSchema } from "@arcgis/ai-components/agent-utils/index.js";

import { PRUEFBEREICHE, getPruefbereich } from "./pruefbereiche.js";
import { vorhaben, getMapEl, zeichneAnalyse, geometryEngine } from "../karte.js";
import { meldeBefund, getBefunde, setzeVermerkText } from "./ergebnis.js";
import { getKontext, setzePruefbereiche } from "./kontext.js";
import {
  merkePruefpunkt as queuePruefpunkt,
  schreibePruefpunkte,
  getPruefpunkte,
} from "./tasks.js";

const PRUEFGRUND_WERTE = [
  "datengrundlage_fehlt",
  "attribut_unklar",
  "schwelle_abgrenzung",
  "nur_vor_ort",
  "datenwiderspruch",
];
const PRIO_WERTE = ["hoch", "mittel", "niedrig"];

const AMPEL_WERTE = ["rot", "gelb", "gruen", "ungeprueft"];
const bereichIds = PRUEFBEREICHE.map((p) => p.id);

function requireVorhaben() {
  if (!vorhaben.geometrie) {
    throw new Error(
      "Kein Vorhabenumring vorhanden. Der Nutzer muss zuerst ein Polygon auf die Karte zeichnen.",
    );
  }
  return vorhaben.geometrie;
}

/** Alle abfragbaren (Feature-)Layer der Webmap, flach. */
function alleFeatureLayers() {
  const map = getMapEl()?.map;
  if (!map) return [];
  const out = [];
  map.allLayers.forEach((layer) => {
    if (typeof layer.createQuery === "function" && typeof layer.queryFeatures === "function") {
      out.push(layer);
    }
  });
  return out;
}

/** Layer der Webmap anhand von Titel-Teilstrings finden. */
function findeLayer(muster) {
  return alleFeatureLayers().filter((layer) => {
    const titel = (layer.title ?? "").toLowerCase();
    return muster.some((m) => titel.includes(m.toLowerCase()));
  });
}

/** Genau einen Layer per (Teil-)Titel. */
function findeLayerNachTitel(titel) {
  const t = (titel ?? "").toLowerCase();
  return (
    alleFeatureLayers().find((l) => (l.title ?? "").toLowerCase() === t) ??
    alleFeatureLayers().find((l) => (l.title ?? "").toLowerCase().includes(t)) ??
    null
  );
}

/**
 * Baut ein Zod-Schema. `gebunden` = true laesst das Feld pruefbereichId weg
 * (der Agent ist dann fest auf ein Rechtsgebiet gebunden).
 */
function pruefbereichFeld(gebunden) {
  return gebunden
    ? {}
    : {
        pruefbereichId: {
          type: "string",
          description: "ID des Pruefbereichs.",
          required: true,
          enum: bereichIds,
        },
      };
}

// ---------------------------------------------------------------------------
// puffer - geodaetischer Puffer um den Vorhabenumring (deterministisch)
// ---------------------------------------------------------------------------
async function makePuffer() {
  return createFunctionTool({
    name: "puffer",
    description:
      "Legt einen geodaetischen Puffer (Suchradius) um den gezeichneten Vorhabenumring und zeichnet ihn auf die Karte. " +
      "Nutze das Tool, bevor du mit queryLayer die Umgebung eines Vorhabens abfragst. " +
      "Eingabe: distanzMeter (z.B. 100). Ausgabe: Flaeche des Puffers in Quadratmetern.",
    inputSchema: await createSchema({
      distanzMeter: {
        type: "number",
        description: "Pufferbreite in Metern (0 = kein Puffer, nur der Umring selbst).",
        required: true,
      },
    }),
    execute: ({ distanzMeter }) => {
      const geom = requireVorhaben();
      const puffer =
        distanzMeter > 0
          ? geometryEngine.geodesicBuffer(geom, distanzMeter, "meters")
          : geom;
      zeichneAnalyse(puffer, [55, 138, 221]);
      const flaeche = Math.round(
        Math.abs(geometryEngine.geodesicArea(puffer, "square-meters")),
      );
      return { flaecheM2: flaeche, distanzMeter };
    },
  });
}

// ---------------------------------------------------------------------------
// queryLayer - raeumliche Abfrage eines Pruefbereich-Layers
// ---------------------------------------------------------------------------
async function makeQueryLayer(bereichId) {
  const gebunden = Boolean(bereichId);
  return createFunctionTool({
    name: "queryLayer",
    description:
      "Fragt Kartenlayer" +
      (gebunden
        ? ` des Rechtsgebiets "${getPruefbereich(bereichId)?.titel}"`
        : " eines Pruefbereichs") +
      " raeumlich gegen den Vorhabenumring ab (Schnitt bzw. Naehe). " +
      (gebunden ? "" : `Eingabe: pruefbereichId (${bereichIds.join(", ")}). `) +
      "Optional: pufferMeter, layerTitel (genau diesen Layer statt der Titel-Muster abfragen - " +
      "vorher mit beschreibeLayer den passenden Layer/das passende Feld finden), " +
      "where (attributiver Filter, SQL, z.B. \"ART = 'Denkmal'\"). " +
      "Ausgabe: Treffer je Layer inkl. Anzahl und Beispiel-Attributen. " +
      "layerFehlt=true nur, wenn wirklich kein passender Layer existiert.",
    inputSchema: await createSchema({
      ...pruefbereichFeld(gebunden),
      pufferMeter: {
        type: "number",
        description: "Suchradius in Metern. Weglassen = Standardradius des Pruefbereichs.",
      },
      layerTitel: {
        type: "string",
        description: "Exakter oder Teil-Titel eines Layers. Ueberschreibt die Titel-Muster des Pruefbereichs.",
      },
      where: {
        type: "string",
        description: "Attributfilter als SQL-WHERE (ohne 'WHERE'). Weglassen = alle Objekte.",
      },
    }),
    execute: async ({ pruefbereichId, pufferMeter, layerTitel, where }) => {
      const id = bereichId ?? pruefbereichId;
      const geom = requireVorhaben();
      const bereich = getPruefbereich(id);
      if (!bereich) throw new Error(`Unbekannter Pruefbereich: ${id}`);

      let layers;
      if (layerTitel) {
        const l = findeLayerNachTitel(layerTitel);
        layers = l ? [l] : [];
      } else {
        layers = findeLayer(bereich.layerMuster);
      }
      if (layers.length === 0) {
        return {
          pruefbereich: bereich.titel,
          layerFehlt: true,
          gesucht: layerTitel ?? bereich.layerMuster,
          hinweis:
            "Mit beschreibeLayer den tatsaechlichen Layer-Bestand pruefen - die Info steckt evtl. als Attribut in einem allgemeineren Layer.",
          treffer: [],
        };
      }

      const radius = pufferMeter ?? bereich.pufferMeter;
      const suchgeom =
        radius > 0 ? geometryEngine.geodesicBuffer(geom, radius, "meters") : geom;

      const treffer = [];
      for (const layer of layers) {
        if (typeof layer.createQuery !== "function") continue;
        try {
          const query = layer.createQuery();
          query.geometry = suchgeom;
          query.spatialRelationship = "intersects";
          query.outFields = ["*"];
          query.returnGeometry = true;
          query.num = 25;
          if (where) query.where = where;
          const fs = await layer.queryFeatures(query);
          for (const f of fs.features) zeichneAnalyse(f.geometry, [163, 45, 45], id);
          treffer.push({
            layer: layer.title,
            where: where ?? "1=1",
            anzahl: fs.features.length,
            beispielAttribute: fs.features.slice(0, 3).map((f) => f.attributes),
          });
        } catch (err) {
          treffer.push({ layer: layer.title, fehler: String(err) });
        }
      }

      return {
        pruefbereich: bereich.titel,
        layerFehlt: false,
        suchradiusMeter: radius,
        pufferBegruendung: bereich.pufferBegruendung,
        treffer,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// beschreibeLayer - Layer-/Feld-/Wert-Inventar der Webmap
// ---------------------------------------------------------------------------
async function makeBeschreibeLayer() {
  return createFunctionTool({
    name: "beschreibeLayer",
    description:
      "Zeigt, welche Feature-Layer die Karte enthaelt und welche Felder/Werte darin stecken. " +
      "Ohne Argumente: alle Layer mit Feldnamen. Mit layerTitel: Felder des Layers inkl. Domaenen. " +
      "Mit layerTitel + felder: Beispiel-Werte (distinct) dieser Felder. " +
      "IMMER zuerst nutzen, bevor du 'Datengrundlage fehlt' meldest - die relevante Info steckt " +
      "oft als Attribut in einem allgemeineren Layer (z.B. ein Feld 'ART' oder 'KLASSE').",
    inputSchema: await createSchema({
      layerTitel: { type: "string", description: "Titel (exakt oder Teil) eines Layers." },
      felder: {
        type: "array",
        description: "Feldnamen, fuer die distinct-Beispielwerte gezeigt werden sollen.",
        itemType: "string",
      },
    }),
    execute: async ({ layerTitel, felder }) => {
      if (!layerTitel) {
        return {
          layer: alleFeatureLayers().map((l) => ({
            titel: l.title,
            geometrie: l.geometryType,
            sichtbar: l.visible,
            felder: (l.fields ?? []).map((f) => `${f.name} (${f.type})`),
          })),
        };
      }
      const l = findeLayerNachTitel(layerTitel);
      if (!l) {
        return {
          fehler: `Kein Layer mit Titel ~ "${layerTitel}"`,
          verfuegbar: alleFeatureLayers().map((x) => x.title),
        };
      }
      if (typeof l.load === "function") {
        try {
          await l.load();
        } catch {
          /* ignore */
        }
      }
      const fields = (l.fields ?? []).map((f) => ({
        name: f.name,
        alias: f.alias,
        typ: f.type,
        domain:
          f.domain?.type === "coded-value"
            ? f.domain.codedValues.map((c) => ({ code: c.code, name: c.name }))
            : undefined,
      }));
      const ergebnis = { titel: l.title, geometrie: l.geometryType, felder: fields };
      if (Array.isArray(felder) && felder.length) {
        ergebnis.beispielWerte = {};
        for (const feld of felder.slice(0, 5)) {
          try {
            const q = l.createQuery();
            q.where = "1=1";
            q.outFields = [feld];
            q.returnDistinctValues = true;
            q.returnGeometry = false;
            q.num = 50;
            q.orderByFields = [feld];
            const fs = await l.queryFeatures(q);
            ergebnis.beispielWerte[feld] = fs.features.map((f) => f.attributes[feld]);
          } catch (err) {
            ergebnis.beispielWerte[feld] = `Fehler: ${err}`;
          }
        }
      }
      return ergebnis;
    },
  });
}

// ---------------------------------------------------------------------------
// erfrageFehlendeDaten - transparente Luecken-Meldung (Konzept Abschnitt 4)
// ---------------------------------------------------------------------------
async function makeErfrageFehlendeDaten(bereichId) {
  const gebunden = Boolean(bereichId);
  return createFunctionTool({
    name: "erfrageFehlendeDaten",
    description:
      "NUR aufrufen, nachdem du mit beschreibeLayer die tatsaechlichen Layer UND deren Attribute " +
      "geprueft hast und die Datengrundlage wirklich fehlt. Liefert einen Text, mit dem du den Nutzer " +
      "konkret um Upload/Service-Link bittest; markiere den Punkt anschliessend per meldeBefund mit " +
      "ampel='ungeprueft'. Der Nutzer darf ueberspringen - der Punkt bleibt 'ungeprueft', erscheint " +
      "aber NICHT als unauffaellig.",
    inputSchema: await createSchema({ ...pruefbereichFeld(gebunden) }),
    execute: ({ pruefbereichId }) => {
      const id = bereichId ?? pruefbereichId;
      const bereich = getPruefbereich(id);
      if (!bereich) throw new Error(`Unbekannter Pruefbereich: ${id}`);
      const layers = findeLayer(bereich.layerMuster);
      const vorhanden = layers.length > 0;
      return {
        pruefbereich: bereich.titel,
        datengrundlageVorhanden: vorhanden,
        gefundeneLayer: layers.map((l) => l.title),
        standardmaessigErwartet: bereich.datenStandard,
        nutzerfrage: vorhanden
          ? null
          : `Fuer die Pruefung "${bereich.titel}" liegt mir keine passende Datengrundlage vor ` +
            `(erwartet: ${bereich.layerMuster.join(" / ")}). ` +
            `Moechten Sie eine Datei oder einen Service-Link bereitstellen? ` +
            `Sie koennen auch ueberspringen - der Punkt wird dann als "nicht geprueft" gekennzeichnet.`,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// holeRechtsgrundlage - STUB. Spaeter: RAG-Retrieval aus dem Gesetzeskorpus.
// ---------------------------------------------------------------------------
async function makeHoleRechtsgrundlage(bereichId) {
  const gebunden = Boolean(bereichId);
  return createFunctionTool({
    name: "holeRechtsgrundlage",
    description:
      "Liefert die einschlaegige Rechtsgrundlage (Paragraph, Verfahren, Behoerde). " +
      "STUB: gibt derzeit den hinterlegten Platzhaltertext zurueck. Sobald das RAG-Backend steht, kommt hier " +
      "die belegte Fundstelle aus dem Gesetzeskorpus (BNatSchG, DSchG NRW, WHG/LWG, BauO NRW, LFoG NRW, BBodSchG, StrWG NRW).",
    inputSchema: await createSchema({
      ...pruefbereichFeld(gebunden),
      fund: {
        type: "string",
        description: "Kurzbeschreibung des geometrischen Befunds (fuer den spaeteren RAG-Query).",
      },
    }),
    execute: ({ pruefbereichId }) => {
      const id = bereichId ?? pruefbereichId;
      const bereich = getPruefbereich(id);
      if (!bereich) throw new Error(`Unbekannter Pruefbereich: ${id}`);
      return {
        _stub: true,
        pruefbereich: bereich.titel,
        rechtsgrundlage: bereich.rechtsgrundlage,
        verfahren: bereich.verfahren,
        behoerde: bereich.behoerde,
        hinweis: "PLATZHALTER - noch nicht per RAG belegt.",
      };
    },
  });
}

// ---------------------------------------------------------------------------
// bilanziereEingriff - STUB. Spaeter: Tabulate Intersection + Biotopwert-Mapping.
// ---------------------------------------------------------------------------
async function makeBilanziereEingriff() {
  return createFunctionTool({
    name: "bilanziereEingriff",
    description:
      "Erstellt eine erste Eingriffsbilanz nach Flaechentypen im Vorhabenumring. " +
      "STUB: liefert derzeit nur die Vorhabenflaeche und einen Platzhalter. Spaeter: Tabulate Intersection " +
      "gegen die Flaechennutzung mit ATKIS-zu-Biotopwert-Mapping.",
    inputSchema: await createSchema({
      dummy: { type: "string", description: "wird ignoriert" },
    }),
    execute: () => {
      const geom = requireVorhaben();
      const flaeche = Math.round(
        Math.abs(geometryEngine.geodesicArea(geom, "square-meters")),
      );
      return {
        _stub: true,
        vorhabenflaecheM2: flaeche,
        bilanz: "PLATZHALTER - Flaechentyp-Verschnitt und Biotopwertbilanz folgen mit dem Backend.",
      };
    },
  });
}

// ---------------------------------------------------------------------------
// meldeBefund - Ergebnis in die Ampel-Liste und den Scoping-Vermerk schreiben
// ---------------------------------------------------------------------------
async function makeMeldeBefund(bereichId) {
  const gebunden = Boolean(bereichId);
  return createFunctionTool({
    name: "meldeBefund",
    description:
      "Traegt das Ergebnis EINES Pruefbereichs in die Ergebnisliste und den Scoping-Vermerk ein. " +
      "Immer am Ende der Pruefung aufrufen - auch bei 'kein Befund' und bei 'nicht geprueft'. " +
      "ampel: 'rot' (Verfahren ausgeloest), 'gelb' (Naehe/vertiefte Pruefung), 'gruen' (keine Betroffenheit), " +
      "'ungeprueft' (Datengrundlage fehlt).",
    resultMode: "continue",
    inputSchema: await createSchema({
      ...pruefbereichFeld(gebunden),
      ampel: { type: "string", description: "Bewertung.", required: true, enum: AMPEL_WERTE },
      aussage: { type: "string", description: "Ergebnis in einem Satz.", required: true },
      verfahren: { type: "string", description: "Ausgeloestes Verfahren / noetiger Antrag." },
      behoerde: { type: "string", description: "Zustaendige Behoerde." },
      rechtsgrundlage: { type: "string", description: "Paragraph / Fundstelle (aus holeRechtsgrundlage)." },
      hinweis: { type: "string", description: "z.B. warum nicht geprueft wurde." },
    }),
    execute: ({ pruefbereichId, ampel, aussage, verfahren, behoerde, rechtsgrundlage, hinweis }) => {
      const id = bereichId ?? pruefbereichId;
      const bereich = getPruefbereich(id);
      const mitPuffer = ampel !== "ungeprueft" && bereich && bereich.pufferMeter >= 0;
      meldeBefund({
        bereichId: id,
        bereich: bereich?.titel ?? id,
        ampel,
        aussage,
        verfahren: verfahren ?? bereich?.verfahren,
        behoerde: behoerde ?? bereich?.behoerde,
        rechtsgrundlage,
        hinweis,
        pufferMeter: mitPuffer ? bereich.pufferMeter : undefined,
        pufferBegruendung: mitPuffer ? bereich.pufferBegruendung : undefined,
      });
      return { gespeichert: true, bereich: bereich?.titel ?? id };
    },
  });
}

// ---------------------------------------------------------------------------
// Synthese-Tools (nur fuer den Synthese-Agent des Koordinators)
// ---------------------------------------------------------------------------
async function makeHoleBisherigeBefunde() {
  return createFunctionTool({
    name: "holeBisherigeBefunde",
    description:
      "Gibt alle bisher gemeldeten Befunde (je Rechtsgebiet: Ampel, Aussage, Verfahren, Behoerde, Rechtsgrundlage) " +
      "als strukturierte Liste zurueck. Grundlage fuer den Scoping-Vermerk.",
    inputSchema: await createSchema({ dummy: { type: "string", description: "wird ignoriert" } }),
    execute: () => ({ befunde: getBefunde() }),
  });
}

async function makeSchreibeVermerk() {
  return createFunctionTool({
    name: "schreibeVermerk",
    description:
      "Schreibt den fertigen, lesbaren Scoping-Vermerk-Text in das Vermerk-Feld der Anwendung. " +
      "Genau einmal am Ende aufrufen, nachdem alle Rechtsgebiete geprueft wurden.",
    resultMode: "continue",
    inputSchema: await createSchema({
      text: { type: "string", description: "Der vollstaendige Vermerk-Text (Plain Text).", required: true },
    }),
    execute: ({ text }) => {
      setzeVermerkText(text);
      return { geschrieben: true, laenge: text.length };
    },
  });
}

// ---------------------------------------------------------------------------
// holeVorhabenKontext - Vorhabentyp + angehakte Pruefbereiche
// ---------------------------------------------------------------------------
async function makeHoleVorhabenKontext() {
  return createFunctionTool({
    name: "holeVorhabenKontext",
    description:
      "Gibt den vom Nutzer gewaehlten Vorhabentyp, die im Panel angehakten Pruefbereiche, " +
      "ob ein Umring gezeichnet ist und dessen Flaeche zurueck. Am Anfang aufrufen, um zu " +
      "entscheiden, welche Rechtsgebiete ueberhaupt relevant sind.",
    inputSchema: await createSchema({ dummy: { type: "string", description: "wird ignoriert" } }),
    execute: () => {
      const k = getKontext();
      const geom = vorhaben.geometrie;
      return {
        vorhabenTyp: k.vorhabenTyp,
        angehakktePruefbereiche: k.aktivePruefbereiche,
        umringGezeichnet: Boolean(geom),
        flaecheM2: geom
          ? Math.round(Math.abs(geometryEngine.geodesicArea(geom, "square-meters")))
          : null,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// setzePruefbereiche - Triage-Ergebnis in die Checkliste schreiben
// ---------------------------------------------------------------------------
async function makeSetzePruefbereiche() {
  return createFunctionTool({
    name: "setzePruefbereiche",
    description:
      "Setzt die im Panel angehakten Pruefbereiche auf die uebergebene Liste (Triage-Ergebnis). " +
      "Nach der Relevanz-Begruendung aufrufen, damit das Screening nur die sinnvollen Rechtsgebiete umfasst.",
    resultMode: "continue",
    inputSchema: await createSchema({
      ids: {
        type: "array",
        description: `Relevante Pruefbereich-Ids (${bereichIds.join(", ")}).`,
        required: true,
        itemType: "string",
      },
    }),
    execute: ({ ids }) => {
      const gueltig = (ids ?? []).filter((i) => bereichIds.includes(i));
      setzePruefbereiche(gueltig);
      return { gesetzt: gueltig };
    },
  });
}

// ---------------------------------------------------------------------------
// merkePruefpunkt - unklaerbaren Aspekt fuer Field Maps vormerken
// ---------------------------------------------------------------------------
async function makeMerkePruefpunkt(bereichId) {
  const gebunden = Boolean(bereichId);
  return createFunctionTool({
    name: "merkePruefpunkt",
    description:
      "Merkt einen Aspekt vor, den du NICHT abschliessend klaeren kannst (Datengrundlage fehlt, nur " +
      "vor Ort pruefbar, Schwellenwert/Abgrenzung unklar, Datenwiderspruch). Wird spaeter per " +
      "erzeugeTasks als Field-Maps-Aufgabe geschrieben. Pro offenem Aspekt einmal aufrufen.",
    resultMode: "continue",
    inputSchema: await createSchema({
      ...pruefbereichFeld(gebunden),
      bezeichnung: { type: "string", description: "Kurztitel des Pruefpunkts.", required: true },
      beschreibung: { type: "string", description: "Was ist offen / warum." },
      empfehlung: { type: "string", description: "Was vor Ort konkret zu tun/pruefen ist." },
      pruefgrund: { type: "string", description: "Kategorie.", enum: PRUEFGRUND_WERTE },
      prioritaet: { type: "string", description: "hoch/mittel/niedrig.", enum: PRIO_WERTE },
    }),
    execute: ({ pruefbereichId, bezeichnung, beschreibung, empfehlung, pruefgrund, prioritaet }) => {
      const id = bereichId ?? pruefbereichId;
      const p = queuePruefpunkt({
        bereichId: id,
        bezeichnung,
        beschreibung,
        empfehlung,
        pruefgrund,
        prioritaet: prioritaet ?? (pruefgrund === "datengrundlage_fehlt" ? "hoch" : "mittel"),
        vorhabenTyp: getKontext().vorhabenTyp,
      });
      return { vorgemerkt: true, bezeichnung: p.bezeichnung, offen: getPruefpunkte().length };
    },
  });
}

// ---------------------------------------------------------------------------
// erzeugeTasks - vorgemerkte Pruefpunkte in den Field-Maps-Layer schreiben
// ---------------------------------------------------------------------------
async function makeErzeugeTasks() {
  return createFunctionTool({
    name: "erzeugeTasks",
    description:
      "Schreibt alle vorgemerkten Pruefpunkte als Aufgaben in den ArcGIS-Field-Maps-Layer 'Pruefpunkte' " +
      "(am Vorhaben-Zentroid, Status 'nicht zugewiesen'). Einmal ganz am Ende aufrufen.",
    resultMode: "continue",
    inputSchema: await createSchema({ dummy: { type: "string", description: "wird ignoriert" } }),
    execute: async () => {
      if (getPruefpunkte().length === 0) return { geschrieben: 0, hinweis: "keine offenen Pruefpunkte" };
      return schreibePruefpunkte();
    },
  });
}

/**
 * FunctionTools fuer einen Fach- oder Koordinator-Agent.
 * @param {string} [bereichId] - bindet die Tools fest an ein Rechtsgebiet.
 */
export async function baueTools(bereichId) {
  return Promise.all([
    makePuffer(),
    makeBeschreibeLayer(),
    makeQueryLayer(bereichId),
    makeErfrageFehlendeDaten(bereichId),
    makeHoleRechtsgrundlage(bereichId),
    makeBilanziereEingriff(),
    makeHoleVorhabenKontext(),
    makeMerkePruefpunkt(bereichId),
    makeMeldeBefund(bereichId),
  ]);
}

/** Zusaetzliche Tools fuer Triage und Synthese (Koordinator). */
export async function baueSyntheseTools() {
  return Promise.all([
    makeHoleVorhabenKontext(),
    makeSetzePruefbereiche(),
    makeHoleBisherigeBefunde(),
    makeSchreibeVermerk(),
    makeErzeugeTasks(),
  ]);
}
