// Vorauswahl der Kriterien je Vorhaben-Typ (einfache, feste Zuordnung –
// später kann das stattdessen vom AI Assistant vorgeschlagen werden)
const defaultCriteriaByType = {
  versorgungsanlage: ["Gewässerflächen", "Versorgungsleitungen und Transportanlagen", "Naturdenkmäler"],
  verkehrsflaeche: ["Punktförmige historische Bauwerke und Einrichtungen", "Flächenhafte Verwaltungsgebiete"],
  siedlungsflaeche: ["Naturdenkmäler", "Gewässerflächen", "Punktförmige historische Bauwerke und Einrichtungen"],
};

const PRUEFRADIUS_METER = 100;

let selectedVorhabenTyp = null;
let selectedGeometryType = null;
let letzteEingabegeometrie = null;
let sketchViewModel = null;
let sketchLayer = null;
let aktuelleErgebnisse = []; // für PDF/Mail-Export gemerkt

// --- Vorhaben-Typ-Auswahl (Buttons statt Dropdown) ---
document.querySelectorAll("#vorhaben-auswahl .option-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#vorhaben-auswahl .option-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedVorhabenTyp = btn.dataset.vorhaben;
    updateCriteriaFromVorhaben();
  });
});

function updateCriteriaFromVorhaben() {
  const preset = defaultCriteriaByType[selectedVorhabenTyp] || [];
  document.querySelectorAll("#criteria-panel-section input, .panel-section input[type=checkbox]").forEach((checkbox) => {
    if (checkbox.dataset.layer) {
      checkbox.checked = preset.includes(checkbox.dataset.layer);
    }
  });
}

// --- Geometrie-Typ-Auswahl (Punkt / Linie / Fläche) ---
document.querySelectorAll("#geometrie-auswahl .option-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#geometrie-auswahl .option-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedGeometryType = btn.dataset.geometrie;

    if (sketchViewModel) {
      sketchLayer.removeAll();
      letzteEingabegeometrie = null;
      document.getElementById("run-check-btn").disabled = true;
      document.getElementById("geometrie-hint").textContent = "Jetzt auf der Karte zeichnen …";
      sketchViewModel.create(selectedGeometryType);
    }
  });
});

// --- Karte initialisieren ---
async function initMapInteraction() {
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
  console.log("Karte ist bereit.");

  const [GraphicsLayer, SketchViewModel] = await $arcgis.import([
    "esri/layers/GraphicsLayer",
    "esri/widgets/Sketch/SketchViewModel",
  ]);

  sketchLayer = new GraphicsLayer({ title: "Eingabegeometrie" });
  mapEl.map.add(sketchLayer);

  sketchViewModel = new SketchViewModel({
    view: mapEl.view,
    layer: sketchLayer,
    pointSymbol: {
      type: "simple-marker",
      color: [226, 75, 74],
      size: 12,
      outline: { color: [255, 255, 255], width: 2 },
    },
    polylineSymbol: {
      type: "simple-line",
      color: [226, 75, 74],
      width: 3,
    },
    polygonSymbol: {
      type: "simple-fill",
      color: [226, 75, 74, 0.3],
      outline: { color: [226, 75, 74], width: 2 },
    },
  });

  sketchViewModel.on("create", (event) => {
    console.log("Sketch create event, state:", event.state);
    if (event.state === "complete") {
      letzteEingabegeometrie = event.graphic.geometry;
      document.getElementById("run-check-btn").disabled = false;
      document.getElementById("geometrie-hint").textContent = "Geometrie gesetzt. Kriterien wählen und Prüfung starten.";
    }
  });

  document.getElementById("run-check-btn").addEventListener("click", () => {
    if (!letzteEingabegeometrie) {
      setResultsHint("Bitte zuerst eine Geometrie auf der Karte zeichnen.");
      return;
    }
    runCheck(mapEl, letzteEingabegeometrie);
  });

  document.getElementById("pdf-btn").addEventListener("click", () => erstellePdfBericht());
  document.getElementById("mail-btn").addEventListener("click", () => sendePerMail());
}

