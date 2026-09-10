// Karten- und Zeichen-Modul.
//
// <arcgis-map> + Werkzeuge (Suche, Layerübersicht, Lesezeichen, Messen,
// Sketch). Die gezeichnete Geometrie (Punkt oder Fläche) ist der Ausgangspunkt
// fürs Screening (`vorhaben`).
//
// Analyse-Grafiken: Such-Puffer je Rechtsgebiet (standardmäßig unsichtbar,
// nur beim Klick auf den zugehörigen Befund sichtbar) und die gefundenen
// Features. Klick auf ein Feature in der Karte -> onFeatureKlick-Callback.

import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-search";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-bookmarks";
import "@arcgis/map-components/components/arcgis-basemap-gallery";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-distance-measurement-2d";
import "@arcgis/map-components/components/arcgis-area-measurement-2d";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/map-components/components/arcgis-sketch";

import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Point from "@arcgis/core/geometry/Point";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator";
import * as centroidOperator from "@arcgis/core/geometry/operators/centroidOperator";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

import { WEBMAP_ID } from "./config.js";
import { t, onLang } from "./i18n.js";

/** Beobachtbarer Zustand der aktuellen Vorhabengeometrie (Polygon oder Punkt). */
export const vorhaben = {
  /** @type {__esri.Polygon | __esri.Point | null} */
  geometrie: null,
  _listener: new Set(),
  set(geom) {
    this.geometrie = geom ?? null;
    this._listener.forEach((fn) => fn(this.geometrie));
  },
  onChange(fn) {
    this._listener.add(fn);
    return () => this._listener.delete(fn);
  },
};

let mapEl;
let skizzenLayer;
let labelLayer;
let _vorhabenLabel = "";
let analyseLayer;
/** @type {Map<string, Array<{ graphic, attributes, layerTitel }>>} */
const trefferProBereich = new Map();
/** @type {Map<string, __esri.Graphic[]>} Puffer-Grafiken je Bereich (unsichtbar bis Klick). */
const pufferProBereich = new Map();

let _featureKlickFn = () => {};
/** Callback bei Klick auf ein Treffer-Feature in der Karte (oder null = daneben). */
export function onFeatureKlick(fn) {
  _featureKlickFn = fn ?? (() => {});
}

