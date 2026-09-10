// Ergebnis-Zustand und -Darstellung des räumlichen Erstscreenings.
//
// Aufbau des Panels, bewusst kennzahlenlastig - Planer sollen die
// relevanten Objekte und die wichtigsten Zahlen auf einen Blick sehen:
//   1. Kennzahlen-Zeile - Vorhaben, Ausdehnung, Region (mit Info-i), Objekte
//   2. Zusammenfassung: je Thema eine grosse Zahl, Summe und Umfeld-Chip.
//      Nur Themen MIT Objekten - was nicht gefunden wurde, steht hier nicht.
//   3. je Thema MIT Objekten eine Karte: Kennzahlen sofort sichtbar,
//      Begründung und Fundstellen erst auf Klick
//   4. unten aufklappbar die herangezogene Rechts- und Planungsgrundlage
//
// Beim Aufklappen einer Themen-Karte wird der zugehörige Layer eingeblendet
// und per definitionExpression auf die gefundenen Objekte beschränkt - der
// vollständige, landesweite Layer würde die Karte zulaufen lassen.
// Der Umfeld-Chip zeigt den Radius, erklärt ihn im Tooltip und blendet auf
// Klick die Zone in der Karte ein.

import {
  alleLayerAus,
  zeigeLayerGefiltert,
  zeigeZone,
  zoneSichtbar,
} from "../karte.js";
import { t, getLang, onLang } from "../i18n.js";
import { KATEGORIEN, kategorieTitel, getKategorie } from "./kategorien.js";
import { alleFundstellen } from "./rag.js";

let region = null;
let vorhabenArt = "";
let vorhabenMasze = { typ: null, flaecheM2: null, laengeM: null };
/** @type {Array<{kategorieId:string,layer:string,anzahl:number,flaecheM2:number|null,laengeM:number|null,geometrieTyp:string|null}>} */
const abfragen = [];
/** @type {Array<{kategorieId:string,begruendung:string,radiusMeter:number,radiusBegruendung:string,zoneFlaecheM2:number,regionalplan?:string,gesetz?:string}>} */
const relevanz = [];
/** @type {Array<{kategorieId:string,begruendung:string,fundstelle?:string}>} */
const nichtRelevant = [];
/**
 * Kategorien, für die `recherchiere` tatsächlich gelaufen ist. Nötig, weil der
 * Agent alle acht recherchieren und danach trotzdem keine einzige melden kann
 * ("Ich kann die Phase-1-Meldungen hier nicht liefern"). Das Panel schrieb
 * dann "8 nicht betrachtet" - eine Falschaussage: betrachtet wurden sie, nur
 * nicht eingestuft.
 */
const recherchiert = new Set();
/** @type {string[]} */
let kernaussagen = [];
let hinweis = "";
/** Erst wenn der Lauf durch ist, stehen alle Zahlen fest. */
let laufFertig = false;
/** Aktiver Segment-Filter: {fb, layer, wert} - beschränkt die Karte auf eine Ausprägung. */
let segmentFilter = null;
/** Aktiver Layer-Fokus: {fb, layer} - zeigt nur die Objekte EINES Layers. */
let layerFilter = null;
/** Aktiver Themen-Fokus: kategorieId - zeigt alle Layer EINES Themas. */
let themaFilter = null;
// Layer-Diagramme, Schlüssel `${kategorieId}|${layerTitel}`. Zwei Mengen statt
// einer: voreingestellt ist je Thema das erste Diagramm offen, und diese
// Voreinstellung darf nicht kippen, nur weil in einem ANDEREN Thema etwas
// aufgeklappt wurde. Erfasst wird deshalb, was der Nutzer selbst geöffnet
// bzw. geschlossen hat.
const offeneDiagramme = new Set();
const zuDiagramme = new Set();
/** Merkt den Auf-/Zu-Zustand des Verworfen-Blocks über ein Neuzeichnen hinweg. */
let verworfenOffen = false;
/** Themen, deren Layer der Nutzer ausgeblendet hat. */
const ausgeblendet = new Set();

let el;
const listener = new Set();
const offen = new Set();
let grundlagenOffen = false;

export function onAnalyseChange(fn) {
  listener.add(fn);
  return () => listener.delete(fn);
}

function notify() {
  render();
  listener.forEach((fn) => fn(getAnalyse()));
}

export function getAnalyse() {
  return {
    region,
    vorhabenArt,
    vorhabenMasze,
    abfragen: [...abfragen],
    relevanz: [...relevanz],
    nichtRelevant: [...nichtRelevant],
    recherchiert: [...recherchiert],
    kernaussagen: [...kernaussagen],
  };
}

export function ergebnisLeeren() {
  alleLayerAus();
  region = null;
  vorhabenMasze = { typ: null, flaecheM2: null, laengeM: null };
  abfragen.length = 0;
  relevanz.length = 0;
  nichtRelevant.length = 0;
  recherchiert.clear();
  kernaussagen = [];
  hinweis = "";
  laufFertig = false;
  segmentFilter = null;
  ausgeblendet.clear();
  offen.clear();
  grundlagenOffen = false;
  notify();
}

export function setzeRegion(r) {
  region = r;
  notify();
}

export function setzeVorhabenArt(titel) {
  vorhabenArt = titel ?? "";
  notify();
}

export function setzeVorhabenMasze(m) {
  vorhabenMasze = m;
  notify();
}

export function merkeAbfrage(a) {
  // Schlüssel ist KATEGORIE UND LAYER, nicht der Layer allein. Ein Layer kann
  // zu zwei Kategorien gehören - "Vegetationsflächen" trägt Wald- und
  // Landwirtschaftsflächen, unterschieden nur über das Attribut. Vorher
  // überschrieb die zweite Abfrage die erste, und die Kategorie, die zufällig
  // zuerst dran war, verlor ihre Objekte: "Wald - keine Objekte im Umfeld",
  // obwohl direkt daneben welcher liegt.
  const i = abfragen.findIndex((x) => x.layer === a.layer && x.kategorieId === a.kategorieId);
  if (i >= 0) abfragen[i] = a;
  else abfragen.push(a);
  notify();
}

export function meldeRelevanz(r) {
  const i = relevanz.findIndex((x) => x.kategorieId === r.kategorieId);
  if (i >= 0) relevanz[i] = r;
  else relevanz.push(r);
  notify();
}

