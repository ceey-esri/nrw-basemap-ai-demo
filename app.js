// Einstiegspunkt: räumliches Erstscreening eines raumbedeutsamen Vorhabens.
//
// Zweistufig: Schritt 2 ermittelt Region, Untersuchungsraum und die relevanten
// Kategorien (mit Begründung aus Regionalplan und Fachrecht), Schritt 3 die
// Kartenobjekte dazu.

import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/main.css";
import "@arcgis/ai-components/main.css";

import { initAuth } from "./src/oauth.js";
import { t, getLang, toggleLang, onLang, applyStatic } from "./src/i18n.js";
import {
  initKarte,
  vorhaben,
  analyseLeeren as grafikenLeeren,
  onFeatureKlick,
  vorhabenMasse,
  setzeVorhabenGeometrie,
  setzeVorhabenAusKoordinaten,
  zoomeAufVorhaben,
  zoomeAufTreffer,
  setzeVorhabenLabel,
  vorhabenLoeschen,
} from "./src/karte.js";
import {
  shapefileLesen,
  koordinatenLesen,
  KOORD_FORMATE,
  getFormat,
} from "./src/import.js";
import { VORHABEN, getVorhaben, vorhabenTitel } from "./src/screening/vorhaben.js";
import { KATEGORIEN, kategorieTitel } from "./src/screening/kategorien.js";
import {
  initAnalyse,
  ergebnisLeeren,
  getAnalyse,
  onAnalyseChange,
  setzeVorhabenMasze,
  setzeHinweis,
  setzeVorhabenArt,
  setzeLaufFertig,
  zeigeGefundeneObjekte,
} from "./src/screening/analyse.js";
import { ragLeeren } from "./src/screening/rag.js";
import { initAgents } from "./src/screening/agents.js";
import { toolsZuruecksetzen, offeneLayer } from "./src/screening/tools.js";
import { erzeugePdf } from "./src/screening/pdf.js";
import { initKontext } from "./src/screening/kontext.js";
import {
  onFortschritt,
  fortschrittReset,
  setzePhase,
  letzterFehler,
  meldeSchritt,
} from "./src/screening/fortschritt.js";

const $ = (s) => document.querySelector(s);

// --- Zustand ---------------------------------------------------------------
// Bewusst GANZ oben: während der Modul-Auswertung können Render-Callbacks
// bereits darauf zugreifen (setzeVorhabenMasze -> notify -> ergebnisButtons).
let assistant = null;
let assistantBereit = false;
let aktuellerNutzer = null;
let aktivePhase = "idle";
let busy = false;
let laufAktiv = false;
let antwortWarter = null;
let vorhabenId = "";

// --- Sprache ---
$("#lang-btn").addEventListener("click", () => toggleLang());

// --- Vorhabenart ---
const typGrid = $("#vorhaben-typ");
function renderTypGrid() {
  typGrid.innerHTML = VORHABEN.map(
    (v) =>
      `<button type="button" class="choice${v.id === vorhabenId ? " active" : ""}" data-typ="${v.id}">${esc(
        vorhabenTitel(v.id, getLang()),
      )}</button>`,
  ).join("");
}
renderTypGrid();
typGrid.addEventListener("click", (e) => {
  const b = e.target.closest(".choice");
  if (!b) return;
  vorhabenId = b.dataset.typ;
  typGrid.querySelectorAll(".choice").forEach((c) => c.classList.toggle("active", c === b));
  setzeVorhabenArt(vorhabenTitel(vorhabenId, getLang()));
  setzeVorhabenLabel(vorhabenTitel(vorhabenId, getLang()));
  aktualisiereButtons();
  aktualisierePreview();
});

$("#kommentar").addEventListener("input", aktualisierePreview);
$("#geom-weg").addEventListener("click", vorhabenLoeschen);

// --- Geometrie importieren: Shapefile oder Koordinaten ---
const importStatus = $("#import-status");
function setzeImportStatus(text, fehler) {
  importStatus.textContent = text;
  importStatus.classList.toggle("import-fehler", Boolean(fehler));
}

function shpZuruecksetzen() {
  $("#shp-input").value = "";
  $("#shp-input").hidden = false;
  $("#shp-gewaehlt").hidden = true;
  setzeImportStatus("");
}
$("#shp-weg").addEventListener("click", shpZuruecksetzen);