export async function initKarte(container, sketchContainer) {
  mapEl = document.createElement("arcgis-map");
  mapEl.id = "main-map";
  mapEl.itemId = WEBMAP_ID;
  // Kein natives Webmap-Popup - die Erklärung liefert die eigene Blase (app.js).
  mapEl.popupDisabled = true;

  const search = document.createElement("arcgis-search");
  search.setAttribute("slot", "top-right");

  const expand = (kind, tooltip, icon) => {
    const inner = document.createElement(kind);
    const wrap = document.createElement("arcgis-expand");
    wrap.setAttribute("slot", "top-right");
    wrap.expandTooltip = tooltip;
    if (icon) wrap.expandIcon = icon;
    wrap.appendChild(inner);
    return { wrap, inner };
  };
  const layer = expand("arcgis-layer-list", t("map.showLayers"), "layers");
  const marks = expand("arcgis-bookmarks", t("map.bookmarks"), "bookmark");
  // Ohne Vorschaubild und Zeitstempel ist ein Lesezeichen eine einzeilige
  // Zeile statt einer Kachel.
  marks.inner.hideThumbnail = true;
  marks.inner.hideTime = true;
  // Nach der Wahl eines Lesezeichens hat der Aufklapper seinen Zweck erfüllt -
  // er verdeckt sonst genau den Ausschnitt, zu dem er gerade gesprungen ist.
  marks.inner.addEventListener("arcgisBookmarkSelect", () => {
    marks.wrap.expanded = false;
  });
  // Der Sprung zum Lesezeichen ist standardmässig sehr schnell - man verliert
  // dabei die Orientierung, weil nicht zu sehen ist, WOHIN die Karte fährt.
  // `goToOverride` (seit 4.33) ist der vorgesehene Weg, die Dauer zu setzen.
  marks.inner.goToOverride = (view, ziel) =>
    view.goTo(ziel.target, { ...ziel.options, duration: LESEZEICHEN_MS, easing: "ease-in-out" });
  // `arcgis-measurement` ist seit 5.0 abgekündigt und zeigte hier nichts mehr
  // an. Ersatz sind die beiden eigenständigen Komponenten - die Einheit heisst
  // dort `unit`, nicht mehr linearUnit/areaUnit.
  // Strecke und Fläche in EINEM Aufklapper - zwei Knöpfe nebeneinander für
  // dieselbe Aufgabe sind Platzverschwendung.
  const messen = document.createElement("arcgis-expand");
  messen.setAttribute("slot", "top-right");
  messen.expandIcon = "measure";
  messen.expandTooltip = t("map.measure");
  const messBox = document.createElement("div");
  messBox.className = "mess-box";

  // Beide Komponenten beschriften sich selbst mit "Neue Messung" - ohne
  // Überschrift ist nicht zu erkennen, welche welche ist.
  const messFeld = (kind, titel, einheit) => {
    const box = document.createElement("div");
    box.className = "mess-feld";
    const kopf = document.createElement("div");
    kopf.className = "mess-titel";
    kopf.textContent = t(titel);
    onLang(() => (kopf.textContent = t(titel)));
    const el = document.createElement(kind);
    el.unit = einheit;
    box.append(kopf, el);
    messBox.appendChild(box);
    return el;
  };

  const strecke = messFeld("arcgis-distance-measurement-2d", "map.measureLine", "meters");
  const flaeche = messFeld("arcgis-area-measurement-2d", "map.measureArea", "square-meters");

  const btnMessWeg = document.createElement("button");
  btnMessWeg.type = "button";
  btnMessWeg.className = "btn btn-outline btn-mini mess-weg";
  const setzeMessWeg = () => (btnMessWeg.textContent = t("map.measureClear"));
  setzeMessWeg();
  onLang(setzeMessWeg);
  btnMessWeg.addEventListener("click", async () => {
    await Promise.allSettled([strecke.clear(), flaeche.clear()]);
  });
  messBox.appendChild(btnMessWeg);

  messen.appendChild(messBox);

  const grundkarten = expand("arcgis-basemap-gallery", t("map.basemaps"), "basemap");

  onLang(() => {
    layer.wrap.expandTooltip = t("map.showLayers");
    marks.wrap.expandTooltip = t("map.bookmarks");
    messen.expandTooltip = t("map.measure");
    grundkarten.wrap.expandTooltip = t("map.basemaps");
  });

  // `__eigen` markiert unsere eigenen Grafik-Layer. alleLayerAus() darf sie
  // nicht ausblenden - sonst verschwindet die gezeichnete Vorhabengeometrie.
  skizzenLayer = new GraphicsLayer({ title: "Vorhaben", listMode: "hide" });
  analyseLayer = new GraphicsLayer({ title: "Analyse", listMode: "hide" });
  // Eigener Layer fuer die Beschriftung: im Skizzen-Layer wuerde sie das
  // Sketch-Werkzeug als bearbeitbare Grafik behandeln und die
  // Geometrie-Erkennung stoeren.
  labelLayer = new GraphicsLayer({ title: "Beschriftung", listMode: "hide" });
  skizzenLayer.__eigen = true;
  analyseLayer.__eigen = true;
  labelLayer.__eigen = true;

  // Die Zeichenwerkzeuge stehen im linken Panel, nicht in der Karte -
  // `referenceElement` bindet die Komponente trotzdem an diese Ansicht.
  const sketch = document.createElement("arcgis-sketch");
  // "single": nach dem Zeichnen ist die Geometrie fertig. "update" liess sie
  // ausgewaehlt mit sichtbaren Stuetzpunkten zurueck.
  sketch.creationMode = "single";
  sketch.layout = "horizontal";
  // "floating" legt alle Knöpfe in EINE Zeile - bei "docked" rutschte die
  // Mülltonne in eine zweite Reihe darunter.
  sketch.toolbarKind = "floating";
  // Nur die drei Geometrietypen, die das Screening kennt - kein Rechteck,
  // kein Kreis, kein Multipoint.
  sketch.availableCreateTools = ["point", "polyline", "polygon"];
  sketch.hideSelectionToolsLassoSelection = true;
  sketch.hideSelectionToolsRectangleSelection = true;
  sketch.hideUndoRedoMenu = true;
  sketch.hideSettingsMenu = true;
  sketch.hideSnappingControls = true;
  sketch.hideDuplicateButton = true;
  sketch.hideLabelsToggle = true;
  sketch.hideTooltipsToggle = true;
  sketch.hideSelectionCountLabel = true;
  // Keine eingebaute Muelltonne - die steht als eigener Knopf neben der Leiste.
  sketch.hideDeleteButton = true;
  // Kein Auswahl-Pfeil in der Zeichenleiste - ausgewählt wird über die Karte.
  sketch.updateOnGraphicClickDisabled = true;
  // Gezeichnetes in derselben gelben Signatur wie importierte Geometrien.
  sketch.pointSymbol = {
    type: "simple-marker",
    style: "circle",
    size: 11,
    color: [...GELB, 0.85],
    outline: { color: [120, 90, 0], width: 1.5 },
  };
  sketch.polylineSymbol = {
    type: "simple-line",
    color: [...GELB, 0.95],
    width: 3,
  };
  sketch.polygonSymbol = {
    type: "simple-fill",
    color: [...GELB, 0.25],
    outline: { color: [...GELB, 1], width: 2 },
  };

  // Kein eigener Default-Layer - die Komponente nutzt garantiert skizzenLayer.
  sketch.defaultGraphicsLayerDisabled = true;

  // Zoom und Home nebeneinander oben links.
  const navLeiste = document.createElement("div");
  navLeiste.className = "map-nav";
  navLeiste.setAttribute("slot", "top-left");
  const zoom = document.createElement("arcgis-zoom");
  const home = document.createElement("arcgis-home");
  navLeiste.append(zoom, home);

  mapEl.append(search, navLeiste, layer.wrap, marks.wrap, grundkarten.wrap, messen);
  container.appendChild(mapEl);
  sketch.referenceElement = mapEl;
  (sketchContainer ?? container).appendChild(sketch);

  await mapEl.viewOnReady();
  if (mapEl.view) mapEl.view.popupEnabled = false;


  // Start mit leerer Karte: alle operativen Webmap-Layer aus. Eingeblendet
  // wird später nur, was das Screening als relevant ermittelt hat.
  mapEl.map.layers.forEach((l) => (l.visible = false));

  mapEl.map.addMany([analyseLayer, skizzenLayer, labelLayer]);
  sketch.layer = skizzenLayer;

  // Geometrie-Erkennung: der Skizzen-Layer ist die Wahrheit. `graphics.length`
  // ist reaktiv -> feuert bei jeder Zeichen-/Lösch-Aktion (Punkt UND Fläche).
  const sync = () => {
    const g = skizzenLayer.graphics.find((x) =>
      ["polygon", "point", "polyline"].includes(x.geometry?.type),
    );
    const neu = g?.geometry ?? null;
    if (neu !== vorhaben.geometrie) vorhaben.set(neu);
  };
  vorhaben.onChange(zeichneVorhabenLabel);
  reactiveUtils.watch(() => skizzenLayer.graphics.length, sync);
  skizzenLayer.graphics.on("change", sync);
  for (const ev of ["arcgisCreate", "arcgisUpdate", "arcgisDelete"]) {
    sketch.addEventListener(ev, (e) => {
      console.info("[karte]", ev, e.detail?.state, e.detail?.graphic?.geometry?.type);
      sync();
    });
  }
  // Sicherheitsnetz gegen Event-/Reaktivitäts-Lücken.
  setInterval(sync, 1200);

  // Klick auf ein Feature -> Callback (für das Karten-Info-Popup).
  //
  // Getestet wird gegen die eingeblendeten Webmap-Layer, nicht mehr gegen
  // Hilfsgrafiken: die Objekte stehen jetzt in ihrer eigenen Signatur in der
  // Karte, und unsichtbare Grafiken findet hitTest ohnehin nicht.
  // EIN Klick-Handler für beides: im Auswahlmodus hervorheben, sonst die
  // Erklärungsblase. `view.on("click")` ist der dokumentierte Weg; der Layer
  // hängt am Treffer, nicht an der Grafik.
  mapEl.view.on("click", async (event) => {
    try {
      const { results } = await mapEl.view.hitTest(event);
      // Nur echte Fachobjekte: die Grundkarte ist ein eigener Layer in der
      // Webmap und wurde vorher als Treffer akzeptiert - highlight() darauf
      // tut nichts, es sah aus, als ginge die Auswahl nicht.
      const hit = (results ?? []).find(
        (r) =>
          r?.type === "graphic" &&
          r.layer &&
          !r.layer.__eigen &&
          !istGrundkarte(r.layer) &&
          typeof r.layer.queryFeatures === "function",
      );
      if (!hit) {
        _featureKlickFn(null);
        return;
      }
      _featureKlickFn({
        bereichId: hit.layer.title,
        attributes: hit.graphic?.attributes ?? {},
        layerTitel: hit.layer.title ?? "",
        x: event.x,
        y: event.y,
      });
    } catch (err) {
      console.warn("[karte] Klick-Auswertung fehlgeschlagen:", err);
      _featureKlickFn(null);
    }
  });

  // Einmalige Schema-Diagnose des Grenzlayers. Die Zuordnung zur
  // Planungsregion steht und faellt damit, welche Attribute er fuehrt.
  grenzlayerDiagnose();

  window.__mapEl = mapEl;
  return mapEl;
}

