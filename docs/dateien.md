# Welche Datei was macht

Stand 21.10.2026. Ergaenzt CLAUDE.md um die reine Datei-Sicht.

## Frontend

| Datei | Aufgabe |
|---|---|
| `index.html` | Topbar, Steuerpanel links, Karte, Ergebnispanel rechts. Enthaelt den off-screen `#assistant-slot` und die beiden Prompt-Felder. |
| `app.js` | Verdrahtung und Ablaufsteuerung: Vorhabenauswahl, Import, Startnachricht, `runScreening()` (zwei Nachrichten an den Assistenten), Fortschritt, Feature-Popup, Panel-Resizing, Sprachwechsel. |
| `style.css` | Design-System (Stahlblau `#2b4c7e`, Papier-Grau, Inter) und alle Panel-Stile. |
| `vite.config.js` | Port 5173 fest (OAuth-Redirect-URI) plus Plugin, das den RAG-Server mitstartet. |
| `src/config.js` | `PORTAL_URL`, `WEBMAP_ID`, `APP_ID`, `MODEL_TIER`, `RAG_URL`. |
| `src/i18n.js` | DE/EN-Umschalter, alle UI-Texte und die Phasenauftraege an den Agenten. |
| `src/oauth.js` | ArcGIS-OAuth (`OAuthInfo` + `IdentityManager`). |
| `src/karte.js` | `<arcgis-map>` samt Widgets und Sketch; Vorhabengeometrie, Zonen (`zeichneZone` / `zeigeZone`), Treffergrafiken, `zeigeLayerGefiltert` (Filter per `definitionExpression`), Feature-Klick. |
| `src/import.js` | Shapefile-ZIP ueber den Portal-Endpunkt `features/generate`, Koordinateneingabe. |

## Screening

| Datei | Aufgabe |
|---|---|
| `src/screening/agents.js` | `SCREENING_PROMPT` und `initAgents()`: baut den Hauptagenten, haengt ihn als `<arcgis-assistant-agent>` an, meldet die Werkzeugkette an den Fortschritt, setzt `recursionLimit` auf 120. |
| `src/screening/tools.js` | Die **fuenf** Werkzeuge des Hauptagenten: `holeVorhabenKontext`, `bestimmeRegion`, `meldeRelevanz`, `meldeNichtRelevant`, `fasseZusammen`. Ausserdem die Werkzeuge, die den Subagenten gehoeren (`beschreibeLayer`, `queryLayer`, die drei RAG-Werkzeuge), die Radiuspruefung `radiusBelegt()`, die Zahlenpruefung `unbelegteZahlen()` und die Fortschritts-Middleware. |
| `src/screening/subagenten.js` | **Vier** Subagenten hinter **drei** Werkzeugen: `klaereBelange` (BelangeAgent), `recherchiere` (Regionalplan + Gesetz, parallel per `Promise.all`, mit Cache je Kategorie und Vorhaben), `pruefeKategorie` (LayerAgent, je Kategorie ein Lauf). |
| `src/screening/agentlauf.js` | Die gemeinsame Lauf-Mechanik der Subagenten: `graphVon()` kompiliert den Graphen mit eigenem `MemorySaver` (die Checkpointer-Reparatur), `laufen()` ruft ihn mit eigener `thread_id`, `frage()` holt den Kurzbefund und erkennt Dienstfehler. Eigenes Modul, damit `tools.js` und `subagenten.js` keinen Importzyklus bilden. |
| `src/screening/bericht.js` | Der BerichtAgent und `formuliereBericht()`. Wird aus `fasseZusammen` in `tools.js` gerufen — der einzige Weg zum Abschlusstext. |
| `src/screening/kategorien.js` | Katalog der 8 Kategorien mit Rechtsrahmen, Fachgesetzen, RAG-Suchtexten und `layerMuster`. Hergeleitet aus den Festlegungskapiteln nach § 7 ROG. |
| `src/screening/vorhaben.js` | Die 6 Vorhabenarten mit Beschreibung und ueblicher Geometrie. |
| `src/screening/regionen.js` | Kreis → Planungsregion → geltender Regionalplan (Spiegel von `rag/regionalplaene.py`). |
| `src/screening/kontext.js` | Vorhabenart und Nutzerkommentar, damit `holeVorhabenKontext` nicht ins DOM greifen muss. |
| `src/screening/analyse.js` | Ergebnis-Store und Darstellung: Kennzahlen, die eine Themenliste mit Leitzahl und Attribut-Aufschluesselung, Grundlagen unten. |
| `src/screening/rag.js` | Fundstellen-Store, getrennt nach `regionalplan:`, `gesetz:`, `anker:` (die Ankernormen) und `belange:`. |
| `src/screening/fortschritt.js` | Schritt- und Phasen-Bus; protokolliert jeden Schritt in die Konsole. |
| `src/screening/pdf.js` | jsPDF-Export inklusive Aufschluesselung und Fundstellen im Wortlaut. |

## RAG

| Datei | Aufgabe |
|---|---|
| `rag/server.py` | FastAPI auf :8000. `POST /rechtsgrundlage`, `POST /regionalplan`, `/health`. Retrieval-only. |
| `rag/korpus.py` | Katalog der Gesetzes-PDFs und ihrer Rechtsgebiete. |
| `rag/regionalplaene.py` | Die 7 Planungsregionen, 53 Kreise, Katalog der Plan-PDFs. |
| `rag/ingest.py` | Ingest des Gesetzeskorpus in die Collection `rechtsgrundlagen`. |
| `rag/ingest_rp.py` | Ingest der Regionalplaene in `regionalplaene`; Marker-Chunking mit Seiten-Fallback. |

## Dokumentation und Werkzeuge

| Datei | Aufgabe |
|---|---|
| `CLAUDE.md` | Die inhaltliche Referenz: jede Entscheidung mit Begruendung und Messwert. Trotz des Namens werkzeugunabhaengig. |
| `.github/copilot-instructions.md` | Einstieg fuer GitHub Copilot: die fuenf Regeln, die am meisten sparen, plus Verweise. |
| `docs/UEBERGABE.md` | Projektstand, offene Punkte, wie man startet, was wo liegt. |
| `docs/dateien.md` | Diese Datei. |
| `.claude/skills/arcgis-js-api/SKILL.md` | SDK-Arbeitsregeln im Detail: welche `.d.ts` fuer welche Frage. |
| `docs/pruefungen/*.mjs` | Drei eigenstaendige Node-Skripte fuer die drei Pruefungen, die einmal falsch positiv waren. Ohne Abhaengigkeiten, Exit 0 = gruen. |
| `docs/grafiken/` | Generatoren fuer die beiden Schaubilder (Python bzw. HTML, Ausgabe PNG ueber Chrome headless). |
| `docs/praesentation/` | Vier eigenstaendige HTML-Seiten: technische Uebersicht, Sprechzettel, Projektbilanz, StoryMap-Textbausteine. |

## Entfallen

Ampelscreening, Pruefbereiche, Fach-Agenten, Scoping-Vermerk, Field-Maps-Uebergabe,
CSV-Export. Die zugehoerigen Dateien (`ergebnis.js`, `pruefbereiche.js`, `tasks.js`,
`export.js`) sind geloescht.
