// Karten- und Zeichen-Modul.
//
// Baut die <arcgis-map> auf, haengt Suche + Layerliste an und stellt ein
// Sketch-Werkzeug bereit, mit dem der Nutzer den Vorhabenumring zeichnet.
// Der gezeichnete Umring ist der geometrische Ausgangspunkt fuer das gesamte
// Screening und wird ueber `vorhaben` anderen Modulen zugaenglich gemacht.
//
// Platzierung der Widgets ueber das slot-Attribut in <arcgis-map> - das ist der
// Weg, der im Vorgaengerstand bereits funktioniert hat.

import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-search";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-sketch";

import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";

import { WEBMAP_ID } from "./config.js";

/** Beobachtbarer Zustand des aktuellen Vorhabenumrings. */
export const vorhaben = {
  /** @type {__esri.Polygon | null} */
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
let analyseLayer;
// Treffer-Grafiken je Pruefbereich-Id (fuer "Befund anklicken -> hinzoomen").
/** @type {Map<string, __esri.Graphic[]>} */
const trefferProBereich = new Map();

/**
 * Erzeugt die Karte im uebergebenen Container.
 * @param {HTMLElement} container
 */
export async function initKarte(container) {
  mapEl = document.createElement("arcgis-map");
  mapEl.id = "main-map";
  mapEl.itemId = WEBMAP_ID;

  const search = document.createElement("arcgis-search");
  search.setAttribute("slot", "top-right");

  const layerList = document.createElement("arcgis-layer-list");
  layerList.setAttribute("slot", "top-right");

  const sketch = document.createElement("arcgis-sketch");
  sketch.setAttribute("slot", "top-left");
  sketch.creationMode = "single";
  // Input ist immer ein Vorhabenumring (Polygon) - Punkt/Linie/Kreis raus,
  // dafuer Freihand-Polygon rein.
  sketch.availableCreateTools = ["polygon", "freehandPolygon", "rectangle"];
  sketch.showCreateToolsFreehandPolygon = true;

  mapEl.append(search, layerList, sketch);
  container.appendChild(mapEl);

  await mapEl.viewOnReady();

  skizzenLayer = new GraphicsLayer({ title: "Vorhabenumring", listMode: "hide" });
  analyseLayer = new GraphicsLayer({ title: "Analyse", listMode: "hide" });
  mapEl.map.addMany([analyseLayer, skizzenLayer]);
  sketch.layer = skizzenLayer;

  const uebernehmen = (event) => {
    const graphic = event.detail?.graphics?.[0] ?? event.detail?.graphic ?? null;
    if (graphic?.geometry?.type === "polygon") vorhaben.set(graphic.geometry);
  };
  sketch.addEventListener("arcgisCreate", (e) => {
    if (e.detail.state === "complete") uebernehmen(e);
  });
  sketch.addEventListener("arcgisUpdate", (e) => {
    if (e.detail.state === "complete") uebernehmen(e);
  });
  sketch.addEventListener("arcgisDelete", () => vorhaben.set(null));

  window.__mapEl = mapEl;
  return mapEl;
}

/** Loescht den gezeichneten Umring. */
export function umringLoeschen() {
  skizzenLayer?.removeAll();
  vorhaben.set(null);
}

export function getMapEl() {
  return mapEl;
}

function symbolFuer(geometry, rgb, opak = false) {
  const linien = opak ? 0.95 : 0.9;
  const fuell = opak ? 0.35 : 0.15;
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
    size: opak ? 12 : 8,
    outline: { color: [255, 255, 255, 0.9], width: 1 },
  };
}

/**
 * Zeichnet ein Analyse-Polygon/-Punkt (Puffer oder Treffer-Feature).
 * @param {__esri.Geometry} geometry
 * @param {[number, number, number]} rgb
 * @param {string} [bereichId] - ordnet die Grafik einem Pruefbereich zu
 *   (macht sie ueber `zoomeZuTreffer` anklickbar).
 */
export function zeichneAnalyse(geometry, rgb = [55, 138, 221], bereichId) {
  if (!analyseLayer || !geometry) return;
  const graphic = new Graphic({
    geometry,
    symbol: symbolFuer(geometry, rgb),
    attributes: { bereichId: bereichId ?? null },
  });
  analyseLayer.add(graphic);
  if (bereichId) {
    if (!trefferProBereich.has(bereichId)) trefferProBereich.set(bereichId, []);
    trefferProBereich.get(bereichId).push(graphic);
  }
}

/** Entfernt alle Analyse-Grafiken (vor einem neuen Screening-Lauf). */
export function analyseLeeren() {
  analyseLayer?.removeAll();
  trefferProBereich.clear();
}

/** Anzahl gemerkter Treffer je Pruefbereich. */
export function trefferAnzahl(bereichId) {
  return trefferProBereich.get(bereichId)?.length ?? 0;
}

/**
 * Zoomt auf die Treffer eines Pruefbereichs und laesst sie kurz gelb blinken.
 * Ohne Treffer (z.B. "ungeprueft"): zoomt auf den Vorhabenumring.
 * @param {string} bereichId
 */
export async function zoomeZuTreffer(bereichId) {
  const view = mapEl?.view;
  if (!view) return;

  const graphics = trefferProBereich.get(bereichId) ?? [];
  const ziel =
    graphics.length > 0
      ? graphics.map((g) => g.geometry)
      : vorhaben.geometrie
        ? [vorhaben.geometrie]
        : [];
  if (ziel.length === 0) return;

  await view.goTo(
    { target: ziel, ...(ziel.length === 1 ? { scale: 4000 } : {}) },
    { duration: 700 },
  );

  if (graphics.length === 0) return;
  blinke(graphics);
}

const GELB = [250, 204, 21];
function blinke(graphics, runden = 4) {
  const original = graphics.map((g) => g.symbol);
  let n = 0;
  const timer = setInterval(() => {
    const an = n % 2 === 0;
    graphics.forEach((g, i) => {
      g.symbol = an ? symbolFuer(g.geometry, GELB, true) : original[i];
    });
    if (++n > runden * 2) {
      clearInterval(timer);
      graphics.forEach((g, i) => (g.symbol = original[i]));
    }
  }, 220);
}

export { geometryEngine };