$("#shp-input").addEventListener("change", async (e) => {
  const dateien = [...(e.target.files ?? [])];
  if (!dateien.length) return;
  setzeImportStatus(t("import.laeuft"));
  try {
    const { geometrie, anzahl, name } = await shapefileLesen(dateien);
    await setzeVorhabenGeometrie(geometrie);
    // Solange etwas geladen ist, bleibt der Dateiknopf weg - erst das "x"
    // gibt ihn wieder frei.
    const ordner = dateien[0].webkitRelativePath?.split("/")[0] || name;
    $("#shp-name").textContent = t("import.geladen", { name: ordner, n: anzahl });
    $("#shp-gewaehlt").hidden = false;
    $("#shp-input").hidden = true;
    setzeImportStatus("");
  } catch (err) {
    console.error("[Import] Shapefile:", err);
    setzeImportStatus(String(err.message ?? err), true);
    e.target.value = "";
  }
});

// Koordinatenformat: die Auswahl bestimmt, wie die Eingabe zu lesen ist -
// dezimal, in Grad/Minute/Sekunde oder als Rechts-/Hochwert.
const koordFormat = $("#koord-format");
koordFormat.innerHTML = KOORD_FORMATE.map(
  (f) => `<option value="${f.id}">${esc(f.name)}</option>`,
).join("");
function renderKoordLabel() {
  const f = getFormat(koordFormat.value);
  $("#koord-label").textContent = t("import.koordFelder", { felder: f.felder });
  $("#koord-input").placeholder = f.beispiel;
}
koordFormat.addEventListener("change", renderKoordLabel);
renderKoordLabel();

$("#koord-btn").addEventListener("click", async () => {
  const f = getFormat(koordFormat.value);
  const k = koordinatenLesen($("#koord-input").value, f.id);
  if (!k) {
    setzeImportStatus(t("import.koordFehler", { beispiel: f.beispiel }), true);
    return;
  }
  try {
    await setzeVorhabenAusKoordinaten(k.x, k.y, k.wkid);
    setzeImportStatus(t("import.koordOk", { x: k.x, y: k.y, sr: f.name }));
  } catch (err) {
    console.error("[Import] Koordinaten:", err);
    setzeImportStatus(String(err.message ?? err), true);
  }
});
$("#koord-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#koord-btn").click();
});

initKontext({
  getVorhabenTyp: () => vorhabenId,
  getKommentar: () => $("#kommentar").value.trim(),
});

// --- Anweisungs-Vorschau ---
//
// #screening-preview ist die erste NACHRICHT an den Agenten: Auftrag, Vorhaben,
// Geometrie und Rahmen. Den Phasenauftrag und den Sprachhinweis hängt
// eineNachricht() automatisch dahinter. Der Systemprompt steht in agents.js und
// wird hier bewusst nicht gezeigt - er ist nicht Teil der Nachricht.
let previewDirty = false;
$("#screening-preview").addEventListener("input", () => (previewDirty = true));

function baueKontextText() {
  const v = getVorhaben(vorhabenId);
  const m = vorhabenMasse();
  const loc = getLang() === "en" ? "en-GB" : "de-DE";
  const geom =
    m.flaecheM2 != null
      ? t("instr.geomFlaeche", {
          ha: (m.flaecheM2 / 10000).toLocaleString(loc, { maximumFractionDigits: 1 }),
        })
      : m.laengeM != null
        ? t("instr.geomLinie", { m: Math.round(m.laengeM).toLocaleString(loc) })
        : m.typ === "point"
          ? t("instr.geomPunkt")
          : t("instr.geomKeine");

  return [
    t("instr.auftrag"),
    "",
    `${t("instr.type")}: ${v ? vorhabenTitel(v.id, getLang()) : t("instr.typeNone")}`,
    v?.beschreibung ? `${t("instr.beschreibung")}: ${v.beschreibung}` : null,
    `${t("instr.geometrie")}: ${geom}`,
    `${t("instr.comment")}: ${$("#kommentar").value.trim() || t("instr.commentNone")}`,
  ]
    .filter((z) => z !== null)
    .join("\n");
}
function aktualisierePreview() {
  if (!previewDirty) $("#screening-preview").value = baueKontextText();
}
aktualisierePreview();

// --- Ergebnis-Panel ---
initAnalyse($("#results"));

const pdfBtn = $("#pdf-btn");

function ergebnisButtons() {
  const a = getAnalyse();
  const hatErgebnis =
    a.relevanz.length > 0 || a.abfragen.length > 0 || a.nichtRelevant.length > 0;
  pdfBtn.disabled = !(aktivePhase === "fertig" && hatErgebnis);
  $("#abschluss").hidden = !(aktivePhase === "fertig" && hatErgebnis);
}
onAnalyseChange(ergebnisButtons);

