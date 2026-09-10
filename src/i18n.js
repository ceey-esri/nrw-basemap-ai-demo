// Kleiner Sprach-Umschalter (Deutsch / Englisch).
//
// - t(key, vars)      -> übersetzter String der aktiven Sprache
// - getLang / setLang / toggleLang / onLang
// - applyStatic(root) -> setzt Text/Placeholder/Title für [data-i18n*]-Elemente

const STORAGE_KEY = "gp-screening-lang";

const DICT = {
  de: {
    "brand.name": "Räumliches Erstscreening",
    "lang.toggle": "EN",
    "lang.toggleTitle": "Switch to English",

    "auth.signedOut": "Nicht angemeldet",
    "auth.signedInAs": "Angemeldet als {name}",
    "auth.signIn": "Anmelden",
    "auth.signOut": "Abmelden",

    "step1.title": "Vorhabenart wählen",
    "step2.title": "Geometrie zeichnen",
    "step1.commentPh": "Ergänzende Hinweise zum Vorhaben (optional).",
    "geom.none": "Keine Geometrie gezeichnet.",
    "geom.line": "Trasse gezeichnet, {m} m lang.",
    "geom.area": "Fläche gezeichnet, {ha} ha.",

    "import.shapefile": "Shapefile hochladen",
    "import.shapefileHilfe":
      "Den Ordner wählen, in dem die .shp liegt - .shx, .dbf und .prj werden " +
      "automatisch mitgenommen.",
    "import.koordinaten": "Koordinaten eingeben",
    "import.setzen": "Setzen",
    "import.geladen": "{name} ({n} Geometrie(n))",
    "import.entfernen": "Datei entfernen",
    "import.laeuft": "Datei wird gelesen ...",
    "import.koordOk": "Punkt gesetzt: {x} / {y} ({sr})",
    "import.koordFehler": "Eingabe passt nicht zum gewählten Format. Beispiel: {beispiel}",

    "preview.summary": "Nachricht an den Assistenten (bearbeitbar)",
    "btn.screening": "Screening starten",

    "hint.prefix": "Noch offen: ",
    "hint.signIn": "anmelden (oben rechts)",
    "hint.type": "Vorhabenart wählen",
    "hint.geom": "Geometrie in die Karte zeichnen",


    "progress.title": "Ablauf",

    "results.title": "Ergebnis",
    "btn.pdf": "PDF",

    "kpi.region": "Planungsregion",
    "kpi.vorhaben": "Vorhabenart",
    "kpi.mass": "Ausdehnung",
    "kpi.laengeVorhaben": "Länge",
    "kpi.flaecheVorhaben": "Fläche",

    "an.relevante": "Themen im Detail",
    "an.abgeschlossen": "Screening abgeschlossen.",
    "an.nichtRelevant": "Themen ohne relevante Objekte",
    "an.ungeprueft": "Nicht betrachtet:",
    "an.ohneEinstufung": "Recherchiert, aber nicht eingestuft:",
    "an.ohneEinstufungKurz": "{n} ohne Einstufung",
    "an.ungeprueftKurz": "{n} nicht betrachtet",
    "an.zumPlan": "Regionalplan öffnen",
    "an.objekte": "{n} Objekte",
    "an.ohneObjekteListe": "Geprüft, keine Objekte im Umfeld:",
    "an.alleZeigen": "Alle Objekte zeigen",
    "an.nurDieserLayer": "Karte auf diesen Layer beschränken (erneut klicken: aufheben)",
    "an.dienstUeberlastet":
      "Der Modelldienst von ArcGIS ist derzeit überlastet (HTTP 429) und hat die Anfrage abgewiesen - auch nach mehreren Versuchen. Das ist kein Fehler der Eingaben: bitte in einigen Minuten erneut starten.",
    "step.dienstUeberlastet": "Modelldienst überlastet (429) - abgebrochen",
    "step.wartetAufModell": "Modelldienst überlastet - neuer Versuch in {s} s",
    "an.layer": "Abgefragte Layer",
    "an.aufteilung": "Aufteilung nach Attributwert",
    "an.weitere": "Weitere ({n})",
    "an.segmentFiltern": "Karte auf diese Ausprägung filtern (erneut klicken: aufheben)",
    "an.keineAufteilungAusdruck":
      "Keine Aufteilung - die Webkarte symbolisiert über einen Arcade-Ausdruck, dem sich " +
      "kein einzelnes Attribut zuordnen lässt.",
    "an.keineAufteilungKeinFeld":
      "Keine Aufteilung - dieser Layer führt im Untersuchungsraum kein Attribut, das " +
      "die Objekte in Klassen teilt (weder Symbolisierung noch Objektart oder Klasse).",
    "an.teilmengeKurz": "Fläche und Länge sind Mindestwerte, die Anzahl ist exakt.",
    "an.teilmenge": "Teilmessung",
    "an.grundlagen": "Herangezogene Grundlagen",
    "an.keineFundstellen": "Noch keine Fundstellen abgerufen.",
    "an.schliessen": "Schließen",
    "an.geltenderPlan": "Regionalplan",
    "an.zuordnung": "Zuordnung über",
    "an.passagenRp": "Passagen aus dem Regionalplan",
    "an.passagenGesetz": "Passagen aus dem Gesetzeskorpus",
    "an.stand": "Stand:",
    "an.quelle": "Quelle",
    "an.umfeld": "Umfeld",
    "an.layerAus": "Layer ausblenden",
    "an.layerEin": "Layer einblenden",
    "an.zoneZeigen": "Zone in der Karte zeigen",
    "an.fundstelleRp": "Regionalplan",
    "an.fundstelleGesetz": "Fachrecht",
    "an.leer": "Noch kein Screening gelaufen.",
    "an.ohneErgebnisKeineRegion":
      "Der Lauf ist beendet, aber die Planungsregion konnte nicht bestimmt werden - " +
      "damit fehlt die Grundlage für Regionalplan und Kategorien. Details in der " +
      "Browser-Konsole unter [Schritt].",
    "an.ohneErgebnisKeineRelevanz":
      "Der Lauf ist beendet, aber es wurde gar keine Kategorie gemeldet - weder als relevant " +
      "noch als geprüft und verworfen. Details in der Browser-Konsole unter [Schritt].",
    "an.alleVerworfen":
      "Kein Thema als relevant eingestuft. {n} Kategorien wurden geprüft und mit Begründung " +
      "verworfen - siehe unten.",
    "an.ohneErgebnisFehler": "Der Lauf ist beendet, ohne Ergebnis. Letzter Fehler: {grund}",
    "an.ohnePhase2":
      "Phase 1 hat {n} relevante Themen geliefert, Phase 2 aber keine Objekte ermittelt. " +
      "Der Lauf wurde also vorzeitig beendet - Zwischenschritte in der Browser-Konsole.",
    "an.letzterFehler": "Letzter Fehler: {grund}",

    "fp.what": "Was ist das?",
    "fp.why": "Warum betrachtet?",
    "fp.object": "Kartenobjekt",
    "fp.pending": "Wird im Screening eingeordnet.",

    "map.showLayers": "Layerübersicht",
    "map.bookmarks": "Lesezeichen",
    "map.measure": "Messen (Strecke und Fläche)",
    "map.measureLine": "Strecke",
    "map.measureArea": "Fläche",
    "map.measureClear": "Messungen löschen",
    "map.basemaps": "Grundkarte wechseln",
    "map.geomDelete": "Alle Geometrieangaben löschen",
    "resizer.title": "Breite ziehen",

    "assistant.heading": "Screening-Assistent",
    "assistant.entry": "Interne Engine. Steuerung über die Buttons links.",

    "instr.auftrag":
      "Führe ein räumliches Erstscreening für das folgende raumbedeutsame Vorhaben durch. " +
      "Adressat ist die Raumordnungsbehörde: sie muss wissen, welcher Raum betroffen ist, " +
      "welche raumordnerischen Themen berührt sein könnten und was vertieft zu prüfen ist. " +
      "Stütze jede Einstufung auf den geltenden Regionalplan und das einschlägige Fachrecht.",
    "instr.type": "Vorhabenart",
    "instr.beschreibung": "Worum es dabei geht",
    "instr.geometrie": "Gezeichnete Geometrie",
    "instr.geomPunkt": "Punkt (Standort)",
    "instr.geomLinie": "Trasse als Linie, {m} m lang",
    "instr.geomFlaeche": "Fläche, {ha} ha gross",
    "instr.geomKeine": "noch keine",
    "instr.typeNone": "(nicht gewählt)",
    "instr.comment": "Nutzerkommentar",
    "instr.commentNone": "(keiner)",
    "instr.phase1":
      "PHASE 1 (Relevanz): Bestimme die Planungsregion und den geltenden Regionalplan. Ermittle " +
      "dann, welche Kategorien für dieses Vorhaben relevant sind, und melde jede davon mit " +
      "Begründung, Fundstellen und einem EIGENEN, fachlich hergeleiteten Untersuchungsradius. " +
      "Jede geprüfte, aber nicht einschlägige Kategorie meldest du ebenfalls - mit einem Satz " +
      "Begründung. Keine geprüfte Kategorie bleibt ohne Meldung. Noch keine Layer abfragen.",
    "instr.zuWenige":
      "PRÜFE DEINE EINSTUFUNG NOCH EINMAL: Du hast nur {n} von {gesamt} Kategorien als relevant " +
      "gemeldet und diese verworfen: {verworfen}. Für ein raumbedeutsames Vorhaben ist das " +
      "unplausibel. Der häufigste Grund: Du hast gefragt, zu welchem Fachbereich das VORHABEN " +
      "gehört - eine Windenergieanlage ist Energieinfrastruktur, eine Straße ist Verkehr. " +
      "Gefragt ist aber, welche FREMDEN Belange das Vorhaben berührt: Abstände zur Siedlung, " +
      "Artenschutz, Rodung und Zuwegung im Wald, Flächeninanspruchnahme in der Landwirtschaft, " +
      "Sichtbeziehungen in der Kulturlandschaft. Geh die verworfenen Kategorien durch und rufe " +
      "für jede, die das Vorhaben doch berühren kann, meldeRelevanz auf. Bleibt eine zu Recht " +
      "verworfen, lass sie stehen. Noch keine Layer abfragen.",
    "instr.nachfassen":
      "NACHFASSEN zu Phase 1: Zu diesen Kategorien fehlt noch eine Meldung: {liste}. " +
      "Recherchiere jede davon mit recherchiere und melde sie anschließend - entweder mit " +
      "meldeRelevanz oder mit meldeNichtRelevant. Keine Kategorie darf ohne Meldung bleiben. " +
      "Noch keine Layer abfragen.",
    "instr.phase2Liste":
      "Diese {n} Kategorien wurden in Phase 1 als relevant gemeldet. Frage für JEDE davon die " +
      "genannten Layer mit queryLayer ab - die Untersuchungszone ist bereits angelegt, du " +
      "musst nichts puffern:",
    "instr.phase2":
      "PHASE 2 (Objekte): Ermittle für jede zuvor als relevant gemeldete Kategorie die " +
      "Objekte im Untersuchungsraum und fasse das Ergebnis zusammen.",
    "instr.nachfassenLayer":
      "NACHFASSEN zu Phase 2: Zu diesen relevanten Kategorien passen weitere Layer, die du " +
      "noch nicht abgefragt hast: {liste}. Prüfe jeden davon mit beschreibeLayer und frage " +
      "ihn mit queryLayer ab. Ist ein Layer fachlich wirklich nicht einschlägig, sag das " +
      "ausdrücklich - aber übergehe ihn nicht stillschweigend. Danach fasseZusammen erneut " +
      "aufrufen, damit die Zahlen stimmen.",
    "instr.langNote": "Antworte auf Deutsch.",
  },

  en: {
    "brand.name": "Spatial Initial Screening",
    "lang.toggle": "DE",
    "lang.toggleTitle": "Zu Deutsch wechseln",

    "auth.signedOut": "Not signed in",
    "auth.signedInAs": "Signed in as {name}",
    "auth.signIn": "Sign in",
    "auth.signOut": "Sign out",

    "step1.title": "Choose project type",
    "step2.title": "Draw geometry",
    "step1.commentPh": "Additional notes about the project (optional).",
    "geom.none": "No geometry drawn.",
    "geom.line": "Corridor drawn, {m} m long.",
    "geom.area": "Area drawn, {ha} ha.",

    "import.shapefile": "Upload shapefile",
    "import.shapefileHilfe":
      "Choose the folder containing the .shp - .shx, .dbf and .prj come along automatically.",
    "import.koordinaten": "Enter coordinates",
    "import.koordFelder": "Coordinates ({felder})",
    "import.setzen": "Set",
    "import.geladen": "{name} ({n} geometry/geometries)",
    "import.entfernen": "Remove file",
    "import.laeuft": "Reading file ...",
    "import.koordOk": "Point set: {x} / {y} ({sr})",
    "import.koordFehler": "Input does not match the selected format. Example: {beispiel}",

    "preview.summary": "Message sent to the assistant (editable)",
    "btn.screening": "Start screening",

    "hint.prefix": "Still open: ",
    "hint.signIn": "sign in (top right)",
    "hint.type": "choose a project type",
    "hint.geom": "draw the geometry on the map",


    "progress.title": "Process",

    "results.title": "Result",
    "btn.pdf": "PDF",

    "kpi.region": "Planning region",
    "kpi.vorhaben": "Project type",
    "kpi.mass": "Extent",
    "kpi.laengeVorhaben": "Length",
    "kpi.flaecheVorhaben": "Area",

    "an.relevante": "Themes in detail",
    "an.abgeschlossen": "Screening complete.",
    "an.nichtRelevant": "Themes without relevant objects",
    "an.ungeprueft": "Not examined:",
    "an.ohneEinstufung": "Researched but not classified:",
    "an.ohneEinstufungKurz": "{n} unclassified",
    "an.ungeprueftKurz": "{n} not examined",
    "an.zumPlan": "Open regional plan",
    "an.objekte": "{n} objects",
    "an.ohneObjekteListe": "Checked, no objects in the surroundings:",
    "an.alleZeigen": "Show all objects",
    "an.nurDieserLayer": "Limit the map to this layer (click again to clear)",
    "an.dienstUeberlastet":
      "The ArcGIS model service is currently overloaded (HTTP 429) and rejected the request, even after several attempts. This is not a problem with your input - please try again in a few minutes.",
    "step.dienstUeberlastet": "Model service overloaded (429) - aborted",
    "step.wartetAufModell": "Model service overloaded - retrying in {s} s",
    "an.layer": "Layers queried",
    "an.aufteilung": "Breakdown by attribute value",
    "an.weitere": "Other ({n})",
    "an.segmentFiltern": "Filter the map to this value (click again to clear)",
    "an.keineAufteilungAusdruck":
      "No breakdown - the web map symbolises via an Arcade expression that maps to no single " +
      "attribute.",
    "an.keineAufteilungKeinFeld":
      "No breakdown - within the study area this layer carries no attribute that groups its " +
      "objects into classes (neither symbology nor object type or class).",
    "an.teilmengeKurz": "Area and length are lower bounds; the count is exact.",
    "an.teilmenge": "partial",
    "an.grundlagen": "Sources consulted",
    "an.keineFundstellen": "No passages retrieved yet.",
    "an.schliessen": "Close",
    "an.geltenderPlan": "Regional plan",
    "an.zuordnung": "Matched via",
    "an.passagenRp": "Passages from the regional plan",
    "an.passagenGesetz": "Passages from the legal corpus",
    "an.stand": "As of:",
    "an.quelle": "Source",
    "an.umfeld": "Nearby",
    "an.layerAus": "Hide layer",
    "an.layerEin": "Show layer",
    "an.zoneZeigen": "Show zone on the map",
    "an.fundstelleRp": "Regional plan",
    "an.fundstelleGesetz": "Sectoral law",
    "an.leer": "No screening run yet.",
    "an.ohneErgebnisKeineRegion":
      "The run finished, but the planning region could not be determined - without it there is " +
      "no basis for the regional plan or the themes. See the browser console under [Schritt].",
    "an.ohneErgebnisKeineRelevanz":
      "The run finished, but no category was reported at all - neither as relevant nor as " +
      "checked and dismissed. See the browser console under [Schritt].",
    "an.alleVerworfen":
      "No theme assessed as relevant. {n} categories were checked and dismissed with reasons - " +
      "see below.",
    "an.ohneErgebnisFehler": "The run finished without a result. Last error: {grund}",
    "an.ohnePhase2":
      "Phase 1 returned {n} relevant themes, but phase 2 found no objects - the run ended " +
      "early. Intermediate steps are in the browser console.",
    "an.letzterFehler": "Last error: {grund}",

    "fp.what": "What is this?",
    "fp.why": "Why considered?",
    "fp.object": "Map object",
    "fp.pending": "To be classified in the screening.",

    "map.showLayers": "Layer list",
    "map.bookmarks": "Bookmarks",
    "map.measure": "Measure (distance and area)",
    "map.measureLine": "Distance",
    "map.measureArea": "Area",
    "map.measureClear": "Clear measurements",
    "map.basemaps": "Change basemap",
    "map.geomDelete": "Clear all geometry",
    "resizer.title": "Drag to resize",

    "assistant.heading": "Screening assistant",
    "assistant.entry": "Internal engine. Controlled via the buttons on the left.",

    "instr.auftrag":
      "Carry out a spatial pre-screening for the following spatially significant project. " +
      "The audience is the regional planning authority: it needs to know which area is " +
      "affected, which spatial planning themes may be touched and what requires closer " +
      "examination. Base every assessment on the applicable regional plan and sectoral law.",
    "instr.type": "Project type",
    "instr.beschreibung": "What it involves",
    "instr.geometrie": "Geometry drawn",
    "instr.geomPunkt": "point (location)",
    "instr.geomLinie": "corridor as a line, {m} m long",
    "instr.geomFlaeche": "area of {ha} ha",
    "instr.geomKeine": "none yet",
    "instr.typeNone": "(not chosen)",
    "instr.comment": "User comment",
    "instr.commentNone": "(none)",
    "instr.phase1":
      "PHASE 1 (relevance): determine the planning region and the applicable regional plan. Then " +
      "identify which themes are relevant for this project and report each with reasoning, " +
      "sources and its OWN substantiated study radius. Also report every category you checked " +
      "but dismissed, with one sentence of reasoning. No checked category is left unreported. " +
      "Do not query any layers yet.",
    "instr.zuWenige":
      "RE-CHECK YOUR CLASSIFICATION: you reported only {n} of {gesamt} categories as relevant " +
      "and dismissed these: {verworfen}. For a spatially significant project that is implausible. " +
      "The usual cause: you asked which sector the PROJECT belongs to - a wind turbine is energy " +
      "infrastructure, a road is transport. The question is which OTHER concerns the project " +
      "affects: setbacks from settlements, species protection, clearing and access roads in " +
      "forests, land take in agriculture, visual relationships in the cultural landscape. Go " +
      "through the dismissed categories and call meldeRelevanz for each one the project can " +
      "affect after all. Leave rightly dismissed ones as they are. Do not query layers yet.",
    "instr.nachfassen":
      "FOLLOW-UP to phase 1: these categories are still unreported: {liste}. Research each one " +
      "with recherchiere and then report it - either with meldeRelevanz or meldeNichtRelevant. " +
      "No category may remain unreported. Do not query any layers yet.",
    "instr.phase2Liste":
      "These {n} categories were reported as relevant in phase 1. Query the listed layers for " +
      "EACH of them with queryLayer - the study zone already exists, you do not need to buffer:",
    "instr.phase2":
      "PHASE 2 (objects): for every theme reported as relevant, determine the objects within the " +
      "study area and summarise the result.",
    "instr.nachfassenLayer":
      "FOLLOW-UP to phase 2: these relevant categories have further matching layers you have " +
      "not queried yet: {liste}. Inspect each with beschreibeLayer and query it with " +
      "queryLayer. If a layer genuinely does not apply, say so explicitly - do not skip it " +
      "silently. Then call fasseZusammen again so the figures are correct.",
    "instr.langNote": "Respond in English.",
  },
};

let lang = "de";
try {
  const g = localStorage.getItem(STORAGE_KEY);
  if (g === "de" || g === "en") lang = g;
} catch {
  /* kein Storage */
}

const listeners = new Set();

export function getLang() {
  return lang;
}

export function setLang(l) {
  if (l !== "de" && l !== "en") return;
  lang = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  applyStatic();
  listeners.forEach((fn) => fn(l));
}

export function toggleLang() {
  setLang(lang === "de" ? "en" : "de");
}

export function onLang(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars) {
  let s = DICT[lang]?.[key] ?? DICT.de[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
}
