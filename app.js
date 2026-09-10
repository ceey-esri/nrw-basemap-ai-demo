// Einstiegspunkt. Verdrahtet OAuth, Karte, Pruefbereich-Liste, Ergebnis-Panel
// und den Screening-Assistenten.
//
// Die gesamte Fachlogik liegt in src/ - diese Datei orchestriert nur.

import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/main.css";
import "@arcgis/ai-components/main.css";

import { initAuth } from "./src/oauth.js";
import { initKarte, vorhaben, umringLoeschen, analyseLeeren } from "./src/karte.js";
import { PRUEFBEREICHE } from "./src/screening/pruefbereiche.js";
import { initErgebnis, befundeLeeren, onBefundeChange, getBefunde } from "./src/screening/ergebnis.js";
import { initAgents } from "./src/screening/agents.js";
import { erzeugePdf } from "./src/screening/pdf.js";
import { initKontext } from "./src/screening/kontext.js";
import { leerePruefpunkte } from "./src/screening/tasks.js";

const $ = (sel) => document.querySelector(sel);

// --- Pruefbereich-Checkliste (rein informativ im Funktionsgeruest) ---
const listeEl = $("#pruefbereich-liste");
listeEl.innerHTML = PRUEFBEREICHE.map(
  (p) => `
    <label title="${p.beschreibung}">
      <input type="checkbox" value="${p.id}" checked />
      ${p.titel}${p.kiNoetig ? "" : " <span class=\"hint\">(Geometrie)</span>"}
    </label>`,
).join("");

/** IDs der aktuell angehakten Pruefbereiche. */
export function aktivePruefbereiche() {
  return [...listeEl.querySelectorAll("input:checked")].map((i) => i.value);
}

/** Setzt die Haken auf die uebergebene Id-Liste (Triage-Ergebnis). */
function setzePruefbereiche(ids) {
  const soll = new Set(ids);
  listeEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = soll.has(cb.value);
  });
}

// --- Vorhaben-Kontext fuer die Agenten ---
initKontext({
  getVorhabenTyp: () => $("#vorhaben-typ").value,
  getAktivePruefbereiche: aktivePruefbereiche,
  setzePruefbereiche,
});

// --- Ergebnis-Panel ---
initErgebnis($("#results"), $("#vermerk"));

$("#vermerk-copy-btn").addEventListener("click", async () => {
  const text = $("#vermerk").value;
  if (text) await navigator.clipboard.writeText(text);
});

// --- PDF-Uebersicht ---
const pdfBtn = $("#pdf-btn");
onBefundeChange((befunde) => {
  pdfBtn.disabled = befunde.length === 0;
});
pdfBtn.addEventListener("click", () => {
  if (getBefunde().length === 0) return;
  erzeugePdf({
    vermerkText: $("#vermerk").value,
    vorhabenTyp: $("#vorhaben-typ").value,
  });
});

// --- Umring-Status ---
vorhaben.onChange((geom) => {
  $("#umring-status").textContent = geom
    ? "Umring gezeichnet - Screening kann gestartet werden."
    : "Kein Umring gezeichnet.";
});
$("#umring-loeschen-btn").addEventListener("click", () => {
  umringLoeschen();
  analyseLeeren();
  befundeLeeren();
  leerePruefpunkte();
});

// --- Karte ---
await initKarte($("#map-container"));

// --- OAuth (bestehender, funktionierender Stand) ---
// Der Assistent wird ERST nach erfolgreicher Anmeldung aufgebaut: der
// Orchestrator und die gehosteten Modelle brauchen ein gueltiges
// Portal-Token, sonst bleibt das Eingabefeld im Ladezustand haengen.
let assistantAufgebaut = false;

initAuth($("#login-btn"), $("#login-status"), (username) => {
  if (username && !assistantAufgebaut) {
    assistantAufgebaut = true;
    baueAssistent().catch((err) => {
      console.error("[Screening] Assistent-Aufbau fehlgeschlagen:", err);
      $("#assistant-slot").innerHTML =
        '<p class="hint" style="padding:12px">Assistent konnte nicht geladen werden - siehe Konsole.</p>';
    });
  }
});

$("#assistant-slot").innerHTML =
  '<p class="hint" style="padding:12px">Bitte oben anmelden, dann wird der Screening-Assistent geladen.</p>';

async function baueAssistent() {
  const assistant = document.createElement("arcgis-assistant");
  assistant.heading = "Genehmigungs-Screening";
  assistant.entryMessage =
    "Vorhabentyp waehlen, Vorhabenumring in die Karte zeichnen. Dann hier: " +
    "erst 'Welche Rechtsgebiete sind relevant?' (Triage mit Begruendung), " +
    "danach 'Screening starten'. Ergebnis: Ampel-Befunde, Scoping-Vermerk, " +
    "Field-Maps-Aufgaben fuer die offenen Punkte.";
  assistant.suggestedPrompts = [
    "Welche Rechtsgebiete sind fuer dieses Vorhaben relevant?",
    "Screening starten",
    "Denkmalschutz fuer diesen Umring noch einmal pruefen",
  ];

  // WICHTIG: Die Agenten muessen als Kinder der <arcgis-assistant> haengen,
  // BEVOR sie in den DOM kommt. Sonst gewinnt der Orchestrator-Init des
  // Assistenten das Rennen gegen die (asynchrone) Agent-Registrierung und
  // die Komponente bleibt dauerhaft auf "No agents found." stehen.
  await initAgents(assistant);

  $("#assistant-slot").innerHTML = "";
  $("#assistant-slot").appendChild(assistant);
  console.info("[Screening] Assistent + Custom-Agent registriert.");
}