/**
 * Setzt die Vorhabengeometrie von aussen (Shapefile-Import, Koordinaten).
 * Sie landet im Skizzen-Layer, damit sie wie eine gezeichnete Geometrie
 * behandelt und über die Sketch-Werkzeuge weiterbearbeitet werden kann.
 */
export async function setzeVorhabenGeometrie(geometry, zoomen = true, dauer = 1800) {
  if (!skizzenLayer || !geometry) return;
  const ziel = mapEl?.view?.spatialReference;
  let geom = geometry;
  if (ziel && geometry.spatialReference?.wkid !== ziel.wkid) {
    if (!projectOperator.isLoaded()) await projectOperator.load();
    geom = projectOperator.execute(geometry, ziel) ?? geometry;
  }
  skizzenLayer.removeAll();
  skizzenLayer.add(new Graphic({ geometry: geom, symbol: symbolFuer(geom, GELB, true) }));
  zeichneVorhabenLabel();
  if (zoomen && mapEl?.view) {
    await mapEl.view.goTo(
      { target: geom, ...(geom.type === "point" ? { scale: 6000 } : {}) },
      // Beim Import kommt der Sprung aus dem Nichts - ein langsamer Schwenk
      // laesst erkennen, wohin die Karte fliegt.
      { duration: dauer, easing: "ease-in-out" },
    );
  }
}

