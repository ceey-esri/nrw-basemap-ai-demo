// Werkzeuge des räumlichen Erstscreenings.
//
// Der geometrische Teil ist deterministisch und liefert die Zahlen fürs
// Dashboard - das Modell tippt keine Zahlen ab. Es entscheidet, WELCHE
// Kategorien relevant sind (belegt aus Regionalplan und Gesetz) und welche
// Layer dafür abzufragen sind.
//
// Zwei Phasen (ein Klick, zwei Assistenten-Nachrichten):
//   1. Relevanz  - Region bestimmen, relevante Kategorien melden; jeder mit
//                  eigenem, fachlich begründetem Untersuchungsradius
//   2. Objekte   - je Kategorie die Layer gegen seine Zone abfragen

import { createFunctionTool, createSchema } from "@arcgis/ai-components/agent-utils/index.js";
import Graphic from "@arcgis/core/Graphic";
import * as symbolUtils from "@arcgis/core/symbols/support/symbolUtils";
// Messung: die geodaetischen Operatoren, nicht mehr geometryEngine. Deren
// geodesicArea/geodesicLength sind seit 4.32 abgekuendigt und arbeiten laut
// Typdefinition NUR mit WGS84 und Web Mercator - bei Daten in ETRS89/UTM32
// lieferten sie stillschweigend falsche Werte.
import * as intersectionOperator from "@arcgis/core/geometry/operators/intersectionOperator";
import * as geodeticAreaOperator from "@arcgis/core/geometry/operators/geodeticAreaOperator";
import * as geodeticLengthOperator from "@arcgis/core/geometry/operators/geodeticLengthOperator";
import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator";

import { RAG_URL } from "../config.js";
import { VORHABEN, getVorhaben } from "./vorhaben.js";
import { KATEGORIEN, getKategorie } from "./kategorien.js";
import {
  REGIONEN,
  istNRW,
  kreisSchluessel,
  regionAusAttributen,
  regionFuer,
} from "./regionen.js";
import {
  vorhaben,
  getMapEl,
  zeichneZone,
  merkeTreffer,
  vorhabenMasse,
} from "../karte.js";
import { getKontext } from "./kontext.js";
import {
  setzeRegion,
  setzeVorhabenMasze,
  merkeAbfrage,
  meldeRelevanz as storeRelevanz,
  meldeNichtRelevant as storeNichtRelevant,
  setzeKernaussagen,
  setzeVorhabenArt,
  getAnalyse,
} from "./analyse.js";
import { setzeFundstellen } from "./rag.js";
import { meldeSchritt } from "./fortschritt.js";

const FB_IDS = KATEGORIEN.map((f) => f.id);

// Verwaltungsgrenzen-Layer und Namensfeld, über die die Planungsregion
// bestimmt wird.
const GRENZ_LAYER = "Gemeindegrenzen 2024";
const NAME_ALIAS = "Geografischer Name";

// --- laufender Zustand ------------------------------------------------------
/** Untersuchungszone je Kategorie: { geometrie, meter }. */
const _zonen = new Map();
let _region = null;

export function toolsZuruecksetzen() {
  _zonen.clear();
  _inhaltCache = null;
  _region = null;
}

// --- Fortschritts-Middleware ------------------------------------------------
// Was im Ablauf steht. Bei den geometrischen Schritten wird die tatsächlich
// verwendete Operation genannt - "sichtet den Datenbestand" sagt nichts
// darüber, was gerechnet wird.
const TOOL_PHRASE = {
  holeVorhabenKontext: "liest den Vorhaben-Kontext",
  bestimmeRegion: "verschneidet mit den Gemeindegrenzen",
  beschreibeLayer: "liest Felder und Wertebereiche des Layers",
  holeRegionalplan: "durchsucht den Regionalplan (Vektorsuche)",
  holeRechtsgrundlage: "durchsucht den Gesetzeskorpus (Vektorsuche)",
  recherchiere: "durchsucht Regionalplan und Gesetzeskorpus",
  meldeRelevanz: "legt die Untersuchungszone an (geodätischer Puffer)",
  meldeNichtRelevant: "verwirft eine Kategorie",
  queryLayer: "fragt einen Kartenlayer ab und verschneidet geodätisch",
  fasseZusammen: "fasst zusammen",
};

function toolArgs(name, input) {
  const kurz = (s, n = 55) => String(s ?? "").slice(0, n);
  switch (name) {
    case "queryLayer":
      return [input?.kategorieId, input?.layerTitel].filter(Boolean).map((x) => kurz(x, 30)).join(" / ");
    case "holeRegionalplan":
    case "holeRechtsgrundlage":
    case "recherchiere":
      return kurz(input?.kategorieId ?? input?.frage);
    case "meldeRelevanz":
      return `${kurz(input?.kategorieId, 24)}, ${input?.radiusMeter ?? "?"} m`;
    case "beschreibeLayer":
      return input?.layerTitel ? kurz(input.layerTitel, 40) : "";
    default:
      return "";
  }
}

const toolFortschritt = {
  name: "fortschritt",
  handler: async (req, next) => {
    const phrase = TOOL_PHRASE[req.tool.name] ?? req.tool.name;
    const args = toolArgs(req.tool.name, req.input);
    meldeSchritt({ typ: "tool", name: req.tool.name, text: `${phrase}${args ? ` (${args})` : ""}` });
    try {
      return await next(req);
    } catch (err) {
      meldeSchritt({
        typ: "tool",
        name: req.tool.name,
        text: `${phrase} - FEHLER: ${String(err).slice(0, 120)}`,
        status: "fehler",
      });
      throw err;
    }
  },
};

function mitFortschritt(tools) {
  for (const t of tools) t.middlewares = [...(t.middlewares ?? []), toolFortschritt];
  return tools;
}

// --- Helfer -----------------------------------------------------------------
function requireVorhaben() {
  if (!vorhaben.geometrie) {
    throw new Error("Keine Vorhabengeometrie. Der Nutzer muss zuerst zeichnen.");
  }
  return vorhaben.geometrie;
}

function alleLayer() {
  const map = getMapEl()?.map;
  if (!map) return [];
  const out = [];
  map.allLayers.forEach((layer) => {
    if (typeof layer.queryFeatures !== "function" || typeof layer.createQuery !== "function") return;
    out.push({ layer, gruppe: layer.parent?.title ?? "" });
  });
  return out;
}

/**
 * Die BESCHREIBUNG eines Layers - das, was die Metadaten über seinen Inhalt
 * sagen. Zusammengesetzt aus dem, was ohne Zusatzanfrage vorliegt:
 *
 * - `layer.sourceJSON.description` — die Beschreibung des Sublayers im
 *   Dienst; kommt mit `layer.load()` mit (`FeatureLayerBase.d.ts`).
 * - `layer.portalItem` — `description`, `snippet` und `tags` des Portal-Items
 *   (`PortalLayer.d.ts` / `PortalItem.d.ts`), soweit schon geladen.
 * - der Titel, als schwächste Quelle.
 *
 * HTML wird entfernt: Item-Beschreibungen sind im Portal fast immer
 * ausgezeichneter Text, und `<p>`-Tags stören den Wortvergleich.
 */
