# Übergabe

Stand 21.10.2026. Was du wissen musst, um an diesem Projekt weiterzuarbeiten —
ergänzt `CLAUDE.md` (die inhaltliche Referenz) und `docs/dateien.md` (die
Datei-Sicht) um das, was sonst nur im Kopf stand.

---

## 1. Zuerst: der Projektstand

### Die Umgebung starten

```bash
npm run dev
```

Startet Vite auf **5173** und über ein Vite-Plugin das RAG-Backend auf **8000**.

**Voraussetzungen, die leicht übersehen werden:**

- **Ollama muss laufen**, Port 11434, Modell `embeddinggemma`. Ohne das liefert
  das RAG keine Treffer und das Screening läuft ins Leere, ohne zu meckern.
- **Port 5173 ist fest** — er steht in der OAuth-Redirect-URI der registrierten
  App. Ein anderer Port bricht die Anmeldung.
- Das Python-venv liegt in `rag/.venv`. Wenn das RAG nicht startet, zuerst dort
  nachsehen.

Prüfen, ob beides steht:

```bash
curl -s -o /dev/null -w "Vite %{http_code}\n" http://localhost:5173/
curl -s -o /dev/null -w "RAG  %{http_code}\n" http://localhost:8000/docs
```

### Was funktioniert, im echten Lauf bestätigt

- Anmeldung, Kartenaufbau, Zeichnen, beide Phasen durchgehend
- **Alle sechs Agenten** laufen — 17 Subagentenläufe ohne Fehler im Log vom
  11.10., LayerAgent für alle acht Kategorien, BerichtAgent dreimal
- Der Wald kommt über § 39 LFoG NRW als BELEGT zurück (die Lücke, für die die
  Ankernormen gebaut wurden)
- Null Kachelfehler nach der Umstellung auf den LayerView-Filter (vorher 161)
- Die Mehrfachzuordnung hält: „Vegetationsflächen" wird je Kategorie korrekt
  gefiltert
- Regionszuordnung für Wuppertal → Düsseldorf, OWL, Metropole Ruhr
- Ringdiagramme mit Kartenfarben, PDF-Export

### Was nie getestet wurde

- **Shapefile-Import** über JSZip und die Koordinateneingabe in den
  projizierten Formaten
- Ob `regionAusSchluessel()` je greift — hängt an den Attributen des
  Grenzlayers
- Die **Retrievalqualität der Regionalpläne**. Drei Pläne laufen über den
  Seiten-Rückfall und liefern gröbere Fundstellen; der Plan Arnsberg TA
  Soest/HSK ist von 2012. Für Demos besser OWL, Ruhr, Köln oder Münsterland
  wählen.

---

## 2. Die drei Prüfungen in `docs/pruefungen/`

Drei eigenständige Node-Skripte, ohne Abhängigkeiten. Jedes sichert eine
Prüfung ab, die schon einmal **falsch positiv** war — also eine Falschaussage
erzeugt hat, statt sie zu verhindern.

```bash
node docs/pruefungen/radius.mjs          # 21 Fälle
node docs/pruefungen/berichtszahlen.mjs  # 11 Fälle
node docs/pruefungen/dienstfehler.mjs    # 17 Fälle
```

Exit-Code 0 = grün. Sie enthalten die Logik als Kopie, nicht als Import — wenn
du die Originale in `tools.js`, `app.js` oder `agentlauf.js` änderst, musst du
die Kopie nachziehen. Das ist bewusst: so laufen sie ohne Browser und ohne SDK.

| Skript | Sichert ab | Der Fehler, der dahintersteckt |
|---|---|---|
| `radius.mjs` | `radiusBelegt()` in `tools.js` | Meldete 5 von 8 Radien als belegt — belegt waren sie auf **Absatznummern**: „§ 35 Abs. **3** Nr. 1" bestätigte einen 3000-m-Radius. Ursache: die Kilometerform von 3000 ist eine nackte „3". |
| `berichtszahlen.mjs` | `unbelegteZahlen()` in `tools.js` | Prüft, dass jede Ziffernfolge im Berichtstext in den übergebenen Fakten steht. Fängt erfundene, gerundete und nachgerechnete Zahlen. **Bekannte Lücke:** „173 km" statt „1,73 km" hat dieselbe Ziffernfolge. |
| `dienstfehler.mjs` | `DIENST_FEHLER` in `app.js` **und** `agentlauf.js` | Das Muster suchte die bloße Zahl 429 und hielt **6 von 7** gültigen Fachantworten für einen Dienstfehler — „Vegetationsflächen: 429 Objekte" wurde verworfen. Beide Stellen müssen dasselbe Muster tragen. |

---

## 3. Die Grafiken in `docs/grafiken/`

Beide Schaubilder sind **generiert**, nicht gezeichnet. Quelle ist Python bzw.
HTML, Ausgabe ein PNG.

### Das große technische Schaubild

```bash
python docs/grafiken/schaubild.py     # baut das SVG in praesentation/uebersicht.html
python docs/grafiken/pruef_svg.py     # prüft: wohlgeformt, nichts außerhalb, Marker da
python docs/grafiken/render.py        # baut daraus eine eigenständige Renderseite
```