/** Punkt aus WGS84-Koordinaten (Länge/Breite) als Vorhabengeometrie setzen. */
export async function setzeVorhabenAusKoordinaten(x, y, wkid = 4326) {
  // In ein projiziertes System kommen Rechts-/Hochwert als x/y; nur bei
  // geografischen Koordinaten sind es Grad. Umgerechnet wird ohnehin erst in
  // setzeVorhabenGeometrie, gegen die Raumbezugseinheit der Karte.
  const p =
    wkid === 4326
      ? new Point({ longitude: x, latitude: y, spatialReference: { wkid: 4326 } })
      : new Point({ x, y, spatialReference: { wkid } });
  await setzeVorhabenGeometrie(p);
  return p;
}

/**
 * Beschriftet die gezeichnete Geometrie mit der Vorhabenart. Ohne Etikett ist
 * auf einem Screenshot nicht zu erkennen, worum es in der Karte eigentlich
 * geht.
 */
export function setzeVorhabenLabel(text) {
  _vorhabenLabel = text ?? "";
  zeichneVorhabenLabel();
}

function zeichneVorhabenLabel() {
  if (!labelLayer) return;
  labelLayer.removeAll();
  const geom = vorhaben.geometrie;
  if (!geom || !_vorhabenLabel) return;
  const anker = geom.type === "point" ? geom : (centroidOperator.execute(geom) ?? null);
  if (!anker) return;
  labelLayer.add(
    new Graphic({
      geometry: anker,
      attributes: { rolle: "label" },
      symbol: {
        type: "text",
        text: _vorhabenLabel,
        color: [140, 100, 0, 1],
        haloColor: [255, 255, 255, 0.95],
        haloSize: 2,
        // Eine EINZELNE Familie - eine Fallback-Liste nimmt TextSymbol nicht
        // an, dann faellt er auf die Standardschrift zurueck.
        font: { size: 10, family: SCHRIFT },
        // Immer nach oben weg: bei einem Punkt sonst mitten auf dem Marker,
        // bei einer Flaeche auf der Fuellung - und in beiden Faellen dort, wo
        // die Zonen-Etiketten von frueher standen.
        yoffset: geom.type === "point" ? 16 : 10,
      },
    }),
  );
}