export function meldeNichtRelevant(r) {
  const i = nichtRelevant.findIndex((x) => x.kategorieId === r.kategorieId);
  if (i >= 0) nichtRelevant[i] = r;
  else nichtRelevant.push(r);
  notify();
}

/** Vermerkt, dass zu dieser Kategorie recherchiert wurde - unabhängig vom Befund. */
export function merkeRecherche(kategorieId) {
  if (!kategorieId || recherchiert.has(kategorieId)) return;
  recherchiert.add(kategorieId);
  notify();
}

export function setzeKernaussagen(liste) {
  kernaussagen = Array.isArray(liste) ? liste.filter(Boolean) : [];
  notify();
}

/** Diagnosehinweis, wenn ein Lauf ohne Ergebnis endet. */
export function setzeHinweis(text) {
  hinweis = text ?? "";
  notify();
}

/**
 * Schaltet die Themenliste frei. Während des Laufs wären die Zahlen nur ein
 * Zwischenstand: die nächste queryLayer-Antwort ändert Leitzahl und Aufteilung
 * wieder.
 */
export function setzeLaufFertig(fertig) {
  laufFertig = Boolean(fertig);
  notify();
}

/**
 * Stellt den Kartenzustand aus dem aktiven Fokus her - die EINZIGE Stelle, die
 * Layer ein- und ausblendet. Vom engsten zum weitesten: eine Ausprägung, ein
 * Layer, ein Thema, sonst alles Gefundene.
 *
 * Vorher setzte jede Klick-Behandlung die Karte selbst; ein abgewähltes Thema
 * blieb dann als leerer Zustand stehen, statt wieder alles zu zeigen.
 */
function zeigeNachFokus() {
  if (segmentFilter) {
    const a = abfragen.find(
      (x) => x.kategorieId === segmentFilter.fb && x.layer === segmentFilter.layer,
    );
    const ids = (a?.aufschluesselung ?? []).find((g) => g.wert === segmentFilter.wert)?.objectIds;
    if (ids?.length) {
      alleLayerAus();
      zeigeLayerGefiltert(segmentFilter.layer, ids);
      return;
    }
    console.warn("[analyse] Kein Filter möglich für", segmentFilter);
    segmentFilter = null;
  }
  if (layerFilter) {
    const a = abfragen.find(
      (x) => x.kategorieId === layerFilter.fb && x.layer === layerFilter.layer,
    );
    alleLayerAus();
    zeigeLayerGefiltert(layerFilter.layer, a?.objectIds ?? []);
    return;
  }
  if (themaFilter) {
    // Alle Layer DIESES Themas, keiner der anderen.
    const proLayer = new Map();
    for (const a of abfragen) {
      if (a.kategorieId !== themaFilter || !a.anzahl) continue;
      proLayer.set(a.layer, [...(proLayer.get(a.layer) ?? []), ...(a.objectIds ?? [])]);
    }
    if (proLayer.size) {
      alleLayerAus();
      for (const [layer, ids] of proLayer) zeigeLayerGefiltert(layer, [...new Set(ids)]);
      return;
    }
    themaFilter = null;
  }
  zeigeGefundeneObjekte();
}

/**
 * Beschränkt die Layer eines Themas auf EINE Ausprägung - oder hebt die
 * Beschränkung wieder auf. Erst damit lässt sich ein Diagrammsegment als
 * Frage an die Karte lesen: "wo liegen eigentlich die Autobahnen?".
 */
function setzeSegmentFilter(fbId, layerTitel, wert) {
  const aus =
    segmentFilter?.fb === fbId && segmentFilter.layer === layerTitel && segmentFilter.wert === wert;
  segmentFilter = aus ? null : { fb: fbId, layer: layerTitel, wert };
  layerFilter = null;
  zeigeNachFokus();
}

/**
 * Zeigt in der Karte nur die Objekte EINES Layers - oder hebt das wieder auf.
 * Ein Thema kann mehrere Layer haben ("Natur und Landschaft": Hecken,
 * Naturdenkmäler, Schutzgebiete); über die Layerzeile im Detail lässt sich
 * einer davon herausgreifen. Fällt der Layerfokus weg, bleibt der Themenfokus
 * stehen - man landet also eine Stufe weiter, nicht gleich bei allem.
 */
function setzeLayerFilter(fbId, layerTitel) {
  const aus = layerFilter?.fb === fbId && layerFilter.layer === layerTitel;
  layerFilter = aus ? null : { fb: fbId, layer: layerTitel };
  segmentFilter = null;
  zeigeNachFokus();
}

/** Zeigt alle Layer EINES Themas - oder hebt den Themenfokus wieder auf. */
function setzeThemaFilter(fbId) {
  themaFilter = themaFilter === fbId ? null : fbId;
  layerFilter = null;
  segmentFilter = null;
  zeigeNachFokus();
}

export function zeigeAlleTreffer() {
  segmentFilter = null;
  layerFilter = null;
  themaFilter = null;
  ausgeblendet.clear();
  zeigeGefundeneObjekte();
  notify();
}

/**
 * Blendet nach dem Lauf die gefundenen Objekte ein - gefiltert, in der eigenen
 * Signatur des Layers. Waehrend des Laufs passiert das bewusst nicht: sonst
 * flackert die Karte bei jeder Einzelabfrage.
 */
export function zeigeGefundeneObjekte() {
  // Erst Grundzustand herstellen: was nicht abgefragt wurde, hat in der Karte
  // nichts zu suchen - auch nicht aus einem frueheren Lauf.
  alleLayerAus();
  // IDs JE LAYER sammeln, nicht je Abfrage: derselbe Layer kann unter zwei
  // Kategorien stehen, und zwei Aufrufe hintereinander würden die
  // definitionExpression überschreiben statt zu ergänzen.
  const proLayer = new Map();
  for (const a of abfragen) {
    if (a.anzahl > 0 && !ausgeblendet.has(a.kategorieId)) {
      proLayer.set(a.layer, [...(proLayer.get(a.layer) ?? []), ...(a.objectIds ?? [])]);
    }
  }
  for (const [layer, ids] of proLayer) zeigeLayerGefiltert(layer, [...new Set(ids)]);
}

