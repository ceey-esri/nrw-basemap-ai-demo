# Genehmigungs-Screening / GP Tool Assistant — Projektkontext

Diese Datei wird von Claude Code automatisch gelesen. Sie fasst zusammen,
was in vorbereitenden Gesprächen (außerhalb dieser Session) bereits
entschieden wurde, damit du nicht bei null anfängst.

## Projektziel

KI-gestützte ArcGIS-Web-Anwendung für ein **fachübergreifendes
Genehmigungs-Screening** bei Bauanträgen und Bauleitplanung. Nutzer
zeichnen einen Vorhabenumring auf der Karte, stellen in normaler Sprache
einen Prüfauftrag; die App ermittelt automatisch die Betroffenheit und
liefert zu jedem Fund das einschlägige Verfahren, den konkreten Antrag
(Ausnahme / Erlaubnis / Befreiung), die zuständige Behörde, den
Paragraphen als Beleg sowie einen Scoping-Vermerk-Entwurf.

Der **Naturschutz bleibt das Kernthema** (Eingriffsregelung,
Artenschutz, Schutzgebiete, FFH-Vorprüfung, Biotope, Baumbestand,
Eingriffsbilanz, UVP-Vorprüfung). Die App screent das Vorhaben aber
bewusst ganzheitlich: Alle Genehmigungstatbestände, die sich aus den
vorhandenen Geodaten ableiten lassen, werden in einem Durchlauf
mitgeprüft — Denkmalschutz, Wasserrecht, Leitungsrecht, Verkehr /
Erschließung, Bodenschutz / Altlasten, Bauordnungsrecht (Abstandsflächen)
und Waldrecht (siehe Abschnitt "Weitere Prüfbereiche").

Das vollständige Konzept (Abschnitte 1–5: Anwenderperspektive, technische
Umsetzung, weitere Genehmigungsprüfungen, Umgang mit fehlenden Daten,
KI-Mehrwert) wurde vom Nutzer im Chat geliefert; die Kernpunkte stehen in
dieser Datei.

**Wichtig:** Das ist ein Screening-/Scoping-Beschleuniger, kein Ersatz
für ein Fachgutachten. Das Tool liefert Hypothesen und ein Mengengerüst
über alle betrachteten Rechtsgebiete, keine rechtssicheren
Artbestimmungen und keine abschließende behördliche Prüfung.

## Bereits getroffene Architekturentscheidungen

1. **Frontend-KI läuft über `@arcgis/ai-components` (SDK 5.1, Beta)**,
   konkret `<arcgis-assistant>` + eigene Custom Agents.
2. **Custom Agents = `LLMAgent` / `WorkflowAgent`** (nicht `FunctionAgent`
   mit eigenem Ollama-Backend). Begründung: Der Entwicklungsrechner ist zu
   langsam für brauchbare lokale Modell-Performance (Qwen2.5 7B war zu
   lahm). Läuft über Esris gehostete Modelle (`modelTier:
   "fast"/"default"/"advanced"`) und kostet dafür ArcGIS-Credits — das ist
   akzeptiert und gewollt.
   **Hybrid-Architektur** (`src/screening/agents.js`), registriert an die
   `<arcgis-assistant>`:
   - **1 Koordinator** `GesamtScreeningAgent` — prüft in einem Durchlauf
     alle Rechtsgebiete + Synthese-Schritt schreibt den Scoping-Vermerk.
     Technisch `WorkflowAgent` über `SequentialWorkflow([...8 Fach-Agenten,
     SyntheseAgent])`. **Fallback** (bei WorkflowAgent-Problemen): ein
     einzelner kombinierter `LLMAgent` mit gleichem Namen/Beschreibung.
   - **8 Fach-Agenten** (je Prüfbereich aus `pruefbereiche.js`) — `LLMAgent`
     mit auf dieses eine Rechtsgebiet **gebundenen** Tools
     (`baueTools(bereichId)`); für gezielte Einzel-/Nachfragen. Der
     Orchestrator des Assistenten routet nach `description`.
   - `<arcgis-assistant-agent>`-Elemente müssen als Kinder der
     `<arcgis-assistant>` hängen, **bevor** sie in den DOM kommt — sonst
     „No agents found." (Race: Orchestrator-Init vs. asynchrone
     Agent-Registrierung). Deshalb baut `app.js` alles an der losgelösten
     Komponente auf und hängt sie erst dann ein.