pdfBtn.addEventListener("click", () =>
  erzeugePdf({ vorhabenTyp: vorhabenId ? vorhabenTitel(vorhabenId, getLang()) : "" }),
);

// --- Klick auf ein Feature in der Karte -> Erklärungsblase ---
onFeatureKlick((info) => {
  const pop = $("#feature-popup");
  if (!info?.bereichId) {
    pop.hidden = true;
    return;
  }
  const a = getAnalyse();
  const abfrage = a.abfragen.find((x) => x.layer === info.bereichId);
  const r = abfrage ? a.relevanz.find((x) => x.kategorieId === abfrage.kategorieId) : null;
  const attrs = Object.entries(info.attributes ?? {})
    .filter(([k, v]) => v != null && v !== "" && !/^(objectid|globalid|shape)/i.test(k))
    .slice(0, 8)
    .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
    .join("<br>");

  $("#feature-popup-inhalt").innerHTML =
    `<p class="fp-titel">${esc(
      abfrage ? kategorieTitel(abfrage.kategorieId, getLang()) : info.layerTitel,
    )}</p>` +
    `<div class="fp-block"><b>${esc(t("fp.what"))}</b>${esc(info.layerTitel || t("fp.object"))}${
      attrs ? `<br>${attrs}` : ""
    }</div>` +
    `<div class="fp-block"><b>${esc(t("fp.why"))}</b>${esc(r?.begruendung ?? t("fp.pending"))}</div>` +
    (r?.regionalplan
      ? `<div class="fp-block"><b>${esc(t("an.fundstelleRp"))}</b>${esc(r.regionalplan)}</div>`
      : "") +
    (r?.gesetz
      ? `<div class="fp-block"><b>${esc(t("an.fundstelleGesetz"))}</b>${esc(r.gesetz)}</div>`
      : "");

  const box = $("#map-container").getBoundingClientRect();
  pop.style.left = Math.min(Math.max(8, info.x - 160), Math.max(8, box.width - 340)) + "px";
  pop.style.top = Math.min(Math.max(8, info.y + 12), Math.max(8, box.height - 200)) + "px";
  pop.hidden = false;
});
$("#fp-close").addEventListener("click", () => ($("#feature-popup").hidden = true));

// --- Fortschritt ---
let letzterSnap = { phase: "idle", kategorie: "", schritte: [] };
onFortschritt((snap) => {
  letzterSnap = snap;
  renderFortschritt(snap);
});

function renderFortschritt({ phase, schritte }) {
  $("#fortschritt-panel").hidden = phase === "idle";

  const tools = schritte.filter((s) => s.typ === "tool").length;
  let pct = 0;
  if (phase === "screening") pct = Math.min(6 + tools * 4, 92);
  else if (phase === "fertig" || phase === "fehler") pct = 100;

  const bar = $("#progress-bar");
  bar.style.width = pct + "%";
  bar.classList.toggle("fertig", phase === "fertig");
  bar.classList.toggle("fehler", phase === "fehler");

  // Der Werkzeugschritt sagt in vier Worten, was gerade passiert ("fragt einen
  // Kartenlayer ab (verkehr / Verkehrswege)"). Der Fließtext des Modells sagt
  // dasselbe in fünf Zeilen - er ist nur die Notlösung, solange noch kein
  // Werkzeug gelaufen ist. Die vollständige Kette steht in der Konsole.
  const rueckwaerts = [...schritte].reverse();
  const letzter = rueckwaerts.find((x) => x.typ === "tool") ?? rueckwaerts.find((x) => x.typ === "ki");
  $("#progress-label").textContent = phase === "screening" ? (letzter?.text ?? "") : "";

}

// --- Geometrie-Status ---
function renderGeomStatus(geom) {
  const m = vorhabenMasse();
  setzeVorhabenMasze(m);
  const loc = getLang() === "en" ? "en-GB" : "de-DE";
  $("#geom-status").textContent = !geom
    ? t("geom.none")
    : geom.type === "point"
      ? ""
      : geom.type === "polyline"
        ? t("geom.line", { m: (m.laengeM ?? 0).toLocaleString(loc) })
        : t("geom.area", {
            ha: ((m.flaecheM2 ?? 0) / 10000).toLocaleString(loc, { maximumFractionDigits: 1 }),
          });
}
vorhaben.onChange((geom) => {
  try {
    renderGeomStatus(geom);
    aktualisierePreview();
    if (!geom) allesLeeren();
  } catch (err) {
    console.error("[Screening] Geometrie-Update fehlgeschlagen:", err);
  }
  aktualisiereButtons();
});

