// Vorauswahl der Kriterien je Vorhaben-Typ (einfache, feste Zuordnung –
// später kann das stattdessen vom AI Assistant vorgeschlagen werden)
const defaultCriteriaByType = {
  versorgungsanlage: ["Gewässerflächen", "Versorgungsleitungen und Transportanlagen", "Naturdenkmäler"],
  verkehrsflaeche: ["Punktförmige historische Bauwerke und Einrichtungen", "Flächenhafte Verwaltungsgebiete"],
  siedlungsflaeche: ["Naturdenkmäler", "Gewässerflächen", "Punktförmige historische Bauwerke und Einrichtungen"],
};

const PRUEFRADIUS_METER = 100;

let letzterKlickpunkt = null;
let markerLayer = null;

// Vorhaben-Typ ändert die Kriterien-Vorauswahl
function updateCriteriaFromVorhaben() {
  const typ = document.getElementById("vorhaben-typ").value;
  const preset = defaultCriteriaByType[typ] || [];
  document.querySelectorAll("#criteria-panel input[type=checkbox]").forEach((checkbox) => {
    checkbox.checked = preset.includes(checkbox.dataset.layer);
  });
}

document.getElementById("vorhaben-typ").addEventListener("change", updateCriteriaFromVorhaben);
updateCriteriaFromVorhaben(); // beim Laden einmal ausführen

// Karte initialisieren, sobald sie bereit ist
async function initMapInteraction() {
  // Kurz warten, falls das Karten-Setup-Skript in index.html noch nicht fertig ist
  let versuche = 0;
  while (!window.__mapEl && versuche < 20) {
    await new Promise((r) => setTimeout(r, 100));
    versuche++;
  }

  const mapEl = window.__mapEl;
  if (!mapEl) {
    console.error("Karte wurde nicht gefunden (window.__mapEl ist leer). Bitte Seite neu laden.");
    return;
  }

  await mapEl.viewOnReady();
  console.log("Karte ist bereit – Klicks sollten jetzt funktionieren.");

  const [GraphicsLayer, Graphic] = await $arcgis.import([
    "esri/layers/GraphicsLayer",
    "esri/Graphic",
  ]);
  markerLayer = new GraphicsLayer({ title: "Prüfpunkt" });
  mapEl.map.add(markerLayer);

  mapEl.addEventListener("arcgisViewClick", async (event) => {
    letzterKlickpunkt = event.detail.mapPoint;
    console.log("Klick registriert:", letzterKlickpunkt);

    // Vorherigen Marker entfernen, neuen setzen
    markerLayer.removeAll();
    const markerGraphic = new Graphic({
      geometry: letzterKlickpunkt,
      symbol: {
        type: "simple-marker",
        color: [226, 75, 74],
        size: 12,
        outline: { color: [255, 255, 255], width: 2 },
      },
    });
    markerLayer.add(markerGraphic);

    setResultsHint(`Punkt gesetzt (${letzterKlickpunkt.longitude.toFixed(4)}, ${letzterKlickpunkt.latitude.toFixed(4)}). Jetzt "Prüfung starten" klicken.`);
  });

  document.getElementById("run-check-btn").addEventListener("click", () => {
    if (!letzterKlickpunkt) {
      setResultsHint("Bitte zuerst einen Punkt auf der Karte setzen.");
      return;
    }
    runCheck(mapEl, letzterKlickpunkt);
  });
}

function setResultsHint(text) {
  document.getElementById("results-list").innerHTML = `<p class="hint">${text}</p>`;
}

async function runCheck(mapEl, punkt) {
  setResultsHint("Prüfung läuft …");

  const [geometryEngineAsync] = await $arcgis.import(["esri/geometry/geometryEngineAsync"]);
  const buffer = await geometryEngineAsync.geodesicBuffer(punkt, PRUEFRADIUS_METER, "meters");

  const aktiveLayerNamen = [...document.querySelectorAll("#criteria-panel input[type=checkbox]:checked")]
    .map((el) => el.dataset.layer);

  if (aktiveLayerNamen.length === 0) {
    setResultsHint("Bitte mindestens ein Kriterium auswählen.");
    return;
  }

  const alleLayer = mapEl.map.allLayers;
  const ergebnisse = [];

  for (const layerName of aktiveLayerNamen) {
    const layer = alleLayer.find((l) => l.title === layerName);

    if (!layer) {
      ergebnisse.push({ name: layerName, status: "unbekannt", detail: "Layer nicht in der Webmap gefunden." });
      continue;
    }

    try {
      if (!layer.queryFeatures) {
        // z.B. Gruppen-Layer oder Basemap-Layer ohne Query-Fähigkeit
        continue;
      }
      const query = layer.createQuery();
      query.geometry = buffer;
      query.spatialRelationship = "intersects";
      query.outFields = ["*"];
      query.returnGeometry = false;

      const result = await layer.queryFeatures(query);
      const anzahl = result.features.length;

      ergebnisse.push({
        name: layerName,
        status: anzahl > 0 ? "rot" : "gruen",
        detail: anzahl > 0
          ? `${anzahl} Objekt(e) im Prüfradius von ${PRUEFRADIUS_METER} m gefunden.`
          : `Kein Objekt im Prüfradius von ${PRUEFRADIUS_METER} m.`,
      });
    } catch (err) {
      console.error(`Fehler beim Abfragen von "${layerName}":`, err);
      ergebnisse.push({ name: layerName, status: "unbekannt", detail: "Abfrage fehlgeschlagen (siehe Konsole)." });
    }
  }

  renderResults(ergebnisse);
}

function renderResults(ergebnisse) {
  const container = document.getElementById("results-list");
  container.innerHTML = "";

  const statusClass = { rot: "status-red", gelb: "status-yellow", gruen: "status-green", unbekannt: "status-yellow" };

  for (const ergebnis of ergebnisse) {
    const card = document.createElement("div");
    card.className = `result-card ${statusClass[ergebnis.status] || "status-yellow"}`;
    card.innerHTML = `
      <div><span class="status-dot"></span><span class="layer-name">${ergebnis.name}</span></div>
      <div class="detail">${ergebnis.detail}</div>
    `;
    container.appendChild(card);
  }

  if (ergebnisse.length === 0) {
    setResultsHint("Keine Ergebnisse.");
  }
}

initMapInteraction();