export function initAnalyse(container) {
  el = container;
  el.addEventListener("click", (e) => {
    const zone = e.target.closest?.(".an-zone[data-fb]");
    if (zone) {
      const fb = zone.dataset.fb;
      zeigeZone(fb, !zoneSichtbar(fb));
      render();
      return;
    }
    if (e.target.closest?.(".an-blase-zu")) {
      grundlagenOffen = false;
      render();
      return;
    }
    if (e.target.closest?.(".an-blase")) return;
    if (e.target.closest?.(".an-info")) {
      grundlagenOffen = !grundlagenOffen;
      render();
      return;
    }
    const auge = e.target.closest?.("[data-auge]");
    if (auge) {
      const fb = auge.dataset.auge;
      if (ausgeblendet.has(fb)) ausgeblendet.delete(fb);
      else ausgeblendet.add(fb);
      zeigeGefundeneObjekte();
      render();
      return;
    }
    const seg = e.target.closest?.("[data-wert][data-fb]");
    if (seg) {
      setzeSegmentFilter(seg.dataset.fb, seg.dataset.layer, seg.dataset.wert);
      render();
      return;
    }
    if (e.target.closest?.(".an-alle-btn")) {
      zeigeAlleTreffer();
      render();
      return;
    }
    const diagramm = e.target.closest?.(".an-layerbox > summary");
    if (diagramm) {
      // Der Zustand muss das naechste render() ueberleben.
      const box = diagramm.parentElement;
      const key = box.dataset.key;
      if (box.open) {
        offeneDiagramme.delete(key);
        zuDiagramme.add(key);
      } else {
        zuDiagramme.delete(key);
        offeneDiagramme.add(key);
      }
      // Der Klick auf die Layerzeile ist zugleich die Frage "wo liegt DIESER
      // Layer?" - die Karte zeigt danach nur noch dessen Objekte.
      setzeLayerFilter(box.dataset.fb, box.dataset.layer);
      // Das <details> schaltet sich selbst um; render() wuerde den Zustand
      // doppelt drehen, deshalb erst im naechsten Zyklus neu zeichnen.
      setTimeout(render, 0);
      return;
    }
    const box = e.target.closest?.(".an-verworfen-box > summary");
    if (box) {
      // Der Zustand muss das naechste render() ueberleben.
      verworfenOffen = !box.parentElement.open;
      return;
    }
    const kopf = e.target.closest?.(".an-fb-kopf");
    if (kopf) {
      // Auf-/Zuklappen UND Kartenfokus in einem: ein aufgeklapptes Thema zeigt
      // ALLE seine Layer, ein zugeklapptes gibt die Karte wieder frei. Kein
      // Zoom, kein Blinken - der Kartenausschnitt gehört dem Nutzer.
      const fb = kopf.parentElement.dataset.fb;
      if (offen.has(fb)) {
        offen.delete(fb);
        if (themaFilter === fb) setzeThemaFilter(fb);
      } else {
        offen.add(fb);
        if (themaFilter !== fb) setzeThemaFilter(fb);
      }
      render();
    }
  });
  onLang(render);
  render();
}

// --- Darstellung -----------------------------------------------------------

const nf = (stellen) =>
  new Intl.NumberFormat(getLang() === "en" ? "en-GB" : "de-DE", {
    minimumFractionDigits: stellen ?? 0,
    maximumFractionDigits: stellen ?? 0,
  });

function flaeche(m2) {
  if (m2 == null) return null;
  // IMMER Hektar. Der Wechsel zwischen m² und ha je nach Grösse machte die
  // Zahlen unvergleichbar: im selben Diagramm standen "116,8 ha" neben
  // "2.964 m²", und niemand rechnet das im Kopf um. Hektar ist ausserdem die
  // Einheit, in der Raumordnung gedacht wird.
  // Geschütztes Leerzeichen: umbrochen wird nie zwischen Zahl und Einheit.
  const ha = m2 / 10000;
  const stellen = ha >= 100 ? 0 : ha >= 10 ? 1 : 2;
  return `${nf(stellen).format(ha)} ha`;
}

function laenge(m) {
  if (m == null) return null;
  // Aus demselben Grund immer Kilometer - "443 m" neben "135,33 km" in einer
  // Legende ist keine Aufteilung, die man ablesen kann.
  const km = m / 1000;
  const stellen = km >= 100 ? 0 : km >= 10 ? 1 : 2;
  return `${nf(stellen).format(km)} km`;
}

/**
 * Kennzahlen-Kachel. Die Schriftgröße richtet sich nach der Textlänge -
 * "Windenergieanlage" oder "Regierungsbezirk Düsseldorf (ohne RVR)" sind sonst
 * breiter als die Kachel. Die Stufen stehen als `--stufe` im CSS.
 */
function kachel(label, wert, klein, hinweisText) {
  if (wert == null || wert === "") return "";
  const tip = hinweisText ? ` title="${esc(hinweisText)}"` : "";
  return `<div class="kpi"${tip}><div class="kpi-label">${esc(label)}</div>
    <div class="kpi-wert ${stufeFuer(wert)}${klein ? " kpi-klein" : ""}"
      title="${esc(String(wert))}">${esc(wert)}</div></div>`;
}

/** Grössenstufe nach Textlänge - damit lange Werte nicht aus der Kachel wachsen. */
function stufeFuer(wert) {
  const n = String(wert ?? "").length;
  return `kpi-${n > 34 ? "xs" : n > 22 ? "s" : n > 14 ? "m" : "l"}`;
}

/** Maßzahl der Vorhabengeometrie - Fläche, Länge oder gar nichts. */
const mass = () =>
  vorhabenMasze.flaecheM2 != null
    ? flaeche(vorhabenMasze.flaecheM2)
    : vorhabenMasze.laengeM != null
      ? laenge(vorhabenMasze.laengeM)
      : null;

/** Passendes Etikett dazu: eine Trasse hat keine "Ausdehnung", sondern Länge. */
const massLabel = () =>
  vorhabenMasze.flaecheM2 != null
    ? t("kpi.flaecheVorhaben")
    : vorhabenMasze.laengeM != null
      ? t("kpi.laengeVorhaben")
      : t("kpi.mass");