function allesLeeren() {
  if (laufAktiv) {
    laufAktiv = false;
    if (antwortWarter) {
      const r = antwortWarter;
      antwortWarter = null;
      r({ error: "abgebrochen" });
    }
  }
  grafikenLeeren();
  ergebnisLeeren();
  ragLeeren();
  toolsZuruecksetzen();
  fortschrittReset();
  $("#feature-popup").hidden = true;
}

// --- Karte ---
await initKarte($("#map-container"), $("#sketch-slot"));
renderGeomStatus(vorhaben.geometrie);

// --- OAuth + Assistent ---
initAuth($("#login-btn"), $("#login-status"), (username) => {
  aktuellerNutzer = username ?? null;
  renderAuth(aktuellerNutzer);
  if (username && !assistant) {
    baueAssistent().catch((err) =>
      console.error("[Screening] Assistent-Aufbau fehlgeschlagen:", err),
    );
  }
});

function renderAuth(username) {
  $("#login-status").textContent = username
    ? t("auth.signedInAs", { name: username })
    : t("auth.signedOut");
  $("#login-btn").textContent = username ? t("auth.signOut") : t("auth.signIn");
}
renderAuth(null);

async function baueAssistent() {
  assistantBereit = false;
  const el = document.createElement("arcgis-assistant");
  el.heading = t("assistant.heading");
  el.keepSuggestedPrompts = false;
  el.suggestedPrompts = [];
  el.entryMessage = t("assistant.entry");

  await initAgents(el);
  $("#assistant-slot").innerHTML = "";
  $("#assistant-slot").appendChild(el);

  el.addEventListener("arcgisResponse", (e) => {
    const text =
      e.detail?.content ?? e.detail?.message?.content ?? el.messages?.at?.(-1)?.content ?? "";
    if (antwortWarter) {
      const r = antwortWarter;
      antwortWarter = null;
      r({ text });
      return;
    }
    if (laufAktiv) return;
    if (aktivePhase === "screening") setzePhaseLokal("fertig");
    setzeBusy(false);
    ergebnisButtons();
  });
  el.addEventListener("arcgisError", (ev) => {
    console.error("[Screening] Assistent-Fehler:", ev.detail);
    if (antwortWarter) {
      const r = antwortWarter;
      antwortWarter = null;
      r({ error: ev.detail ?? "Fehler" });
      return;
    }
    setzePhaseLokal("fehler");
    setzeBusy(false);
  });

  assistant = el;
  assistantBereit = true;
  aktualisiereButtons();
  ergebnisButtons();
  console.info("[Screening] Assistent bereit.");
}

// --- Ablaufsteuerung ---
function setzePhaseLokal(p) {
  aktivePhase = p;
  setzePhase(p);
}
function setzeBusy(b) {
  busy = b;
  aktualisiereButtons();
  ergebnisButtons();
}
function naechsteAntwort() {
  return new Promise((resolve) => {
    antwortWarter = resolve;
  });
}

/**
 * Der Arbeitsauftrag für Phase 2, aus dem Store gebaut.
 *
 * Das Modell hat sich in Phase 2 wiederholt geweigert abzufragen, weil ihm
 * "die Phase-1-Ergebnisse" fehlten - es verlässt sich nicht darauf, seine
 * eigenen Meldungen aus der Nachrichtenhistorie zu kennen. Deshalb steht die
 * Liste jetzt wörtlich in der Nachricht: welche Kategorie, welcher Radius,
 * welche Layer. Deterministisch aus dem Store, nicht aus der Erinnerung.
 */
function phase2Auftrag() {
  const a = getAnalyse();
  const layerJe = new Map(offeneLayer().map((o) => [o.kategorieId, o.layer]));
  const zeilen = a.relevanz.map((r) => {
    const layer = layerJe.get(r.kategorieId) ?? [];
    return (
      `- ${r.kategorieId} (${kategorieTitel(r.kategorieId, getLang())}), ` +
      `Umfeld ${r.radiusMeter} m: ` +
      (layer.length ? layer.join(", ") : "kein passender Layer im Katalog")
    );
  });
  return t("instr.phase2Liste", { n: a.relevanz.length }) + "\n" + zeilen.join("\n");
}

/** Kategorien, zu denen Phase 1 weder eine Relevanz- noch eine Absage lieferte. */
/** Mehr Runden bringen erfahrungsgemäss nichts und kosten nur Credits. */
const MAX_NACHFASSEN = 3;

/**
 * Ab so vielen verworfenen Kategorien bei höchstens einer relevanten gilt die
 * Einstufung als verdächtig - dann hat das Modell vermutlich nach der
 * Zugehörigkeit des Vorhabens gefragt statt nach seiner Wirkung.
 */