3. **Eigene Tools bleiben eigene Logik**, unabhängig vom Modell. Umgesetzt
   als `FunctionTool` (`@arcgis/ai-components/agent-utils`) in
   `src/screening/tools.js`:
   - `puffer` — deterministisch, `geometryEngine.geodesicBuffer()` (sync,
     wegen Web-Worker-Problem kein `*Async`), läuft im Browser ✅
   - `queryLayer` — `@arcgis/core` FeatureLayer-Query gegen die Layer der
     Webmap (Layer-Zuordnung per Titel-Teilstring aus `pruefbereiche.js`).
     Nutzt das ArcGIS-OAuth-Token über den IdentityManager automatisch,
     kein eigener Server nötig ✅ (Abweichung von der ursprünglichen
     Entscheidung `@esri/arcgis-rest-feature-service` — bewusst, weil
     `@arcgis/core` die Auth transparent mitbringt; das REST-Paket bleibt
     als Option in `package.json`.)
   - `meldeBefund` — schreibt Ergebnis + Ampel in `src/screening/ergebnis.js`
     (Befund-Liste + Scoping-Vermerk-Entwurf) ✅
   - `erfrageFehlendeDaten` — prüft, ob der Layer eines Prüfbereichs in
     der Karte liegt; liefert sonst eine konkrete Nutzerfrage ✅
   - `holeBisherigeBefunde` / `schreibeVermerk` — für den Synthese-Schritt:
     Befunde auslesen bzw. den fertigen Vermerk-Text ins Feld schreiben
     (`setzeVermerkText` friert die automatische Vermerk-Erzeugung ein) ✅
   - `holeRechtsgrundlage` — **STUB**: gibt derzeit den Platzhaltertext aus
     `pruefbereiche.js` zurück. Braucht das RAG-Backend (siehe unten).
   - `bilanziereEingriff` — **STUB**: liefert nur die Vorhabenfläche.
   `baueTools(bereichId)`: ohne Argument generisch (Parameter `pruefbereichId`),
   mit Argument fest an ein Rechtsgebiet gebunden (Parameter entfällt).
4. **npm/Vite ist Pflicht, kein CDN.** Grund: Esris Doku sagt explizit,
   dass eigene Agents nur über den npm-Weg (`@arcgis/ai-components`)
   gebaut werden können; die CDN-Variante erlaubt nur die fertigen
   Esri-Agenten (Navigation, Data Exploration, Help).
5. **Das RAG-Backend für `holeRechtsgrundlage` muss noch gebaut werden.**
   Das frühere Python-Vorwerk (`api.py`, `ask_tool.py`, `embeddings.py`,
   `chroma_db/` …) war ein Ollama/Qwen-Test aus einem anderen Projekt
   (`llm_test`) und wurde **entfernt**. Neu aufzusetzen: Vektor-Store +
   Embedding + gechunkter, fachübergreifender Gesetzeskorpus (BNatSchG /
   LNatSchG NRW, DSchG NRW, WHG / LWG NRW, BauO NRW, LFoG NRW, BBodSchG,
   StrWG NRW / FStrG). Anbindung über das `holeRechtsgrundlage`-Tool.

## Weitere Prüfbereiche (jenseits des Naturschutzes)

Diese Prüfungen fügen sich strukturell exakt in die bestehende Pipeline
ein — sie erweitern nur, welche Layer `queryLayer`/`puffer` abfragen und
welchen Rechtskorpus `holeRechtsgrundlage` durchsucht.

1. **Denkmalschutz / Bodendenkmalpflege** — Layer: Historische Bauwerke
   (Fläche/Linie/Punkt). Prüfung: Vorhaben in/nahe historischem Bauwerk
   oder Bodendenkmal? → denkmalrechtliche Erlaubnis nach DSchG NRW, ggf.
   Beteiligung LWL-/LVR-Denkmalpflege. Analog zum Naturschutz: Pufferung
   + Abfrage + RAG-Retrieval.