function kopfHtml() {
  const anzahlQuellen = alleFundstellen("regionalplan:").length + alleFundstellen("gesetz:").length;

  // Summen über alle Themen hinweg sind fachlich sinnlos - ein Naturschutz-
  // gebiet und ein Wirtschaftsweg addieren sich zu nichts. Die Zahlen stehen
  // deshalb nur je Thema. Oben steht, was den Rahmen setzt.
  const regionKachel = region?.name
    ? `<div class="kpi">
        <div class="kpi-label">${esc(t("kpi.region"))}
          <button class="an-info" type="button" title="${esc(t("an.grundlagen"))}"
            aria-label="${esc(t("an.grundlagen"))}">i${
              anzahlQuellen ? `<span class="an-info-zahl">${nf().format(anzahlQuellen)}</span>` : ""
            }</button>
          ${
            region.url
              ? `<a class="an-planlink" href="${esc(region.url)}" target="_blank" rel="noopener"
                   title="${esc(`${t("an.zumPlan")}: ${region.plan}`)}"
                   aria-label="${esc(t("an.zumPlan"))}">&#8599;</a>`
              : ""
          }
        </div>
        <div class="kpi-wert ${stufeFuer(region.name)} kpi-klein">${esc(region.name)}</div>
        ${grundlagenOffen ? `<div class="an-blase">${grundlagenInhalt()}</div>` : ""}
      </div>`
    : "";

  // Reihenfolge: erst WAS, dann WO, dann WIE GROSS.
  return `<div class="kpi-grid kpi-gross">
    ${kachel(t("kpi.vorhaben"), vorhabenArt || null, true)}
    ${regionKachel}
    ${vorhabenMasze.flaecheM2 != null ? "" : kachel(massLabel(), mass())}
  </div>`;
}

/**
 * Chip "Umfeld 2.000 m": Tooltip erklärt, woher der Radius stammt, Klick
 * blendet die Zone in der Karte ein bzw. wieder aus.
 */
function umfeldChip(id, r) {
  if (!r || r.radiusMeter == null) return "";
  const aktiv = zoneSichtbar(id);
  const tip = r.radiusBegruendung ? `${r.radiusBegruendung} - ${t("an.zoneZeigen")}` : t("an.zoneZeigen");
  return `<button type="button" class="an-zone an-umfeld${aktiv ? " aktiv" : ""}"
    data-fb="${esc(id)}" title="${esc(tip)}">${esc(t("an.umfeld"))} ${nf().format(r.radiusMeter)} m</button>`;
}

/**
 * Zwischenstand nach Phase 1: welche Themen der Agent als relevant eingestuft
 * hat und mit welchem Radius. Bewusst ohne Detailblöcke - die kommen erst
 * mit den Objekten.
 */
/**
 * Warum es keine Aufteilung gibt - der Grund steht in der Abfrage, statt ihn
 * pauschal auf "Einzelsymbol" zu schieben. Ein unique-value-Renderer ohne
 * nutzbares Feld (etwa über valueExpression) sah vorher genauso aus.
 */
function keineAufteilungText(liste) {
  // "Einzelsymbol" ist kein Grund mehr: seit queryLayer auch dann nach einem
  // klassifizierenden Attribut sucht, heisst eine fehlende Aufteilung, dass der
  // Layer wirklich keines FÜHRT - kein Feld mit 2 bis 40 sich wiederholenden
  // Werten im Untersuchungsraum.
  if (liste.some((a) => a.symbolAusdruck)) return t("an.keineAufteilungAusdruck");
  return t("an.keineAufteilungKeinFeld");
}

/** Kennzahlen eines Themas über alle seine Layer. */
function themenZahlen(id) {
  const liste = abfragen.filter((a) => a.kategorieId === id);
  const summe = { objekte: 0, flaeche: 0, laenge: 0, teilmenge: false };
  for (const a of liste) {
    summe.objekte += a.anzahl;
    summe.flaeche += a.flaecheM2 ?? 0;
    summe.laenge += a.laengeM ?? 0;
    if (a.teilmenge) summe.teilmenge = true;
  }
  // Die frühere Aufteilung ÜBER ALLE Layer eines Themas ist hier bewusst
  // entfallen: sie warf Länge und Fläche verschiedener Layer in einen Topf.
  // Aufgeschlüsselt wird jetzt je Layer, siehe gruppenEinesLayers().
  return { liste, ...summe };
}

/**
 * Die Zahl, die auf den ersten Blick zählt: bei Linien die Länge, bei
 * Flächen die Fläche, sonst die Anzahl der Objekte.
 */
function leitwert(z, kategorieId) {
  // Die Objektzahl ist immer exakt; Fläche und Länge sind bei einer Teilmessung
  // Mindestwerte - das muss man der Zahl ansehen.
  const ca = z.teilmenge ? "≥\u2009" : "";
  const mass = leitmassVon(z, kategorieId);
  if (mass === "laenge" && z.laenge > 0) return ca + laenge(z.laenge);
  if (mass === "flaeche" && z.flaeche > 0) return ca + flaeche(z.flaeche);
  // Der hinterlegte Belang gibt nichts her - dann entscheiden die Daten.
  if (z.flaeche > 0) return ca + flaeche(z.flaeche);
  if (z.laenge > 0) return ca + laenge(z.laenge);
  return nf().format(z.objekte);
}

/**
 * Welche Messgrösse trägt dieses Thema?
 *
 * Steht sie im Katalog (`leitmass`), gilt sie - das ist eine fachliche
 * Eigenschaft des Belangs und keine der Daten: Siedlung und Wald sind
 * Flächenbelange, Verkehr und Leitungsnetze Streckenbelange. Ohne diese Angabe
 * gewann die Fläche, sobald irgendein Flächenlayer beitrug, und bei Verkehr
 * stand dann Hektar Verkehrsfläche statt Kilometer Strecke.
 */
function leitmassVon(z, kategorieId) {
  const gesetzt = getKategorie(kategorieId)?.leitmass;
  if (gesetzt === "laenge" && z.laenge > 0) return "laenge";
  if (gesetzt === "flaeche" && z.flaeche > 0) return "flaeche";
  return z.flaeche > 0 ? "flaeche" : z.laenge > 0 ? "laenge" : "anzahl";
}

/**
 * Reihenfolge der Layer innerhalb eines Themas: Flächen vor Linien vor
 * Punkten, darin nach Grösse. Die Kennzahl des Themas ist die Fläche - dann
 * muss der Flächenlayer auch obenan stehen und nicht der Linienlayer, der
 * zufällig mehr Objekte hat.
 */
function layerReihenfolge(liste, mass) {
  // Der Layer, der die Kennzahl trägt, gehört nach oben. Bei Verkehr sind das
  // die Verkehrswege (Länge), nicht die Verkehrsflächen.
  const rang = (a) =>
    mass === "laenge"
      ? a.laengeM > 0
        ? 0
        : a.flaecheM2 > 0
          ? 1
          : 2
      : a.flaecheM2 > 0
        ? 0
        : a.laengeM > 0
          ? 1
          : 2;
  return [...liste].sort(
    (a, b) =>
      rang(a) - rang(b) ||
      (b.flaecheM2 || b.laengeM || b.anzahl) - (a.flaecheM2 || a.laengeM || a.anzahl),
  );
}

/** Mass eines Aufschlüsselungs-Eintrags in der Einheit des Themas. */
function gruppenMass(g) {
  if (g.laenge > 0) return laenge(g.laenge);
  if (g.flaeche > 0) return flaeche(g.flaeche);
  return `${nf().format(g.anzahl)}×`;
}

// Segmentfarben: Abstufungen des Stahlblaus plus zwei gedeckte Gegentöne.
// Bewusst wenige - mehr als sieben Ausprägungen liest ohnehin niemand ab.
// Auge-Symbole als Inline-SVG - keine Icon-Schrift, kein CDN.
const AUGE_AN =
  '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">' +
  '<path d="M10 4C5.5 4 2.2 7.2 1 10c1.2 2.8 4.5 6 9 6s7.8-3.2 9-6c-1.2-2.8-4.5-6-9-6z" ' +
  'fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  '<circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const AUGE_AUS =
  '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">' +
  '<path d="M10 4C5.5 4 2.2 7.2 1 10c1.2 2.8 4.5 6 9 6s7.8-3.2 9-6c-1.2-2.8-4.5-6-9-6z" ' +
  'fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  '<circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  '<line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" stroke-width="1.8"/></svg>';

const SEGMENTE = ["#2b4c7e", "#4a76b8", "#7aa0d4", "#5b8c8c", "#a8c2e4", "#8fb3a8", "#c3ccd8"];
const MAX_SEGMENTE = 7;

/** Rang eines Aufschlüsselungs-Eintrags in der Einheit des Themas. */
function gruppenRang(g) {
  return g.laenge || g.flaeche || g.anzahl;
}

/** Ist genau dieses Segment gerade als Kartenfilter aktiv? */
function istAktiv(fbId, layerTitel, wert) {
  return (
    segmentFilter?.fb === fbId && segmentFilter.layer === layerTitel && segmentFilter.wert === wert
  );
}

/**
 * Aufschlüsselung EINES Layers in die Form, die das Ringdiagramm erwartet.
 *
 * Bewusst nicht mehr über die Layer eines Themas hinweg summiert: unter
 * "Natur und Landschaft" liegen Hecken (Länge) und Naturschutzgebiete
 * (Fläche), und ein Ring aus Kilometern und Quadratmetern ist keine
 * Aufteilung, sondern eine Falschaussage.
 */
function gruppenEinesLayers(a) {
  return (a.aufschluesselung ?? [])
    .map((g) => ({
      wert: g.wert,
      anzahl: g.anzahl ?? 0,
      flaeche: g.flaecheM2 ?? 0,
      laenge: g.laengeM ?? 0,
      farbe: g.farbe ?? null,
      objectIds: g.objectIds ?? [],
    }))
    .sort((x, y) => gruppenRang(y) - gruppenRang(x));
}

/** Relative Leuchtdichte nach WCAG - Grundlage jedes Kontrastwerts. */
function leuchtdichte(r, g, b) {
  const k = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
}

/** Kontrastverhältnis zweier Leuchtdichten (1 = gleich, 21 = Schwarz auf Weiss). */
function kontrast(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Panelhintergrund (--surface) und die Schwelle, ab der Text als lesbar gilt.
const GRUND = leuchtdichte(255, 255, 255);
const MIN_KONTRAST = 4.5;
// Kartenfarben sind oft blass, damit sie unter Beschriftung liegen können. Als
// Kennzahl brauchen sie Kraft - darunter wird aufgesättigt.
const MIN_SAETTIGUNG = 0.5;
const NEUTRAL_GRENZE = 0.15;

/**
 * Dunkelt eine Kartenfarbe so weit ab, dass sie auf weissem Grund lesbar ist -
 * und nicht weiter.
 *
 * Die Farbe soll wiedererkennbar bleiben, deshalb wird nur die Helligkeit
 * gesenkt und das Verhältnis der Kanäle gehalten; Farbton und Sättigung
 * bleiben also erhalten. Ein helles Gelb aus der Karte war als Kennzahl auf
 * Weiss praktisch unlesbar, ein gesetztes Grau hätte dagegen die Zuordnung zur
 * Karte zerstört.
 */
function lesbareFarbe(farbe) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(farbe ?? ""));
  if (!m) return null;
  const [r0, g0, b0] = [Number(m[1]), Number(m[2]), Number(m[3])];

  // Über HSL statt über eine proportionale Skalierung aller Kanäle: die
  // dunkelte zwar korrekt ab, nahm dabei aber die Sättigung mit - aus einem
  // hellen Ockergelb wurde ein müdes Oliv. Hier bleibt der Farbton unangetastet,
  // die Sättigung wird auf ein Mindestmaß angehoben, und nur die Helligkeit
  // sinkt, bis der Kontrast reicht.
  const [h, s0, l0] = rgbZuHsl(r0, g0, b0);
  // Ein nahezu neutraler Ton bleibt neutral: Grau hat nur einen winzigen
  // Farbstich, und Aufsättigen machte daraus ein kräftiges Blau. Aufgesättigt
  // wird nur, was schon eine erkennbare Farbe IST.
  const sat = s0 < NEUTRAL_GRENZE ? s0 : Math.min(1, Math.max(s0, MIN_SAETTIGUNG));
  let l = l0;
  for (let i = 0; i < 60; i += 1) {
    const [r, g, b] = hslZuRgb(h, sat, l);
    if (kontrast(leuchtdichte(r, g, b), GRUND) >= MIN_KONTRAST) return `rgb(${r}, ${g}, ${b})`;
    if (l <= 0.12) break;
    l -= 0.015;
  }
  const [r, g, b] = hslZuRgb(h, sat, Math.max(l, 0.12));
  return `rgb(${r}, ${g}, ${b})`;
}

/** RGB (0-255) nach HSL (h in 0-1, s und l in 0-1). */
function rgbZuHsl(r, g, b) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr
      ? ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
      : max === gg
        ? ((bb - rr) / d + 2) / 6
        : ((rr - gg) / d + 4) / 6;
  return [h, s, l];
}

/** HSL zurück nach RGB (0-255, gerundet). */
function hslZuRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const kanal = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(kanal(h + 1 / 3) * 255),
    Math.round(kanal(h) * 255),
    Math.round(kanal(h - 1 / 3) * 255),
  ];
}

/**
 * Leitfarbe eines Themas: die Kartenfarbe des Layers, der am meisten beiträgt.
 * Ein durchgehendes Stahlblau für alle Themen sagte nichts darüber, welcher
 * Bestand gemeint ist - hier steht dieselbe Farbe wie in der Karte.
 */
function themenFarbe(z) {
  const beste = [...z.liste]
    .filter((a) => a.anzahl > 0 && a.layerFarbe)
    .sort((a, b) => (b.laengeM || b.flaecheM2 || b.anzahl) - (a.laengeM || a.flaecheM2 || a.anzahl))[0];
  return lesbareFarbe(beste?.layerFarbe);
}

/** Leitzahl EINER Layerabfrage - in der Einheit, die dieser Layer hergibt. */
function layerLeitwert(a) {
  const ca = a.teilmenge ? "≥ " : "";
  if (a.laengeM > 0) return ca + laenge(a.laengeM);
  if (a.flaecheM2 > 0) return ca + flaeche(a.flaecheM2);
  return nf().format(a.anzahl);
}

/**
 * Ringdiagramm der Aufschlüsselung plus Legende.
 *
 * Gezeichnet über stroke-dasharray auf konzentrischen Kreisen: bei einem
 * Umfang von genau 100 ist der Prozentwert direkt die Strichlänge, und
 * stroke-dashoffset dreht jedes Segment an seine Position. Kein Pfad-Rechnen,
 * keine Bibliothek.
 */
function kreisHtml(gruppen, fbId, layerTitel) {
  const summe = gruppen.reduce((n, g) => n + gruppenRang(g), 0);
  if (!summe) return "";

  // Was hinter Platz sieben liegt, wird zu einem Sammelposten.
  let teile = gruppen.slice(0, MAX_SEGMENTE);
  if (gruppen.length > MAX_SEGMENTE) {
    const rest = gruppen.slice(MAX_SEGMENTE - 1);
    teile = [
      ...gruppen.slice(0, MAX_SEGMENTE - 1),
      {
        wert: t("an.weitere", { n: nf().format(rest.length) }),
        anzahl: rest.reduce((n, g) => n + g.anzahl, 0),
        flaeche: rest.reduce((n, g) => n + g.flaeche, 0),
        laenge: rest.reduce((n, g) => n + g.laenge, 0),
        farbe: null,
        proLayer: rest.flatMap((g) => g.proLayer ?? []),
      },
    ];
  }

  const R = 15.915494; // Umfang = 2*PI*R = 100
  let bisher = 0;
  const segmente = teile
    .map((g, i) => {
      const anteil = (gruppenRang(g) / summe) * 100;
      const aktiv = istAktiv(fbId, layerTitel, g.wert);
      const kreis = `<circle class="an-seg${aktiv ? " aktiv" : ""}" cx="21" cy="21" r="${R}"
        fill="none" data-fb="${esc(fbId)}" data-layer="${esc(layerTitel)}" data-wert="${esc(g.wert)}"
        stroke="${g.farbe ?? SEGMENTE[i]}" stroke-width="6.5"
        stroke-dasharray="${anteil.toFixed(2)} ${(100 - anteil).toFixed(2)}"
        stroke-dashoffset="${(25 - bisher).toFixed(2)}"
        ><title>${esc(`${g.wert}: ${gruppenMass(g)} (${Math.round(anteil)} %)`)}</title></circle>`;
      bisher += anteil;
      return kreis;
    })
    .join("");

  const legende = teile
    .map(
      (g, i) => `<div class="an-legende-zeile${istAktiv(fbId, layerTitel, g.wert) ? " aktiv" : ""}"
        role="button" tabindex="0" data-fb="${esc(fbId)}" data-layer="${esc(layerTitel)}"
        data-wert="${esc(g.wert)}"
        title="${esc(t("an.segmentFiltern"))}">
        <span class="an-legende-punkt" style="background:${g.farbe ?? SEGMENTE[i]}"></span>
        <span class="an-legende-name">${esc(g.wert)}</span>
        <span class="an-legende-mass">${esc(gruppenMass(g))}</span>
        <span class="an-legende-prozent">${Math.round((gruppenRang(g) / summe) * 100)} %</span>
      </div>`,
    )
    .join("");

  return `<div class="an-kreis">
    <svg class="an-kreis-svg" viewBox="0 0 42 42" role="img"
      aria-label="${esc(t("an.aufteilung"))}">
      <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--border)" stroke-width="6.5" />
      ${segmente}
    </svg>
    <div class="an-legende">${legende}</div>
  </div>`;
}

/**
 * Themen: EINE Liste - Kennzahl, Aufschlüsselung und Details in einem Block.
 * Sie erscheint erst, wenn die Geo-Analyse gelaufen ist; vorher gibt es keine
 * Objekte, über die sich etwas aussagen liesse.
 */
function themenHtml() {
  // Erst wenn der Lauf durch ist. Vorher stünde hier ein Zwischenstand, der
  // sich mit jeder weiteren Abfrage ändert; solange zeigen wir nur, welche
  // Themen überhaupt als relevant eingestuft wurden.
  if (!laufFertig || !abfragen.length) return "";

  // Nur Themen MIT Objekten. Eine Zeile ohne Zahl ist im Detailbereich nur
  // Platzhalter; dass die Kategorie geprüft wurde und nichts im Umfeld liegt,
  // steht als Vermerk unten (ohneObjekteHtml) und in der Bilanz.
  const ids = [...new Set([...relevanz.map((r) => r.kategorieId), ...abfragen.map((a) => a.kategorieId)])]
    .map((id) => ({ id, z: themenZahlen(id) }))
    .filter((x) => x.z.objekte > 0)
    .sort((a, b) => (b.z.laenge || b.z.flaeche || b.z.objekte) - (a.z.laenge || a.z.flaeche || a.z.objekte));
  if (!ids.length) return "";

  const bloecke = ids
    .map(({ id, z }) => {
      const r = relevanz.find((x) => x.kategorieId === id);
      const auf = offen.has(id);

      // Unter dem Themennamen: die Objektzahl, darunter JE LAYER eine eigene
      // Zeile mit fett gesetzter Zahl. Als eine durchlaufende Aufzählung
      // ("143 Objekte · 19,4 km Hecken, 2,9 ha Schutzgebiete") liessen sich
      // die Werte nicht mehr auseinanderhalten.
      const mass = leitmassVon(z, id);
      const mitObjekten = layerReihenfolge(
        z.liste.filter((a) => a.anzahl > 0),
        mass,
      );
      const zweiteZeile =
        `<span class="an-summe-objekte">${esc(t("an.objekte", { n: nf().format(z.objekte) }))}</span>` +
        mitObjekten
          .slice(0, 4)
          .map(
            (a) =>
              `<span class="an-summe-layer">${esc(layerLeitwert(a))} ${esc(a.layer)}</span>`,
          )
          .join("");

      // Ein Ringdiagramm JE LAYER, jedes für sich aufklappbar. Das erste steht
      // offen - sonst müsste man erst klicken, um überhaupt etwas zu sehen.
      const tabelle = mitObjekten
        .map((a, i) => {
          const key = `${id}|${a.layer}`;
          const gruppen = gruppenEinesLayers(a);
          const auf = offeneDiagramme.has(key) || (i === 0 && !zuDiagramme.has(key));
          const inhalt = gruppen.length
            ? kreisHtml(gruppen, id, a.layer)
            : `<p class="an-ohne">${esc(keineAufteilungText([a]))}</p>`;
          const nurDieser = layerFilter?.fb === id && layerFilter.layer === a.layer;
          return `<details class="an-layerbox${nurDieser ? " aktiv" : ""}"${auf ? " open" : ""}
            data-key="${esc(key)}" data-fb="${esc(id)}" data-layer="${esc(a.layer)}">
            <summary title="${esc(t("an.nurDieserLayer"))}">
              <span class="an-layerbox-punkt"${
                a.layerFarbe ? ` style="background:${esc(a.layerFarbe)}"` : ""
              }></span>
              <span class="an-layerbox-name">${esc(a.layer)}</span>
              <span class="an-layerbox-wert">${esc(layerLeitwert(a))}</span>
            </summary>
            ${inhalt}
          </details>`;
        })
        .join("");

      // Einordnung, Fundstellen und die abgefragten Layer stehen zusammen im
      // Infoblock. Zahlen wiederholen wir hier nicht - die stehen oben.
      const teilmenge = z.liste.some((a) => a.teilmenge);
      const infos = [
        r?.begruendung ? `<p class="an-text">${esc(r.begruendung)}</p>` : "",
        fundstelle(t("an.fundstelleRp"), r?.regionalplan),
        fundstelle(t("an.fundstelleGesetz"), r?.gesetz),
        mitObjekten.length ? "" : fundstelle(t("an.layer"), z.liste.map((a) => a.layer).join(", ")),
        teilmenge ? fundstelle(t("an.teilmenge"), t("an.teilmengeKurz")) : "",
      ].join("");

      const details = auf
        ? `<div class="an-fb-body">
            ${tabelle}
            ${infos.trim() ? `<div class="an-warum">${infos}</div>` : ""}
          </div>`
        : "";

      // Ohne Objekte gibt es keine Kennzahl - eine grosse "0" behauptet eine
      // Messung, die gar nicht stattgefunden hat. Die Zeile bleibt trotzdem
      // stehen, mit "Keine Objekte im Umfeld" als zweiter Zeile.
      const farbe = themenFarbe(z);
      const zahl = `<span class="an-summe-zahl"${
        farbe ? ` style="color:${esc(farbe)}"` : ""
      }>${esc(leitwert(z, id))}</span>`;

      return `<div class="an-fb${auf ? " offen" : ""}${
        themaFilter === id ? " fokus" : ""
      }" data-fb="${esc(id)}">
        <div class="an-fb-kopf">
          ${zahl}
          <span class="an-summe-text">
            <span class="an-summe-name">${esc(kategorieTitel(id, getLang()))}</span>
            <span class="an-summe-mass">${zweiteZeile}</span>
          </span>
          ${umfeldChip(id, r)}
          <button type="button" class="an-auge${ausgeblendet.has(id) ? " aus" : ""}"
            data-auge="${esc(id)}"
            title="${esc(ausgeblendet.has(id) ? t("an.layerEin") : t("an.layerAus"))}"
            aria-label="${esc(ausgeblendet.has(id) ? t("an.layerEin") : t("an.layerAus"))}"
            >${ausgeblendet.has(id) ? AUGE_AUS : AUGE_AN}</button>
          <span class="an-chevron">${auf ? "−" : "+"}</span>
        </div>${details}</div>`;
    })
    .join("");

  // Nach einem Segment- oder Layerklick steht die Karte auf einem Ausschnitt
  // des Ergebnisses. Ein Weg zurueck muss sichtbar sein, sonst kommt man nur
  // ueber einen zweiten Klick auf dasselbe Element heraus.
  const eingeschraenkt = Boolean(segmentFilter || layerFilter || themaFilter || ausgeblendet.size);
  const knopf = `<button type="button" class="an-alle-btn${eingeschraenkt ? " aktiv" : ""}">
      ${esc(t("an.alleZeigen"))}</button>`;

  return `<div class="an-titel">
      <span>${esc(t("an.relevante"))}</span>${knopf}
    </div>
    <div class="an-themen">${bloecke}</div>`;
}

/**
 * Inhalt der Grundlagen-Sprechblase: geltender Plan, Zuordnungsweg und die
 * RAG-Passagen im Wortlaut. Steht direkt am Info-i der Planungsregion - dort
 * kommt die Frage auf, nicht am Ende der Seite.
 */
function grundlagenInhalt() {
  const rp = alleFundstellen("regionalplan:");
  const ges = alleFundstellen("gesetz:");

  const passage = (f) => `
    <div class="an-passage">
      <div class="an-passage-kopf">${esc(f.zitat)}${
        f.ueberschrift ? ` — ${esc(f.ueberschrift)}` : ""
      }</div>
      ${f.stand ? `<div class="an-passage-meta">${esc(t("an.stand"))} ${esc(f.stand)}</div>` : ""}
      <div class="an-passage-text">${esc(String(f.text ?? "").slice(0, 1200))}</div>
    </div>`;

  return `<div class="an-blase-kopf">
      <span>${esc(t("an.grundlagen"))}</span>
      <button type="button" class="an-blase-zu" aria-label="${esc(t("an.schliessen"))}">&#215;</button>
    </div>
    <div class="an-blase-body">
      ${
        region?.plan
          ? `<p class="an-fundstelle"><span>${esc(t("an.geltenderPlan"))}</span>${esc(region.plan)} (${esc(
              region.stand,
            )})${
              region.url
                ? ` <a href="${esc(region.url)}" target="_blank" rel="noopener">${esc(t("an.quelle"))}</a>`
                : ""
            }</p>`
          : ""
      }
      ${region?.gefundenUeber ? `<p class="an-fundstelle"><span>${esc(t("an.zuordnung"))}</span>${esc(region.gefundenUeber)}</p>` : ""}
      ${rp.length ? `<div class="an-block-titel">${esc(t("an.passagenRp"))}</div>${rp.map(passage).join("")}` : ""}
      ${ges.length ? `<div class="an-block-titel">${esc(t("an.passagenGesetz"))}</div>${ges.map(passage).join("")}` : ""}
      ${!rp.length && !ges.length ? `<p class="an-ohne">${esc(t("an.keineFundstellen"))}</p>` : ""}
    </div>`;
}

function fundstelle(label, wert) {
  if (!wert) return "";
  return `<p class="an-fundstelle"><span>${esc(label)}</span>${esc(wert)}</p>`;
}

function render() {
  // Der Zwischenstand gehört in den Ablauf: er sagt, woran gerade gearbeitet
  // wird. Das Ergebnisfeld bleibt leer, bis wirklich Ergebnisse dastehen.
  if (!el) return;
  if (
    !region &&
    !relevanz.length &&
    !nichtRelevant.length &&
    !abfragen.length &&
    !kernaussagen.length &&
    !hinweis
  ) {
    el.innerHTML = `<p class="hint">${esc(t("an.leer"))}</p>`;
    return;
  }
  el.innerHTML =
    (hinweis ? `<div class="an-warnung">${esc(hinweis)}</div>` : "") +
    kopfHtml() +
    themenHtml() +
    nichtRelevantHtml();
}

/**
 * Geprüft und verworfen: was NICHT einschlägig ist, gehört ans Ende - aber es
 * gehört hin. Sonst sieht es aus, als wäre der Belang übersehen worden.
 */
function nichtRelevantHtml() {
  if (!laufFertig || (!nichtRelevant.length && !relevanz.length)) return "";
  const zeilen = nichtRelevant
    .map(
      (n) => `<div class="an-verworfen">
        <span class="an-verworfen-name">${esc(kategorieTitel(n.kategorieId, getLang()))}</span>
        <span class="an-verworfen-text">${esc(n.begruendung)}</span>
        ${n.fundstelle ? `<span class="an-verworfen-quelle">${esc(n.fundstelle)}</span>` : ""}
      </div>`,
    )
    .join("");
  const offenText = ungeprueftHtml() + ohneObjekteHtml();
  const rest = KATEGORIEN.filter(
    (k) =>
      !relevanz.some((r) => r.kategorieId === k.id) &&
      !nichtRelevant.some((n) => n.kategorieId === k.id),
  );
  const ohneEinstufungZahl = rest.filter((k) => recherchiert.has(k.id)).length;
  const offenZahl = rest.length - ohneEinstufungZahl;
  if (!zeilen && !offenText) return "";
  // Aufklappbar: gehört in den Bericht, soll ihn aber nicht dominieren.
  return `<details class="an-verworfen-box"${verworfenOffen ? " open" : ""}>
      <summary>${esc(t("an.nichtRelevant"))}${
        nichtRelevant.length ? ` (${nf().format(nichtRelevant.length)})` : ""
      }${
        ohneEinstufungZahl
          ? ` · ${esc(t("an.ohneEinstufungKurz", { n: nf().format(ohneEinstufungZahl) }))}`
          : ""
      }${
        offenZahl ? ` · ${esc(t("an.ungeprueftKurz", { n: nf().format(offenZahl) }))}` : ""
      }</summary>
      ${zeilen ? `<div class="an-verworfen-liste">${zeilen}</div>` : ""}${offenText}
    </details>`;
}

/**
 * Was am Ende weder relevant noch verworfen ist - in ZWEI Gruppen, weil das
 * fachlich zweierlei ist: recherchiert, aber nicht eingestuft (Regionalplan
 * und Fachrecht wurden durchsucht, die Meldung blieb aus) und gar nicht
 * betrachtet. Deterministisch aus Katalog und Recherchevermerk; ohne diese
 * Zeilen sähe der Bericht so aus, als wäre der Katalog abgearbeitet worden.
 */
/**
 * Kategorien, die abgefragt wurden und im Untersuchungsraum nichts enthalten.
 * Sie stehen nicht mehr in der Themenliste - dort wären sie eine Zeile ohne
 * Zahl -, dürfen aber auch nicht verschwinden: geprüft und leer ist ein
 * Ergebnis, keine Lücke.
 */
function ohneObjekteHtml() {
  const leer = [...new Set([...relevanz.map((r) => r.kategorieId), ...abfragen.map((a) => a.kategorieId)])]
    .filter((id) => themenZahlen(id).objekte === 0)
    .map((id) => kategorieTitel(id, getLang()));
  if (!leer.length) return "";
  return `<p class="an-ohne">${esc(t("an.ohneObjekteListe"))} ${esc(leer.join(", "))}</p>`;
}

function ungeprueftHtml() {
  const angefasst = new Set([
    ...relevanz.map((r) => r.kategorieId),
    ...nichtRelevant.map((n) => n.kategorieId),
  ]);
  const rest = KATEGORIEN.filter((k) => !angefasst.has(k.id));
  if (!rest.length) return "";
  const namen = (liste) => liste.map((k) => kategorieTitel(k.id, getLang())).join(", ");
  const ohneEinstufung = rest.filter((k) => recherchiert.has(k.id));
  const offen = rest.filter((k) => !recherchiert.has(k.id));
  return (
    (ohneEinstufung.length
      ? `<p class="an-ohne">${esc(t("an.ohneEinstufung"))} ${esc(namen(ohneEinstufung))}</p>`
      : "") +
    (offen.length ? `<p class="an-ohne">${esc(t("an.ungeprueft"))} ${esc(namen(offen))}</p>` : "")
  );
}

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