/** Schreibt Felder und ein Beispielobjekt des Grenzlayers in die Konsole. */
async function grenzlayerDiagnose() {
  try {
    const map = mapEl?.map;
    if (!map) return;
    const treffer = [];
    map.allLayers.forEach((l) => {
      const t = String(l.title ?? "").toLowerCase();
      if (/gemeinde|kreis|verwaltung|grenz/.test(t) && typeof l.queryFeatures === "function") {
        treffer.push(l);
      }
    });
    if (!treffer.length) {
      console.warn("[karte] Kein Grenzlayer in der Webmap gefunden - Regionszuordnung unmöglich.");
      return;
    }
    for (const l of treffer) {
      await l.load?.();
      const q = l.createQuery();
      q.where = "1=1";
      q.outFields = ["*"];
      q.returnGeometry = false;
      q.num = 1;
      const fs = await l.queryFeatures(q);
      console.info(`[karte] Grenzlayer "${l.title}"`, {
        felder: (l.fields ?? []).map((f) => `${f.name} (${f.alias})`),
        beispielObjekt: fs.features[0]?.attributes ?? null,
      });
    }
  } catch (err) {
    console.warn("[karte] Grenzlayer-Diagnose fehlgeschlagen:", err);
  }
}

/** Löscht die gezeichnete Vorhabengeometrie samt Beschriftung. */
export function vorhabenLoeschen() {
  skizzenLayer?.removeAll();
  labelLayer?.removeAll();
  vorhaben.set(null);
}

export function getMapEl() {
  return mapEl;
}

/** Fläche der Vorhabengeometrie in m2 (nur Polygon). */
function vorhabenFlaecheM2() {
  const g = vorhaben.geometrie;
  if (!g || g.type !== "polygon") return null;
  return Math.round(Math.abs(geometryEngine.geodesicArea(g, "square-meters")));
}

/** Länge der Vorhabengeometrie in m (nur Linie). */
function vorhabenLaengeM() {
  const g = vorhaben.geometrie;
  if (!g || g.type !== "polyline") return null;
  return Math.round(Math.abs(geometryEngine.geodesicLength(g, "meters")));
}

/** Kennzahlen der Vorhabengeometrie für das Dashboard. */
export function vorhabenMasse() {
  const g = vorhaben.geometrie;
  return {
    typ: g?.type ?? null,
    flaecheM2: vorhabenFlaecheM2(),
    laengeM: vorhabenLaengeM(),
  };
}

function symbolFuer(geometry, rgb, opak = false) {
  const linien = opak ? 0.95 : 0.85;
  const fuell = opak ? 0.3 : 0.12;
  if (geometry.type === "polygon") {
    return {
      type: "simple-fill",
      color: [...rgb, fuell],
      outline: { color: [...rgb, linien], width: opak ? 2.5 : 1.5 },
    };
  }
  if (geometry.type === "polyline") {
    return { type: "simple-line", color: [...rgb, linien], width: opak ? 4 : 2 };
  }
  return {
    type: "simple-marker",
    color: [...rgb, linien],
    size: opak ? 13 : 8,
    outline: { color: [255, 255, 255, 0.95], width: opak ? 2 : 1 },
  };
}

// Kartenbeschriftung: Der Esri-Schriftdienst (static.arcgis.com/fonts) rendert
// die TextSymbole, nicht der Browser. "Nunito Sans" liegt dort nicht - jede
// Beschriftung erzeugte ein 404 und der Dienst fiel selbst auf diese Schrift
// zurueck. Also fragen wir gleich das an, was vorhanden ist. Kein `weight:
// "bold"`: das wuerde arial-unicode-ms-bold anfordern, das es ebenso wenig
// gibt. Dafuer eine Stufe groesser, damit die Beschriftung trotzdem traegt.
/** Dauer des Kartenflugs zu einem Lesezeichen. */
const LESEZEICHEN_MS = 2200;

const SCHRIFT = "Arial Unicode MS";

const BLAU = [43, 76, 126];
const GELB = [250, 204, 21];
// Blinkfarbe fuer eine einzelne Ausprägung aus dem Ringdiagramm - Gelb ist
// schon die Farbe der gezeichneten Vorhabengeometrie.
const TUERKIS = [13, 165, 172];

// Mehr als so viele Hilfsgrafiken gleichzeitig bringt optisch nichts und
// kostet nur Rendering-Zeit.
const MAX_BLINK = 400;

/**
 * Zoomt auf die gezeichnete Vorhabengeometrie. Beim Start des Screenings soll
 * der Untersuchungsraum im Bild sein, nicht die zuletzt betrachtete Ecke.
 */