2. **Wasserrecht** — Layer: Gewässerpunkte, -linien, -flächen. Prüfung:
   Abstand zu Gewässern (Gewässerrandstreifen § 38 WHG / LWG NRW), Bauen
   im Überschwemmungsgebiet, wasserrechtliche Erlaubnis bei
   Grundwasserabsenkung/Einleitung. Überschwemmungsgebiets-Kulisse ist
   nicht im Basis-DLM enthalten, extern über LANUV ergänzbar.
3. **Leitungs- und Infrastrukturrecht** — Layer: Versorgungsleitungen und
   Transportanlagen, Pumpen. Prüfung: Kreuzt das Vorhaben Ver-/Entsorgungs-
   leitungen? → Leitungsrechte, Zustimmung des Leitungsträgers,
   Schutzstreifen-Verletzung; auch relevant für die Erschließung.
4. **Verkehrsrecht / Erschließung** — Layer: Verkehrspunkte, -wege,
   -flächen. Prüfung: Anbindung ans Straßennetz, straßenrechtliche
   Sondernutzung bei Zufahrten, Abstandsflächen / Anbauverbotszonen zu
   klassifizierten Straßen nach StrWG NRW / FStrG.
5. **Bodenschutz / Altlasten** — Layer: Reliefformen (Reliefflächen,
   Reliefobjekte) + optional externes Altlastenkataster. Prüfung:
   Erhebliche Reliefveränderungen (Abgrabung/Aufschüttung) →
   bodenschutzrechtliche Anzeige nach BBodSchG; mit Altlastenverdachts-
   flächen kombiniert Hinweis auf Sanierungspflichten.
6. **Bauordnungsrecht — Abstandsflächen & Nachbarrecht** — Layer:
   Punktförmige Bauwerke und Einrichtungen. Prüfung: automatisierte
   Abstandsflächenberechnung zur Nachbarbebauung nach BauO NRW — rein
   geometrische Pufferoperation, kein KI-Bedarf.
7. **Waldrecht** — Layer: Laub- und Nadelbäume, Vegetationsflächen (mit
   Flächengröße/-zusammenhang). Prüfung: Wald i. S. d. LFoG NRW
   (zusammenhängende Fläche ≥ 0,1 ha)? → Waldumwandlungsgenehmigung statt
   "nur" Baumfällgenehmigung — eigener, strengerer Tatbestand mit
   Ersatzaufforstungspflicht.
8. **Nutzungskonflikte / Sonstiges** — Layer: Linienhafte Barrieren und
   Absperrungen, Flächen weiterer Nutzung. Prüfung: bestehende
   Nutzungsbeschränkungen oder Einfriedungen im Vorhabenbereich, die vor
   Baubeginn zu klären sind.

Der Scoping-Vermerk listet dadurch fachübergreifend alle ausgelösten
Verfahren auf, nicht nur die naturschutzrechtlichen.

## Umgang mit fehlenden Datensätzen

- `erfrageFehlendeDaten` stellt vor/während eines Prüfschritts fest, ob
  die nötige Datengrundlage im Hosted Feature Layer bzw. den Services
  vorhanden ist.
- Fehlt ein Datensatz, weist das Modell im Reasoning-Stream konkret
  darauf hin und fragt aktiv nach (Upload, Service-URL, Layer-Auswahl).
- Die Aufforderung kann jederzeit übersprungen werden — das Screening
  läuft ohne Unterbrechung weiter. Der betroffene Prüfpunkt wird dann im
  Ergebnis und im Vermerk klar als **"nicht geprüft, Datengrundlage
  fehlt"** gekennzeichnet, nicht als unauffällig.
- Beim Massenscreening wird die Abfrage pro Datensatztyp nur einmal
  gestellt, nicht pro Flurstück.

## Projektstruktur (nach dem Neuaufbau)

Der einzige übernommene Baustein aus dem Vorgängerstand ist der
**ArcGIS-OAuth-Login** (funktioniert). Alles andere war Test-Code
(Ollama/Qwen, PDF-Indexierung) und wurde entfernt und durch das
Screening-Konzept ersetzt. Umbauprotokoll: `docs/umbau-2026-08-27.md`.