Dann als PNG rendern (Chrome headless, Pfade absolut):

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --hide-scrollbars --default-background-color=FFFFFFFF --force-device-scale-factor=3 \
  --window-size=1696,1158 \
  --screenshot="<abs>/tafel.png" "<abs>/docs/grafiken/tafel_render.html"
```

### Das einfache Agenten-Schaubild für die StoryMap

`docs/grafiken/agenten.html` ist eine eigenständige Seite mit dem SVG direkt
darin — einfach editieren und rendern:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --hide-scrollbars --default-background-color=F5F7FAFF --force-device-scale-factor=2.5 \
  --window-size=1240,790 \
  --screenshot="<abs>/Grafik-Agenten-StoryMap.png" "<abs>/docs/grafiken/agenten.html"
```

**Fallen beim Rendern:**

- Chrome braucht **absolute** Pfade. Relativ gibt es `ERR_NAME_NOT_RESOLVED`.
- `--default-background-color` ist RRGGBB**AA** — die Alpha-Stellen nicht
  vergessen.
- Das SVG arbeitet mit `currentColor`. In der Renderseite muss eine Farbe
  gesetzt sein, sonst wird alles schwarz auf transparent.

### Es gibt kein ImageMagick

`convert` auf diesem Rechner ist `C:\WINDOWS\system32\convert` — das
**Dateisystem**-Werkzeug (FAT→NTFS), nicht ImageMagick. Nicht aufrufen. Für
PNG→TIFF o. ä. geht PowerShell mit `System.Drawing`:

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("in.png")
$img.Save("out.tiff", [System.Drawing.Imaging.ImageFormat]::Tiff)
```

---

## 4. Die Präsentationsunterlagen in `docs/praesentation/`

Vier eigenständige HTML-Seiten. Sie waren als Artifacts auf claude.ai
veröffentlicht; die Quellen liegen jetzt hier, damit sie den Werkzeugwechsel
überleben.

| Datei | Wofür |
|---|---|
| `uebersicht.html` | Technische Übersicht „Wer macht wann was" — enthält das große Schaubild, die GP-Tools-Abgrenzung und den Abschnitt zu Ollama/ChromaDB |
| `sprechzettel.html` | Leitfaden für die technische Runde: Station für Station am Schaubild entlang, mit Sprechtext und den Rückfragen, die kommen |
| `projektbilanz.html` | Die vollständige Projektbilanz mit allen 18 Erkenntnissen im Schema *Angenommen → Gemessen → Folge* |
| `storymap-texte.html` | Korrigierte Textbausteine für die StoryMap, einzeln kopierbar |

**Achtung:** Die Projektbilanz nennt den Tokenzähler als gebaut. Der ist am
20.10. wieder entfernt worden — siehe Abschnitt 6.

Die Seiten sind für den Artifact-Viewer geschrieben: kein `<!doctype>`, kein
`<html>`/`<head>`/`<body>`. Zum lokalen Öffnen im Browser funktionieren sie
trotzdem, der Browser ergänzt das.

---

## 5. Arbeitsweise, die sich bewährt hat

Diese Punkte standen bisher nur im Gedächtnis des Assistenten.

### Erklärstil

„Für Dummies" heißt in diesem Projekt: **Fachbegriff nennen UND an einem
Beispiel festmachen** — nicht statt dessen. Also „ein Geometrie-Operator (=
rechnet im Browser) — wie der Taschenrechner auf dem Tisch, nicht wie der
Antrag ans Steueramt", nicht „so ein Rechending".

### Vor dem Löschen bestehender Business-Logik nachfragen

Vieles, was überflüssig aussieht, ist eine Reparatur für einen Fehler, der
nicht mehr sichtbar ist. Beispiele: die drei Sperren gegen Überzuordnung in
`inhaltsZuordnung()`, die Reihenfolge der vier Schritte in `queryLayer`, die
Abbruchbedingung in `nachfassenBis()`.

### Bei mehrdeutigem Projektstand nachfragen statt raten

### Deutsch für UI-Texte, Kommentare und Doku

Siehe Umlautregel in `.github/copilot-instructions.md`.

---

## 6. Was zuletzt passiert ist (Oktober 2026)

Chronologisch, weil mehreres aufeinander aufbaut.

**09.10. — Hybride Suche.** Vorher reine Vektorsuche. Jetzt zwei Zweige (dense
+ BM25), fusioniert über Reciprocal Rank Fusion, mit Abstinenzschwelle und
Dublettenentfernung.

**11.10. vormittags — Ankernormen.** Je Kategorie ist die Tatbestandsnorm im
Katalog hinterlegt und wird per Metadatenzugriff **geholt statt gesucht**.
Anlass: von acht Tatbestandsnormen fand die Suche genau eine.

**11.10. nachmittags — fünf Subagenten.** `LayerAgent` dazu, `schreibeBericht`
entfernt, Modulschnitt in `agentlauf.js` und `bericht.js`, damit kein
Importzyklus entsteht.

**11.10. abends — drei Messfehler behoben.** Radiusprüfung (Absatznummern),
429-Erkennung (Fachantworten), LayerView-Filter (161 Kachelfehler).

**20.10. — Tokenzähler gebaut und wieder entfernt.** Er hat seinen Zweck
erfüllt: Die Zahlen kommen als `usage_metadata` an der Modellnachricht an,
gelesen im `afterModel`-Hook einer Middleware — für den Hauptagenten gemessen,
10 Aufrufe / 57.862 Tokens. Auf Wunsch wieder zurückgebaut.

**Wer ihn wieder braucht:** `handler` ist in `AgentMiddleware` Pflicht
(`middlewares/types.d.ts:73`), ein Durchreicher `(req, next) => next(req)`
genügt. Ohne ihn fallen alle Subagenten mit `n.handler is not a function` aus —
genau das ist beim ersten Einbau passiert.

---

## 7. Offene Punkte

Nach Dringlichkeit.

### Nicht committet

**Der wichtigste Punkt.** Seit `dc734f4` ist nichts committet — 14 geänderte
Dateien plus die neuen Module `agentlauf.js` und `bericht.js`, die beiden
Grafiken und dieser `docs/`-Ordner. Darin steckt die gesamte Arbeit des
Oktobers.

Remote: `github.com/ceey-esri/nrw-basemap-ai-demo`, Branch `main`.

### Übersprungene Layer werden nirgends vermerkt

Der `LayerAgent` darf einen Layer ausdrücklich als nicht einschlägig abtun, und
das steht auch in seiner Antwort. `offeneLayer()` sieht davon nichts und
schlägt ihn in der nächsten Runde wieder vor — über drei Nachfass-Runden
blieben so 6 → 5 → 5 Layer „offen", zwei Runden ohne Wirkung.

Behebbar mit einem `merkeUebersprungen(kategorieId, layer, grund)`, das
`offeneLayer()` dann ausschließt. Offen ist nur die fachliche Frage, ob ein
übersprungener Layer im Ergebnispanel erscheinen soll.

### Der Radius bleibt eine Modellannahme

Entschieden und dokumentiert: Die Normen kennen keinen Untersuchungsradius. Von
den acht Ankernormen tragen **zwei** eine echte Abstandsangabe, **eine** eine
Zahl ohne Abstandsbezug (§ 43 EnWG: 200 m sind eine *Leitungslänge*), **fünf**
keine. Jeder Radius ist deshalb als Annahme gekennzeichnet.

**Falls das jemand ändern will:** Es gibt eine Restfehlerquelle. Die Prüfung
bestätigt die *Zahl*, nicht ihre *Bedeutung* — ein gemeldeter 200-m-Radius für
„energie" gilt wegen § 43 EnWG als belegt, obwohl die 200 m dort eine
Leitungslänge sind. Der Tooltip sagt das inzwischen ausdrücklich.

### Der Orchestrator kostet eine Modellrunde pro Nachricht

Die `<arcgis-assistant>` macht vor jedem Aufruf eine *intent detection* per
LLM. Bei einem registrierten Agenten und versteckter Oberfläche ist das reiner
Aufwand, laut Typdefinition aber nicht abschaltbar. Der Ausweg wäre
`agent.run()` direkt — kostet die von der Komponente verwaltete
Gesprächshistorie zwischen den Phasen.

### Kosten sind nicht gemessen

In der Beta laut Esris FAQ keine. Danach nach Zahl der Aufrufe. Ein Lauf löst
rund **210 Modellaufrufe** aus (hochgerechnet aus einem Log, nicht gemessen).
Als Gegenprobe taugt die Credit-Anzeige des Portals vor und nach einem Lauf.

---

## 8. Die Dinge, die ich jemandem sofort sagen würde

Fünf Sätze, die viel Zeit sparen.

1. **Die Zahlen im Ergebnis kommen nie vom Modell.** Anzahl aus
   `queryFeatureCount()`, Fläche und Länge aus den geodätischen Operatoren nach
   dem Verschnitt. Wenn eine Zahl falsch aussieht, liegt es an der Geometrie
   oder am Filter, nicht am Sprachmodell.

2. **Ein Layer kann zwei Kategorien tragen.** „Vegetationsflächen" enthält Wald
   *und* Landwirtschaft. Der Schlüssel ist überall `kategorieId + layer`, nie
   der Layertitel allein — sonst überschreibt die zweite Abfrage die erste.

3. **Die Reihenfolge im RAG-Suchtext entscheidet über das Ergebnis.** Belang
   zuerst, Vorhabentyp als kurzer „Anlass:" am Ende. Stand der Vorhabentyp
   vorne, kam für „Wasser" keine einzige Wassernorm zurück.

4. **Der Agent darf nicht lagebezogen begründen.** „Ohne Kenntnis der konkreten
   Lage nicht anzunehmen" ist als Antwort gesperrt — ob etwas in der Nähe
   liegt, klärt Phase 2. Die Recherche klärt nur, ob der Belang bei diesem
   *Vorhabentyp* grundsätzlich eine Rolle spielt.

5. **Wenn ein Lauf leer bleibt, zuerst Ollama prüfen.** Das ist die häufigste
   Ursache und meldet sich nicht von selbst.