export async function zoomeAufVorhaben() {
  const geom = vorhaben.geometrie;
  const view = mapEl?.view;
  if (!geom || !view) return;
  await view.goTo(
    { target: geom, ...(geom.type === "point" ? { scale: 12000 } : {}) },
    { duration: 700 },
  );
}

/**
 * Ankerpunkt fuer das Zonen-Etikett: Mitte in x, oberer Rand in y. Damit
 * beschriftet das Etikett den Ring statt das Vorhaben in der Mitte.
 */
function zonenAnker(geometry) {
  const ext = geometry?.extent;
  if (!ext) return geometry?.type === "point" ? geometry : null;
  return new Point({
    x: (ext.xmin + ext.xmax) / 2,
    y: ext.ymax,
    spatialReference: geometry.spatialReference,
  });
}

/**
 * Zeichnet die Untersuchungszone EINER Kategorie - zunächst UNSICHTBAR.
 * Sichtbar wird sie erst über zeigeZone(), sonst liegen bei acht Kategorien
 * acht ineinander verschachtelte Kreise auf der Karte.
 */
export function zeichneZone(schluessel, geometry, meter, label) {
  if (!analyseLayer || !geometry) return;
  (pufferProBereich.get(schluessel) ?? []).forEach((g) => analyseLayer.remove(g));
  const g = new Graphic({
    geometry,
    symbol: symbolFuer(geometry, BLAU),
    visible: false,
    attributes: { rolle: "zone", schluessel },
  });
  analyseLayer.add(g);
  const teile = [g];
  // Nicht in die Mitte: dort sitzt schon das Etikett des Vorhabens, und bei
  // mehreren Zonen laegen alle Beschriftungen uebereinander. Am OBEREN RAND
  // des jeweiligen Puffers hat jede Zone ihre eigene Hoehe - die Radien sind
  // ja verschieden -, und die Mitte bleibt fuer das Vorhaben frei.
  const anker = zonenAnker(geometry);
  if (anker && label) {
    const t = new Graphic({
      geometry: anker,
      symbol: {
        type: "text",
        text: label,
        color: [...BLAU, 1],
        haloColor: [255, 255, 255, 0.95],
        haloSize: 2,
        font: { size: 11, family: SCHRIFT },
        yoffset: 5,
      },
      visible: false,
      attributes: { rolle: "zone-label", schluessel },
    });
    analyseLayer.add(t);
    teile.push(t);
  }
  pufferProBereich.set(schluessel, teile);
}

/** Blendet die Zone einer Kategorie ein oder aus und zoomt beim Einblenden hin. */
export async function zeigeZone(schluessel, an) {
  const teile = pufferProBereich.get(schluessel) ?? [];
  teile.forEach((g) => (g.visible = an));
  if (!an || !mapEl?.view || !teile.length) return;
  await mapEl.view.goTo({ target: teile.map((g) => g.geometry) }, { duration: 600 });
}

/** Sind die Zonengrafiken einer Kategorie gerade sichtbar? */
export function zoneSichtbar(schluessel) {
  return Boolean((pufferProBereich.get(schluessel) ?? [])[0]?.visible);
}

/** Merkt gefundene Features (Geometrie + Attribute) und zeichnet sie. */
export function merkeTreffer(bereichId, features, layerTitel, oidFeld) {
  if (!bereichId) return;
  if (!trefferProBereich.has(bereichId)) trefferProBereich.set(bereichId, []);
  const liste = trefferProBereich.get(bereichId);
  for (const f of features) {
    if (!f?.geometry) continue;
    // Nur Geometrie und Attribute - keine Grafik. Die Objekte werden über den
    // gefilterten Webmap-Layer in seiner eigenen Signatur gezeigt; eine rote
    // Übermalung verdeckt genau die Information, um die es geht.
    liste.push({
      geometry: f.geometry,
      attributes: f.attributes ?? {},
      layerTitel,
      oid: oidFeld ? f.attributes?.[oidFeld] : null,
    });
  }
}

export function analyseLeeren() {
  analyseLayer?.removeAll();
  trefferProBereich.clear();
  pufferProBereich.clear();
}

/** Treffer eines Rechtsgebiets (Attribute + Layertitel). */
export function getTreffer(bereichId) {
  return (trefferProBereich.get(bereichId) ?? []).map((t, i) => ({
    index: i,
    attributes: t.attributes,
    layerTitel: t.layerTitel,
  }));
}