function setResultsHint(text) {
  document.getElementById("results-list").innerHTML = `<p class="hint">${text}</p>`;
}

// --- Prüfung durchführen ---
async function runCheck(mapEl, geometrie) {
  setResultsHint("Prüfung läuft …");
  document.getElementById("export-buttons").hidden = true;

  const [geometryEngine] = await $arcgis.import(["esri/geometry/geometryEngine"]);
  const buffer = geometryEngine.geodesicBuffer(geometrie, PRUEFRADIUS_METER, "meters");

  const aktiveLayerNamen = [...document.querySelectorAll(".panel-section input[type=checkbox]:checked")]
    .map((el) => el.dataset.layer)
    .filter(Boolean);

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

    // Layer vor der neuen Prüfung zurücksetzen
    layer.definitionExpression = null;
    layer.visible = false;

    try {
      if (!layer.queryFeatures) continue;
      await layer.load();

      const query = layer.createQuery();
      query.geometry = buffer;
      query.spatialRelationship = "intersects";
      query.outFields = ["*"];
      query.returnGeometry = false;

      const result = await layer.queryFeatures(query);
      const anzahl = result.features.length;

      if (anzahl > 0) {
        // Nur die relevanten (gefundenen) Features einblenden
        const idField = layer.objectIdField;
        const ids = result.features.map((f) => f.attributes[idField]);
        layer.definitionExpression = `${idField} IN (${ids.join(",")})`;
        layer.visible = true;
      }

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

  aktuelleErgebnisse = ergebnisse;
  renderResults(ergebnisse);

  if (ergebnisse.length > 0) {
    document.getElementById("export-buttons").hidden = false;
  }
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

// --- PDF-Bericht erstellen ---
function erstellePdfBericht() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const vorhabenLabel = document.querySelector("#vorhaben-auswahl .option-btn.active")?.textContent || "Kein Vorhaben ausgewählt";

  doc.setFontSize(16);
  doc.text("Genehmigungseinschätzung – NRW Basemap Konfliktprüfung", 14, 18);

  doc.setFontSize(11);
  doc.text(`Vorhaben: ${vorhabenLabel}`, 14, 30);
  doc.text(`Erstellt am: ${new Date().toLocaleString("de-DE")}`, 14, 37);
  doc.text(`Prüfradius: ${PRUEFRADIUS_METER} m`, 14, 44);

  let y = 56;
  doc.setFontSize(13);
  doc.text("Ergebnisse:", 14, y);
  y += 8;

  doc.setFontSize(11);
  for (const ergebnis of aktuelleErgebnisse) {
    const ampel = ergebnis.status === "rot" ? "[KRITISCH]" : ergebnis.status === "gruen" ? "[OK]" : "[UNBEKANNT]";
    doc.text(`${ampel} ${ergebnis.name}`, 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.text(ergebnis.detail, 18, y);
    doc.setFontSize(11);
    y += 10;

    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  }

  doc.save("nrw-basemap-genehmigungseinschaetzung.pdf");
}

// --- Per Mail senden (Entwurf, PDF muss aktuell noch manuell angehängt werden) ---
function sendePerMail() {
  erstellePdfBericht(); // löst gleichzeitig den PDF-Download aus

  const vorhabenLabel = document.querySelector("#vorhaben-auswahl .option-btn.active")?.textContent || "Vorhaben";
  const zeilen = aktuelleErgebnisse.map((e) => {
    const ampel = e.status === "rot" ? "KRITISCH" : e.status === "gruen" ? "OK" : "UNBEKANNT";
    return `- ${e.name}: ${ampel} (${e.detail})`;
  });

  const betreff = encodeURIComponent(`Genehmigungseinschätzung: ${vorhabenLabel}`);
  const body = encodeURIComponent(
    `Genehmigungseinschätzung für: ${vorhabenLabel}\n\n${zeilen.join("\n")}\n\nBitte das soeben heruntergeladene PDF an diese E-Mail anhängen.`
  );

  window.location.href = `mailto:?subject=${betreff}&body=${body}`;
}

initMapInteraction();