function layerBeschreibung(layer) {
  const item = layer?.portalItem;
  const teile = [
    layer?.title,
    layer?.sourceJSON?.description,
    layer?.sourceJSON?.longDescription,
    item?.snippet,
    item?.description,
    ...(item?.tags ?? []),
    ...(item?.categories ?? []),
  ].filter((x) => typeof x === "string" && x.trim());
  return teile
    .join(" · ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Klassenbezeichnungen des Renderers - der RÜCKFALL für Layer ganz ohne
 * Metadatentext. Nicht die Felder selbst, sondern die Bezeichnungen, unter
 * denen die Karte den Inhalt zeigt.
 */
function rendererBegriffe(layer) {
  const out = [];
  const r = layer?.renderer;
  for (const i of r?.uniqueValueInfos ?? []) {
    if (i?.label) out.push(String(i.label));
    if (i?.value != null) out.push(String(i.value));
  }
  for (const i of r?.classBreakInfos ?? []) if (i?.label) out.push(String(i.label));
  return out;
}

/**
 * Layer, die eine Kategorie über ihren INHALT abbilden, ohne es im Titel zu
 * sagen.
 *
 * Anlass: In einem Testlauf blieb der Wald unentdeckt, obwohl direkt daneben
 * welcher liegt - Waldflächen stecken in diesem Datenbestand als Klasse eines
 * allgemeinen Flächenlayers. `layerFuerKategorie()` matcht nur auf
 * `layer.title` und konnte das nicht sehen; damit fehlte der Layer auch im
 * deterministischen Nachfass-Schritt `offeneLayer()`.
 *
 * @returns {Array<{layer: object, gruppe: string, treffer: string[]}>}
 */
/**
 * Ordnet JEDEN Layer per Inhalt HÖCHSTENS EINER Kategorie zu - derjenigen, die
 * am besten passt.
 *
 * Der erste Anlauf hat einen Layer jeder Kategorie zugeschlagen, deren
 * Stichwort irgendwo im Text vorkam. Ergebnis in einem echten Lauf: sämtliche
 * Layer - Siedlungsflächen, Gewässerflächen, Verkehrswege, Vegetationsflächen -
 * landeten unter "Kulturlandschaft und Denkmäler", weil in den Beschreibungen
 * ein breites Wort wie "Kulturlandschaft" steht. Über `offeneLayer()` ging
 * diese Fehlzuordnung direkt in den Phase-2-Auftrag.
 *
 * Zwei Sperren dagegen:
 * 1. **Stichwörter, die zu viele Layer treffen, klassifizieren nicht.** Wer in
 *    mehr als `MAX_ANTEIL` der Layer vorkommt, beschreibt den Datenbestand,
 *    nicht diesen einen Layer - solche Wörter fliegen raus.
 * 2. **Nur der beste Treffer zählt.** Ein Layer gehört inhaltlich zu genau
 *    einer Kategorie; bei Gleichstand gewinnt niemand, dann bleibt der Layer
 *    unzugeordnet und das Modell entscheidet an der Beschreibung selbst.
 *
 * @returns {Map<string, {kategorieId: string, treffer: string[], quelle: string}>}
 *   Layertitel -> Zuordnung
 */
const MAX_ANTEIL = 0.34;
let _inhaltCache = null;

function inhaltsZuordnung() {
  if (_inhaltCache) return _inhaltCache;
  const layer = alleLayer();
  const texte = new Map(
    layer.map((x) => [x.layer.title, layerBeschreibung(x.layer).toLowerCase()]),
  );

  // Wie viele Layer trifft jedes Stichwort? Alles über MAX_ANTEIL ist ein
  // Sammelbegriff des Datenbestands und taugt nicht zur Unterscheidung.
  const haeufigkeit = new Map();
  for (const fb of KATEGORIEN) {
    for (const w of fb.stichworte ?? []) {
      const wort = w.toLowerCase();
      if (haeufigkeit.has(wort)) continue;
      haeufigkeit.set(wort, [...texte.values()].filter((t) => t.includes(wort)).length);
    }
  }
  const zuBreit = [...haeufigkeit.entries()]
    .filter(([, n]) => n > layer.length * MAX_ANTEIL)
    .map(([w]) => w);
  if (zuBreit.length) {
    console.info(
      `[tools] Stichwörter ohne Trennschärfe (in >${Math.round(MAX_ANTEIL * 100)} % der Layer), ` +
        `ignoriert: ${zuBreit.join(", ")}`,
    );
  }
  const breit = new Set(zuBreit);

  const zuordnung = new Map();
  // Layer, die schon ein Titelmuster beansprucht, bleiben aussen vor. Die
  // Inhaltssuche existiert, um Layer zu FINDEN, deren Titel nichts verrät -
  // nicht um Layern mit klarem Titel weitere Kategorien anzuhängen. Ohne diese
  // Zeile wurde "Siedlungsflächen" (per Titel eindeutig Siedlungsraum)
  // zusätzlich der Energie-Kategorie zugeordnet, und die Sperre in queryLayer
  // liess beide durch: Wohnbauflächen tauchten unter "Energieanlagen und
  // Leitungsnetze" auf.
  const perTitel = new Set();
  for (const fb of KATEGORIEN) {
    for (const x of layerFuerKategorie(fb.id)) perTitel.add(x.layer.title);
  }

  for (const x of layer) {
    if (perTitel.has(x.layer.title)) continue;
    const text = texte.get(x.layer.title) ?? "";
    const nurTitel = text.length <= (x.layer.title ?? "").length + 3;

    let bester = null;
    let gleichstand = false;
    for (const fb of KATEGORIEN) {
      const worte = (fb.stichworte ?? []).map((w) => w.toLowerCase()).filter((w) => !breit.has(w));
      if (!worte.length) continue;

      // Erst die Beschreibung. Nur ein Layer ganz ohne Metadatentext fällt auf
      // die Klassenbezeichnungen der Karte zurück - sonst wäre er blind.
      let treffer = worte.filter((w) => text.includes(w));
      let quelle = "beschreibung";
      if (!treffer.length && nurTitel) {
        const begriffe = rendererBegriffe(x.layer).map((b) => b.toLowerCase());
        treffer = [...new Set(begriffe.filter((b) => worte.some((w) => b.includes(w))))];
        quelle = "klassen";
      }
      if (!treffer.length) continue;
      if (!bester || treffer.length > bester.treffer.length) {
        bester = { kategorieId: fb.id, treffer: treffer.slice(0, 8), quelle };
        gleichstand = false;
      } else if (treffer.length === bester.treffer.length) {
        gleichstand = true;
      }
    }
    if (bester && !gleichstand) zuordnung.set(x.layer.title, bester);
  }

  console.info(
    "[tools] Layer-Zuordnung nach Beschreibung:",
    Object.fromEntries([...zuordnung].map(([k, v]) => [k, `${v.kategorieId} (${v.quelle})`])),
  );

  // Vollbild der Zuordnung: JE KATEGORIE, welche Layer sie überhaupt
  // beanspruchen kann. Ohne das ist "Energieanlagen und Leitungsnetze findet
  // nie etwas" nicht zu unterscheiden von "es gibt keinen passenden Layer" -
  // und genau das ist der wahrscheinlichste Fall, wenn ein layerMuster keinen
  // Titel in DIESER Webmap trifft.
  const je = {};
  const ohne = [];
  for (const fb of KATEGORIEN) {
    const titel = [
      ...new Set([
        ...layerFuerKategorie(fb.id).map((x) => x.layer.title),
        ...layer.filter((x) => zuordnung.get(x.layer.title)?.kategorieId === fb.id).map((x) => x.layer.title),
      ]),
    ];
    je[fb.id] = titel.length ? titel : "KEIN LAYER";
    if (!titel.length) ohne.push(fb.id);
  }
  console.info("[tools] Layer je Kategorie:", je);
  if (ohne.length) {
    console.warn(
      `[tools] Ohne passenden Layer in dieser Webkarte: ${ohne.join(", ")} - diese Kategorien ` +
        "können nie Objekte liefern, egal wie sie eingestuft werden. layerMuster prüfen.",
    );
  }
  _inhaltCache = zuordnung;
  return zuordnung;
}

/**
 * Layer, die eine Kategorie über ihren INHALT abbilden, ohne es im Titel zu
 * sagen.
 *
 * @returns {Array<{layer: object, gruppe: string, treffer: string[], quelle: string}>}
 */
function layerNachInhalt(fbId) {
  const zuordnung = inhaltsZuordnung();
  return alleLayer()
    .filter((x) => zuordnung.get(x.layer.title)?.kategorieId === fbId)
    .map((x) => ({ ...x, ...zuordnung.get(x.layer.title) }));
}

/**
 * Layer einer Kategorie: über den Titel ODER über den Inhalt. Die Titelsuche
 * allein liess Layer durchrutschen, deren Name nichts über ihren Inhalt sagt.
 */
function layerFuerKategorieGesamt(fbId) {
  const ausTitel = layerFuerKategorie(fbId);
  const bekannt = new Set(ausTitel.map((x) => x.layer.title));
  return [...ausTitel, ...layerNachInhalt(fbId).filter((x) => !bekannt.has(x.layer.title))];
}

/**
 * Welche Kategorien beanspruchen diesen Layer? Titelmuster (mehrere möglich -
 * "Vegetationsflächen" gehört zu Wald UND Landwirtschaft) plus die
 * Inhaltszuordnung.
 */
function kategorienFuerLayer(titel) {
  const out = new Set();
  for (const fb of KATEGORIEN) {
    if (layerFuerKategorie(fb.id).some((x) => x.layer.title === titel)) out.add(fb.id);
  }
  const ausInhalt = inhaltsZuordnung().get(titel)?.kategorieId;
  if (ausInhalt) out.add(ausInhalt);
  return out;
}

function findeLayer(titel) {
  const t = (titel ?? "").toLowerCase();
  const alle = alleLayer();
  return (
    alle.find((x) => (x.layer.title ?? "").toLowerCase() === t) ??
    alle.find((x) => (x.layer.title ?? "").toLowerCase().includes(t)) ??
    null
  );
}

/** Layer, die einem Kategorie über seine Titel-Muster zugeordnet sind. */
function layerFuerKategorie(fbId) {
  const fb = getKategorie(fbId);
  if (!fb) return [];
  return alleLayer().filter((x) =>
    fb.layerMuster.some((m) => (x.layer.title ?? "").toLowerCase().includes(m.toLowerCase())),
  );
}

/**
 * Löst Domänen-Codes eines Feldes in Klartext auf. Ohne das steht in der
 * Aufschlüsselung "1100" statt "Autobahn".
 */
function wertLesbar(layer, feldName, wert) {
  if (wert == null || wert === "") return "(ohne Angabe)";
  const feld = (layer.fields ?? []).find((f) => f.name === feldName);
  const dom = feld?.domain;
  if (dom?.type === "coded-value") {
    const cv = dom.codedValues.find((c) => String(c.code) === String(wert));
    if (cv) return cv.name;
  }
  return String(wert);
}

const SQL_WOERTER = new Set([
  "and", "or", "not", "in", "is", "null", "like", "between", "upper", "lower",
  "date", "timestamp", "true", "false", "current_date",
]);

/**
 * Feldnamen, die in einem where-Ausdruck stehen, aber nicht auf dem Layer
 * existieren. Ohne diese Prüfung erfindet das Modell Felder und Codes; die
 * Abfrage liefert dann lautlos 0 Objekte und das Thema verschwindet aus dem
 * Ergebnis, ohne dass irgendwo ein Fehler auftaucht.
 */
function unbekannteFelder(layer, where) {
  if (!where) return [];
  const da = new Set((layer.fields ?? []).map((f) => String(f.name).toLowerCase()));
  // Zeichenketten-Literale zuerst entfernen - sonst gelten deren Inhalte
  // ('Bundesautobahn') fälschlich als Bezeichner.
  const ohneLiterale = String(where).replace(/'[^']*'/g, "''");
  const bezeichner = ohneLiterale.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return [
    ...new Set(
      bezeichner.filter((b) => !SQL_WOERTER.has(b.toLowerCase()) && !da.has(b.toLowerCase())),
    ),
  ];
}

/**
 * Wie die Webkarte diesen Layer symbolisiert.
 *
 * "unique-value" (Typen) heisst: wer die Karte gebaut hat, hat sich fuer genau
 * ein Feld als fachliche Unterscheidung entschieden - besser als jede
 * Heuristik. "simple" (Einzelsymbol) heisst umgekehrt: der Layer traegt keine
 * Unterscheidung, die hier zaehlt; dann wird gar nicht aufgeschluesselt.
 */
function symbolisierung(layer) {
  const r = layer?.renderer;
  const art = r?.type ?? null;
  const felder = layer?.fields ?? [];
  // Gross-/Kleinschreibung im Renderer weicht gelegentlich von der im Schema
  // ab - ein exakter Vergleich lieferte dann fälschlich "kein Feld".
  const treffer = (name) =>
    felder.find((f) => String(f.name).toLowerCase() === String(name).toLowerCase())?.name ?? null;

  // Einzelsymbol trägt keine Unterscheidung. Sonst zählt `field` - das haben
  // unique-value UND class-breaks. Bei valueExpression gibt es kein Feld.
  const feld = art === "simple" ? null : treffer(r?.field ?? "");
  const ausdruck = Boolean(r?.valueExpression);
  if (art && art !== "simple" && !feld) {
    console.warn(`[tools] "${layer.title}": Symbolisierung "${art}" ohne nutzbares Feld`, {
      rendererFeld: r?.field ?? null,
      valueExpression: ausdruck,
    });
  }
  return { art, feld, ausdruck };
}

/**
 * Die Farbe, mit der die Karte ein Objekt tatsächlich zeichnet.
 *
 * Nicht selbst aus dem Symbol gepult - das ging schief, weil Webmaps aus
 * ArcGIS Pro CIM-Symbole verwenden, die gar kein `symbol.color` haben. Statt
 * dessen fragt `symbolUtils.getDisplayedColor()` den Renderer so, wie ihn auch
 * die Darstellung fragt: Unique-Value, Class-Breaks, visuelle Variablen und
 * CIM sind damit abgedeckt.
 */
async function farbeAusKarte(layer, feature) {
  try {
    const g = new Graphic({ geometry: feature.geometry, attributes: feature.attributes });
    const c = await symbolUtils.getDisplayedColor(g, { renderer: layer.renderer });
    if (!c) return null;
    const [r, gr, b] = c.toRgba();
    return `rgb(${r}, ${gr}, ${b})`;
  } catch (err) {
    console.warn("[tools] Farbe nicht ermittelbar für", layer.title, err);
    return null;
  }
}

/**
 * Ein klassifizierendes Feld aus den BEREITS GEHOLTEN Features - der Rückfall,
 * wenn der Renderer keines hergibt.
 *
 * Anlass: "Verkehrswege" lieferte "es liess sich kein klassifizierendes
 * Attribut ermitteln" und blieb damit ohne Diagramm, obwohl der Layer eine
 * Straßenklasse führt. Die Aufschlüsselung hing allein am Renderer: hat der
 * kein `field` (Einzelsymbol mit Arcade-Ausdruck, CIM-Symbolik, oder ein
 * Renderer, der beim Laden gar nicht ankam), gab es gar keine Aufteilung.
 *
 * Die Abfrage holt `outFields: ["*"]`, die Attribute liegen also schon vor -
 * dieser Rückfall kostet keine einzige zusätzliche Anfrage.
 *
 * Gewählt wird das Feld, das im Untersuchungsraum tatsächlich unterscheidet:
 * 2 bis MAX_KLASSEN verschiedene Werte (eines = keine Information, zu viele =
 * Eigennamen) bei mindestens halber Belegung. Codierte Domänen haben Vorrang,
 * danach das Feld mit den WENIGSTEN Klassen - gröbere Klassen liest man ab,
 * fünfzig Einzelwerte nicht.
 */
const MAX_KLASSEN = 40;

/**
 * Sieht dieser Wert aus wie eine Kennung statt wie eine Klasse? Lange
 * Buchstaben-Ziffern-Folgen ohne Leerzeichen sind Schlüssel ("DENWAT01D000A32o",
 * "DE-NW-05515000"), keine Sachkategorie.
 */
function wirktWieKennung(wert) {
  const v = String(wert ?? "").trim();
  return v.length >= 8 && !/\s/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v);
}

function ersatzGruppenfeld(layer, features, ausschluss) {
  if (!features?.length) return null;
  // Eigennamen und Kennungen trennen Objekte, aber keine Sachverhalte - ein
  // Ring aus 40 Gewässernamen ist keine Aufteilung.
  const nutzlos =
    /^(objectid|globalid|fid|shape|se_anno|st_area|st_length|uuid|guid)|name|bezeichn|schluessel|schlüssel|kennung|nummer|datum|_id$/i;
  const kandidaten = (layer.fields ?? []).filter(
    (f) =>
      !nutzlos.test(f.name) &&
      f.name !== ausschluss &&
      (f.domain?.type === "coded-value" || f.type === "string" || f.type === "small-integer"),
  );

  let beste = null;
  for (const f of kandidaten) {
    const werte = new Set();
    let belegt = 0;
    for (const feat of features) {
      const v = feat.attributes?.[f.name];
      if (v == null || v === "") continue;
      belegt += 1;
      werte.add(v);
      if (werte.size > MAX_KLASSEN) break;
    }
    if (werte.size < 2 || werte.size > MAX_KLASSEN) continue;
    if (belegt < features.length / 2) continue;

    const domaene = f.domain?.type === "coded-value";
    // Eine Klassifikation GRUPPIERT. Hat jedes Objekt seinen eigenen Wert, ist
    // das eine Kennung - bei drei historischen Bauwerken standen so drei
    // Denkmalnummern im Ring, jede mit 33 %. Eine codierte Domäne ist davon
    // ausgenommen: sie ist per Definition ein gepflegter Werteschlüssel.
    if (!domaene && werte.size >= belegt) continue;
    // Zusätzlich die FORM der Werte: "DENWAT01D000A32o" ist auch dann keine
    // Klasse, wenn er zufällig zweimal vorkommt.
    if (!domaene && [...werte].some((v) => wirktWieKennung(v))) continue;
    const rang = { domaene: f.domain?.type === "coded-value" ? 0 : 1, klassen: werte.size };
    if (!beste || rang.domaene < beste.domaene || (rang.domaene === beste.domaene && rang.klassen < beste.klassen)) {
      beste = { name: f.name, ...rang };
    }
  }
  if (beste) {
    console.info(
      `[tools] "${layer.title}": Renderer ohne Feld - Aufteilung ersatzweise nach ` +
        `"${beste.name}" (${beste.klassen} Klassen).`,
    );
  }
  return beste?.name ?? null;
}

/**
 * Die geodaetischen Operatoren muessen vor dem ersten `execute()` geladen sein
 * (`isLoaded()` / `load()` laut Typdefinition). Einmal je Sitzung.
 */
async function messwerkzeugeBereit() {
  // NUR die geodaetischen Operatoren und der Puffer kennen isLoaded/load -
  // `intersectionOperator` exportiert laut Typdefinition nur `execute`,
  // `executeMany` und `accelerateGeometry` und braucht kein Laden.
  await Promise.all(
    [geodesicBufferOperator, geodeticAreaOperator, geodeticLengthOperator]
      .filter((op) => !op.isLoaded())
      .map((op) => op.load()),
  );
}

/** SQL-Literal aus einem Attributwert - Zahlen ohne, Text mit Anführungszeichen. */
function sqlWert(v) {
  return typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Leitet für einen Layer, den MEHRERE Kategorien beanspruchen, den Filter der
 * gefragten Kategorie aus den Daten ab.
 *
 * "Vegetationsflächen" trägt Wald- UND Ackerflächen, unterschieden allein über
 * ein Attribut. Ohne Filter misst jede Kategorie denselben Bestand: unter
 * "Wald" standen die Vegetationsflächen komplett, unter "Landwirtschaft"
 * ebenso, und Ackerflächen tauchten nirgends getrennt auf. Das dem Modell zu
 * überlassen hat nicht getragen - hier wird es aus den `stichworte` des
 * Katalogs und den tatsächlich vorkommenden Klassenwerten hergeleitet.
 *
 * @returns {{where: string, werte: string[]} | null} null, wenn kein
 *   sinnvoller Teil-Filter möglich ist (kein Treffer oder alle Werte passen).
 */
function klassenFilter(layer, kategorieId, feld, features) {
  const worte = (getKategorie(kategorieId)?.stichworte ?? []).map((w) => w.toLowerCase());
  if (!feld || !worte.length || !features?.length) return null;

  const alle = new Map();
  for (const f of features) {
    const roh = f.attributes?.[feld];
    if (roh == null || roh === "") continue;
    if (!alle.has(roh)) alle.set(roh, String(wertLesbar(layer, feld, roh) ?? roh).toLowerCase());
  }
  if (alle.size < 2) return null;

  const passend = [...alle.entries()].filter(([, label]) => worte.some((w) => label.includes(w)));
  // Nur ein echter Teil: trifft nichts oder alles, ist der Filter sinnlos.
  if (!passend.length || passend.length === alle.size) return null;

  return {
    where: `${feld} IN (${passend.map(([roh]) => sqlWert(roh)).join(", ")})`,
    werte: passend.map(([roh]) => String(wertLesbar(layer, feld, roh) ?? roh)),
  };
}

/** Kompakte Feldliste für eine Fehlermeldung an das Modell. */
function feldUebersicht(layer) {
  const nutzlos = /^(objectid|globalid|shape|se_anno|st_area|st_length)/i;
  return (layer.fields ?? [])
    .filter((f) => !nutzlos.test(f.name))
    .slice(0, MAX_FELDER)
    .map((f) => `${f.name} (${f.alias ?? f.name})`);
}

/** Suchgeometrie einer Kategorie: seine Zone, sonst das Vorhaben selbst. */
function suchgeometrie(fbId) {
  return _zonen.get(fbId)?.geometrie ?? requireVorhaben();
}

// Was das Modell von einer Fundstelle wirklich braucht: Zitat, Überschrift,
// Stand und einen Auszug. Der Wortlaut steht im Ergebnispanel.
const MODELL_TREFFER = 4;
const AUSZUG_ZEICHEN = 400;

// Deckel für beschreibeLayer: das Ergebnis bleibt in der Nachrichtenhistorie
// und wird bei jeder weiteren Modellrunde erneut mitgeschickt.
const MAX_FELDER = 25;
const MAX_CODES = 20;

// Abfragedeckel. Die ANZAHL kommt aus queryFeatureCount und ist immer exakt;
// gedeckelt ist nur, wie viele Geometrien für Fläche und Länge geholt und
// verschnitten werden. Der Deckel liegt bewusst hoch - bei 2.000 wurden reale
// Läufe (2.193 Vegetationsflächen) gekappt und die Summen waren nur noch
// Mindestwerte. Er ist eine Notbremse gegen Ausreisser, keine Sparmassnahme.
const MAX_TREFFER = 20000;
const SEITE = 2000;

function fuerModell(f) {
  const text = String(f.text ?? "");
  return {
    zitat: f.zitat,
    ueberschrift: f.ueberschrift,
    stand: f.stand,
    score: f.score,
    auszug: text.length > AUSZUG_ZEICHEN ? text.slice(0, AUSZUG_ZEICHEN) + " [...]" : text,
  };
}

/**
 * Baut den Suchtext als GRUNDSATZFRAGE zur Wirkung.
 *
 * Zwei Fehler waren hier nacheinander drin. Erst fragte die Suche nur nach dem
 * Belang an sich ("Allgemeine Siedlungsbereiche ASB und GIB") - sie fand
 * Passagen darüber, WAS ein Siedlungsbereich ist, statt darüber, was ein neues
 * Vorhaben in seiner Nähe auslöst.
 *
 * Danach war die Frage zwar auf die Wirkung gerichtet, aber ORTSBEZOGEN
 * formuliert - der Subagent antwortete daraufhin Dinge wie "für eine
 * Einzel-WEA an einem Punkt ohne bekannten Gewässeranschluss nicht per se
 * anzunehmen". Das ist die falsche Ebene: OB ein Gewässerrandstreifen in der
 * Nähe liegt, klärt hinterher die räumliche Analyse. Die Recherche soll
 * ausschliesslich klären, ob der Belang bei diesem Vorhabentyp GRUNDSÄTZLICH
 * eine Rolle spielt.
 */
function wirkungsfrage(vorhabenText, kategorie, korpus) {
  if (!kategorie) return null;
  const v = String(vorhabenText ?? "").trim();
  const gesetz = korpus === "gesetz";

  // Reihenfolge ist hier NICHT Kosmetik, sie entscheidet über das Ergebnis.
  // Stand der Vorhabentyp vorne ("Vorhabentyp: Errichtung einer
  // Windenergieanlage. Belang: Gewässerrandstreifen …"), zog er das Embedding
  // vollständig zu sich: für die Kategorie "Wasser" kamen BauGB § 249,
  // BNatSchG § 45b und § 16b zurück - fünf Treffer, keine einzige Wassernorm,
  // obwohl § 38 WHG im Korpus steht und bei belangzentrierter Frage auf
  // Platz 1 landet. Deshalb: BELANG zuerst, dann die im Katalog benannten
  // Normen bzw. Festlegungsarten, und der Vorhabentyp nur als kurzer Anlass
  // am Ende.
  const belang = gesetz ? kategorie.gesetzSuche : kategorie.regionalplanSuche;
  const rahmen = gesetz ? kategorie.fachgesetze : kategorie.rechtsrahmen;

  return [
    belang,
    rahmen,
    gesetz
      ? "Welche Anforderungen, Abstände und Genehmigungserfordernisse gelten dafür?"
      : "Welche Ziele und Grundsätze legt der Regionalplan dazu fest?",
    v ? `Anlass: ${v}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function ragAnfrage(pfad, body) {
  const resp = await fetch(`${RAG_URL}/${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`RAG ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
async function makeHoleVorhabenKontext() {
  return createFunctionTool({
    name: "holeVorhabenKontext",
    description:
      "Gibt Vorhabenart, deren Beschreibung, den Nutzerkommentar und die Masse der gezeichneten " +
      "Geometrie zurück (Punkt / Linie mit Länge / Fläche). Immer zuerst aufrufen.",
    inputSchema: await createSchema({ dummy: { type: "string", description: "wird ignoriert" } }),
    execute: () => {
      const k = getKontext();
      const v = getVorhaben(k.vorhabenTyp) ?? VORHABEN.find((x) => x.titel === k.vorhabenTyp);
      const m = vorhabenMasse();
      setzeVorhabenMasze(m);
      setzeVorhabenArt(v?.titel ?? k.vorhabenTyp);
      return {
        vorhabenTyp: v?.titel ?? k.vorhabenTyp,
        beschreibung: v?.beschreibung ?? "",
        nutzerkommentar: k.kommentar,
        geometrieTyp: m.typ,
        flaecheM2: m.flaecheM2,
        laengeM: m.laengeM,
      };
    },
  });
}

/**
 * Löst den Kreis über eine zweite Abfrage im selben Grenzlayer auf.
 *
 * Der Layer führt nur Gemeindenamen, die Zuordnungstabelle kennt die 53 Kreise
 * und kreisfreien Städte - "Ense" oder "Attendorn" stehen dort nicht. Die
 * ersten fünf Stellen des AGS identifizieren aber den Kreis, und in fast jedem
 * Kreis gibt es eine Gemeinde, die so heisst wie er ("Soest" im Kreis Soest,
 * "Olpe" im Kreis Olpe, "Unna" im Kreis Unna). Diese Abfrage holt alle
 * Gemeinden des Kreises und prüft ihre Namen gegen die Tabelle.
 *
 * Ein Treffer zählt nur, wenn ALLE gefundenen Namen auf dieselbe Region
 * zeigen - sonst wäre das Ergebnis geraten.
 */
async function regionAusKreis(layer, attrs) {
  const schluessel = kreisSchluessel(attrs);
  if (!schluessel || !istNRW(attrs)) return null;
  const agsFeld = (layer.fields ?? []).find((f) => /^ags$/i.test(f.name))?.name;
  if (!agsFeld) return null;
  try {
    const q = layer.createQuery();
    q.where = `${agsFeld} LIKE '${schluessel}%'`;
    q.outFields = ["*"];
    q.returnGeometry = false;
    q.num = 400;
    const fs = await layer.queryFeatures(q);
    const namen = [...new Set(fs.features.map((f) => f.attributes?.GEN).filter(Boolean))];
    const treffer = [...new Set(namen.map(regionFuer).filter(Boolean))];
    if (treffer.length !== 1) {
      console.warn("[tools] Kreis nicht eindeutig aufloesbar", {
        kreisSchluessel: schluessel,
        gemeinden: namen.length,
        kandidaten: treffer,
      });
      return null;
    }
    const passend = namen.find((n) => regionFuer(n) === treffer[0]);
    return {
      region: treffer[0],
      gefundenIn: `Kreis ${schluessel} (über AGS)`,
      name: passend,
      ueberKreis: true,
    };
  } catch (err) {
    console.warn("[tools] Kreis-Abfrage fehlgeschlagen:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
async function makeBestimmeRegion() {
  return createFunctionTool({
    name: "bestimmeRegion",
    description:
      "Verschneidet die Vorhabengeometrie mit dem Gemeindegrenzen-Layer und liest den Namen aus " +
      "dem Feld mit dem Alias 'Geografischer Name'. Liefert die " +
      "Planungsregion samt geltendem Regionalplan (Name, Stand, Quelle). MUSS vor " +
      "holeRegionalplan aufgerufen werden - die Zuordnung darf nicht geraten werden.",
    inputSchema: await createSchema({
      layerTitel: {
        type: "string",
        description: "Optional. Standard: der Gemeindegrenzen-Layer.",
      },
    }),
    execute: async ({ layerTitel }) => {
      const geom = requireVorhaben();
      const kandidat =
        findeLayer(layerTitel ?? GRENZ_LAYER) ??
        findeLayer("Gemeindegrenzen") ??
        findeLayer("Kreisgrenzen") ??
        findeLayer("Kreise") ??
        findeLayer("Verwaltungs") ??
        findeLayer("Grenzen");
      if (!kandidat) {
        return {
          gefunden: false,
          hinweis: `Kein Layer "${GRENZ_LAYER}" in der Karte gefunden.`,
          verfuegbar: alleLayer().map((x) => x.layer.title),
        };
      }
      try {
        await kandidat.layer.load?.();
      } catch {
        /* ignore */
      }

      const q = kandidat.layer.createQuery();
      q.geometry = geom;
      q.spatialRelationship = "intersects";
      q.outFields = ["*"];
      q.returnGeometry = false;
      q.num = 10;
      const fs = await kandidat.layer.queryFeatures(q);
      if (!fs.features.length) {
        return {
          gefunden: false,
          hinweis:
            `Keine Treffer in "${kandidat.layer.title}" (Geometrietyp ${kandidat.layer.geometryType}). ` +
            "Bei einem Linienlayer schneidet ein Punkt im Gemeindeinneren keine Grenze.",
        };
      }

      // Bevorzugt das Feld mit dem Alias "Geografischer Name".
      const nameFeld = (kandidat.layer.fields ?? []).find(
        (f) => (f.alias ?? "").toLowerCase() === NAME_ALIAS.toLowerCase(),
      )?.name;

      // Der Layer deckt ganz Deutschland ab - Punkte ausserhalb NRW haben
      // keinen Regionalplan in diesem Korpus.
      const ausserhalb = fs.features.filter((f) => !istNRW(f.attributes));
      if (ausserhalb.length === fs.features.length) {
        const namen = fs.features.map((f) => f.attributes?.[nameFeld]).filter(Boolean);
        return {
          gefunden: false,
          ausserhalbNRW: true,
          hinweis:
            `Das Vorhaben liegt ausserhalb Nordrhein-Westfalens (${namen.join(", ")}). ` +
            "Der Regionalplan-Korpus deckt nur NRW ab - ohne Regionalplan kein Screening.",
        };
      }

      for (const f of fs.features) {
        const direkt = nameFeld ? f.attributes?.[nameFeld] : null;
        const ausFeld = direkt && regionFuer(direkt);
        // Reihenfolge: Name -> sonstige Attribute -> Kreis über AGS ->
        // Regierungsbezirk. Jeder Schritt ist deterministisch; der jeweils
        // nächste greift nur, wenn der vorige nichts ergeben hat.
        const treffer =
          (ausFeld ? { region: ausFeld, gefundenIn: nameFeld, name: direkt } : null) ??
          regionAusAttributen(f.attributes) ??
          (await regionAusKreis(kandidat.layer, f.attributes));
        if (treffer) {
          const info = REGIONEN[treffer.region];
          _region = {
            region: treffer.region,
            name: info.name,
            plan: info.plan,
            stand: info.stand,
            url: info.url,
            // Der GEN-Wert aus dem Grenzlayer: die Gebietskoerperschaft, ueber
            // die die Region bestimmt wurde.
            gemeinde: treffer.name ?? null,
            gefundenUeber: treffer.ueberBezirk
              ? `${treffer.gefundenIn} = ${treffer.name} (nur Regierungsbezirk)`
              : `${treffer.gefundenIn} = ${treffer.name}`,
          };
          setzeRegion(_region);
          return { gefunden: true, ..._region, layer: kandidat.layer.title };
        }
      }

      // Nicht auflösbar: alles zurückgeben, was zur Diagnose nötig ist - und
      // dasselbe in die Konsole, sonst sieht nur das Modell, woran es lag.
      const gefunden = fs.features
        .map((f) => (nameFeld ? f.attributes?.[nameFeld] : null))
        .filter(Boolean);
      setzeRegion({
        name: null,
        gemeinde: gefunden[0] ?? null,
        gefundenUeber: gefunden.length
          ? `${nameFeld} = ${gefunden.join(", ")} - keiner Planungsregion zuzuordnen`
          : "kein Name im Grenzlayer gefunden",
      });
      console.warn("[tools] Planungsregion nicht bestimmbar", {
        layer: kandidat.layer.title,
        nameFeld: nameFeld ?? null,
        gefundeneNamen: fs.features
          .map((f) => (nameFeld ? f.attributes?.[nameFeld] : null))
          .filter(Boolean),
        felder: (kandidat.layer.fields ?? []).map((f) => `${f.name} (${f.alias})`),
        beispielAttribute: fs.features[0]?.attributes ?? null,
      });
      return {
        gefunden: false,
        hinweis:
          "Der gefundene Name liess sich keiner Planungsregion zuordnen. Die Tabelle kennt die " +
          "53 Kreise und kreisfreien Städte in NRW - ein reiner Gemeindename steht dort nicht, " +
          "und ein Amtlicher Gemeindeschlüssel war in den Attributen auch nicht zu finden. " +
          "Nenne in deiner Antwort die gefundenen Namen und Felder, damit nachvollziehbar ist, " +
          "was der Layer führt.",
        layer: kandidat.layer.title,
        nameFeld: nameFeld ?? null,
        gefundeneNamen: fs.features
          .map((f) => (nameFeld ? f.attributes?.[nameFeld] : null))
          .filter(Boolean),
        felder: (kandidat.layer.fields ?? []).map((f) => f.name + " (" + f.alias + ")"),
        beispielAttribute: fs.features[0].attributes,
      };
    },
  });
}

// ---------------------------------------------------------------------------
async function makeBeschreibeLayer() {
  return createFunctionTool({
    name: "beschreibeLayer",
    description:
      "Ohne Argumente: alle Kartenlayer mit Geometrietyp und der Kategorie, der sie zugeordnet " +
      "sind. Mit layerTitel: die Felder dieses Layers inkl. Domänen und - entscheidend - " +
      "'klassifizierendeFelder': die Felder, deren Ausprägungen im Untersuchungsraum " +
      "tatsächlich unterscheiden. Aus dieser Liste wählst du das gruppeFeld.",
    inputSchema: await createSchema({
      layerTitel: { type: "string", description: "Titel (exakt oder Teil) eines Layers." },
      felder: {
        type: "array",
        description: "Feldnamen, für die Beispielwerte gezeigt werden sollen.",
        itemType: "string",
      },
    }),
    execute: async ({ layerTitel, felder }) => {
      if (!layerTitel) {
        const zuordnung = new Map();
        const inhaltsTreffer = new Map();
        for (const fb of KATEGORIEN) {
          for (const x of layerFuerKategorie(fb.id)) zuordnung.set(x.layer.title, fb.id);
          // Inhaltstreffer: nur setzen, wo der Titel nichts hergab - und die
          // gefundenen Klassenwerte mitgeben, sonst weiss das Modell zwar,
          // DASS der Layer passt, aber nicht, wonach es filtern soll.
          for (const x of layerNachInhalt(fb.id)) {
            if (!zuordnung.has(x.layer.title)) {
              zuordnung.set(x.layer.title, fb.id);
              inhaltsTreffer.set(x.layer.title, x.treffer);
            }
          }
        }
        const nutzlos = /^(objectid|globalid|shape|se_anno|st_area|st_length)/i;
        return {
          hinweis:
            "Ob ein Layer zu einer Kategorie gehört, entscheidest du an seiner BESCHREIBUNG " +
            "(Feld `beschreibung`: Metadaten aus Dienst und Portal-Item), nicht am Titel und " +
            "nicht an den Feldnamen. Unter einem unscheinbaren Titel wie " +
            "\"Flächen weiterer Nutzung\" oder \"Vegetationsflächen\" stecken oft Wald, " +
            "Schutzgebiete oder Sondernutzungen - die Beschreibung sagt es, der Titel nicht. " +
            "`kategorieVorschlag` ist die Vorabzuordnung des Katalogs aus genau dieser " +
            "Beschreibung (bei Layern ohne Metadaten ersatzweise aus den Kartenklassen, dann " +
            "steht in `passendeWerte`, wonach zu filtern ist). Ein Vorschlag, keine Wahrheit: " +
            "prüf auch Layer ohne Kategorie und ruf beschreibeLayer(layerTitel) für alles auf, " +
            "was nach der Beschreibung einschlägig sein könnte.",
          layer: alleLayer().map((x) => ({
            titel: x.layer.title,
            // Die Beschreibung ist die eigentliche Entscheidungsgrundlage - sie
            // steht deshalb VOR den Feldern. Gekappt, weil Item-Beschreibungen
            // im Portal ganze Absätze sein können und die Historie sonst
            // aufblähen (siehe Kontextbudget in CLAUDE.md).
            beschreibung: layerBeschreibung(x.layer).slice(0, 300) || undefined,
            kategorieVorschlag: zuordnung.get(x.layer.title) ?? null,
            passendeWerte: inhaltsTreffer.get(x.layer.title) ?? undefined,
            geometrie: x.layer.geometryType,
            // Die Feld-Aliase verraten, was wirklich drinsteckt - der Titel
            // allein tut das oft nicht.
            felder: (x.layer.fields ?? [])
              .filter((f) => !nutzlos.test(f.name))
              .slice(0, 10)
              .map((f) => f.alias || f.name),
            symbolisiertNach: symbolisierung(x.layer).feld,
          })),
        };
      }
      const x = findeLayer(layerTitel);
      if (!x) {
        return {
          fehler: `Kein Layer ~ "${layerTitel}"`,
          verfuegbar: alleLayer().map((y) => y.layer.title),
        };
      }
      try {
        await x.layer.load?.();
      } catch {
        /* ignore */
      }
      // Gedeckelt, weil dieses Ergebnis in die Nachrichtenhistorie wandert und
      // dann bei JEDER weiteren Modellrunde erneut übertragen wird. Ein
      // ungefilterter Layer mit langen Domänenlisten sprengt sonst den Kontext.
      const nutzlos = /^(objectid|globalid|shape|se_anno|st_area|st_length)/i;
      const alleFelder = (x.layer.fields ?? []).filter((f) => !nutzlos.test(f.name));
      const ergebnis = {
        titel: x.layer.title,
        geometrie: x.layer.geometryType,
        feldZahl: alleFelder.length,
        felder: alleFelder.slice(0, MAX_FELDER).map((f) => {
          const cv = f.domain?.type === "coded-value" ? f.domain.codedValues : null;
          return {
            name: f.name,
            alias: f.alias,
            typ: f.type,
            domain: cv ? cv.slice(0, MAX_CODES).map((c) => ({ code: c.code, name: c.name })) : undefined,
            domainWeitere: cv && cv.length > MAX_CODES ? cv.length - MAX_CODES : undefined,
          };
        }),
      };
      if (alleFelder.length > MAX_FELDER) {
        ergebnis.hinweis = `Nur die ersten ${MAX_FELDER} Felder gezeigt.`;
      }

      // Was der Dienst und das Portal-Item ueber diesen Layer sagen - die
      // Grundlage fuer die Frage, ob er fachlich einschlaegig ist.
      ergebnis.beschreibung = layerBeschreibung(x.layer).slice(0, 600) || undefined;

      // Ein Layer kann ZWEI Kategorien tragen, unterschieden nur ueber ein
      // Attribut: "Vegetationsflaechen" enthaelt Wald- UND Landwirtschafts-
      // flaechen. Ohne diesen Hinweis fragt das Modell ihn einmal ab, legt
      // alles unter einer Kategorie ab, und die andere meldet "keine Objekte".
      const gehoertZu = [...kategorienFuerLayer(x.layer.title)];
      ergebnis.gehoertZu = gehoertZu;
      if (gehoertZu.length > 1) {
        ergebnis.hinweisMehrfachnutzung =
          `Dieser Layer trägt Objekte für ${gehoertZu.join(" UND ")}. Frage ihn für JEDE ` +
          "dieser Kategorien EINZELN ab und grenze dabei mit `where` auf die Klassen ein, " +
          "die zur jeweiligen Kategorie gehören (siehe klassifizierendeFelder). Eine " +
          "einzige Abfrage ohne Filter ordnet alle Objekte der falschen Kategorie zu.";
      }

      // Welche Felder KLASSIFIZIEREN? Nur die taugen als gruppeFeld. Ein Feld
      // mit codierter Domaene ist per Definition eine Klassifikation; bei
      // freien Textfeldern zaehlen wir die verschiedenen Werte IM
      // UNTERSUCHUNGSRAUM: 3 bis 40 Auspraegungen sind eine Klasse, 900 sind
      // Eigennamen und 1 traegt keine Information. Das Modell soll die Wahl
      // nicht raten, sondern an Zahlen treffen.
      const kandidaten = alleFelder.filter(
        (f) => f.domain?.type === "coded-value" || f.type === "string" || f.type === "small-integer",
      );
      ergebnis.klassifizierendeFelder = [];
      const suchgeom = _zonen.size ? [..._zonen.values()][0].geometrie : vorhaben.geometrie;
      for (const f of kandidaten.slice(0, 8)) {
        if (f.domain?.type === "coded-value") {
          ergebnis.klassifizierendeFelder.push({
            name: f.name,
            alias: f.alias,
            grund: `codierte Domaene mit ${f.domain.codedValues.length} Werten`,
          });
          continue;
        }
        try {
          const q = x.layer.createQuery();
          if (suchgeom) {
            q.geometry = suchgeom;
            q.spatialRelationship = "intersects";
          }
          q.outFields = [f.name];
          q.returnDistinctValues = true;
          q.returnGeometry = false;
          q.num = 60;
          const fs = await x.layer.queryFeatures(q);
          const werte = [...new Set(fs.features.map((g) => g.attributes?.[f.name]))].filter(
            (v) => v != null && v !== "",
          );
          if (werte.length >= 2 && werte.length <= 40) {
            ergebnis.klassifizierendeFelder.push({
              name: f.name,
              alias: f.alias,
              grund: `${werte.length} verschiedene Werte im Untersuchungsraum`,
              werte: werte.slice(0, MAX_CODES),
            });
          }
        } catch {
          /* Feld nicht abfragbar - dann eben kein Kandidat */
        }
      }
      ergebnis.hinweisGruppeFeld =
        "Waehle das gruppeFeld aus klassifizierendeFelder und nimm das, dessen Auspraegungen " +
        "raumordnerisch etwas unterscheiden (Strassenklasse, Schutzgebietstyp, Gewaesserart) - " +
        "nicht Name, Nummer oder Datum. Steht die Liste leer, frage ohne gruppeFeld ab.";
      if (Array.isArray(felder) && felder.length) {
        ergebnis.beispielWerte = {};
        for (const feld of felder.slice(0, 3)) {
          try {
            const q = x.layer.createQuery();
            q.where = "1=1";
            q.outFields = [feld];
            q.returnDistinctValues = true;
            q.returnGeometry = false;
            q.num = MAX_CODES;
            const fs = await x.layer.queryFeatures(q);
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
export async function makeHoleRegionalplan() {
  return createFunctionTool({
    name: "holeRegionalplan",
    description:
      "Sucht im geltenden Regionalplan der zuvor bestimmten Region nach Zielen und Grundsätzen. " +
      "Entweder kategorieId angeben (nutzt den hinterlegten Suchtext der Kategorie) oder " +
      "frage frei formulieren. Gib die Fundstelle im Wortlaut wieder - bewerte NICHT, ob das " +
      "Vorhaben einem Ziel widerspricht.",
    inputSchema: await createSchema({
      kategorieId: { type: "string", description: "Kategorie aus dem Katalog.", enum: FB_IDS },
      vorhaben: {
        type: "string",
        description:
          "Die geplante Massnahme in Kurzform, z. B. \"Neubau einer Strasse\". Daraus wird die Suche als Wirkungsfrage formuliert.",
      },
      frage: { type: "string", description: "Alternativ: vollstaendig freier Suchtext." },
    }),
    execute: async ({ kategorieId, vorhaben: vorhabenText, frage }) => {
      if (!_region) {
        return {
          fehler: "Region noch nicht bestimmt.",
          nichtWiederholen: true,
          hinweis: "Zuerst bestimmeRegion aufrufen, dann erneut - nicht blind wiederholen.",
        };
      }
      const fb = getKategorie(kategorieId);
      const q = frage || (fb ? wirkungsfrage(vorhabenText, fb, "regionalplan") : null);
      if (!q) return { fehler: "Weder kategorieId noch frage angegeben." };
      try {
        const data = await ragAnfrage("regionalplan", { frage: q, region: _region.region });
        const fundstellen = (data.treffer ?? []).map((t) => ({
          zitat: t.zitat,
          ueberschrift: t.ueberschrift,
          art: t.art,
          stand: t.stand,
          quelle_url: t.quelle_url,
          score: t.score,
          text: t.text,
        }));
        // Volltext in den Store fürs Panel, gekürzt ans Modell: die Passagen
        // würden sonst die Nachrichtenhistorie fluten und jede weitere Runde
        // verteuern.
        setzeFundstellen(`regionalplan:${kategorieId ?? "frei"}`, fundstellen);
        return {
          quelle: "Regionalplan",
          plan: _region.plan,
          region: _region.name,
          fundstellen: fundstellen.slice(0, MODELL_TREFFER).map(fuerModell),
        };
      } catch (err) {
        return {
          fehler: `Regionalplan-Index nicht erreichbar: ${err}`,
          nichtWiederholen: true,
          hinweis:
            "Diesen Aufruf NICHT wiederholen. Fahre ohne Regionalplan-Fundstelle fort und " +
            "stütze die Relevanz auf das im Katalog hinterlegte Fachrecht.",
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
export async function makeHoleRechtsgrundlage() {
  return createFunctionTool({
    name: "holeRechtsgrundlage",
    description:
      "Sucht im Gesetzeskorpus (Bundes- und NRW-Recht) nach einschlägigen Normen. Entweder " +
      "kategorieId angeben (nutzt den hinterlegten Suchtext) oder frage frei formulieren.",
    inputSchema: await createSchema({
      kategorieId: { type: "string", description: "Kategorie aus dem Katalog.", enum: FB_IDS },
      vorhaben: {
        type: "string",
        description:
          "Die geplante Massnahme in Kurzform, z. B. \"Neubau einer Strasse\". Daraus wird die Suche als Wirkungsfrage formuliert.",
      },
      frage: { type: "string", description: "Alternativ: vollstaendig freier Suchtext." },
    }),
    execute: async ({ kategorieId, vorhaben: vorhabenText, frage }) => {
      const fb = getKategorie(kategorieId);
      const q = frage || (fb ? wirkungsfrage(vorhabenText, fb, "gesetz") : null);
      if (!q) return { fehler: "Weder kategorieId noch frage angegeben." };
      try {
        const data = await ragAnfrage("rechtsgrundlage", { frage: q });
        const fundstellen = (data.treffer ?? []).map((t) => ({
          zitat: t.zitat,
          ueberschrift: t.ueberschrift,
          gesetz: t.gesetz,
          stand: t.stand,
          quelle_url: t.quelle_url,
          score: t.score,
          text: t.text,
        }));
        setzeFundstellen(`gesetz:${kategorieId ?? "frei"}`, fundstellen);
        return {
          quelle: "Gesetzeskorpus",
          hinterlegteNormen: fb?.fachgesetze ?? null,
          fundstellen: fundstellen.slice(0, MODELL_TREFFER).map(fuerModell),
        };
      } catch (err) {
        return {
          fehler: `Gesetzes-Index nicht erreichbar: ${err}`,
          nichtWiederholen: true,
          hinweis:
            "Diesen Aufruf NICHT wiederholen. Nutze die im Katalog hinterlegten Normen als " +
            "Grundlage und vermerke, dass der Volltext nicht abrufbar war.",
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
async function makeMeldeRelevanz() {
  return createFunctionTool({
    name: "meldeRelevanz",
    description:
      "Stuft EINE Kategorie als für dieses Vorhaben RELEVANT ein, begründet das und legt " +
      "SEINE Untersuchungszone fest. NUR für relevante Kategorien aufrufen - nicht relevante " +
      "werden gar nicht gemeldet, auch nicht mit Null. " +
      "Jede Kategorie hat einen EIGENEN Radius: er ergibt sich aus dem einschlägigen " +
      "Abstandserfordernis bzw. dem Wirkraum dieses Belangs (z.B. Anbauverbotszone, " +
      "Gewässerrandstreifen, Umgebungsschutz, Wirkraum von Schutzgebieten). " +
      "radiusBegruendung muss diese Herleitung nennen und sich auf die Fundstelle stützen.",
    resultMode: "continue",
    inputSchema: await createSchema({
      kategorieId: { type: "string", description: "Die betroffene Kategorie.", required: true, enum: FB_IDS },
      begruendung: {
        type: "string",
        description: "Warum dieser Bereich für dieses Vorhaben zu betrachten ist (2-4 Sätze).",
        required: true,
      },
      radiusMeter: {
        type: "number",
        description: "Untersuchungsradius dieser Kategorie in Metern (0 = nur die Vorhabenflaeche).",
        required: true,
      },
      radiusBegruendung: {
        type: "string",
        description: "Woraus sich genau dieser Radius ergibt - mit Bezug auf die Fundstelle.",
        required: true,
      },
      regionalplan: { type: "string", description: "Zitat aus dem Regionalplan (Nummer + Titel)." },
      gesetz: { type: "string", description: "Zitat der einschlägigen Norm." },
    }),
    execute: async ({ kategorieId, begruendung, radiusMeter, radiusBegruendung, regionalplan, gesetz }) => {
      const fb = getKategorie(kategorieId);
      if (!fb) return { fehler: `Unbekannte Kategorie: ${kategorieId}` };

      const geom = requireVorhaben();
      await messwerkzeugeBereit();
      const zone =
        radiusMeter > 0
          ? geodesicBufferOperator.execute(geom, radiusMeter, { unit: "meters" })
          : geom;
      _zonen.set(kategorieId, { geometrie: zone, meter: radiusMeter });
      const zoneFlaecheM2 = Math.round(
        Math.abs(geodeticAreaOperator.execute(zone, { unit: "square-meters" })),
      );
      zeichneZone(kategorieId, zone, radiusMeter, `${fb.titel} - ${radiusMeter} m`);

      storeRelevanz({
        kategorieId,
        begruendung,
        radiusMeter,
        radiusBegruendung,
        zoneFlaecheM2,
        regionalplan,
        gesetz,
      });
      return {
        gespeichert: true,
        kategorie: fb.titel,
        radiusMeter,
        zoneFlaecheM2,
        layerVorschlag: layerFuerKategorieGesamt(kategorieId).map((x) => x.layer.title),
      };
    },
  });
}

// ---------------------------------------------------------------------------
async function makeMeldeNichtRelevant() {
  return createFunctionTool({
    name: "meldeNichtRelevant",
    description:
      "Meldet EINE geprüfte Kategorie als für dieses Vorhaben NICHT einschlägig - mit " +
      "Begründung aus der Recherche. Ruf das für jede Kategorie auf, die du mit recherchiere " +
      "geprüft und dann verworfen hast. Das ist bei einem Teil der Kategorien der Normalfall, " +
      "kein Ausweichen. Damit ist im Ergebnis nachvollziehbar, dass sie " +
      "betrachtet wurde, statt einfach zu fehlen. Keine Zone, keine Abfrage.",
    resultMode: "continue",
    inputSchema: await createSchema({
      kategorieId: { type: "string", description: "Die geprüfte Kategorie.", required: true, enum: FB_IDS },
      begruendung: {
        type: "string",
        description:
          "Warum ein Vorhaben DIESER ART den Belang seiner Bauart nach gar nicht berühren " +
          "kann - EIN Satz (\"eine Anlage ausschliesslich im Siedlungsbereich nimmt keine " +
          "Waldflächen in Anspruch\"). NICHT zulässig: Begründungen über die konkrete Lage " +
          "(\"liegt vermutlich nicht in einem solchen Bereich\") - das klärt die räumliche " +
          "Analyse. Ebenso wenig zulässig: \"der Kurzbefund nennt keine benennbare " +
          "Anforderung\" oder \"keine vorhabentypspezifische Festlegung\". Regionalpläne " +
          "regeln Gebiete und Fachgesetze Schutzgüter; dass der Vorhabentyp dort nicht " +
          "namentlich steht, ist der Normalfall und kein Beleg für Nichtbetroffenheit.",
        required: true,
      },
      fundstelle: {
        type: "string",
        description: "Worauf sich das stützt (Ziel-Nummer, Paragraph oder 'keine Festlegung').",
      },
    }),
    execute: ({ kategorieId, begruendung, fundstelle }) => {
      const fb = getKategorie(kategorieId);
      if (!fb) return { fehler: `Unbekannte Kategorie: ${kategorieId}` };
      storeNichtRelevant({ kategorieId, begruendung, fundstelle });
      return { vermerkt: true, kategorie: fb.titel };
    },
  });
}

// ---------------------------------------------------------------------------
async function makeQueryLayer() {
  return createFunctionTool({
    name: "queryLayer",
    description:
      "Fragt EINEN Kartenlayer gegen die Untersuchungszone DIESER Kategorie ab. " +
      "Der Radius stammt aus meldeRelevanz. Nur für Kategorien aufrufen, die zuvor per " +
      "meldeRelevanz als relevant eingestuft wurden. Liefert Anzahl der Objekte, bei " +
      "Flächen- und Linienlayern die betroffene Fläche bzw. Länge - gemessen wird nur der " +
      "SCHNITT mit der Zone, nicht das ganze Fremdobjekt. " +
      "Feldnamen im 'where' werden gegen den Layer geprüft und unbekannte zurückgewiesen; " +
      "hol dir Namen und Codes vorher mit beschreibeLayer. Trifft dein Filter kein einziges " +
      "Objekt, obwohl welche in der Zone liegen, wird er verworfen und ohne Filter gemessen - " +
      "das Ergebnis kommt trotzdem, mit 'filterVerworfen' und den tatsächlichen Werten. " +
      "'where' grenzt auf die raumordnerisch relevanten Ausprägungen ein, 'gruppeFeld' ist " +
      "dasselbe Feld und schlüsselt das Ergebnis nach Ausprägung auf.",
    inputSchema: await createSchema({
      kategorieId: { type: "string", description: "Die betroffene Kategorie.", required: true, enum: FB_IDS },
      layerTitel: { type: "string", description: "Titel des Layers.", required: true },
      where: {
        type: "string",
        description:
          "Attributfilter als SQL (ohne 'WHERE'), der auf die fachlich relevanten Objekte " +
          "eingrenzt - z.B. nur klassifizierte Strassen statt aller Wege.",
      },
      gruppeFeld: {
        type: "string",
        description:
          "Feldname, nach dem die Treffer aufgeschlüsselt werden (z.B. Strassenklasse, " +
          "Gewässerart, Vegetationstyp). Domänen-Codes werden automatisch in Klartext " +
          "übersetzt.",
      },
    }),
    execute: async ({ kategorieId, layerTitel, where, gruppeFeld }) => {
      // Ohne Untersuchungszone gibt es keine Abfrage. Die Zone entsteht
      // ausschliesslich in meldeRelevanz, also erst NACH der RAG-Recherche -
      // damit ist hier deterministisch gesperrt, was fachlich gilt: kein
      // Objektabgleich für eine Kategorie, die Regionalplan und Fachrecht
      // nicht als betroffen ausgewiesen haben. Vorher fiel suchgeometrie()
      // still auf die blosse Vorhabengeometrie zurück, und das Modell konnte
      // jede beliebige Kategorie abfragen.
      if (!_zonen.has(kategorieId)) {
        return {
          fehler: `Für "${kategorieId}" ist keine Untersuchungszone festgelegt.`,
          nichtWiederholen: true,
          hinweis:
            "Erst recherchiere(kategorieId, vorhaben) aufrufen und die Kategorie mit " +
            "meldeRelevanz einstufen - dann steht ihr Radius fest. Kategorien ohne " +
            "Relevanzmeldung werden NICHT abgefragt.",
        };
      }
      const x = findeLayer(layerTitel);
      if (!x) {
        return {
          layerFehlt: true,
          gesucht: layerTitel,
          vorschlag: layerFuerKategorieGesamt(kategorieId).map((y) => y.layer.title),
        };
      }
      // Gehört der Layer überhaupt zu dieser Kategorie? Ein Lauf hat sämtliche
      // Layer - Siedlungsflächen, Gewässerflächen, Verkehrswege - unter
      // "Kulturlandschaft und Denkmäler" abgelegt, weil das Modell überall
      // dieselbe kategorieId mitgab. Im Ergebnis stand dann ein Thema mit
      // allem drin und sieben Themen ohne Objekte.
      const beansprucht = kategorienFuerLayer(x.layer.title);
      if (beansprucht.size && !beansprucht.has(kategorieId)) {
        return {
          fehler: `"${x.layer.title}" gehört nicht zu "${kategorieId}".`,
          nichtWiederholen: true,
          gehoertZu: [...beansprucht],
          hinweis:
            `Frage diesen Layer unter ${[...beansprucht].join(" oder ")} ab. Ist die Kategorie ` +
            "noch nicht als relevant gemeldet, hol das zuerst nach - oder lass den Layer weg. " +
            "Die kategorieId bestimmt, unter welchem Thema das Ergebnis erscheint; sie ist " +
            "keine Formalie.",
        };
      }

      const suchgeom = suchgeometrie(kategorieId);
      await messwerkzeugeBereit();
      try {
        await x.layer.load?.();
      } catch {
        /* ignore */
      }

      const fehlend = [
        ...unbekannteFelder(x.layer, where),
        ...(gruppeFeld && !(x.layer.fields ?? []).some((f) => f.name === gruppeFeld)
          ? [gruppeFeld]
          : []),
      ];
      if (fehlend.length) {
        return {
          fehler: `Unbekannte Felder: ${fehlend.join(", ")}`,
          vorhandeneFelder: feldUebersicht(x.layer),
          hinweis:
            "Diese Felder gibt es auf dem Layer nicht. Nimm einen Namen aus vorhandeneFelder " +
            "und - bei codierten Werten - die Codes aus beschreibeLayer. Nicht raten.",
        };
      }

      const baueQuery = (w) => {
        const q = x.layer.createQuery();
        q.geometry = suchgeom;
        q.spatialRelationship = "intersects";
        q.outFields = ["*"];
        q.returnGeometry = true;
        // ENTSCHEIDEND fuer die Messung: Die Features muessen im selben
        // Bezugssystem ankommen wie die Untersuchungszone. Ohne das liefert der
        // Dienst sie in der Projektion des Layers (bei NRW-Daten meist
        // ETRS89/UTM32), und der Verschnitt mit der Zone rechnet zwei
        // verschiedene Koordinatensysteme gegeneinander.
        if (suchgeom?.spatialReference) q.outSpatialReference = suchgeom.spatialReference;
        if (w) q.where = w;
        return q;
      };

      /** Exakte Trefferzahl - serverseitig, ohne Deckel. */
      const zaehle = async (w) => {
        try {
          const q = baueQuery(w);
          q.returnGeometry = false;
          return await x.layer.queryFeatureCount(q);
        } catch {
          return null;
        }
      };

      /**
       * Holt Geometrien seitenweise bis MAX_TREFFER. Ohne Pagination liefert
       * der Dienst nur seine maxRecordCount-Seite - das wird dann gemeldet,
       * statt es als vollständiges Ergebnis auszugeben.
       */
      const holeFeatures = async (w) => {
        const seitenweise = Boolean(x.layer.capabilities?.query?.supportsPagination);
        const out = [];
        for (let start = 0; out.length < MAX_TREFFER; start += SEITE) {
          const q = baueQuery(w);
          q.num = SEITE;
          if (seitenweise) q.start = start;
          const seite = await x.layer.queryFeatures(q);
          out.push(...seite.features);
          if (!seitenweise || seite.features.length < SEITE) break;
        }
        return out.slice(0, MAX_TREFFER);
      };

      // Die Symbolisierungsmethode entscheidet über die Aufschlüsselung:
      // Einzelsymbol -> gar keine, Typen -> das Feld der Karte, auch ohne
      // Zutun des Modells.
      const sym = symbolisierung(x.layer);
      // Einzelsymbol heisst: der Layer trägt keine Unterscheidung, die hier
      // zählt - dann bleibt es bewusst bei keiner Aufteilung. Sonst zählt das
      // Feld des Modells, dann das des Renderers, und erst danach der Rückfall
      // auf die Attribute (weiter unten, dafür braucht es die Features).
      // Beim Einzelsymbol liefert der Renderer kein Feld - das heisst aber
      // nicht, dass der Layer keine Klassifikation FÜHRT. Gesucht wird sie
      // trotzdem, weiter unten aus den Attributen.
      let gruppe = gruppeFeld ?? sym.feld;
      let gruppeQuelle = gruppe ? (gruppeFeld ? "modell" : "renderer") : null;

      let features = await holeFeatures(where);
      let benutzterFilter = where ?? null;
      let filterVerworfen = null;
      let tatsaechlicheWerte = null;

      // Trifft der Filter nichts, obwohl Objekte in der Zone liegen, wird er
      // VERWORFEN statt den Schritt abzubrechen. Vorher stieg das Werkzeug
      // hier aus, ohne irgendetwas zu speichern - traf das Modell mit seinen
      // Filtern daneben, lieferte Phase 2 gar kein Ergebnis, obwohl der Punkt
      // mitten in einer Siedlung lag. Das Messen ist die verlässliche
      // Grundfunktion; der Filter ist nur eine Verfeinerung.
      if (!features.length && where) {
        const ohne = await holeFeatures(null);
        if (ohne.length) {
          const feld = gruppe ?? null;
          tatsaechlicheWerte = feld
            ? [...new Set(ohne.map((f) => wertLesbar(x.layer, feld, f.attributes?.[feld])))].slice(0, 25)
            : null;
          filterVerworfen = where;
          benutzterFilter = null;
          features = ohne;
          console.warn("[tools] Filter traf nichts, wurde verworfen:", {
            layer: x.layer.title,
            where,
            ohneFilter: ohne.length,
            tatsaechlicheWerte,
          });
        }
      }

      let gesamt = (await zaehle(benutzterFilter)) ?? features.length;
      const fs = { features };

      merkeTreffer(x.layer.title, fs.features, x.layer.title, x.layer.objectIdField);

      // Mass je Objekt: Fläche/Länge NUR im SCHNITT mit der Zone - nicht die
      // volle Ausdehnung des Fremdobjekts. Ein Naturschutzgebiet, das die Zone
      // nur streift, zählt sonst mit seiner Gesamtfläche.
      const istFlaeche = x.layer.geometryType === "polygon";
      const istLinie = x.layer.geometryType === "polyline";
      // Gemessen wird nur der Teil, der WIRKLICH in der Zone liegt: erst
      // verschneiden, dann geodaetisch messen. Ein Waldstueck, das zur Haelfte
      // hineinragt, zaehlt zur Haelfte.
      const massVon = (geom) => {
        if (!istFlaeche && !istLinie) return 0;
        try {
          const schnitt = intersectionOperator.execute(geom, suchgeom);
          if (!schnitt) return 0;
          return Math.abs(
            istFlaeche
              ? geodeticAreaOperator.execute(schnitt, { unit: "square-meters" })
              : geodeticLengthOperator.execute(schnitt, { unit: "meters" }),
          );
        } catch (err) {
          console.warn(`[tools] Geometrie in "${x.layer.title}" nicht messbar:`, err);
          return 0;
        }
      };

      // ERST ein Gruppenfeld bestimmen - der Klassenfilter unten braucht es,
      // um die Werte der Kategorie zuzuordnen. Ohne diesen Schritt lief er ins
      // Leere: bei "Vegetationsflächen" liefert der Renderer gar kein Feld,
      // der Filter bekam `null` und gab auf - Wald und Landwirtschaft zeigten
      // daraufhin denselben Bestand.
      // Auch beim Einzelsymbol wird gesucht: dass die Karte alles gleich
      // zeichnet, heisst nicht, dass der Layer keine Objektart führt.
      if (!gruppe) {
        gruppe = ersatzGruppenfeld(x.layer, fs.features);
        if (gruppe) gruppeQuelle = "ersatz";
      }

      // Gehört der Layer MEHREREN Kategorien und hat das Modell keinen Filter
      // gesetzt, wird er hier hergeleitet - sonst misst jede Kategorie den
      // ganzen Layer. Deterministisch aus den Stichworten des Katalogs.
      let autoFilter = null;
      if (!benutzterFilter && kategorienFuerLayer(x.layer.title).size > 1) {
        autoFilter = klassenFilter(x.layer, kategorieId, gruppe, fs.features);
        if (autoFilter) {
          console.info(
            `[tools] "${x.layer.title}" gehört zu mehreren Kategorien - für "${kategorieId}" ` +
              `automatisch gefiltert: ${autoFilter.where}`,
          );
          benutzterFilter = autoFilter.where;
          features = await holeFeatures(autoFilter.where);
          fs.features = features;
          gesamt = (await zaehle(autoFilter.where)) ?? features.length;
        }
      }

      // Nach dem Filter noch einmal prüfen: Wurde auf `objektart='wald'`
      // eingegrenzt, steht in diesem Feld nur noch ein Wert und der Ring hätte
      // ein einziges Segment. Die Unterteilung sitzt dann eine Ebene tiefer
      // (klasse: Laub-, Nadel-, Mischwald).
      {
        const werte = gruppe
          ? new Set(
              fs.features.map((f) => f.attributes?.[gruppe]).filter((v) => v != null && v !== ""),
            )
          : new Set();
        if (werte.size < 2) {
          const ersatz = ersatzGruppenfeld(x.layer, fs.features, gruppe);
          if (ersatz) {
            console.info(
              `[tools] "${x.layer.title}": "${gruppe ?? "-"}" unterscheidet hier nicht ` +
                `(${werte.size} Wert(e)) - Aufteilung nach "${ersatz}".`,
            );
            gruppe = ersatz;
            gruppeQuelle = "ersatz";
          }
        }
      }

      // Aufschlüsselung nach dem fachlich tragenden Attribut: erst dadurch
      // wird aus "42 Verkehrswege" ein "12 km Autobahn, 2 km Wirtschaftsweg".
      const gruppen = new Map();
      const oidFeld = x.layer.objectIdField;
      let summe = 0;
      for (const f of fs.features) {
        const m = massVon(f.geometry);
        summe += m;
        if (!gruppe) continue;
        const roh = f.attributes?.[gruppe];
        const label = wertLesbar(x.layer, gruppe, roh);
        const g = gruppen.get(label) ?? {
          wert: label,
          anzahl: 0,
          mass: 0,
          farbe: null,
          // Ein Vertreter je Ausprägung - daran fragen wir gleich die Farbe ab,
          // mit der die Karte ihn zeichnet.
          vertreter: f,
          objectIds: [],
        };
        g.anzahl += 1;
        g.mass += m;
        const oid = oidFeld ? f.attributes?.[oidFeld] : null;
        if (oid != null) g.objectIds.push(oid);
        gruppen.set(label, g);
      }

      // Farben der Kartensymbolisierung nachtragen, damit Ring und Karte
      // dieselbe Sprache sprechen.
      await Promise.all(
        [...gruppen.values()].map(async (g) => {
          g.farbe = await farbeAusKarte(x.layer, g.vertreter);
        }),
      );
      const ohneFarbe = [...gruppen.values()].filter((g) => !g.farbe).length;
      if (gruppen.size && ohneFarbe) {
        console.warn(
          `[tools] ${ohneFarbe} von ${gruppen.size} Ausprägungen ohne Kartenfarbe in "${x.layer.title}"`,
          { rendererTyp: x.layer.renderer?.type ?? null, rendererFeld: x.layer.renderer?.field ?? null },
        );
      }

      const flaecheM2 = istFlaeche ? Math.round(summe) : null;
      const laengeM = istLinie ? Math.round(summe) : null;
      const aufschluesselung = [...gruppen.values()]
        .map((g) => ({
          wert: g.wert,
          anzahl: g.anzahl,
          flaecheM2: istFlaeche ? Math.round(g.mass) : null,
          laengeM: istLinie ? Math.round(g.mass) : null,
          farbe: g.farbe,
          objectIds: g.objectIds,
        }))
        .sort((a, b) => (b.flaecheM2 ?? b.laengeM ?? b.anzahl) - (a.flaecheM2 ?? a.laengeM ?? a.anzahl));

      // Gemessen wurde nur, was wir auch geholt haben. Wenn der Deckel greift,
      // muss das mitlaufen - sonst sieht eine Teilsumme aus wie das Ganze.
      const teilmenge = gesamt > features.length;
      // Eine Leitfarbe für DEN LAYER, nicht je Ausprägung: das Ergebnispanel
      // faerbt damit die Leitzahl. Ein einheitliches Blau fuer alles sagte
      // nichts darueber, welcher Layer gemeint ist.
      const layerFarbe = features.length ? await farbeAusKarte(x.layer, features[0]) : null;
      merkeAbfrage({
        kategorieId,
        layer: x.layer.title,
        layerFarbe,
        objectIds: oidFeld ? fs.features.map((f) => f.attributes?.[oidFeld]).filter((v) => v != null) : [],
        anzahl: gesamt,
        gemessen: features.length,
        teilmenge,
        flaecheM2,
        laengeM,
        geometrieTyp: x.layer.geometryType,
        gruppeFeld: gruppe ?? null,
        gruppeQuelle,
        autoFilterWerte: autoFilter?.werte ?? null,
        symbolArt: sym.art,
        symbolAusdruck: sym.ausdruck,
        aufschluesselung,
        where: benutzterFilter,
      });

      return {
        layer: x.layer.title,
        kategorie: kategorieId,
        anzahl: gesamt,
        gemessen: teilmenge ? features.length : undefined,
        hinweisDeckel: teilmenge
          ? `Anzahl ist exakt. Fläche und Länge sind über die ersten ${features.length} von ` +
            `${gesamt} Objekten gemessen - grenze mit where enger ein, wenn du vollständige ` +
            "Summen brauchst."
          : undefined,
        flaecheM2,
        laengeM,
        where: benutzterFilter ?? "1=1",
        gruppeFeld: gruppe ?? null,
        aufschluesselung: aufschluesselung
          .slice(0, 12)
          .map(({ wert, anzahl, flaecheM2: fl, laengeM: la }) => ({
            wert,
            anzahl,
            flaecheM2: fl,
            laengeM: la,
          })),
        filterVerworfen: filterVerworfen ?? undefined,
        tatsaechlicheWerte: tatsaechlicheWerte ?? undefined,
        hinweisFilter: filterVerworfen
          ? `Dein where "${filterVerworfen}" traf kein einziges Objekt, obwohl welche in der ` +
            "Zone liegen. Es wurde verworfen und ohne Filter gemessen. Nimm beim nächsten Mal " +
            "Werte aus tatsaechlicheWerte - oder lass den Filter weg und schlüssele nur auf."
          : undefined,
        hinweisAufschluesselung: gruppe
          ? undefined
          : "Ohne gruppeFeld ist nicht erkennbar, WELCHE Art von Objekten getroffen wurde. " +
            "Prüfe mit beschreibeLayer die Felder und wiederhole die Abfrage mit gruppeFeld " +
            "und - falls fachlich geboten - einem einschränkenden where.",
        beispielAttribute: fs.features.slice(0, 2).map((f) => f.attributes),
      };
    },
  });
}

// ---------------------------------------------------------------------------
async function makeFasseZusammen() {
  return createFunctionTool({
    name: "fasseZusammen",
    description:
      "Schliesst das Screening mit 3 bis 5 KERNAUSSAGEN ab - kein Fliesstext. " +
      "Jede Aussage EIN kurzer Satz, quantifiziert und faktisch, z.B. " +
      "'2 Gewässer im 50-m-Umfeld, davon eine Qürung' oder " +
      "'Vorhaben liegt vollständig im Freiraum'. Die Zahlen stammen aus queryLayer. " +
      "KEINE Aussage zur Raumverträglichkeit oder Zulässigkeit.",
    resultMode: "continue",
    inputSchema: await createSchema({
      kernaussagen: {
        type: "array",
        description: "3 bis 5 kurze, quantifizierte Aussagen.",
        itemType: "string",
        required: true,
      },
    }),
    execute: ({ kernaussagen }) => {
      setzeKernaussagen(kernaussagen);
      const a = getAnalyse();
      return { geschrieben: (kernaussagen ?? []).length, relevanteKategorien: a.relevanz.length };
    },
  });
}

/**
 * Layer, die zu einer als relevant gemeldeten Kategorie passen, aber noch
 * nicht abgefragt wurden.
 *
 * Das Modell greift sich gern einen Layer je Kategorie und lässt den Rest
 * liegen - bei "Wald" dann die Bäume, aber nicht die Vegetationsflächen.
 * Diese Prüfung ist deterministisch und braucht das Modell nicht.
 *
 * @returns {Array<{kategorieId: string, layer: string[]}>}
 */
export function offeneLayer() {
  const a = getAnalyse();
  // Je KATEGORIE UND LAYER, nicht je Layer: "Vegetationsflächen" unter
  // Landwirtschaft abgefragt heisst nicht, dass es auch unter Wald abgefragt
  // wurde - dort trägt derselbe Layer andere Klassen.
  const abgefragt = new Set(a.abfragen.map((x) => `${x.kategorieId}|${x.layer}`));
  const out = [];
  for (const r of a.relevanz) {
    // Gesamtsicht: Titeltreffer UND Inhaltstreffer. Ein Layer, dessen Klassen
    // "Wald" enthalten, gehört genauso in die Nachfrage wie einer, der so heisst.
    const fehlt = layerFuerKategorieGesamt(r.kategorieId)
      .filter((x) => !abgefragt.has(`${r.kategorieId}|${x.layer.title}`))
      .map((x) => {
        const mehrfach = kategorienFuerLayer(x.layer.title).size > 1;
        const zusatz = x.treffer?.length ? ` (Werte: ${x.treffer.join(", ")})` : "";
        // Wurde derselbe Layer schon unter einer ANDEREN Kategorie abgefragt,
        // ist der Filter das Entscheidende - sonst kaeme dieselbe Menge zweimal.
        return `${x.layer.title}${zusatz}${
          mehrfach ? " [auch für andere Kategorien - mit where auf die passenden Klassen einschränken]" : ""
        }`;
      });
    if (fehlt.length) out.push({ kategorieId: r.kategorieId, layer: fehlt });
  }
  return out;
}

/**
 * Werkzeuge des Haupt-Agenten. Die RAG-Recherche läuft über die Subagenten
 * (subagenten.js) - deren Passagen sollen den Hauptkontext nicht fluten.
 */
export async function baueTools() {
  return mitFortschritt(
    await Promise.all([
      makeHoleVorhabenKontext(),
      makeBestimmeRegion(),
      makeBeschreibeLayer(),
      makeMeldeRelevanz(),
      makeMeldeNichtRelevant(),
      makeQueryLayer(),
      makeFasseZusammen(),
    ]),
  );
}

export { mitFortschritt };