const MIN_VERWORFEN_VERDACHT = 4;

/**
 * Fragt so lange nach, wie die deterministische Prüfung noch Lücken findet
 * UND jede Runde welche schliesst. Bleibt die Zahl der offenen Punkte gleich,
 * bringt eine weitere Nachricht nichts - dann ist Schluss.
 *
 * @param {() => any[]} pruefe    liefert die offenen Punkte
 * @param {(offen:any[]) => string} text  die Nachricht an den Agenten
 * @param {(offen:any[]) => any} loggen   was in der Konsole stehen soll
 * @returns {Promise<boolean>} true bei einem Fehler
 */
async function nachfassenBis(pruefe, text, loggen, was) {
  let vorher = Infinity;
  for (let runde = 1; runde <= MAX_NACHFASSEN; runde += 1) {
    if (!laufAktiv) return false;
    const offen = pruefe();
    if (!offen.length) return false;
    if (offen.length >= vorher) {
      console.info(`[Screening] Nachfassen ${was}: keine Bewegung mehr, Abbruch.`, loggen(offen));
      return false;
    }
    vorher = offen.length;
    console.info(`[Screening] Nachfassen ${was} (Runde ${runde}):`, loggen(offen));
    await new Promise((res) => setTimeout(res, 200));
    const r = await eineNachricht(text(offen));
    if (r?.error) return true;
  }
  return false;
}

function fehlendeKategorien() {
  const a = getAnalyse();
  const gemeldet = new Set([
    ...a.relevanz.map((r) => r.kategorieId),
    ...a.nichtRelevant.map((n) => n.kategorieId),
  ]);
  return KATEGORIEN.filter((k) => !gemeldet.has(k.id));
}

function eingabenVollstaendig() {
  return Boolean(vorhabenId) && Boolean(vorhaben.geometrie);
}

function aktualisiereButtons() {
  const btn = $("#screening-btn");
  btn.disabled = !(assistantBereit && eingabenVollstaendig() && !busy);

  // Was noch fehlt, steht im Tooltip - eine eigene Hinweiszeile darunter war
  // dauerhaft sichtbarer Text für einen Zustand, den die Häkchen schon zeigen.
  const fehlt = [];
  if (!assistantBereit) fehlt.push(t("hint.signIn"));
  if (!vorhabenId) fehlt.push(t("hint.type"));
  if (!vorhaben.geometrie) fehlt.push(t("hint.geom"));
  btn.title = fehlt.length ? t("hint.prefix") + fehlt.join(", ") + "." : "";

  // Grünes Häkchen je Block, sobald erfüllt.
  $("#haken-vorhaben").hidden = !vorhabenId;
  $("#haken-geometrie").hidden = !vorhaben.geometrie;
  $("#geom-weg").disabled = !vorhaben.geometrie;

  console.info("[Screening] Start-Bedingungen:", {
    assistantBereit,
    vorhabenId: vorhabenId || null,
    geometrie: vorhaben.geometrie?.type ?? null,
    busy,
  });
}

/** Eine Assistenten-Nachricht je Phase - der Nutzer klickt nur einmal. */
/**
 * Fehler des Modelldienstes, die NICHT als `arcgisError` ankommen, sondern als
 * ganz normale Antwort im Nachrichtentext ("429 The system is currently
 * experiencing high demand"). Ohne diese Erkennung galt der Lauf als
 * erfolgreich, das Ergebnis blieb leer, und die Nachfass-Schritte schickten
 * weitere Nachrichten in dasselbe Limit.
 */
const DIENST_FEHLER =
  /\b429\b|too many requests|rate.?limit|high demand|error during (message processing|intent detection)/i;

/**
 * Wartezeiten vor den Wiederholungen. Ein Kapazitätsengpass des Esri-Dienstes
 * ist vorübergehend, aber nicht nach acht Sekunden vorbei - lieber gut zwei
 * Minuten warten als den ganzen Lauf verlieren.
 */
const WARTEN_MS = [10000, 30000, 60000];

/**
 * Alles, worin die Fehlermeldung stecken kann, zu einem Text - der Assistent
 * liefert mal `{text}`, mal `{error: <string>}`, mal `{error: <Event-Detail>}`
 * mit `message` oder verschachteltem `error`.
 */
function fehlertext(antwort) {
  const roh = antwort?.error ?? antwort?.text ?? "";
  if (typeof roh === "string") return roh;
  return [roh?.message, roh?.error?.message, roh?.detail, safeJson(roh)]
    .filter((x) => typeof x === "string")
    .join(" ");
}

function safeJson(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return "";
  }
}