```
index.html                     Layout: Topbar + Steuerpanel + Karte + Assistent/Ergebnis
app.js                         Einstiegspunkt, verdrahtet nur die Module
style.css
oauth-callback.html            unverändert übernommen
src/config.js                  PORTAL_URL, WEBMAP_ID, APP_ID, MODEL_TIER
src/oauth.js                   OAuth (übernommener, funktionierender Stand)
src/karte.js                   <arcgis-map> + Suche/Layerliste/Sketch; `vorhaben`-Store
src/screening/pruefbereiche.js Katalog der 8 Prüfbereiche (Layer, Puffer, Recht, Behörde)
src/screening/tools.js         FunctionTools; baueTools(bereichId?) + baueSyntheseTools()
                               (puffer, queryLayer, meldeBefund, erfrageFehlendeDaten,
                               holeBisherigeBefunde, schreibeVermerk,
                               holeRechtsgrundlage*, bilanziereEingriff*)
src/screening/agents.js        initAgents(): 1 Koordinator (WorkflowAgent, Fallback LLMAgent)
                               + 8 Fach-Agenten, je als <arcgis-assistant-agent>
src/screening/ergebnis.js      Befund-Liste (Ampel) + Scoping-Vermerk (auto + setzeVermerkText)
                               (* = Stub)
```

Widgets werden per `slot`-Attribut in `<arcgis-map>` platziert
(`slot="top-right"` etc.) — so wie es im Vorgängerstand funktioniert hat.
Karten-Assets von `@arcgis/core`/`@arcgis/map-components` kommen per
Default vom Esri-CDN (kein Vite-Asset-Copy nötig). `npm run dev` /
`npm run build` (Vite). Build läuft grün.

## Feedback-Umsetzung (Batches)

Nutzer-Feedback nach der ersten Multi-Agent-Version — Abarbeitung in Batches:

- **Batch 1 (erledigt, Build grün, Browser-Test offen):**
  - Sketch: Freihand-Polygon an, nur `polygon`/`freehandPolygon`/`rectangle`
    (`karte.js`).
  - Puffergröße + Begründung: `pufferBegruendung` je Prüfbereich
    (`pruefbereiche.js`); `meldeBefund` hängt `pufferMeter` +
    `pufferBegruendung` automatisch an den Befund; erscheint in Karte,
    Vermerk, PDF.
  - Befund-Karte anklicken → `karte.js:zoomeZuTreffer()` zoomt auf die
    Treffer-Grafiken des Rechtsgebiets und lässt sie gelb blinken
    (`trefferProBereich`-Registry, Grafiken via `zeichneAnalyse(…, id)`).
  - PDF-Übersicht: `src/screening/pdf.js` (jsPDF), Button `#pdf-btn`.
- **Batch 2 (erledigt, Build grün, Browser-Test offen):**
  - `beschreibeLayer`-Tool (Layer/Felder/Domänen/Beispielwerte);
    `queryLayer` mit `layerTitel`- und `where`-Parameter. `erfrageFehlendeDaten`
    nur noch nach `beschreibeLayer`. Grund: „Datengrundlage fehlt" kam zu
    oft — Infos stecken als Attribut in allgemeineren Layern.
  - Vorhabentyp-`<select>` im linken Panel; `src/screening/kontext.js` +
    Tool `holeVorhabenKontext` (Typ + angehakte Bereiche + Umring/Fläche).
  - **TriageAgent** (eigener registrierter Agent): begründet, welche
    Rechtsgebiete relevant sind, ruft `setzePruefbereiche` (hakt die
    Checkliste), fragt nach Bestätigung. Danach „Screening starten" →
    Koordinator. Fach-Agenten überspringen sich selbst, wenn ihre id
    nicht in `angehakktePruefbereiche` steht.