/**
 * Blendet die genannten Webmap-Layer ein oder aus. Beim Einblenden werden die
 * übergeordneten Gruppen mit sichtbar geschaltet, sonst bleibt das Kind
 * wirkungslos; beim Ausblenden nur der Layer selbst.
 * @param {string[]} titel
 * @param {boolean} an
 */
export function setzeLayerSichtbar(titel, an) {
  const map = mapEl?.map;
  if (!map) return;
  const gesucht = new Set(titel);
  map.allLayers.forEach((l) => {
    if (!gesucht.has(l.title)) return;
    l.visible = an;
    if (!an) {
      // Beim Ausblenden den ursprünglichen Filter wiederherstellen.
      if (Object.prototype.hasOwnProperty.call(l, "__urFilter")) {
        l.definitionExpression = l.__urFilter;
        delete l.__urFilter;
      }
      return;
    }
    let p = l.parent;
    while (p && typeof p.visible === "boolean") {
      p.visible = true;
      p = p.parent;
    }
  });
}

/**
 * Blendet einen Layer ein und beschränkt ihn auf die gefundenen Objekte -
 * sonst läge der komplette landesweite Layer über der Karte.
 *
 * Bevorzugt wird der `where`-Ausdruck der Abfrage: eine IN-Liste aus
 * ObjectIDs wird bei vielen Treffern zu lang für die URL. Nur wenn kein
 * Filter vorlag, wird auf die IDs zurückgegriffen.
 *
 * @param {string} titel
 * @param {Array<number|string>} objectIds
 * @param {string|null} [where]
 */
// Grenze fuer eine IN-Liste aus ObjectIDs in der definitionExpression -
// darueber wird die Anfrage-URL zu lang.
// Obergrenze fuer eine IN-Liste aus ObjectIDs in der definitionExpression.
// Entspricht MAX_TREFFER in tools.js - mehr Objekte holen wir gar nicht erst.
const MAX_ID_FILTER = 2000;

// Titel-Teilstrings, an denen ein Hintergrundlayer zu erkennen ist.
const GRUNDKARTE_TITEL = ["grundkarte", "basemap", "hintergrund", "basiskarte", "topographie"];

/**
 * Blendet ALLE Webmap-Layer aus und setzt ihre Filter zurück. Grundzustand
 * vor dem Einblenden der Treffer: sonst bleibt aus einem früheren Lauf ein
 * Layer stehen, den niemand mehr zuordnen kann.
 */
export function alleLayerAus() {
  const map = mapEl?.map;
  if (!map) return;
  map.allLayers.forEach((l) => {
    if (typeof l.visible !== "boolean") return;
    // Eigene Grafik-Layer (Vorhaben, Analyse) und die Grundkarte bleiben an -
    // ohne sie steht die Karte leer da und die Skizze ist weg.
    if (l.__eigen || istGrundkarte(l)) {
      l.visible = true;
      return;
    }
    l.visible = false;
    if (Object.prototype.hasOwnProperty.call(l, "__urFilter")) {
      l.definitionExpression = l.__urFilter;
      delete l.__urFilter;
    }
  });
}

/** Hintergrundlayer der Webmap - erkennbar am Titel bzw. am Layertyp. */
function istGrundkarte(l) {
  const titel = String(l.title ?? "").toLowerCase();
  return (
    GRUNDKARTE_TITEL.some((m) => titel.includes(m)) ||
    l.type === "vector-tile" ||
    l.type === "tile" ||
    l.type === "base-tile"
  );
}

/**
 * Blendet einen Layer ein und beschränkt ihn auf die gefundenen Objekte.
 *
 * Gefiltert wird ausschliesslich über die ObjectIDs - sie sind die exakte
 * Antwort auf „was liegt in der Zone". Ein `where`-Ausdruck taugt dafür NICHT:
 * er filtert nach Attribut, aber ohne Raumbezug, und würde den landesweiten
 * Bestand dieser Klasse über die Karte legen. Ohne brauchbare IDs bleibt der
 * Layer deshalb aus.
 *
 * @param {string} titel
 * @param {Array<number|string>} objectIds
 */
