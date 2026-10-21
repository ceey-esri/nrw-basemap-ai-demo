# Arbeitsregeln für dieses Repo

Diese Datei wird von GitHub Copilot automatisch gelesen. Sie ist der Einstieg,
nicht die Doku — **die vollständige Projektdokumentation steht in
[`CLAUDE.md`](../CLAUDE.md)** (der Name ist historisch; der Inhalt ist
werkzeugunabhängig und die laufende Referenz).

## Was dieses Projekt ist

KI-gestütztes räumliches Erstscreening eines raumbedeutsamen Vorhabens für eine
Landes- oder Raumordnungsbehörde. Nutzer wählt eine Vorhabenart, zeichnet
Punkt/Linie/Fläche, startet — die Anwendung bestimmt die Planungsregion, wertet
Regionalplan und Fachrecht aus, leitet daraus relevante Kategorien ab, fragt
Kartenlayer ab und fasst zusammen.

ArcGIS Maps SDK for JavaScript **5.1.20**, Vite, Vanilla JS (kein Framework).
Dazu ein lokales RAG-Backend in Python (`rag/`).

**Verbindliche Grenze:** Die KI bewertet **nicht** Raumverträglichkeit,
Zulässigkeit oder ob ein Ziel der Raumordnung entgegensteht. Sie stellt fest,
was im Untersuchungsraum liegt, gibt Ziele im Wortlaut wieder und benennt, was
vertieft zu prüfen ist. Diese Grenze ist das Verkaufsargument der Demo, keine
Einschränkung — nicht aufweichen.

## Die fünf Regeln, die am meisten sparen

### 1. Namen gegen die installierten `.d.ts` prüfen, nie raten

Die ausführliche Fassung steht in
[`.claude/skills/arcgis-js-api/SKILL.md`](../.claude/skills/arcgis-js-api/SKILL.md)
— lies sie, bevor du etwas am SDK anfasst. Kurzform:

```
node_modules/@arcgis/core/**/*.d.ts                       Kernklassen
node_modules/@arcgis/map-components/dist/components/      <arcgis-*>-Tags
node_modules/@arcgis/ai-components/dist/agent-utils/      Agenten, Middleware
```

Steht ein Name nicht in den Typdefinitionen, gibt es ihn in 5.1 nicht. Drei
echte Fehler aus diesem Projekt, die genau daran hingen:

- `geometryEngine.geodesicArea` ist seit 4.32 abgekündigt und arbeitet nur mit
  WGS84/Web Mercator — bei NRW-Daten in ETRS89/UTM32 lieferte es **still
  falsche Zahlen**. Richtig sind die geodätischen Operatoren.
- `AgentMiddleware.handler` ist **Pflicht**, `hooks` optional
  (`middlewares/types.d.ts:73`). Eine Middleware ohne Handler legt alle
  Subagenten lahm: `n.handler is not a function`.
- `FeatureLayer` hat kein `description` — nur `copyright`. Die Beschreibung
  steckt in `layer.sourceJSON.description` bzw. im Portal-Item.

### 2. Kein CDN, npm-Pflicht

Eigene Agenten gehen nur über den npm-Weg. Ein
`<script src="https://js.arcgis.com/…">` würde das SDK doppelt laden.

### 3. Echte Umlaute in Strings, ASCII in Bezeichnern

`ä ö ü ß` in UI-Texten, Kommentaren und **Suchtexten**. Bezeichner bleiben ASCII
(`flaecheM2`, `kategorieId`), ebenso i18n-Schlüssel und Regions-IDs — die
matchen gegen externe Daten.

Das ist keine Stilfrage: „Gewaesserrandstreifen" in ASCII fällt im RAG unter die
Abstinenzschwelle und liefert **null** Treffer. „Gewässerrandstreifen" findet
§ 38 WHG auf Platz 1.

### 4. `npm run lint` vor jedem Abschluss

ESLint, nur Korrektheitsregeln. `vite build` ist grün bei undefinierten
Bezeichnern, `no-undef` nicht. Genau so ist `MAX_TREFFER is not defined` in den
Browser gelangt.

### 5. Neue Anforderungen an das Modell gehören ins Werkzeug, nicht in den Prompt

Der Agent hält sich nicht zuverlässig an den Prompt. Er hat Feldnamen erfunden,
Kategorien übergangen, Layer ausgelassen. Alles, was stimmen muss, ist deshalb
im Code abgesichert: Feldprüfung, Filter-Verwerfen, exakte Zählung,
Nachfass-Schritte, Zahlenprüfung am Bericht.

**Erkennung deterministisch, Korrektur durch das Modell.**

## Architektur in zehn Zeilen

Ein `ScreeningAgent` (Hauptagent) mit **fünf** Werkzeugen, dahinter **fünf**
Subagenten:

| Subagent | Werkzeug | Liest in |
|---|---|---|
| `BelangeAgent` | `klaereBelange` | Gesetzeskorpus |
| `RegionalplanAgent` | `recherchiere` | Regionalpläne |
| `GesetzAgent` | `recherchiere` | Gesetzeskorpus |
| `LayerAgent` | `pruefeKategorie` | Kartendaten |
| `BerichtAgent` | `fasseZusammen` | nichts |

Kein Subagent spricht mit einem anderen — alles läuft über den Hauptagenten.

**Zwei Wege zum selben Ziel sind keine Redundanz, sondern eine Einladung.**
`beschreibeLayer` und `queryLayer` sind aus den Werkzeugen des Hauptagenten
*entfernt*, nicht nur im Prompt abgeraten. Grund: Beim Abschlusstext gab es zwei
Wege, und das Modell nahm den, der am Subagenten vorbeiführte.

## Vor dem Start

```bash
npm run dev     # Vite auf 5173 (fest, OAuth-Redirect) + RAG auf 8000
```

**Ollama muss laufen** (Port 11434, Modell `embeddinggemma`), sonst liefert das
RAG keine Treffer. Port 5173 ist nicht verhandelbar — er steht in der
OAuth-Redirect-URI.

## Bevor du eine der drei Prüfungen anfasst

In `docs/pruefungen/` liegen drei eigenständige Node-Skripte. Jedes sichert eine
Prüfung ab, die schon einmal **falsch positiv** war und dadurch eine
Falschaussage erzeugt hat. Nach jeder Änderung an der jeweiligen Logik laufen
lassen:

```bash
node docs/pruefungen/radius.mjs          # 21 Fälle
node docs/pruefungen/berichtszahlen.mjs  # 11 Fälle
node docs/pruefungen/dienstfehler.mjs    # 17 Fälle
```

Alle drei beenden mit Exit-Code 0, wenn sie grün sind.

## Weiterlesen

| Datei | Inhalt |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Die vollständige Referenz: jede Entscheidung mit Begründung und Messwert |
| [`docs/UEBERGABE.md`](../docs/UEBERGABE.md) | Projektstand, offene Punkte, wo was liegt |
| [`docs/dateien.md`](../docs/dateien.md) | Datei-für-Datei, was sie tut |
| [`.claude/skills/arcgis-js-api/SKILL.md`](../.claude/skills/arcgis-js-api/SKILL.md) | SDK-Arbeitsregeln im Detail |