/**
 * Nachricht abschicken und auf die Antwort warten - je nachdem, was zuerst da
 * ist.
 *
 * `submitMessage()` liefert laut `customElement.d.ts` ein `Promise<void>`, das
 * bei einem Dienstfehler ABLEHNT. Das haben wir bisher weggeworfen: der 429
 * tauchte dadurch nur als unbehandelte Rejection an unserer Aufrufstelle in der
 * Konsole auf, die Wartelogik sah ihn nie, und der Lauf zog mit einer leeren
 * Antwort weiter. Auf die Ereignisse `arcgisResponse` / `arcgisError` allein
 * ist kein Verlass - beim Fehler in der Intent-Erkennung feuert keines von
 * beiden.
 */
function sendeUndWarte(text) {
  const antwort = naechsteAntwort();
  const gesendet = assistant.submitMessage(text).then(
    // Angenommen: NICHT auflösen, sondern weiter auf das Antwortereignis warten.
    () => new Promise(() => {}),
    (err) => ({ error: err }),
  );
  return Promise.race([antwort, gesendet]).then((r) => {
    // Gewinnt der Fehler das Rennen, darf der Warter nicht stehenbleiben -
    // sonst fängt er die Antwort auf die NÄCHSTE Nachricht ab.
    if (r?.error) antwortWarter = null;
    return r;
  });
}

/**
 * Ist der Vorhabenkontext in diesem Lauf schon rausgegangen? Er gehört EINMAL
 * an den Anfang, nicht an jede Nachricht: die Historie geht bei jeder
 * Modellrunde ohnehin komplett mit, und der Dienst weist Anfragen unter Last
 * nach GRÖSSE ab ("exceeds the maximum usage size allowed during peak load").
 */
let kontextGesendet = false;

async function eineNachricht(auftrag) {
  const kontext = kontextGesendet
    ? ""
    : (previewDirty ? $("#screening-preview").value.trim() : baueKontextText()) + "\n\n";
  kontextGesendet = true;
  const text = `${kontext}${auftrag}\n${t("instr.langNote")}`;

  for (let versuch = 0; ; versuch += 1) {
    // Ohne diese Zeile ist im Nachhinein nicht zu unterscheiden, ob die
    // Wiederholung gar nicht gegriffen hat oder ob der Dienst sie ebenfalls
    // abgewiesen hat - beides sieht in der Konsole gleich aus.
    console.info(`[Screening] Nachricht raus (Versuch ${versuch + 1}, ${text.length} Zeichen).`);
    const antwort = await sendeUndWarte(text);
    if (antwort?.error === "abgebrochen") return antwort;

    // Der 429 kommt in mehreren Formen: als Antworttext, als
    // arcgisError-Ereignis, als abgelehntes Sende-Promise - und in der
    // haeufigsten Form GAR NICHT. Die Komponente faengt den Fehler selbst ab
    // (customElement.js), schreibt ihn in die Konsole und liefert eine LEERE
    // Antwort. Eine leere Antwort ist in diesem Ablauf nie ein gueltiges
    // Ergebnis - der Agent hat immer etwas zu melden -, deshalb zaehlt sie
    // hier als Dienstfehler.
    const inhalt = fehlertext(antwort);
    const leer = !antwort?.error && !String(antwort?.text ?? "").trim();
    if (!leer && !DIENST_FEHLER.test(inhalt)) return antwort;
    console.warn(
      leer
        ? "[Screening] Leere Antwort - der Dienst hat die Anfrage vermutlich abgewiesen."
        : "[Screening] Ratenbegrenzung erkannt in: " + inhalt.slice(0, 200),
    );

    // Ratenbegrenzung: warten und es noch einmal versuchen, statt den Lauf
    // sofort zu verlieren. Danach ist Schluss - weiterschicken macht es nur
    // schlimmer.
    if (versuch >= WARTEN_MS.length || !laufAktiv) {
      meldeSchritt({ name: "modell", status: "fehler", text: t("step.dienstUeberlastet") });
      return { error: "ratelimit", ratelimit: true, text: antwort?.text };
    }
    const warten = WARTEN_MS[versuch];
    console.warn(`[Screening] Modelldienst überlastet, neuer Versuch in ${warten / 1000} s.`);
    meldeSchritt({
      name: "modell",
      status: "laeuft",
      text: t("step.wartetAufModell", { s: Math.round(warten / 1000) }),
    });
    await new Promise((res) => setTimeout(res, warten));
    if (!laufAktiv) return { error: "abgebrochen" };
  }
}