- **Batch 3 (Code erledigt, wartet auf Layer-Freigabe + Browser-Test):**
  - `src/screening/tasks.js` — Warteschlange offener Prüfpunkte;
    `merkePruefpunkt`-Tool (fach-gebunden), `erzeugeTasks`-Tool (Koordinator,
    am Ende). `schreibePruefpunkte()` lädt den FeatureLayer, projiziert den
    Vorhaben-Zentroid in dessen SR, schreibt per `applyEdits` — **defensiv**:
    nur Felder, die der Layer wirklich hat (case-insensitiv).
  - Layer-URL in `src/config.js` (`PRUEFPUNKTE_LAYER_URL`).
  - Field-Maps-Pflichtfelder `esritask_type` (Code 0 = „Vor-Ort-Klärung"),
    `esritask_assignee`, `esritask_status` (0 = nicht zugewiesen). Tool
    schreibt `esritask_status = 0`, `esritask_type = 0`.
  - Fachfelder: `prioritaet` **INTEGER** (1=hoch, 2=mittel, 3=niedrig),
    `rechtsgebiet`, `pruefgrund`, `beschreibung`, `empfehlung`, `vorhaben_id`,
    `vorhaben_typ`, `quelle`, `erstellt_am`.
  - **Offen beim Nutzer:** Prüfpunkte-Layer mit dem App-Login-Nutzer mit
    Bearbeitungsrecht teilen; sonst schlägt `applyEdits` fehl (Tool gibt
    den Fehler zurück).
- **RAG-Konzept:** Entwurf besprochen (Dokumente, Ablage `rag/`, Chunking
  pro §-Absatz, Mapping-Tabelle, LanceDB/Chroma, Backend-Endpoint). Noch
  nicht als `docs/rag-konzept.md` festgehalten.

## Offene Baustellen / nicht verifiziert

- **`holeRechtsgrundlage` + `bilanziereEingriff` sind Stubs.** RAG-Backend
  und Tabulate-Intersection-Bilanz fehlen noch komplett.
- **Layer-Zuordnung ist geraten.** `pruefbereiche.js` matcht Layer über
  Titel-Teilstrings; der echte Layer-Bestand der Sandbox-Webmap
  (`WEBMAP_ID`) ist nicht verifiziert. Fehlende Layer meldet
  `erfrageFehlendeDaten` transparent — nicht stillschweigend übergehen.
- **Rechtsgrundlagen-Texte in `pruefbereiche.js` sind Platzhalter**
  (Präfix `PLATZHALTER:`), juristisch nicht geprüft.
- Nicht verifiziert: ob `LLMAgent`-Aufrufe über `@arcgis/ai-components`
  Credits verbrauchen und wie viele — vor Massenscreening im
  ArcGIS-Developer-Dashboard (Usage) prüfen.
- Der Prüfbereich-Checkliste im linken Panel fehlt noch die Verdrahtung
  zum Koordinator (aktuell rein informativ; `aktivePruefbereiche()` in
  `app.js` wird exportiert, aber der Koordinator prüft immer alle 8).
- **Multi-Agent-Verhalten nur im Build geprüft, nicht im Browser.** Offen:
  ob `SequentialWorkflow` über 8 `LLMAgent`s + Synthese sauber läuft (u.a.
  ob die Nutzer-Nachricht durchgereicht wird, State-Merge). Bei Problemen
  greift der `LLMAgent`-Fallback im Koordinator — siehe Konsole
  (`[Screening] WorkflowAgent-Koordinator nicht verfügbar ...`).
- `<arcgis-assistant>` wird per JS erzeugt (ohne `referenceElement` —
  Custom-Agenten brauchen den Webmap-Kontext nicht, das spart die
  Embeddings-/Schreibrechte-Abhängigkeit). Assistent wird erst nach
  erfolgreichem Login aufgebaut.
- Der Assistant-Orchestrator wählt pro Nutzer-Nachricht **einen** Agent.
  „Prüfe alles" muss also beim Koordinator landen — hängt an dessen
  `description` vs. denen der 8 Fach-Agenten. Ggf. Prompt/Descriptions
  nachschärfen, wenn falsch geroutet wird.

## Arbeitsweise / Präferenzen

- Vor dem Löschen bestehender Business-Logik nachfragen statt anzunehmen,
  dass sie nicht mehr gebraucht wird.
- Bei mehrdeutigem Projektstand nachfragen statt zu raten.
- Deutsch als Sprache für UI-Texte, Code-Kommentare und Doku (Umlaute im
  Code bewusst vermieden — ASCII-Schreibweise in JS-Strings/Kommentaren).