export function zeigeLayerGefiltert(titel, objectIds) {
  const map = mapEl?.map;
  if (!map) return;
  const ids = (objectIds ?? []).filter((v) => v != null);

  map.allLayers.forEach((l) => {
    if (l.title !== titel) return;
    const feld = l.objectIdField;
    if (!feld || !ids.length || ids.length > MAX_ID_FILTER) {
      console.warn("[karte] Kein ID-Filter moeglich, Layer bleibt ausgeblendet:", titel, {
        objectIds: ids.length,
        objectIdField: feld ?? null,
      });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(l, "__urFilter")) {
      l.__urFilter = l.definitionExpression ?? null;
    }
    l.definitionExpression = `${feld} IN (${ids.join(",")})`;
    l.visible = true;
    let p = l.parent;
    while (p && typeof p.visible === "boolean") {
      p.visible = true;
      p = p.parent;
    }
  });
}

/**
 * Schwenkt auf eine Auswahl von Objekten eines Layers.
 *
 * Anders als beim Aufklappen eines Themas ist ein Schwenk hier richtig: der
 * Nutzer hat sich bewusst für EINE Ausprägung entschieden und will sehen, wo
 * die liegt.
 */
export async function schwenkeZuObjekten(layerTitel, objectIds) {
  const view = mapEl?.view;
  if (!view) return;
  const gesucht = new Set((objectIds ?? []).map(String));
  const ziele = (trefferProBereich.get(layerTitel) ?? [])
    .filter((tr) => tr.oid != null && gesucht.has(String(tr.oid)))
    .map((tr) => tr.geometry)
    .filter(Boolean);
  if (!ziele.length) return;
  await view.goTo({ target: ziele, ...(ziele.length === 1 ? { scale: 6000 } : {}) }, { duration: 700 });
}

/**
 * Lässt gefundene Objekte eines Layers kurz aufleuchten - ohne Zoom. Mit
 * `objectIds` nur eine Teilmenge, mit `farbe` in einem anderen Ton.
 *
 * Die Objekte stehen als Webmap-Layer in ihrer eigenen Signatur in der Karte.
 * Für den Moment des Blinkens legen wir Hilfsgrafiken darüber und räumen sie
 * danach wieder ab; dauerhafte Übermalung würde genau die Signatur verdecken,
 * um die es geht.
 */
export async function blinkeTreffer(schluessel, optionen = {}) {
  if (!analyseLayer) return;
  // Frueher war das zweite Argument die Rundenzahl - beide Formen bleiben gueltig.
  const { runden = 3, objectIds = null, farbe = GELB } =
    typeof optionen === "number" ? { runden: optionen } : optionen;
  const nurDiese = objectIds?.length ? new Set(objectIds.map(String)) : null;
  const geometrien = (trefferProBereich.get(schluessel) ?? [])
    .filter((tr) => !nurDiese || (tr.oid != null && nurDiese.has(String(tr.oid))))
    .map((t) => t.geometry)
    .filter(Boolean)
    .slice(0, MAX_BLINK);
  if (!geometrien.length) return;

  const grafiken = geometrien.map(
    (geometry) =>
      new Graphic({ geometry, symbol: symbolFuer(geometry, farbe, true), visible: false }),
  );
  grafiken.forEach((g) => analyseLayer.add(g));

  await new Promise((fertig) => {
    let n = 0;
    const timer = setInterval(() => {
      const an = n % 2 === 0;
      grafiken.forEach((g) => (g.visible = an));
      if (++n >= runden * 2) {
        clearInterval(timer);
        grafiken.forEach((g) => analyseLayer.remove(g));
        fertig();
      }
    }, 240);
  });
}

/**
 * Zoomt auf ALLE gemerkten Treffer - der Abschluss eines Laufs. Ohne das bleibt
 * die Karte auf dem Vorhaben stehen, und die gefundenen Objekte liegen
 * ausserhalb des Ausschnitts.
 */
export async function zoomeAufTreffer(spielraum = 1.15) {
  const view = mapEl?.view;
  if (!view) return false;
  const ziele = [];
  for (const liste of trefferProBereich.values()) {
    for (const tr of liste) if (tr.geometry) ziele.push(tr.geometry);
  }
  if (!ziele.length) return false;
  try {
    await view.goTo({ target: ziele }, { duration: 900 });
    // Etwas Luft um den Bestand, sonst kleben die Objekte am Rand.
    if (spielraum !== 1) view.scale *= spielraum;
    return true;
  } catch (err) {
    console.warn("[karte] Zoom auf die Treffer nicht möglich:", err);
    return false;
  }
}

export { geometryEngine, TUERKIS, GELB };