async function runScreening() {
  if (!assistant || busy || !eingabenVollstaendig()) return;
  allesLeeren();
  kontextGesendet = false;
  zoomeAufVorhaben();
  setzePhaseLokal("screening");
  setzeBusy(true);
  laufAktiv = true;

  let fehler = false;
  let ueberlastet = false;
  // Phase 1: Region, relevante Kategorien, je eigene Untersuchungszone.
  const r1 = await eineNachricht(t("instr.phase1"));
  if (r1?.error) fehler = true;
  if (r1?.ratelimit) ueberlastet = true;

  // Nachfassen: Der Agent überspringt Kategorien, ohne sie zu melden - dann
  // steht am Ende "geprüft: 3 von 8" und niemand weiss, was mit den anderen
  // fünf ist. Statt darauf zu hoffen, dass der Prompt reicht, wird gezielt
  // nachgefragt - und zwar so lange, wie das noch etwas bewegt: eine einzige
  // Nachfrage hat in echten Läufen nur einen Teil der Lücken geschlossen.
  // Abbruch, sobald eine Runde nichts mehr verändert (MAX_NACHFASSEN als
  // Deckel), sonst dreht sich der Lauf im Kreis.
  // Ohne Planungsregion gibt es keinen Regionalplan - dann kann der Agent die
  // Kategorien gar nicht beurteilen, und Nachfassen schickt nur Nachrichten
  // hinterher, die nichts ändern können.
  if (!fehler && laufAktiv && getAnalyse().region?.name) {
    fehler = await nachfassenBis(
      fehlendeKategorien,
      (offen) => t("instr.nachfassen", { liste: offen.map((k) => `${k.titel} (${k.id})`).join(", ") }),
      (offen) => offen.map((k) => k.id),
      "Kategorien",
    );
  }

  // Plausibilitätsprüfung nach Phase 1. Die Unterscheidung "welchem Fachbereich
  // gehört das Vorhaben an" gegen "welche Belange berührt es" ist dem Modell
  // schon zweimal verrutscht - einmal kamen alle acht Kategorien relevant
  // zurück, einmal nur "Energie und technische Infrastruktur", weil eine
  // Windenergieanlage nun einmal Energieinfrastruktur IST. Der Prompt allein
  // hat das nicht gehalten, also prüft der Code das Ergebnis: ein
  // raumbedeutsames Vorhaben, das nur einen einzigen Belang berührt, ist
  // unplausibel.
  if (!fehler && laufAktiv) {
    const a = getAnalyse();
    if (a.relevanz.length <= 1 && a.nichtRelevant.length >= MIN_VERWORFEN_VERDACHT) {
      const verworfen = a.nichtRelevant
        .map((n) => kategorieTitel(n.kategorieId, getLang()))
        .join(", ");
      console.info("[Screening] Nur", a.relevanz.length, "relevante Kategorie(n) - frage nach.");
      await new Promise((res) => setTimeout(res, 200));
      const rp = await eineNachricht(
        t("instr.zuWenige", { n: a.relevanz.length, gesamt: KATEGORIEN.length, verworfen }),
      );
      if (rp?.error) fehler = true;
      if (rp?.ratelimit) ueberlastet = true;
    }
  }

  // Phase 2 nur, wenn Phase 1 überhaupt Kategorien geliefert hat.
  if (!fehler && laufAktiv && getAnalyse().relevanz.length > 0) {
    await new Promise((res) => setTimeout(res, 200));
    const auftrag = phase2Auftrag();
    console.info("[Screening] Phase-2-Auftrag:\n" + auftrag);
    const r2 = await eineNachricht(t("instr.phase2") + "\n" + auftrag);
    if (r2?.error) fehler = true;
  }

  // Zweites Nachfassen: das Modell fragt gern einen Layer je Kategorie ab und
  // lässt den Rest liegen - bei "Wald" die Bäume, aber nicht die
  // Vegetationsflächen. Auch das wird deterministisch geprüft, nicht erhofft,
  // und ebenfalls so lange wiederholt, wie es noch Layer schliesst.
  if (!fehler && laufAktiv && getAnalyse().abfragen.length > 0) {
    fehler = await nachfassenBis(
      offeneLayer,
      (offen) =>
        t("instr.nachfassenLayer", {
          liste: offen
            .map((o) => `${kategorieTitel(o.kategorieId, getLang())}: ${o.layer.join(", ")}`)
            .join(" | "),
        }),
      (offen) => offen,
      "offene Layer",
    );
  }

  laufAktiv = false;
  antwortWarter = null;
  setzePhaseLokal(fehler ? "fehler" : "fertig");

  // Erst jetzt in die Karte: waehrend des Laufs wuerde bei jeder Einzelabfrage
  // ein Layer aufpoppen und die Karte flackern.
  zeigeGefundeneObjekte();
  setzeLaufFertig(true);
  // Jetzt erst schwenken: waehrend des Laufs waere das ein Springen bei jeder
  // Einzelabfrage. Am Ende soll man sehen, was gefunden wurde - nicht das
  // Vorhaben allein.
  await zoomeAufTreffer();

  // Lauf beendet: sagen, WIE WEIT er kam, statt leer zu bleiben. Wichtig ist
  // die Unterscheidung zwischen "nichts gemeldet" (Fehler) und "geprüft und
  // nichts einschlägig" (gültiges Ergebnis) - das sah vorher gleich aus.
  const a = getAnalyse();
  const grund = letzterFehler();
  const geprueft = a.relevanz.length + a.nichtRelevant.length;

  // Ein überlasteter Modelldienst ist kein fachliches Ergebnis - und schon gar
  // keine fehlgeschlagene Regionsbestimmung. Das muss die Meldung sagen, sonst
  // sucht man den Fehler im Grenzlayer.
  if (ueberlastet) {
    setzeHinweis(t("an.dienstUeberlastet"));
  } else if (grund && !geprueft && !a.abfragen.length) {
    setzeHinweis(t("an.ohneErgebnisFehler", { grund }));
  } else if (!geprueft && !a.abfragen.length) {
    setzeHinweis(a.region?.name ? t("an.ohneErgebnisKeineRelevanz") : t("an.ohneErgebnisKeineRegion"));
    if (!a.region?.name) {
      console.warn(
        "[Screening] Ohne Planungsregion: siehe die Zeile " +
          '"[tools] Planungsregion nicht bestimmbar" weiter oben - dort stehen die Felder ' +
          "und Namen, die der Grenzlayer tatsächlich liefert.",
      );
    }
  } else if (!a.relevanz.length) {
    // Kein Fehler: der Agent hat Kategorien geprüft und alle verworfen.
    setzeHinweis(t("an.alleVerworfen", { n: a.nichtRelevant.length }));
  } else if (!a.abfragen.length) {
    setzeHinweis(
      t("an.ohnePhase2", { n: a.relevanz.length }) + (grund ? ` ${t("an.letzterFehler", { grund })}` : ""),
    );
  } else {
    setzeHinweis("");
  }
  console.info("[Screening] Lauf beendet:", {
    region: a.region?.name ?? null,
    relevant: a.relevanz.length,
    verworfen: a.nichtRelevant.length,
    abfragen: a.abfragen.length,
    objekte: a.abfragen.reduce((n, x) => n + x.anzahl, 0),
    letzterFehler: grund ?? null,
  });

  setzeBusy(false);
  ergebnisButtons();
}

$("#screening-btn").addEventListener("click", () => {
  runScreening().catch((err) => {
    console.error("[Screening] Lauf fehlgeschlagen:", err);
    laufAktiv = false;
    antwortWarter = null;
    setzePhaseLokal("fehler");
    setzeBusy(false);
  });
});

// --- Panels ziehen ---
function machResizable(panelSel, griffSel, seite) {
  const panel = $(panelSel);
  const griff = $(griffSel);
  if (!panel || !griff) return;
  let aktiv = false;
  griff.addEventListener("pointerdown", (e) => {
    aktiv = true;
    griff.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
  });
  griff.addEventListener("pointermove", (e) => {
    if (!aktiv) return;
    const breite = seite === "rechts" ? window.innerWidth - e.clientX : e.clientX;
    panel.style.width = Math.min(760, Math.max(280, breite)) + "px";
  });
  const ende = (e) => {
    aktiv = false;
    griff.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = "";
  };
  griff.addEventListener("pointerup", ende);
  griff.addEventListener("pointercancel", ende);
}
machResizable("#right-panel", "#rp-resizer", "rechts");
machResizable("#left-panel", "#lp-resizer", "links");

// --- Sprachwechsel ---
onLang(() => {
  applyStatic();
  renderTypGrid();
  if (vorhabenId) {
    setzeVorhabenArt(vorhabenTitel(vorhabenId, getLang()));
    setzeVorhabenLabel(vorhabenTitel(vorhabenId, getLang()));
  }
  aktualisierePreview();
  renderKoordLabel();
  renderGeomStatus(vorhaben.geometrie);
  renderFortschritt(letzterSnap);
  renderAuth(aktuellerNutzer);
  aktualisiereButtons();
  ergebnisButtons();
});
applyStatic();
aktualisiereButtons();
ergebnisButtons();

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
