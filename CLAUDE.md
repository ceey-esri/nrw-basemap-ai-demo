# Räumliches Erstscreening — Projektkontext

Die inhaltliche Referenz des Projekts: jede Entscheidung mit Begründung und
Messwert. Der Dateiname ist historisch — der Inhalt ist werkzeugunabhängig.

Seit dem 21.10.2026 wird mit **GitHub Copilot Enterprise** weitergearbeitet.
Dessen Einstiegspunkt ist `.github/copilot-instructions.md`; er verweist
hierher. Wer neu dazukommt, liest **`docs/UEBERGABE.md`** zuerst — dort stehen
Projektstand, offene Punkte und wie man die Umgebung startet.

## Projektziel

**KI-gestütztes räumliches Erstscreening eines raumbedeutsamen Vorhabens.**
Adressat ist die Landes- bzw. Raumordnungsbehörde. Ausgangslage: Ein neues
Großvorhaben kommt auf die Behörde zu, und kurzfristig muss klar werden —
welcher Raum ist betroffen, welche räumlichen Themen könnten relevant sein,
welche Daten braucht man für eine vertiefte Betrachtung.

Nutzer wählt eine Vorhabenart, zeichnet Punkt / Linie / Fläche in die Karte und
startet. Die Anwendung arbeitet **sichtbar** in dieser Kette:

```
Fragestellung verstehen → Planungsregion bestimmen → Regionalplan + Gesetze
auswerten → daraus relevante Kategorien ableiten → Kartenlayer abfragen →
Ergebnisse auf der Karte darstellen → aus den Daten zusammenfassen
```

**Verbindliche Grenze:** Die KI **bewertet nicht** die Raumverträglichkeit, die
Zulässigkeit oder ob ein Ziel der Raumordnung entgegensteht. Sie stellt fest,
was im Untersuchungsraum liegt, gibt Ziele der Raumordnung im Wortlaut wieder
und benennt, was vertieft zu betrachten wäre. Diese Grenze wird in der Demo
offensiv gezeigt — das schafft bei diesem Publikum mehr Vertrauen als eine
überzogene Agenten-Demo.

**Datenbotschaft für die Bühne:** nicht „basemap.de ist die AI-Datenbasis",
sondern „für diesen Showcase haben wir einen kuratierten, standardisierten
Geodatenbestand aufgebaut". Kernaussage: *AI braucht nicht viele Daten, sondern
zugängliche, strukturierte, verlässliche und interpretierbare Daten.*

## Vorhabenarten (6)

`src/screening/vorhaben.js` — Wind · Gewerbe/Industrie · Straße · Mobilfunk ·
Außenbereich · PV. Je Eintrag: Titel (DE/EN), Beschreibung (Kontext
für die RAG-Suche) und die übliche Geometrie (Punkt / Linie / Fläche).

**Es gibt keine fest verdrahteten Prüfbereiche mehr.** Welche Kategorien
relevant sind, leitet der Agent zur Laufzeit aus Regionalplan und Gesetzen ab.
Der Katalog der 8 Kategorien steht in `src/screening/kategorien.js` und bildet
die Festlegungskapitel der Regionalpläne nach § 7 ROG ab: Siedlungsraum ·
Natur und Landschaft · Wasser · Wald · Verkehr · Energieanlagen und
Leitungsnetze · Landwirtschaft · Kulturlandschaft. Die `stichworte` sind fachlich geschnitten, nicht wörtlich:
Gehölz gehört zu **Natur** und nicht zu Wald (§ 1 LFoG NRW), und „Vegetation"
ist aus **Landwirtschaft** entfernt — es traf ausgerechnet „Vegetationslose
Fläche". Gegen die echten Klassenwerte des Vegetationslayers geprüft: Wald →
Nadelholz, Laubholz, Laub- und Nadelholz; Landwirtschaft → Ackerland, Grünland;
Natur → Gehölz; „Vegetationslose Fläche" bleibt bei keiner.
Die Energie-Kategorie hiess
bis 2026-09-08 „Energie und **technische Infrastruktur**" — dieser Zusatz lud
dazu ein, Siedlungs- und Bauwerksflächen dort einzuordnen; das Stichwort
„Versorgung" traf aus demselben Grund jede Ver- und Entsorgungsfläche. Die Zuordnung Kategorie → Webmap-Layer läuft über
`layerMuster` (Titel-Teilstrings), nicht über die Layergruppe — und ist nur ein
**Vorschlag**, weil in diesem Datenbestand Einschlägiges oft unter
unscheinbaren Titeln steckt.

Zwei Korrekturen am Katalog: **Rohstoffsicherung ist entfallen** (die
Vorhabenart Abgrabung gibt es nicht mehr, und das hinterlegte BBodSchG war
ohnehin das falsche Fachrecht), **Landwirtschaft ist dazugekommen** — in NRW
ein eigener regionalplanerischer Freiraumbelang (§ 1a Abs. 2 BauGB, § 15
BNatSchG). Klima/Immissionsschutz fehlt bewusst: dafür gibt es keine Layer, der
Agent würde eine Kategorie melden, zu der er nie Objekte finden kann.

## Architektur

1. **Ein orchestrierender Hauptagent plus vier Subagenten.** Der Hauptagent
   (`src/screening/agents.js`) hängt an einer im UI unsichtbaren
   `<arcgis-assistant>` (`#assistant-slot` off-screen, Steuerung nur über
   `submitMessage()`). Er führt die Fäden zusammen; die fachliche Arbeit liegt
   bei den Subagenten in `src/screening/subagenten.js`:

   | Subagent | Werkzeug am Hauptagenten | Aufgabe |
   |---|---|---|
   | `BelangeAgent` | `klaereBelange` | liest in § 35 Abs. 3 BauGB nach, welche Belange zu prüfen sind → BELEGT/OFFEN je Kategorie |
   | `RegionalplanAgent` | `recherchiere` | Ziele und Grundsätze des geltenden Plans |
   | `GesetzAgent` | `recherchiere` | einschlägige Normen im Gesetzeskorpus |
   | `LayerAgent` | `pruefeKategorie` | sucht die Layer einer Kategorie, prüft Felder, fragt ab und verschneidet |
   | `BerichtAgent` | `fasseZusammen` | formuliert den Abschlusstext aus übergebenen Fakten |

   **Die Zahl 429 im Antworttext ist KEIN Dienstfehler** (korrigiert
   2026-10-11 abends). `DIENST_FEHLER` hiess `/\b429\b|…/` und traf damit in
   jeder Fachantwort, die zufällig so eine Zahl enthielt. Im Lauf hat es
   **dreimal** gefeuert: „Vegetationsflächen: 429 Objekte" wurde als
   Dienstabweisung verworfen, ebenso zwei Antworten, in denen weiter hinten
   eine Zahl wie `1.429` stand — das Wortgrenzenpaar `\b429\b` trifft auch
   hinter einem Tausenderpunkt. Gemessen: **6 von 7** realistischen
   Fachantworten hielt das alte Muster für einen Dienstfehler.

   Die Messwerte lagen danach trotzdem im Store (`queryLayer` schreibt sie
   unabhängig vom Rückgabewert hinein), aber der Hauptagent bekam
   `layerFehlgeschlagen` gemeldet und prüfte dieselben Kategorien erneut — das
   erklärt die drei Nachfass-Runden in dem Lauf. **In `app.js` war es
   gefährlicher:** `fehlertext()` fällt ohne `error` auf `antwort.text`
   zurück, also auf die VOLLE Antwort des Hauptagenten; eine solche Zahl in
   der Zusammenfassung hätte den ganzen Lauf als Dienstabweisung gewertet, mit
   10/30/60 Sekunden Warten und Abbruch danach. Dass es nicht eintrat, war
   Zufall.

   Beide Stellen tragen jetzt dasselbe Muster: die Zahl zählt nur in einem
   **Fehlerkontext** (`http`, `statuscode`, `code`, `error`, `fehler`, höchstens
   10 Nicht-Ziffern davor), die eindeutigen Wortmarken (`too many requests`,
   `rate limit`, `high demand`, `exceeds the maximum usage size`) tragen den
   Rest. 17 Fälle geprüft: zehn echte Fehlermeldungen treffen, sieben gültige
   Fachantworten nicht.

   **Am 2026-10-11 erstmals gegen das echte Modell bestätigt**: 17
   erfolgreiche Subagenten-Läufe im Log (1 × Belange, 8 × Regionalplan,
   8 × Gesetz), null Einträge im `catch`-Zweig, und der Rückfall in
   `graphVon()` hat nie gefeuert — `createGraph().compile({ checkpointer })`
   trägt beim ersten Versuch.

   **Im zweiten Lauf desselben Tages auch `LayerAgent` und `BerichtAgent`
   bestätigt**: Layer-Agent für alle acht Kategorien, Bericht-Agent dreimal,
   null Einträge im `catch`-Zweig. Die Antwort für „energie" war **2234
   Zeichen** lang und wurde auf 1500 gekürzt — `maxText` der Layerprüfung steht
   deshalb jetzt auf 3000. Dass die Kürzung überhaupt aufgefallen ist, liegt an
   der Warnung, die `frage()` seitdem ausgibt.

   **Der Hauptagent hat absichtlich NUR noch fünf Werkzeuge**
   (`holeVorhabenKontext`, `bestimmeRegion`, `meldeRelevanz`,
   `meldeNichtRelevant`, `fasseZusammen`). `beschreibeLayer` und `queryLayer`
   gehören dem `LayerAgent`, die Recherche den beiden Recherche-Agenten, der
   Abschlusstext dem `BerichtAgent`.

   **Warum es zu jedem Ziel genau EINEN Weg gibt.** Der Abschlusstext hatte
   zwei: `schreibeBericht` liess den Subagenten formulieren und gab den Text
   zurück mit der Anweisung, ihn „unverändert an `fasseZusammen`
   weiterzugeben" — ein Handschlag in zwei Schritten, auf den sich das Modell
   halten musste. Im Lauf vom 2026-10-11 hat es `schreibeBericht`
   **übersprungen** und direkt `fasseZusammen` gerufen; der Abschlusstext kam
   damit vom Hauptagenten. `schreibeBericht` ist deshalb entfallen, und
   `fasseZusammen` läuft selbst durch `formuliereBericht()` (`bericht.js`).
   Dieselbe Logik beim `LayerAgent`: `beschreibeLayer` und `queryLayer` sind
   aus `baueTools()` entfernt, nicht nur im Prompt abgeraten. **Zwei Wege zum
   selben Ziel sind keine Redundanz, sondern eine Einladung.**

   **Modulschnitt, damit kein Importzyklus entsteht:** `tools.js` braucht
   `formuliereBericht`, und `subagenten.js` braucht umgekehrt die
   Werkzeug-Fabriken aus `tools.js`. Die gemeinsame Lauf-Mechanik (`graphVon`,
   `laufen`, `frage`) liegt deshalb in **`agentlauf.js`**, der BerichtAgent in
   **`bericht.js`**; die Kette ist `tools.js → bericht.js → agentlauf.js`,
   zyklusfrei. Ein ESM-Zyklus wäre hier zwar zulässig gewesen — alle Bindings
   sind gehobene Funktionsdeklarationen — aber eine Fussangel für jeden, der
   später Top-Level-Code ergänzt.

   **`frage()` hat einstellbare Längen** (`maxText`, `maxLog`,
   `recursionLimit`). Die Deckel waren fest: 600 Zeichen an den Hauptagenten,
   300 in die Konsole, `recursionLimit` 8. Für einen Recherchebefund zu EINER
   Kategorie passt das; für die Belange-Einstufung mit einer Zeile je Kategorie
   nicht, und für die Layerprüfung reicht ein Limit von 8 nicht einmal für den
   zweiten Layer. Die Belange-Antwort bekommt 2000/1200, die Layerprüfung
   1500/700 bei `recursionLimit: 40`. Zusätzlich **warnt** `frage()` jetzt,
   wenn sie kürzt.

   **Ein Messfehler, der als Modellfehler aussah** (festgehalten, weil er sich
   wiederholen kann): Im Log erschien die Belange-Antwort mit fünf von acht
   Kategorien und endete nach **299** Zeichen — eine Stelle vor dem Schnitt bei
   300. Nicht das Modell hat aufgehört, sondern `console.info`. Dass der Text
   an den Hauptagenten mit 600 Zeichen knapp genügte, war Glück. Die
   Vollständigkeit wird trotzdem geprüft: `klaereBelange` vergleicht die
   Antwort gegen `FB_IDS` und fasst bei fehlenden Kategorien **genau einmal**
   nach — Erkennung im Code, Korrektur durch das Modell.

   **Der `checkpointer`-Fehler, der die Subagenten lahmgelegt hatte, ist
   behoben.** `LLMAgent` setzt beim Modellaufruf intern `checkpointer: true` —
   in LangGraph heisst das „**erbe** den des übergeordneten Graphen". Unter dem
   Orchestrator der `<arcgis-assistant>` gibt es diesen Elternteil; bei
   direktem `agent.run()` ist der Graph ein **Wurzelgraph** ohne Elternteil,
   und LangGraph lehnt ab: *„checkpointer: true cannot be used for root
   graphs."* `agent.run()` kompiliert ohne Optionen. `graphVon()` kompiliert
   deshalb selbst — `agent.createGraph().compile({ checkpointer: new
   MemorySaver() })` — und `laufen()` ruft den Graphen mit eigenem `thread_id`
   je Durchlauf auf, damit sich die Kategorien keinen Gesprächsfaden teilen.
   `createGraph` ist in der Typdefinition `@internal`; `@langchain/langgraph`
   steht deshalb seit 2026-10-09 als **direkte** Abhängigkeit in
   `package.json` (gepinnt auf die vom SDK installierte Version), damit der
   Zugriff nicht an einer transitiven Auflösung hängt.

   Ein früherer `WorkflowAgent`-Aufbau lief durch und meldete „fertig", ohne
   ein Werkzeug auszuführen — deshalb die Arbeitsteilung über Werkzeuge statt
   über eine Agenten-Hierarchie.
   `recursionLimit` per Middleware auf 120.
   `<arcgis-assistant-agent>` muss **vor** dem DOM-Einhängen der Assistant
   angehängt sein, sonst „No agents found" (Race).
2. **Modell:** Esri-gehostet über `@arcgis/ai-components`, Stufe `MODEL_TIER`
   in `src/config.js` — steht auf **`"fast"`** (nicht `"default"`, wie hier
   bis 2026-10-11 stand).

   **Welches Modell:** Die Typdefinition kennt nur eine Stufe
   (`"advanced" | "default" | "fast"`, `LLMAgent.d.ts:24`) und nennt kein
   Modell. Die **Release Notes zu 5.1** tun es: *„a new `fast` model tier
   (GPT-5.4-nano)"*. Für `default` und `advanced` ist keines genannt. Laut FAQ
   gilt: *„You cannot change the LLM used by agents provided by the JavaScript
   Maps SDK, including the LLM used for agent orchestration."* — ein eigenes
   Modell ginge nur über einen eigenen LangGraph-Backend-Weg, nicht über die
   Agent-Utilities (Stand 5.1).

   **KOSTEN — hier stand das Gegenteil des Richtigen.** Bis 2026-10-11 stand
   hier „Kostet ArcGIS-Credits". Das ist falsch. Esris FAQ zu den agentischen
   Apps sagt: *„There will be no cost to end users or organizations for using
   AI components during the beta period."* Die AI-Komponenten sind in 5.1
   weiterhin **Beta**. Für danach kündigt dieselbe Seite Kosten an — bemessen
   an der *„number of interactions with agents and LLM calls made through the
   components"*, mit einer Struktur, die erst in einem Preview-Release
   festgelegt wird. Also: **jetzt kostenlos, später nach Aufrufen.**
   Quellen: `developers.arcgis.com/javascript/latest/agentic-apps/ai-faq/`
   und die Release Notes zu 5.1.

3. **Werkzeuge** (`src/screening/tools.js`) — der geometrische Teil ist
   deterministisch und liefert die Zahlen fürs Dashboard; das Modell tippt keine
   Zahlen ab:
   - `holeVorhabenKontext` — Vorhabenart, Kommentar, Geometrie + Maße
   - `bestimmeRegion` — **Verschnitt mit den Gemeindegrenzen** → Kreis → über
     `src/screening/regionen.js` deterministisch die Planungsregion und der
     geltende Regionalplan. Wird bewusst **nicht** vom Modell geraten.
     `regionFuer()` matcht **nur auf Wortgrenzen und nur in eine Richtung**
     (gesuchter Name vollständig in einem Kreisnamen). Die frühere
     Substring-Suche ordnete still falsch zu: „Lippetal" (Kreis Soest) lief
     über „Lippe" nach OWL, „Bad Münstereifel" (Kreis Euskirchen) über
     „Münster" ins Münsterland — Testfälle in dieser Datei prüfbar.
     **Die Kette, wenn der Gemeindename nicht in der Kreistabelle steht**
     („Ense", „Warstein", „Attendorn" sind Gemeinden, keine Kreise):
     1. `regionFuer(GEN)` — Wortgrenzen, eine Richtung.
     2. `regionAusAttributen()` — alle übrigen String-Attribute.
     3. **`regionAusKreis()` (tools.js)** — der eigentliche Löser: die ersten
        fünf Stellen des `AGS` identifizieren den Kreis, eine zweite Abfrage
        `AGS LIKE '<prefix>%'` holt **alle Gemeinden dieses Kreises**, und
        deren Namen laufen gegen die Tabelle. In fast jedem Kreis gibt es eine
        gleichnamige Gemeinde („Soest" im Kreis Soest, „Olpe" im Kreis Olpe).
        Gewertet wird nur, wenn **alle** Treffer auf dieselbe Region zeigen.
     4. `regionAusSchluessel()` — Regierungsbezirk aus `SN_R`, aber **nur für
        Köln (3) und Detmold (7)**. Düsseldorf, Münster und Arnsberg verlieren
        Kreise ans RVR-Gebiet bzw. zerfallen in Teilpläne; dort wäre die
        Bezirksangabe eine Falschaussage.

     Drei Kreise tragen einen Namen, den keine ihrer Gemeinden führt
     (Ennepe-Ruhr, Hochsauerland, Märkischer Kreis) — dafür stehen ihre
     Kreisstädte in `KREISSTADT`. Das ist die **einzige von Hand eingetragene
     Ortskenntnis** in `regionen.js`; alles andere kommt aus dem Grenzlayer.

     Der Layer deckt **ganz Deutschland** ab (Beispielobjekt: Flensburg).
     `istNRW()` prüft das Land über den AGS; liegt das Vorhaben ausserhalb NRW,
     bricht `bestimmeRegion` mit klarer Meldung ab, statt still zu scheitern.
   - `beschreibeLayer` — ohne Argumente die Layerliste mit **Feld-Aliassen**,
     Symbolisierungsfeld, `kategorieVorschlag` — und, als eigentliche
     Entscheidungsgrundlage, die **`beschreibung`** des Layers.
     `layerBeschreibung()` setzt sie aus dem zusammen, was ohne Zusatzanfrage
     vorliegt: `layer.sourceJSON.description` (kommt mit `layer.load()` mit,
     `FeatureLayerBase.d.ts:516`), dazu `snippet`, `description`, `tags` und
     `categories` des `layer.portalItem` (`PortalLayer.d.ts:157`,
     `PortalItem.d.ts`), HTML entfernt. **`FeatureLayer` selbst hat kein
     `description`** — nur `copyright`; die Beschreibung steckt in `sourceJSON`
     bzw. im Portal-Item.
     Gegen diesen Text laufen die `stichworte` der Kategorie
     (`inhaltsZuordnung()`), nicht gegen Feldnamen oder Attributwerte: **die
     Beschreibung sagt, was drin ist, die Felder sagen nur, wie es heisst.**

     **Zwei Sperren gegen Überzuordnung** — der erste Anlauf schlug einen Layer
     JEDER Kategorie zu, deren Stichwort irgendwo im Text vorkam, und in einem
     echten Lauf landeten daraufhin sämtliche Layer (Siedlungsflächen,
     Gewässerflächen, Verkehrswege, Vegetationsflächen) unter „Kulturlandschaft
     und Denkmäler": ein Thema mit allem drin, sieben ohne Objekte. Über
     `offeneLayer()` ging die Fehlzuordnung direkt in den Phase-2-Auftrag.
     1. **Stichwörter ohne Trennschärfe fliegen raus**: Wer in mehr als
        `MAX_ANTEIL = 34 %` der Layer vorkommt, beschreibt den Datenbestand,
        nicht diesen Layer. Die ignorierten Wörter stehen in der Konsole.
     2. **Nur der beste Treffer zählt**: Ein Layer wird per Inhalt höchstens
        EINER Kategorie zugeordnet; bei Gleichstand keiner, dann entscheidet
        das Modell an der Beschreibung. Die fertige Zuordnung wird als Tabelle
        geloggt (`[tools] Layer-Zuordnung nach Beschreibung`).
     3. **Das Titelmuster hat Vorrang**: Layer, die schon ein `layerMuster`
        beansprucht, überspringt die Inhaltssuche ganz. Sie existiert, um Layer
        zu FINDEN, deren Titel nichts verrät — nicht um Layern mit klarem Titel
        weitere Kategorien anzuhängen. Ohne diese Sperre bekam
        „Siedlungsflächen" (per Titel eindeutig Siedlungsraum) zusätzlich die
        Energie-Kategorie, und weil `kategorienFuerLayer()` die **Vereinigung**
        aus Titel- und Inhaltstreffern bildet, liess die Sperre in `queryLayer`
        beide durch: Wohnbauflächen erschienen unter „Energieanlagen und
        Leitungsnetze".
     Nur für Layer ganz **ohne** Metadatentext entscheiden ersatzweise die
     Klassenbezeichnungen des Renderers — sonst wären solche Layer wieder
     blind; in dem Fall gehen die Treffer als `passendeWerte` mit, damit das
     Modell weiss, wonach zu filtern ist. Der Werkzeugtext sagt dem Modell
     ausdrücklich, dass es sich an der Beschreibung orientieren soll, nicht am
     Titel und nicht an den Feldnamen.
     **Anlass:** In einem Testlauf blieb der Wald unentdeckt, obwohl direkt
     daneben welcher liegt — Waldflächen stecken hier als Klasse eines
     allgemeinen Flächenlayers, nicht in einem Layer namens „Wald". Die reine
     Titelsuche konnte das nicht sehen, und damit fehlte der Layer auch im
     deterministischen Nachfass-Schritt `offeneLayer()`, der jetzt über
     `layerFuerKategorieGesamt()` beide Quellen zusammenführt (Titel-Vorschlag — Prompt und Werkzeugtext sagen ausdrücklich, dass
     auch unscheinbar benannte Layer zu prüfen sind). Mit `layerTitel` die
     Felder inkl. Domänen, `klassifizierendeFelder` und `symbolisierung`.
   - **Ein Layer kann ZWEI Kategorien tragen** — „Vegetationsflächen" enthält
     Wald- *und* Landwirtschaftsflächen, unterschieden nur über ein Attribut.
     Das muss überall durchgehalten werden, und war es zunächst nicht:
     `merkeAbfrage()` schlüsselte nach **Layertitel allein**, also überschrieb
     die zweite Abfrage die erste, und die zuerst abgefragte Kategorie verlor
     ihre Objekte („Wald — keine Objekte im Umfeld", obwohl direkt daneben
     welcher liegt). `offeneLayer()` hatte denselben Fehler und schlug einen
     einmal abgefragten Layer nie wieder für eine andere Kategorie vor.
     **Schlüssel ist jetzt überall `kategorieId + layer`**; `zeigeGefundeneObjekte()`
     sammelt die ObjectIDs entsprechend **je Layer** ein, sonst überschriebe der
     zweite `zeigeLayerGefiltert()`-Aufruf die `definitionExpression` des ersten.
     `beschreibeLayer(layerTitel)` meldet `gehoertZu` und bei mehreren
     Kategorien `hinweisMehrfachnutzung`: je Kategorie einzeln abfragen und mit
     `where` auf die passenden Klassen einschränken.
   - `queryLayer` — **zwei Sperren vor der Abfrage.** Erstens die
     Kategoriezugehörigkeit: `kategorienFuerLayer()` sammelt, welche Kategorien
     einen Layer beanspruchen (Titelmuster — mehrere möglich, „Vegetationsflächen"
     gehört zu Wald *und* Landwirtschaft — plus die Inhaltszuordnung). Passt die
     übergebene `kategorieId` nicht dazu, bricht das Werkzeug ab und nennt die
     richtige. Sonst legt das Modell alles unter derselben Kategorie ab, und im
     Ergebnis steht ein Thema mit allem drin.
     Zweitens **gesperrt ohne Relevanzmeldung**: liegt für die Kategorie
     keine Zone in `_zonen`, bricht das Werkzeug ab und verweist auf
     `recherchiere` + `meldeRelevanz`. Die Zone entsteht nur dort, also erst
     nach der RAG-Recherche — damit gilt deterministisch, was fachlich gemeint
     ist: kein Objektabgleich für eine Kategorie, die Plan und Fachrecht nicht
     als betroffen ausgewiesen haben. Vorher fiel `suchgeometrie()` still auf
     die blosse Vorhabengeometrie zurück, und das Modell konnte jede beliebige
     Kategorie abfragen.
     Abfrage gegen die Zone **dieser** Kategorie; zählt Features
     und summiert nur die **verschnittene** Fläche bzw. Länge.

     **Gemessen wird mit den geodätischen Operatoren, nicht mit
     `geometryEngine`** (Stand 2026-09-09): `intersectionOperator.execute()`,
     dann `geodeticAreaOperator` bzw. `geodeticLengthOperator`, jeweils nach
     `load()` (`messwerkzeugeBereit()`); die Zone baut
     `geodesicBufferOperator`. Grund steht in den Typdefinitionen:
     `geometryEngine.geodesicArea/geodesicLength/geodesicBuffer` sind **seit
     4.32 abgekündigt** und arbeiten *„only with WGS84 (wkid: 4326) and Web
     Mercator spatial references"*. Bei NRW-Daten in ETRS89/UTM32 lieferten sie
     stillschweigend falsche Zahlen.
     Ebenso wichtig und vorher schlicht falsch: `q.outSpatialReference` wird auf
     das Bezugssystem der Zone gesetzt. Ohne das kommen die Features in der
     Projektion des Layers zurück, und der Verschnitt rechnet zwei verschiedene
     Koordinatensysteme gegeneinander. Mit `where`
     grenzt der Agent auf die fachlich relevanten Ausprägungen ein, mit
     `gruppeFeld` wird nach Attributwert **aufgeschlüsselt** (Domänen-Codes
     werden über `wertLesbar()` in Klartext übersetzt). Aus „42 Verkehrswege"
     wird so „12 km Autobahn, 3 km Landesstraße" — die Attributprüfung ist der
     Kern der fachlichen Aussage, nicht die bloße Trefferzahl.
     **Zwei Sperren, weil der Prompt allein nicht reichte** (das Modell hat
     Feldnamen und Codes frei erfunden, die Abfragen lieferten lautlos 0):
     1. Feldnamen im `where` werden gegen `layer.fields` geprüft
        (`unbekannteFelder()`, Literale werden vorher entfernt).
     2. 0 Treffer **mit** Filter → Gegenprobe ohne Filter. Liegen dort Objekte,
        wird der Filter **verworfen** und ohne ihn gemessen; `filterVerworfen`
        und `tatsaechlicheWerte` gehen ans Modell zurück.
        Vorher stieg das Werkzeug hier aus, **ohne etwas zu speichern** — traf
        das Modell mit seinen Filtern daneben, lieferte Phase 2 gar kein
        Ergebnis, obwohl der Punkt mitten in einer Siedlung lag. Das Messen ist
        die verlässliche Grundfunktion, der Filter nur eine Verfeinerung.
     Eine frühere dritte Sperre (`where` nur nach vorherigem `beschreibeLayer`)
     ist wieder raus: sie war gegenüber der Feldprüfung redundant und kostete
     je Layer eine zusätzliche Modellrunde.

     **Rückfall für die Aufschlüsselung** (`ersatzGruppenfeld()`): Gibt weder
     das Modell noch der Renderer ein Feld her, wird eines aus den **bereits
     geholten Attributen** gewählt — die Abfrage holt ohnehin
     `outFields: ["*"]`, das kostet keine zusätzliche Anfrage. Kriterium: 2 bis
     40 verschiedene Werte im Untersuchungsraum bei mindestens halber Belegung,
     codierte Domänen zuerst, danach das Feld mit den **wenigsten** Klassen.
     `gruppeQuelle` (`renderer` / `modell` / `ersatz`) geht in den Store.
     Anlass: „Verkehrswege" blieb ohne Diagramm („es liess sich kein
     klassifizierendes Attribut ermitteln"), obwohl der Layer klassifiziert
     ist — die Aufteilung hing allein am Renderer, und der lieferte kein Feld.
     Beim Einzelsymbol bleibt es bewusst bei keiner Aufteilung.

     **Die Reihenfolge in `queryLayer` ist wesentlich** — einmal falsch herum
     gebaut, und der Klassenfilter lief ins Leere: (1) Feld aus Modell oder
     Renderer, (2) fehlt eines, `ersatzGruppenfeld()` aus den Attributen —
     **auch beim Einzelsymbol**, denn dass die Karte alles gleich zeichnet,
     heisst nicht, dass der Layer keine Objektart führt, (3) Klassenfilter,
     (4) noch einmal prüfen, ob das Feld nach dem Filter noch unterscheidet.
     Stand Schritt 2 hinter Schritt 3, bekam `klassenFilter()` bei
     „Vegetationsflächen" (Renderer ohne Feld) `null` und gab auf — Wald und
     Landwirtschaft zeigten denselben Bestand.

     **Trägt das Gruppenfeld hier überhaupt eine Unterscheidung?** Nach dem
     Holen der Features wird geprüft, wie viele verschiedene Werte darin
     stehen. Bei weniger als zwei greift `ersatzGruppenfeld()` — auch wenn ein
     Feld gesetzt war. Beim Wald ist das der Normalfall: gefiltert wird auf
     `objektart='wald'`, und dann steht im Ring ein einziges Segment „Wald";
     die Unterteilung sitzt eine Ebene tiefer (`klasse`: Laub-, Nadel-,
     Mischwald). Der Rückfall schliesst zusätzlich Namens- und Kennungsfelder
     aus (`name`, `bezeichn`, `nummer`, `schlüssel`, …) — ein Ring aus vierzig
     Gewässernamen ist keine Aufteilung.

     **Feldauswahl über die Symbolisierung** (`symbolisierung()`): Der
     `renderer.type` entscheidet. `"unique-value"` (Typen) → `renderer.field`
     wird als `gruppeFeld` genommen, auch ohne Zutun des Modells.
     `"simple"` (Einzelsymbol) → **gar keine** Aufteilung, ein vom Modell
     übergebenes `gruppeFeld` wird ignoriert: der Layer trägt keine
     Unterscheidung, die hier zählt. Der Feldabgleich läuft
     **case-insensitiv** — der Renderer schreibt den Feldnamen gelegentlich
     anders als das Schema, und ein exakter Vergleich meldete dann fälschlich
     „kein Feld". Fehlt trotzdem eins, nennt das Ergebnis den **wirklichen**
     Grund (Einzelsymbol / Arcade-Ausdruck / kein Attribut ermittelbar) statt
     pauschal „Einzelsymbol". Zusätzlich liefert
     `beschreibeLayer(layerTitel)`
     `klassifizierendeFelder` — Felder mit codierter Domäne, plus Textfelder
     mit 2–40 verschiedenen Werten **im Untersuchungsraum** (mehr = Eigennamen,
     eines = keine Information). Der Prompt lässt `gruppeFeld` nur aus dieser
     Liste zu. Das Modell wählt damit an Zahlen statt zu raten.

     **Abfragedeckel:** `anzahl` kommt aus `queryFeatureCount()` und ist immer
     exakt. Geometrien werden seitenweise geholt (`Query.start`/`num`, nur bei
     `capabilities.query.supportsPagination`) bis `MAX_TREFFER = 20000`
     (2.000 je Seite) — bewusst hoch, weil bei 2.000 reale Läufe gekappt wurden
     und die Summen nur noch Mindestwerte waren. Greift der Deckel doch, sind
     Fläche und Länge Mindestwerte — `teilmenge: true` fließt
     in den Store, das Ergebnis zeigt „≥" an der Leitzahl und einen
     Teilmessungs-Chip an der Layerzeile. Vorher lag der Deckel bei fest 200,
     und ein Lauf meldete exakt 200 Objekte: das war das Limit, nicht die
     Realität.
   - `holeRegionalplan` / `holeRechtsgrundlage` — RAG (siehe unten). Der
     Suchtext wird von `wirkungsfrage(vorhabenText, kategorie, korpus)` gebaut:
     **Belang zuerst**, dann die im Katalog benannten Normen (`fachgesetze`)
     bzw. Festlegungsarten (`rechtsrahmen`), und der Vorhabentyp nur als kurzer
     „Anlass:" am Ende.

     **Die Reihenfolge entscheidet über das Ergebnis, nicht über die Optik.**
     Solange der Vorhabentyp vorne stand („Vorhabentyp: Errichtung einer
     Windenergieanlage. Belang: Gewässerrandstreifen …"), zog er das Embedding
     vollständig zu sich. Am 2026-09-08 gegen das laufende RAG gemessen,
     Vorhaben WEA, top_k=5 je Kategorie:

     | Kategorie | alt | neu |
     |---|---|---|
     | wasser | BauGB ×3, BNatSchG ×2 — **keine Wassernorm** | LWG NRW ×3, WHG ×2 |
     | wald | BauGB ×3, BNatSchG ×2 — **keine Forstnorm** | LFoG NRW ×5 |
     | kulturlandschaft | BauGB ×3, BNatSchG ×2 — **kein Denkmalrecht** | DSchG NRW ×3 |
     | natur | BNatSchG ×3, BauGB ×2 | BNatSchG ×2, LNatSchG NRW ×3 |
     | verkehr | FStrG ×1, BauGB ×4 | FStrG ×2, StrWG NRW ×2 |
     | energie | EnWG ×3, FStrG, BauGB | EnWG ×5 |
     | siedlung / landwirtschaft | BauGB | BauGB (unverändert — hier ist das BauGB die richtige Norm) |

     Im Regionalplan-Korpus dieselbe Richtung: für „Wasser" lieferte die alte
     Frage vier Windenergie-Ziele und keine Wasserfestlegung, die neue
     IV.7-1 (stehende Gewässer), IV.8-5 (Hochwasserschutz) und IV.7-2
     (Oberflächengewässer).

     **Folge für die Radien:** § 38 WHG steht im Korpus, mit der Zahl im
     Wortlaut („Der Gewässerrandstreifen ist im Außenbereich fünf Meter
     breit"), und wird bei belangzentrierter Frage auf Platz 1 gefunden — mit
     der alten Frage gar nicht. Was der Subagent vorher als RADIUS meldete,
     kann also nicht aus den Passagen gestammt haben, sondern nur aus dem
     Modellwissen; die `radiusBegruendung` nannte trotzdem eine plausible Norm
     und sah damit belegt aus. Der Radius ist weiterhin **nicht validiert**
     (kein Wertebereich, kein Abgleich mit dem Zitat) — jetzt hat das Modell
     aber wenigstens das richtige Material vor sich. Zwei Fehler steckten hier nacheinander drin:
     erst fragte die Suche nur nach dem Belang an sich (fand also, WAS ein
     Siedlungsbereich ist); dann war sie zwar auf die Wirkung gerichtet, aber
     **ortsbezogen** — der Subagent antwortete „für eine Einzel-WEA ohne
     bekannten Gewässeranschluss nicht per se anzunehmen". Falsche Ebene: OB
     etwas in der Nähe liegt, klärt Phase 2. Die Recherche klärt nur, ob der
     Belang bei diesem **Vorhabentyp** grundsätzlich eine Rolle spielt.
     `vorhaben` ist dafür Pflichtparameter, und `meldeNichtRelevant` weist
     lagebezogene Begründungen ausdrücklich zurück.
     Diese zweite Korrektur schoss dann zu weit: „Regelt der Plan den Belang
     für diesen Vorhabentyp überhaupt, ist er RELEVANT" — jeder Regionalplan
     hat ein Kapitel zu jedem Freiraumbelang, also kamen **8 von 8 Kategorien
     relevant** zurück. Der Gegenversuch (2026-09-08 vormittags), eine
     **benennbare Anforderung an diesen Vorhabentyp** zu verlangen, kippte das
     Pendel voll durch: **8 von 8 verworfen**, jedes Mal mit derselben Floskel
     „keine benennbare Anforderung im Kurzbefund" — auch Natur, Wald und Wasser
     bei einer 150-m-WEA, wo die Betroffenheit offensichtlich ist.

     **Der Denkfehler war das Kriterium selbst.** Ein Regionalplan regelt
     GEBIETE, ein Fachgesetz SCHUTZGÜTER — beide nennen den Vorhabentyp fast
     nie beim Namen („Vorranggebiet für den Schutz der Natur", nicht
     „Windenergieanlagen"). Wer eine vorhabentypbezogene Norm verlangt, findet
     systematisch nichts. Seit 2026-09-08 lautet die Frage deshalb: **Kann ein
     Vorhaben dieser Art den Belang räumlich oder funktional BERÜHREN** —
     Flächen in Anspruch nehmen, überbauen, zerschneiden, überprägen, im
     Wirkraum beeinträchtigen? Verworfen wird nur, was der Vorhabentyp seiner
     Bauart nach gar nicht berühren kann (Wald bei einer Anlage ausschliesslich
     im Siedlungsbereich). **Die Abstufung läuft über den RADIUS, nicht über
     das Weglassen von Kategorien** — dass eine hohe WEA die meisten Belange
     berührt, ist fachlich richtig und kein Fehler.
     `meldeNichtRelevant` weist „keine benennbare Anforderung im Kurzbefund"
     ausdrücklich als Begründung zurück, ebenso ein fehlendes Zitat: das ist
     eine Lücke der Recherche, kein Beleg für Nichtbetroffenheit.

     **Dritter Ausschlag, andere Achse (2026-09-08 abends): nur EINE Kategorie
     — „Energie und technische Infrastruktur".** Das Modell hatte gefragt, zu
     welchem Fachbereich das VORHABEN gehört, statt welche Belange es BERÜHRT;
     eine Windenergieanlage *ist* nun einmal Energieinfrastruktur. Schuld war
     Schritt 3 des Systemprompts: „Wähle die Kategorien, die **für diese
     Vorhabenart in Frage kommen** — nicht stumpf alle acht". Beides zusammen
     liest sich als Zugehörigkeitsfrage plus Aufforderung zum Einengen.
     Beide Prompts und die Subagenten sagen jetzt ausdrücklich: *Gefragt ist
     nicht, wozu das Vorhaben gehört, sondern welche FREMDEN Belange es
     beeinträchtigt — bei einer WEA ist „Energie" gerade der uninteressanteste
     Belang.*

     **Und weil der Prompt diese Frage schon dreimal falsch beantwortet hat,
     prüft der Code jetzt das Ergebnis** (`app.js`, nach Phase 1): höchstens
     eine relevante Kategorie bei mindestens `MIN_VERWORFEN_VERDACHT = 4`
     verworfenen ist für ein raumbedeutsames Vorhaben unplausibel. Dann geht
     **eine** gezielte Nachricht raus (`instr.zuWenige`), die die Verwechslung
     beim Namen nennt und die verworfenen Kategorien zur erneuten Prüfung
     auflistet. Deterministische Erkennung, Korrektur durch das Modell — wie
     bei `fehlendeKategorien()` und `offeneLayer()`.
   - `meldeRelevanz` — fachliche Einordnung je Kategorie + **eigener
     Untersuchungsradius** mit Herleitung; zeichnet die Zone (unsichtbar).

     **Der Radius wird jetzt gegen die Dokumente geprüft** (`radiusBelegt()`).
     Er war der einzige Wert im Ergebnis, den das Modell frei setzen konnte —
     ohne Wertebereich und ohne Abgleich mit dem Zitat, auf das er sich berief.
     Geprüft wird gegen den **Volltext der Fundstellen dieser Kategorie**, in
     Ziffern (`1000`, `1.000`, als km bei runden Werten) **und als Zahlwort**:
     § 38 WHG schreibt „fünf Meter", nicht „5 m" — ohne die Zahlwortliste
     fände die Prüfung den wichtigsten Beleg im Korpus nicht. Die Wortgrenzen
     sind scharf, „40" trifft nicht in „140 Meter" (sechs Testfälle geprüft).
     Beide Recherche-Prompts verlangen entsprechend: Meterzahl **nur** wenn im
     Text, mit Fundstelle, sonst `-`.
     **Eine Zahl ohne Längeneinheit belegt nichts** (korrigiert 2026-10-11).
     Vorher fehlte diese Bedingung, und bei runden Werten kippte die Prüfung
     komplett: zu `3000` wurde zusätzlich die Kilometerform `3` gesucht, und
     eine nackte „3" steht in jedem Gesetzestext. Im Lauf vom 2026-10-11
     meldete die Prüfung **5 von 8 Radien als belegt** — belegt waren sie auf
     „§ 35 Abs. **3** Nr. 1" (3000 m), „Absätzen 1 und **2**" (2000 m) und
     „Absatz **5**" (5000 m). Also auf Absatznummern statt auf Abständen, und
     damit genau die Falschaussage, die das Werkzeug verhindern soll — sie sah
     im Chip aus wie ein Beleg. Jetzt verlangt jeder Zweig eine Einheit, und
     die muss zur Schreibweise passen: Ziffern und Zahlwörter nur mit
     m/Meter/Metern, die Kilometerform nur mit km/Kilometer/Kilometern. „3
     Meter" belegt also keinen 3000-m-Radius mehr. 21 Fälle geprüft, darunter
     die vier Falschtreffer aus dem Lauf und die echten Belege „fünf Meter"
     (§ 38 WHG), „40 Meter"/„20 Meter" (§ 9 FStrG) und „200 Metern" (§ 43
     EnWG). Fehlt die Einheit im Dokument, gilt der Radius als unbelegt — das
     ist die richtige Richtung zu irren.

     **Was die reparierte Prüfung über die Radien aussagt** (Lauf vom
     2026-10-11 abends): **8 von 8 nicht belegt** — gemeldet wurden 1.000,
     2.000, 3.000 und 5.000 m. Vorher galten fünf davon als belegt, und zwar
     auf Absatznummern. Das ist kein Rückschritt, sondern der ehrliche Stand.

     **Entschieden am 2026-10-11: es bleibt so.** Für die Demo ist ein als
     Modellannahme gekennzeichneter Radius das fachlich richtige Ergebnis — die
     Normen kennen keinen Untersuchungsradius, und eine eigene Formel wäre
     Scheingenauigkeit. Korrigiert wurde stattdessen die **Behauptung in der
     Oberfläche**: der Tooltip sagte „Radius belegt in § 43 EnWG" und
     behauptete damit mehr, als die Prüfung zeigt. Sie prüft, ob die ZAHL im
     Wortlaut vorkommt — nicht, ob sie dort ein Abstand ist. § 43 EnWG führt
     „200 Metern" als **Gesamtlänge** einer Freileitung; ein gemeldeter
     200-m-Radius gilt danach als belegt. Der Tooltip nennt jetzt genau das:
     „Diese Meterzahl steht im Wortlaut von … Geprüft ist die Zahl, nicht ihre
     fachliche Bedeutung." Von den acht Ankernormen tragen **zwei** eine echte
     Abstandsangabe (§ 38 WHG fünf Meter Randstreifenbreite, § 9 FStrG 40/20 m
     Anbauverbotszone), eine eine Zahl ohne Abstandsbezug (§ 43 EnWG), fünf
     keine.

     **Das Maßstabsproblem dahinter, bewusst nicht gelöst.** Die Normen nennen
     *Abstandsvorschriften*: fünf Meter Gewässerrandstreifen (§ 38 WHG), 40
     bzw. 20 Meter Anbauverbotszone (§ 9 FStrG), 200 Meter Freileitungslänge
     (§ 43 EnWG). Das Modell braucht aber einen *Untersuchungsradius* für ein
     Erstscreening, und der liegt bei einer 150-m-Windenergieanlage in
     Kilometern. Beides sind verschiedene Größen, und die zweite steht in
     keinem der Dokumente. Die Forderung „der Radius muss aus den Dokumenten
     hervorgehen" ist damit für runde Kilometerwerte praktisch nie erfüllbar.
     Drei denkbare Wege, keiner umgesetzt: (a) so lassen — jeder Radius ist
     dann sichtbar eine Modellannahme, was fachlich korrekt ist; (b) den
     Untersuchungsradius aus der Vorhabenhöhe ableiten (deterministisch,
     belegbar, aber unsere Formel statt einer Norm); (c) die Abstandsvorschrift
     als Mindestradius nehmen und den Screening-Aufschlag getrennt ausweisen.
     **Das ist eine fachliche Entscheidung, keine technische.**

     Ist die Zahl nicht belegt, geht `radiusBelegt: false` in den Store, das
     Werkzeug sagt es dem Modell zurück, und der Umfeld-Chip bekommt einen
     Stern, eine gestrichelte Kante und im **Tooltip** den Vermerk, dass es
     sich um eine Modellannahme handelt (`an.radiusAnnahme`).
   - `meldeNichtRelevant` — geprüft und verworfen, mit Begründung und
     Fundstelle. Erscheint unten im Ergebnis, damit ein betrachteter Belang
     nicht einfach fehlt; Kategorien, die der Agent gar nicht angefasst hat,
     listet `ungeprueftHtml()` deterministisch aus dem Katalog dahinter.
     **Meldepflicht:** je Kategorie genau eine der beiden Meldungen.
     `recherchiere` gibt das als `naechsterSchritt` direkt zurück — dort fällt
     die Entscheidung, ein Prompt-Absatz allein reichte nicht. Reicht auch das
     nicht, fasst `app.js` nach: `fehlendeKategorien()` vergleicht nach Phase 1
     gegen den Katalog und schickt bei Lücken **eine** zusätzliche Nachricht
     (`instr.nachfassen`) mit den fehlenden Kategorien.
     Dasselbe nach Phase 2 für **übergangene Layer**: `offeneLayer()`
     (tools.js) liefert je relevanter Kategorie die per `layerMuster`
     passenden Layer, die nicht abgefragt wurden — das Modell greift sich sonst
     einen je Kategorie und lässt den Rest liegen (bei „Wald" die Bäume, aber
     nicht die Vegetationsflächen). Beide Nachfass-Schritte laufen über
     `nachfassenBis()` **wiederholt** — bis zu `MAX_NACHFASSEN = 3` Runden,
     Abbruch sobald eine Runde keine Lücke mehr schliesst. Eine einzige
     Nachfrage hat in echten Läufen nur einen Teil der Lücken geschlossen;
     ohne die Abbruchbedingung dreht sich der Lauf dagegen im Kreis.
     Ein Lauf, in dem alle Kategorien verworfen werden, ist ein **gültiges
     Ergebnis** und keine Fehlermeldung (`an.alleVerworfen`).
     **Die Liste für Phase 2 ist nicht vorgegeben:** `phase2Auftrag()` liest
     `getAnalyse().relevanz`, und die füllt ausschließlich `meldeRelevanz` —
     ein Werkzeug, das nur das Modell aufruft. Deterministisch ist die
     Übergabe, nicht die Einstufung.
   - `recherchiere` (`src/screening/subagenten.js`) — **ein** Werkzeug, das
     Regionalplan- und Gesetzes-Subagent per `Promise.all` **gleichzeitig**
     laufen lässt und je (Kategorie, Vorhaben) cacht. Halbiert Wartezeit und
     Modellrunden gegenüber zwei getrennten Werkzeugen.
   - `fasseZusammen` — Schlusstext. **Formuliert wird vom `BerichtAgent`**,
     nicht vom Hauptagenten: was er übergibt, sind die FAKTEN als Stichpunkte.
     Der Rückweg ist abgesichert — `unbelegteZahlen()` prüft **jede
     Ziffernfolge** im formulierten Text gegen die übergebenen Fakten. Steht
     eine nicht drin, wird der ganze Text verworfen und die Stichpunkte des
     Hauptagenten bleiben stehen; Grund und Zahlen gehen ans Modell zurück.
     Verglichen wird die **Ziffernfolge ohne Trennzeichen** — „3.000" gilt als
     „3000", „1,73" als „1.73". Bewusst nicht interpretiert: ein Punkt trennt
     im Deutschen Tausender und im Englischen Dezimalstellen, und daran die
     Prüfung scheitern zu lassen hiesse, einen inhaltlich richtigen Bericht
     wegen seiner Schreibweise zu verwerfen — der teurere Fehler.
     **Bekannte Lücke:** ein verrutschtes Dezimaltrennzeichen („173 km" statt
     „1,73 km") hat dieselbe Ziffernfolge und fällt nicht auf. Erkannt werden
     erfundene, gerundete und nachgerechnete Zahlen (11 Fälle geprüft).
4. **npm/Vite Pflicht, kein CDN** — eigene Agents gehen nur über den npm-Weg.
5. **Ratenbegrenzung des Modelldienstes** (`DIENST_FEHLER` in `app.js`): Der
   Esri-Dienst antwortet bei Überlast mit HTTP 429 („The system is currently
   experiencing high demand"), und zwar **nicht** als `arcgisError`, sondern
   als ganz normaler Antworttext — **mal so, mal als `arcgisError`-Ereignis**.
   Ohne Erkennung galt der Lauf als erfolgreich, das Ergebnis blieb leer, und
   die Nachfass-Schritte schickten weitere Nachrichten in dasselbe Limit.
   **Entscheidend war aber eine dritte Form:** `submitMessage()` liefert laut
   `customElement.d.ts` ein `Promise<void>`, das bei einem Dienstfehler
   **ablehnt** — und dieses Promise haben wir weggeworfen. Der 429 tauchte
   dadurch nur als unbehandelte Rejection an der Aufrufstelle in der Konsole
   auf (`app.js:579`), die Wartelogik sah ihn nie, und der Lauf zog mit einer
   leeren Antwort weiter. `sendeUndWarte()` rennt das Sende-Promise jetzt gegen
   das Antwortereignis: bei Annahme wird weiter auf `arcgisResponse` gewartet,
   bei Ablehnung ist der Fehler da. Gewinnt der Fehler, wird `antwortWarter`
   genullt — sonst fängt er die Antwort auf die nächste Nachricht ab.
   `eineNachricht()` zieht über `fehlertext()` alle Formen zusammen, wartet
   `WARTEN_MS = [10s, 30s, 60s]` und bricht erst danach mit
   `an.dienstUeberlastet` ab — einer Meldung, die den Dienst benennt statt die
   Regionsbestimmung. Nur `error: "abgebrochen"` (Nutzerabbruch) geht sofort
   durch.
   Der Dienst weist unter Last nach **Grösse** ab („exceeds the maximum usage
   size allowed during peak load"), nicht nur nach Rate. Deshalb geht der
   Vorhabenkontext seit 2026-09-08 nur noch **einmal je Lauf** raus
   (`kontextGesendet`) statt an jeder Nachricht; die Historie überträgt ihn
   ohnehin bei jeder Modellrunde mit.
   Zusätzlich läuft das Nachfassen nur noch, wenn überhaupt eine Planungsregion
   feststeht; ohne sie gibt es keinen Regionalplan zu bewerten.
   `modelTier` kennt laut `LLMAgent.d.ts` genau drei Werte: `"advanced"`,
   `"default"`, `"fast"`; `MODEL_TIER` steht seit 2026-09-08 auf `"fast"`,
   weil die kleinere Stufe in einem anderen Kontingent liegt. Bleibt der 429
   auch dort, liegt es am geteilten Durchsatz der Organisation — dann hilft
   nur Provisioned Throughput auf Portalseite.

   **Der Orchestrator ist der eigentliche Kostenpunkt.** Der Fehler fällt bei
   der *intent detection* an, also im Router der `<arcgis-assistant>`, bevor
   unser Agent läuft. Laut `customElement.d.ts` ist dieser LLM-Aufruf fest
   eingebaut und nicht abschaltbar — bei **einem** registrierten Agenten und
   off-screen versteckter Chat-Oberfläche ist er reiner Aufwand. Der Ausweg
   wäre `agent.run({ outputMessage, summary }, { recursionLimit })` direkt,
   wie es `subagenten.js` bereits tut; `initAgents()` gibt das Agent-Objekt
   schon zurück, `app.js` verwirft es nur. Das kostet allerdings die von der
   Komponente verwaltete Gesprächshistorie zwischen den Phasen und ist ein
   Umbau der Ablaufsteuerung — offen, bewusst nicht nebenbei gemacht.

## Ergebnis

`src/screening/analyse.js` — **kein Ampelscreening mehr.**

- **Kopfzeile**: Vorhabenart, Planungsregion (mit Info-i, dahinter der geltende
  Plan und die Passagen). Bei einer **Linie** kommt die Länge dazu; bei einer
  gezeichneten **Fläche** nicht — die Zahl wiederholte nur die Eingabe.
  **Bewusst keine Summen** über alle Themen
  — ein Naturschutzgebiet und ein Wirtschaftsweg addieren sich zu nichts; Zahlen
  stehen nur je Thema.
- **Themen** (`themenHtml`) — **eine** Liste, nicht zwei. Je Thema eine Zeile:
  links die Leitzahl, darunter die Objektzahl und **je Layer eine eigene Zeile**
  („1,73 km Verkehrswege") — als durchlaufende
  Aufzählung liessen sich die Werte nicht auseinanderhalten. Rechts der
  **Umfeld-Chip** („Umfeld 2.000 m") — Tooltip = Herleitung des Radius, Klick =
  Zone ein-/ausblenden.
  **Genau EINE Kennzahl je Thema, und welche, steht im Katalog** (`leitmass`
  in `kategorien.js`): Siedlung, Wald und Landwirtschaft sind
  **Flächenbelange**, Verkehr und Leitungsnetze **Streckenbelange**; die
  übrigen entscheiden die Daten (Fläche schlägt Länge). Das ist eine fachliche
  Eigenschaft des Belangs, keine der Daten — zwei Versuche, sie aus den Zahlen
  abzuleiten, gingen daneben: nach Objektzahl gewannen im Siedlungsraum die
  linienhaften Bauwerke, und „Fläche gewinnt immer" setzte bei Verkehr Hektar
  Verkehrsfläche statt Kilometer Strecke. `layerReihenfolge()` sortiert nach
  derselben Messgrösse, damit der Layer oben steht, der die Kennzahl trägt. Die frühere zweiteilige Zahl
  („35,9 km · 2.964 m²") und die Bezugszeile darunter sind wieder entfallen:
  zwei Zahlen nebeneinander sind keine Kennzahl mehr, und die Aufschlüsselung
  je Layer steht ohnehin in der Zeile darunter.
  **Einheitliche Einheiten:** Flächen **immer in Hektar**, Längen **immer in
  Kilometern** (`flaeche()` / `laenge()`, Nachkommastellen nach Grösse). Der
  frühere Wechsel je nach Betrag machte die Zahlen unvergleichbar — im selben
  Diagramm standen „116,8 ha" neben „2.964 m²" und „443 m" neben „135,33 km".
  Zahl und Einheit hängen an einem geschützten Leerzeichen.
  Ihre **Farbe** kommt aus der Kartensymbolisierung des stärksten Layers
  (`themenFarbe()`, gespeist aus `layerFarbe` in `queryLayer`) — ein
  durchgehendes Stahlblau sagte nichts darüber, welcher Bestand gemeint ist.
  Damit die Farbe nicht auf Kosten der Lesbarkeit geht, läuft sie durch
  `lesbareFarbe()`: **über HSL**, nicht über eine proportionale Skalierung der
  Kanäle — die dunkelte zwar korrekt ab, nahm aber die Sättigung mit, und aus
  einem hellen Ockergelb wurde ein müdes Oliv. Jetzt bleibt der Farbton
  unangetastet, die Sättigung wird auf mindestens `MIN_SAETTIGUNG = 0.5`
  angehoben und nur die Helligkeit sinkt, bis **4,5:1** gegen den weissen
  Panelgrund erreicht ist. Ausgenommen sind **neutrale Töne** (`s < 0.15`):
  Grau hat nur einen winzigen Farbstich, und Aufsättigen machte daraus ein
  kräftiges Blau. Gemessen: Ocker `rgb(233,214,160)` → `rgb(139,111,32)`,
  Hellgrün → `rgb(92,128,43)`, Grau `rgb(120,120,125)` → `rgb(116,116,121)`.
  Themen **ohne** Objekte stehen **nicht** in der Liste — eine Zeile ohne Zahl
  ist dort nur Platzhalter. Dass sie geprüft wurden und im Umfeld nichts liegt,
  vermerkt `ohneObjekteHtml()` unten im aufklappbaren Block und die Bilanz
  zählt sie als „n ohne Objekte".
  Die Liste erscheint **erst nach dem Lauf** (`laufFertig`, gesetzt von
  `app.js` am Ende von `runScreening`) — vorher änderte sich mit jeder
  queryLayer-Antwort die Leitzahl. Nur Themen **mit** Objekten. Der Kopf ist
  ein **Raster mit fester Zahlenspalte**, damit alle Themennamen auf derselben
  Kante beginnen; „6.936,2 ha" und „1 ha" sind sonst verschieden breit.
- **Karte**: die gezeichnete Geometrie trägt ein Textetikett mit der
  Vorhabenart, immer nach oben versetzt; die **Zonen-Etiketten** sitzen dagegen
  am **oberen Rand ihres Puffers** (`zonenAnker()`) und sind **blau**. Vorher
  standen alle auf dem Zentroid und lagen übereinander — bei verschiedenen
  Radien hat jetzt jede Zone ihre eigene Höhe (eigener `labelLayer` — im Skizzen-Layer würde das Sketch-Werkzeug
  sie als bearbeitbare Grafik behandeln und die Geometrie-Erkennung stören).
  Am Ende des Laufs schwenkt `zoomeAufTreffer()` auf **alle** gemerkten
  Objekte (mit etwas Luft über `view.scale`); während des Laufs passiert das
  nicht, das wäre ein Springen bei jeder Einzelabfrage. Ein Klick auf ein
  **Lesezeichen** schliesst dessen Aufklapper (`arcgisBookmarkSelect` →
  `expanded = false`) — er verdeckte sonst genau den Ausschnitt, zu dem er
  gesprungen ist.
  Nach dem Lauf ruft `zeigeGefundeneObjekte()` (aus `app.js` am Ende von
  `runScreening`) erst `alleLayerAus()` und blendet dann nur die abgefragten
  Layer ein — **gefiltert allein über die ObjectIDs**.
  **Gefiltert wird über `FeatureFilter.objectIds` an der LayerView**
  (`FeatureFilter.d.ts:205`, `FeatureLikeLayerView.filter` seit 4.11), nicht
  mehr über `definitionExpression`. Grund: die `definitionExpression` hängt der
  Layer an **jede Kachelanfrage** an. 277 ObjectIDs sind dort rund 1.900
  Zeichen, der frühere Deckel von 2.000 IDs wäre über 14.000 gewesen — weit
  jenseits dessen, was ein Dienst in einer URL annimmt. Im Lauf vom 2026-10-11
  schlugen unmittelbar nach dem Setzen der Filter **161 Kachelanfragen** fehl,
  verteilt auf die 12 Kacheln des Sichtfelds. Der LayerView-Filter wirkt
  clientseitig; die Kacheln laden unverändert.
  Die LayerViews werden **einmal beim Kartenstart** geholt
  (`merkeLayerViews()`, hängt sie als `__lv` an den Layer) — damit bleibt
  `zeigeLayerGefiltert()` **synchron**. Das ist keine Kosmetik: holte die
  Funktion die LayerView selbst per `await`, könnte das Zurücknehmen in
  `alleLayerAus()` nach dem Setzen landen und den frischen Filter wieder
  löschen — bei schnellen Klicks in der Ergebnisliste ein Wettrennen mit leerer
  Karte als Ausgang. `MAX_ID_FILTER` ist auf **200** gesenkt und gilt nur noch
  für den `definitionExpression`-Rückfall (nicht-numerische IDs, fehlende
  LayerView); darüber bleibt der Layer lieber ungefiltert sichtbar als
  unsichtbar.
  **Im Lauf vom 2026-10-11 bestätigt:** `[karte] LayerViews bereit: 27/36` und
  **null** Kachelfehler (vorher 161). Die neun ohne `filter`-Fähigkeit sind die
  **Gruppenlayer** der Webmap (Gewässer, Vegetation, Verkehr, Bauwerke und
  Einrichtungen, …) — die tragen keine Features und brauchen keinen Filter. Ein `where` taugt dafür
  nicht: es filtert nach Attribut ohne Raumbezug und legt den landesweiten
  Bestand über die Karte. Ohne brauchbare IDs bleibt der Layer aus. Während des
  Laufs passiert nichts, sonst flackert die Karte bei jeder Einzelabfrage.
  Ausgenommen von `alleLayerAus()`: die Grundkarte (`GRUNDKARTE_TITEL` bzw.
  Kachel-Layertypen) und die eigenen Grafik-Layer, die über `__eigen` markiert
  sind — sonst verschwände die gezeichnete Vorhabengeometrie.
  **Rote Treffer-Grafiken gibt es nicht mehr**: `merkeTreffer` speichert nur
  Geometrie, Attribute und ObjectID; die Objekte erscheinen in der eigenen
  Signatur des Layers, der Feature-Klick trifft per `hitTest` den echten
  Webmap-Layer.
- **Aufgeklappt**: **je Layer ein eigenes Ringdiagramm** (`.an-layerbox`,
  aufklappbar, das erste offen) mit Legende (Wert, Maß, Prozent). Bewusst nicht
  mehr eines je Thema: unter „Natur und Landschaft" liegen Hecken (Länge) und
  Naturschutzgebiete (Fläche), und ein Ring aus Kilometern und Quadratmetern
  ist keine Aufteilung, sondern eine Falschaussage. Gilt genauso im PDF. Die Segmentfarben kommen aus der
  **Kartensymbolisierung**: je Ausprägung geht ein Vertreter-Feature an
  `symbolUtils.getDisplayedColor(graphic, { renderer })` — dieselbe Frage, die
  auch die Darstellung stellt, also inklusive Unique-Value, Class-Breaks,
  visueller Variablen und CIM-Symbolen. Vorher habe ich die Farbe selbst aus
  `symbol.color` gepult; CIM-Symbole aus ArcGIS Pro haben das gar nicht,
  deshalb blieben die Segmente in der Ersatzpalette.
  **Drei Fokusstufen, eine Stelle die zeichnet** (`zeigeNachFokus()` — vom
  engsten zum weitesten): ein **Segment** zeigt eine Ausprägung, eine
  **Layerzeile** einen Layer, ein **aufgeklapptes Thema** alle Layer dieses
  Themas, und ohne Fokus steht alles Gefundene da. Zuklappen des Themas gibt
  die Karte wieder frei. Vorher setzte jede Klick-Behandlung die Karte selbst,
  und ein abgewähltes Thema hinterliess einen leeren Zustand. **Weder Zoom noch Blinken** — der Kartenausschnitt gehört dem
  Nutzer, nicht der Liste; `schwenkeZuObjekten` und `blinkeTreffer` werden vom
  Panel nicht mehr aufgerufen. Zurück führt der Knopf **„Alle Objekte zeigen"**
  neben der Überschrift (`zeigeAlleTreffer()`), der hervorgehoben ist, solange
  die Karte nur einen Ausschnitt zeigt. Ein **Auge-Symbol** je Thema blendet
  den Layer aus und wieder ein; standardmäßig sind alle sichtbar.
  Darunter ein Infoblock mit Einordnung, Regionalplan, Fachrecht und den
  abgefragten Layern — keine Zahlen, die stehen schon in der Zeile.
- **Themen ohne relevante Objekte**: aufklappbarer Block unter den Themen mit den
  verworfenen Kategorien samt Begründung und Fundstelle. Die Überschrift trennt
  dahinter **zwei** Restgruppen, weil das fachlich zweierlei ist
  (`ungeprueftHtml()`, deterministisch aus Katalog und Recherchevermerk):
  „n ohne Einstufung" — `recherchiere` ist gelaufen, die Meldung blieb aus —
  und „n nicht betrachtet". Der Vermerk kommt aus `merkeRecherche()`
  (`analyse.js`), gesetzt in `recherchiere` **vor** der Suche und unabhängig
  vom Befund. Anlass: ein Lauf, in dem der Agent alle acht Kategorien
  recherchierte („durchsucht Regionalplan und Gesetzeskorpus (wald)") und
  danach mit „Ich kann die Phase-1-Meldungen hier nicht liefern" keine einzige
  meldete — das Panel schrieb „8 nicht betrachtet", eine Falschaussage.
- **Herangezogene Grundlagen** stehen als **Sprechblase am Info-i** der
  Planungsregion (`grundlagenInhalt()`, `.an-blase`) — geltender Plan,
  Zuordnungsweg und die RAG-Passagen im Wortlaut. Der Plan-Link zeigt auf das
  **lokal abgelegte PDF** unter `Regionalplaene/`; die Behörden-URLs hatten die
  Umlaut-Umstellung nicht überlebt und waren tot.

Zusätzlich: **PDF-Export** (`src/screening/pdf.js`, inkl. Aufschlüsselung).
Entfallen: Rückfragen an den Assistenten.

## Startnachricht

Im Steuerpanel unter "Nachricht an den Assistenten" steht die **erste Nachricht**,
die rausgeht: Auftrag, Vorhabenart samt Beschreibung, die gezeichnete Geometrie
mit Maßen und der Nutzerkommentar (`baueKontextText()` in app.js). Bearbeitbar.
Den Phasenauftrag (`instr.phase1` / `instr.phase2`) und den Sprachhinweis hängt
`eineNachricht()` automatisch dahinter.

Der **Systemprompt** (`SCREENING_PROMPT` in `agents.js`) wird bei
`createLLMAgent` gesetzt und ist bewusst **nicht** im UI — er ist nicht Teil der
Nachricht.

### Kontextbudget

Der Systemprompt liegt bei ~7.000 Zeichen, die Werkzeugbeschreibungen bei
~5.700. `beschreibeLayer` ist auf `MAX_FELDER = 25` und `MAX_CODES = 20`
gedeckelt und filtert Systemfelder heraus — sein Ergebnis bleibt in der
Nachrichtenhistorie und geht bei **jeder** weiteren Modellrunde erneut mit.
Ein ungedeckelter Layer mit langen Domänenlisten hat den Lauf gekippt.

## RAG (`rag/`)

Python/FastAPI, **retrieval-only**, ChromaDB, Embeddings via Ollama
`embeddinggemma`. **Zwei getrennte Collections:**

| Collection | Inhalt | Ingest | Filter |
|---|---|---|---|
| `rechtsgrundlagen` | 21 Gesetzes-PDFs in `Rechtsgrundlagen/` | `npm run rag:ingest` | keiner (Volltext) |
| `regionalplaene` | 7 Regionalplan-PDFs in `Regionalplaene/` | `npm run rag:ingest:rp` | `rp_<region>` |

Endpunkte: `POST /rechtsgrundlage {frage}` und `POST /regionalplan {region, frage}`.
Port 8000, CORS offen. `npm run dev` startet den Server automatisch mit
(Vite-Plugin). **Ollama muss laufen.**

### `/belange` — welche Belange sind für DIESES Vorhaben einschlägig?

Die umgekehrte Frage zu `/rechtsgrundlage`: dort ist der Belang vorgegeben und
gesucht wird die Norm, hier ist nur das Vorhaben bekannt. Sie ersetzt die
Stelle, an der die Einstufung **dreimal** gescheitert ist (8/8 relevant, dann
0/8, dann 1/8) — das Modell urteilt dort nicht mehr, es **liest**.

**Zwei Verfahren wurden gemessen und verworfen:**

1. **Treffer je Rechtsgebiet auszählen** über die `rb_<gebiet>`-Flags. Misst
   mit, wie dick ein Gesetz ist: Leitungsrecht stellt 1.382 der 4.407 Chunks
   (31 %), Waldrecht 179 (4 %) — entsprechend landete Leitungsrecht bei Wind,
   Mobilfunk *und* Photovoltaik auf Platz 1.
2. **Dasselbe, normiert auf den Korpusanteil** (Lift = beobachtet/erwartet).
   Kippt in die Gegenrichtung: die kleinen Gebiete gewinnen, Bauordnungsrecht
   steht überall vorn, und bei einer Windenergieanlage fällt ausgerechnet der
   **Naturschutz** heraus.

**Was bleibt, zählt gar nichts: die Liste steht im Gesetz.** § 35 Abs. 3 BauGB
zählt die öffentlichen Belange auf, die einem Aussenbereichsvorhaben
entgegenstehen können — Flächennutzungsplan, Wasser-/Abfall-/Immissionsschutz,
schädliche Umwelteinwirkungen, Verkehrseinrichtungen und Versorgung,
Naturschutz/Landschaftspflege/Bodenschutz/Denkmalschutz/Landschaftsbild,
Agrarstruktur/Wasserwirtschaft/Hochwasserschutz, Splittersiedlung, Funkstellen.
Der Endpunkt liefert die Passagen im **Wortlaut** (`BELANGE_ZEICHEN = 1200` —
weniger, und die Aufzählung bricht mittendrin ab), das Modell liest sie ab und
nennt die Fundstelle.

Gemessen am 2026-10-09: § 35 BauGB liegt für **alle sechs Vorhabenarten** unter
den ersten fünf Treffern, bei vieren auf Platz 1. Dazu kommen die
vorhabenspezifischen Normen (BNatSchG § 45b bei Wind, FStrG § 9 bei
Photovoltaik, TKG bei Mobilfunk).

#### Die Ankernormen — geholt statt gesucht (seit 2026-10-11)

**Die Lücke, die das schliesst:** Belange mit eigenem Genehmigungstatbestand
stehen nicht in § 35 Abs. 3. **Wald war der Anlass** — die Waldumwandlung
regelt § 39 LFoG NRW, und Forstrecht erschien in den gesuchten Passagen nie,
auch nicht bei 14 Treffern und auch nicht mit einer zweiten, eingriffsbezogenen
Frage („Rodung, Zuwegung, Versiegelung"): der Vorhabentyp dominiert das
Embedding zu stark.

**Gemessen am 2026-10-11 war der Wald aber kein Sonderfall, sondern der
Normalfall.** Vorhaben WEA, `/belange` mit den acht Ankernormen: die Suche
lieferte BauGB §§ 16b/35, BNatSchG §§ 26/45b, WHG § 11a, BauO NRW § 6 — also
**genau eine** der acht Ankernormen (§ 35 BauGB). Sieben von acht
Tatbestandsnormen fehlten in den Passagen:

| Kategorie | Ankernorm | in den Passagen? |
|---|---|---|
| siedlung | BauGB § 35 | ja |
| natur | BNatSchG § 14 | nein |
| wasser | WHG § 38 | nein |
| wald | LFoG NRW § 39 | nein |
| verkehr | FStrG § 9 | nein |
| energie | EnWG § 43 | nein |
| landwirtschaft | BauGB § 1a | nein |
| kulturlandschaft | DSchG NRW § 9 | nein |

**Der Denkfehler war, § 35 Abs. 3 für einen Retrieval-Erfolg zu halten.** Er
kommt zuverlässig, weil wir **wissen, wo der Katalog steht** — nicht weil die
Suche gut ist. Dieselbe Kenntnis liegt für jede Kategorie im Katalog
(`ankernorm` in `kategorien.js`), also wird sie auch so benutzt:

- `/belange` nimmt eine Liste `ankernormen: [{kuerzel, norm, kategorieId}]`
  und holt jede über **`col.get(where=…)`** — reiner Metadatenzugriff. Kein
  Embedding, keine Ähnlichkeit, keine Abstinenzschwelle, nichts zu fusionieren.
  Die Norm kommt zurück oder sie steht nicht im Korpus (`ankerFehlend`).
- **Warum aus dem LFoG keine Liste zu holen ist:** § 35 Abs. 3 BauGB ist ein
  *Katalog* — eine Passage, viele Belange, deshalb als Entdeckungsschritt
  brauchbar. Ein Fachgesetz regelt *ein* Schutzgut. Es braucht aber auch keine
  Liste: zu welcher Kategorie es gehört, steht im Katalog.
- **`_ankernorm()` wählt nicht das erste Chunk.** Bei DSchG NRW § 9 ist das
  erste Stück ein Inhaltsverzeichnis-Artefakt aus 269 Zeichen („Abschnitt 3 /
  Denkmalbereiche / Herausgeber: …"), der Normtext steht im zweiten. Gewählt
  wird das erste Stück mit **`(1)` am Zeilenanfang**, und der Auszug beginnt
  dort — das schneidet bei LFoG NRW § 39 zugleich den Fussnotenblock weg, der
  sonst die halbe Auszugslänge frisst. Fehlt der Marker, gewinnt das längste
  Stück. Sortiert wird über die laufende Nummer am Ende der Chunk-ID.
  `ANKER_ZEICHEN = 760`; bei 600 fiel die Fünf-Meter-Angabe in § 38 WHG heraus.
- **Nebengewinn für den Radius:** § 38 WHG („fünf Meter"), § 9 FStrG („40
  Meter", „20 Meter") und § 43 EnWG („200 Metern") tragen ihre Maße im
  Wortlaut. `radiusBelegt()` liest `anker:<kategorieId>` **als erste Quelle** —
  vorher hing die Belegbarkeit daran, ob die Suche die richtige Norm fand.

**Drei Gruppen statt zwei.** Weil jede Kategorie ihre Tatbestandsnorm im
Wortlaut vor sich hat, ist OFFEN nicht mehr die Sammelstelle für „Suche hat
nichts gefunden": **BELEGT** (in einer Passage genannt oder die Ankernorm
knüpft einen auslösbaren Tatbestand an), **NICHT BERÜHRT** (Ankernorm liegt
vor, ihr Tatbestand kann von dieser Bauart nicht ausgelöst werden — mit
Fundstelle und dem fehlenden Tatbestandsmerkmal) und **OFFEN** nur noch für
Kategorien in `ankerFehlend`. Recherchiert werden weiterhin alle Gruppen,
verworfen wird erst in `meldeNichtRelevant`.

### Hybride Suche (seit 2026-10-09)

Vorher reine Vektorsuche, `n_results=6`, fertig. Das war der Eigenbau, der die
Retrievalqualität allein von der Formulierung des Suchtexts abhängig machte.
Jetzt der übliche Aufbau:

1. **Zwei Zweige, je `KANDIDATEN = 40`** — Dense über `embeddinggemma`, dazu
   BM25 (`rank_bm25`) über eine beim ersten Zugriff gebaute Collection-Kopie.
   Der Stichwortindex nimmt Überschrift und Zitat mit auf; die Tokenisierung
   trennt am `§` und behält Ziffern, damit „38" in „§ 38 WHG" ein Suchwort ist.
2. **Reciprocal Rank Fusion**, `RRF_K = 60`. Punktzahlen aus Kosinus und BM25
   sind nicht vergleichbar — fusioniert werden deshalb die Ränge.
3. **Abstinenz-Schwelle `MIN_AEHNLICHKEIT = 0.45`**, geprüft an der besten
   Ähnlichkeit der **ganzen Anfrage**, nicht je Treffer: Liegt sie darunter,
   kommt eine leere Liste. Vorher lieferte die Suche immer sechs Paragraphen,
   auch wenn der Korpus zum Thema nichts enthielt — und das Modell las sie als
   Befund.
4. **Dubletten raus** über `kuerzel|norm` bzw. `kuerzel|nummer`. Ein Ziel kann
   über mehrere Chunks laufen; zweimal dieselbe Fundstelle verbraucht einen der
   wenigen Plätze beim Modell.

Die Antwort führt `aehnlichkeit` und `stichwort` getrennt mit, damit
nachvollziehbar bleibt, welcher Zweig einen Treffer nach oben gebracht hat.

**Gemessen am 2026-10-09** (Vorhaben WEA, Münsterland, `top_k=4`): alle acht
Kategorien liefern in beiden Korpora ausschliesslich einschlägige Normen —
Wasser → WHG/LWG NRW, Wald → LFoG NRW/BWaldG, Kulturlandschaft → DSchG NRW,
Verkehr → FStrG/StrWG NRW, keine Dubletten. Zum Vergleich: mit reiner
Vektorsuche kam für Kulturlandschaft kein Denkmalrecht zurück.

**Zwei Befunde aus der Messung, die der Intuition widersprechen:**

- **Eine absolute BM25-Grenze wäre genau falsch herum.** „Waldumwandlung
  Genehmigung" (einschlägig) erreicht 9,80 Punkte, „Bundesliga" (abwegig)
  12,44. Die Stichwortpunktzahl hängt an der Wortseltenheit, nicht an der
  Einschlägigkeit. Trennscharf ist allein die Vektor-Ähnlichkeit: Katalogfragen
  0,584–0,727 gegen 0,000–0,181 bei abwegigen.
- **Die Hybridsuche rettet eine schlechte Frage nicht.** Mit dem alten
  Suchtext (Vorhabentyp zuerst) liefert sie für Kulturlandschaft weiterhin kein
  Denkmalrecht. Sie macht robuster, ersetzt aber `wirkungsfrage()` nicht.

**Der Korpus braucht echte Umlaute.** „Gewaesserrandstreifen" in ASCII fällt
unter die Abstinenz-Schwelle und liefert **null** Treffer, „Gewässerrandstreifen"
findet WHG § 38 auf Platz 1 (Ähnlichkeit 0,65). Das ist der harte Grund hinter
der Projektregel zu Umlauten in Suchtexten.

Tempo: ein dauerhafter `httpx.Client` statt eines neuen je Anfrage und ein
`lru_cache` auf `_embed_query` — die Suchtexte stammen aus dem festen
Kategorien-Katalog und wiederholen sich, der Ollama-Roundtrip entfällt dann.

### Regionalplan-Korpus — die 7 Planungsregionen

`rag/regionalplaene.py` (Katalog + Kreis→Region) und `src/screening/regionen.js`
(dieselbe Zuordnung im Frontend). Der **Regionalplan Ruhr** hat die Pläne der
Bezirke Düsseldorf, Münster und Arnsberg im RVR-Gebiet abgelöst — das
Verbandsgebiet ist aus diesen drei Bezirken herausgeschnitten.

| Region | Plan | Stand |
|---|---|---|
| ruhr | Regionalplan Ruhr | Lesefassung Aug. 2026 |
| duesseldorf | Regionalplan Düsseldorf (RPD) | Gesamtfassung 05.03.2026 |
| koeln | Regionalplan Köln (Neuaufstellung) | Sept. 2025 |
| muensterland | Regionalplan Münsterland | 2025 |
| owl | Regionalplan OWL | rechtskräftig 16.04.2024 |
| arnsberg_soest_hsk | RP Arnsberg, TA Soest/HSK | März 2012 |
| arnsberg_suedwestfalen | RP Arnsberg, TA MK/OE/SI | Februar 2025 |

### Chunking der Regionalpläne (`rag/ingest_rp.py`)

Zweistufig, weil die Pläne unterschiedlich nummerieren:

1. **Marker-Chunking** — ein Chunk je Ziel/Grundsatz. Zwei Muster:
   `G II.1-1 Titel` (Münsterland, OWL) und `1.4-1 Ziel: Titel` (RP Ruhr).
   Inhaltsverzeichnis-Zeilen werden über die Punktführung im Zeilenfenster
   gefiltert.
2. **Seiten-Fallback** — greift bei unter 25 Marker-Treffern (RPD, Köln,
   Arnsberg Soest/HSK): ein Chunk je Seite, Fundstelle ist dann die
   Seitenzahl statt einer Ziel-Nummer.

Seitentexte werden **einmal** extrahiert (`seiten_roh`), sonst würden die
großen PDFs zweimal gelesen. Zwei PDFs sind AES-verschlüsselt — dafür ist
`cryptography` im venv nötig (bereits installiert).

Aktueller Stand: **1394 Chunks** über alle sieben Pläne (Gesetzeskorpus: 4407).
Geprüft am 2026-09-04 gegen `rag/chroma_db`.

## Projektstruktur

```
index.html                     Topbar (Esri-Logo) + links zwei Karten
                               (Vorhabenart, Geometrie samt Sketch-Werkzeugen
                               und Import) + Nachricht + Startknopf + Ablauf;
                               Karte in der Mitte, Ergebnis rechts (520 px)
app.js                         Verdrahtung, Ablaufsteuerung, Panels
style.css                      Design-System (Stahlblau, Avenir Next / Nunito Sans)
eslint.config.js               nur Korrektheitsregeln (no-undef u. a.)
vite.config.js                 Port 5173 fest (OAuth-Redirect-URI) + RAG-Autostart
src/config.js                  PORTAL_URL, WEBMAP_ID, APP_ID, MODEL_TIER, RAG_URL
src/i18n.js                    DE/EN-Umschalter
src/oauth.js                   ArcGIS-OAuth (übernommener, funktionierender Stand)
src/karte.js                   <arcgis-map> + Widgets + Sketch (Punkt/Linie/Fläche).
                               Messen über arcgis-distance-measurement-2d und
                               arcgis-area-measurement-2d in EINEM Aufklapper —
                               arcgis-measurement ist seit 5.0 abgekündigt und
                               zeigte nichts mehr. Dazu Grundkarten-Galerie,
                               arcgis-zoom und arcgis-home.
                               **Auswahl** über `SelectionOperation` (seit
                               5.1) und `view.selectionManager` — dieselbe
                               Mechanik wie im Experience Builder: Zeiger,
                               Rechteck, Lasso, aufheben. Die Operation ist
                               EINMAL verwendbar, für jede Auswahl wird eine
                               neue erzeugt; Highlighting und Trefferzahl
                               kommen vom Manager. Vor jedem Start
                               `syncSources()`, sonst kennt er nur die Layer
                               von damals.
                               Der Sketch sitzt im linken Panel und ist über
                               `referenceElement` an die Ansicht gebunden;
                               zeichneZone / zeigeZone / merkeTreffer /
                               fokussiereTreffer / zeigeLayerGefiltert; Feature-Klick
src/screening/vorhaben.js      Katalog der 6 Vorhabenarten
src/screening/regionen.js      Kreis -> Planungsregion -> Regionalplan
src/screening/kontext.js       Vorhabenart + Kommentar (holeVorhabenKontext)
src/screening/kategorien.js    Katalog der 8 Kategorien (rechtlich hergeleitet
                               aus den Festlegungskapiteln nach § 7 ROG)
src/screening/tools.js         FunctionTools des Hauptagenten + Fortschritts-Middleware
src/screening/agentlauf.js     graphVon / laufen / frage - die gemeinsame
                               Mechanik, mit der ein Subagent laeuft. Eigenes
                               Modul, damit tools.js <-> subagenten.js kein
                               Importzyklus wird
src/screening/bericht.js       BerichtAgent + formuliereBericht() - von
                               fasseZusammen aus tools.js gerufen
src/screening/subagenten.js    Vier Subagenten hinter drei Werkzeugen:
                               klaereBelange (BelangeAgent), recherchiere
                               (Regionalplan + Gesetz, parallel + Cache),
                               pruefeKategorie (LayerAgent, je Kategorie)
src/import.js                  Shapefile-Upload: der Nutzer wählt den ORDNER
                               (`webkitdirectory`), die Teile werden per JSZip
                               im Browser gepackt und an den Portal-Endpunkt
                               `features/generate` geschickt. Dazu Koordinaten
                               in 7 Formaten (inkl. Grad/Minute/Sekunde)
src/screening/agents.js        initAgents(): EIN Screening-Agent
src/screening/analyse.js       Ergebnis-Store + Kennzahlen + Themen im Detail
                               (Ringdiagramm, Segment-Filter, Auge-Schalter)
src/screening/rag.js           Fundstellen ("regionalplan" / "gesetz")
src/screening/fortschritt.js   Schritt-/Phasen-Bus
src/screening/pdf.js           jsPDF-Export des Screenings
```

## Datengrundsatz (Prompt)

Der Agent bewertet **nur, was in der Karte liegt**. Keine Spekulation über
nicht erfasste Objekte, kein „Datengrundlage möglicherweise unvollständig".
Fehlt ein Layer, sagt er das.

## Offene Punkte / nicht verifiziert

- **Gemeinde → Kreis ist gelöst** (2026-09-05). Der Grenzlayer führt `AGS`,
  `ARS` und `SN_L`/`SN_R`/`SN_K` einzeln; darüber läuft `regionAusKreis()`.
  Elf Kreise gegengeprüft, alle eindeutig. `karte.js:grenzlayerDiagnose()`
  schreibt das Schema weiterhin beim Kartenstart in die Konsole — nützlich,
  falls die Webmap einmal einen anderen Grenzlayer bekommt.
- **Im Browser gelaufen, aber nicht systematisch getestet.** Bestätigt
  funktionierend: Anmeldung, Kartenaufbau, Zeichnen, die Kette über beide
  Phasen, Regionszuordnung (Wuppertal → Düsseldorf, OWL, Metropole Ruhr),
  Ringdiagramm mit Kartenfarben, PDF. Nicht geprüft: Shapefile-Import über
  JSZip, Koordinateneingabe in den projizierten Formaten, die beiden
  Nachfass-Schritte (`fehlendeKategorien`, `offeneLayer`) im echten Lauf, und
  ob `regionAusSchluessel` je greift — das hängt an den Attributen des
  Grenzlayers.
- **Retrievalqualität der Regionalpläne ungeprüft.** Drei Pläne laufen über
  den Seiten-Fallback und liefern daher gröbere Fundstellen.
- Regionalplan Arnsberg TA Soest/HSK ist von **2012** — deutlich älter als die
  übrigen. Für eine Demo besser eine Region mit aktuellem Plan wählen (OWL,
  Ruhr, Köln, Münsterland).
- **Kosten: in der Beta keine** (geprüft am 2026-10-11 an Esris FAQ). Nach
  der Beta nach Zahl der Aufrufe. Gemessen ist der Verbrauch nicht.
  Ein Tokenzähler über alle sechs Agenten war am 2026-10-11 gebaut und am
  2026-10-20 auf Wunsch wieder **entfernt** — er hatte seinen Zweck erfüllt:
  die Zahlen kommen als `usage_metadata` an der Modellnachricht an (für den
  Hauptagenten gemessen, 10 Aufrufe / 57.862 Tokens), gelesen im
  `afterModel`-Hook einer Middleware. Wer ihn wieder braucht: `handler` ist in
  `AgentMiddleware` PFLICHT (`middlewares/types.d.ts:73`), ein Durchreicher
  `(req, next) => next(req)` genügt — ohne ihn fallen alle Subagenten mit
  `n.handler is not a function` aus.
  Als Gegenprobe taugt die Credit-Anzeige des Portals (Organisation →
  Credits) vor und nach einem Lauf; sie misst, was wirklich abgerechnet wird.

  **Was ein Lauf an Modellaufrufen auslöst** (aus dem Log vom 2026-10-11
  hochgerechnet, nicht gemessen): 4 Intent-Erkennungen des Orchestrators,
  ~46 Runden im Hauptagenten (42 Werkzeugaufrufe), ~32 in den beiden
  Recherche-Agenten, ~126 im LayerAgent (21 Läufe), ~3 im BerichtAgent —
  zusammen rund **210 Modellaufrufe**. Davon waren 20 von 42
  `pruefeKategorie`-Aufrufen Wiederholungen durch den 429-Fehlalarm; nach
  dessen Behebung sollte der nächste Lauf deutlich darunter liegen.
- **Ein bewusst übersprungener Layer wird nirgends vermerkt.** Der
  `LayerAgent` darf einen Layer ausdrücklich als nicht einschlägig abtun
  („BaumreihenundHecken: übersprungen – gehört fachlich zu natur"), und das
  steht auch in seiner Antwort. `offeneLayer()` sieht davon nichts: es
  vergleicht nur gegen `getAnalyse().abfragen` und schlägt denselben Layer in
  der nächsten Runde wieder vor. Im Lauf vom 2026-10-11 blieben so über drei
  Nachfass-Runden 6 → 5 → 5 Layer „offen", bis die Abbruchbedingung („keine
  Bewegung mehr") griff — zwei Runden ohne Wirkung. Behebbar mit einem
  `merkeUebersprungen(kategorieId, layer, grund)`, das `offeneLayer()` dann
  ausschliesst; offen, weil zu klären ist, ob ein übersprungener Layer im
  Ergebnispanel erscheinen soll.

- **Der Agent hält sich nicht zuverlässig an den Prompt.** Er hat Feldnamen
  erfunden, Kategorien übergangen, Layer ausgelassen und lagebezogen statt
  grundsätzlich begründet. Alles, was stimmen muss, ist deshalb im Code
  abgesichert — Feldprüfung, Filter-Verwerfen, exakte Zählung, zwei
  Nachfass-Schritte. **Neue Anforderungen an das Modell gehören ins Werkzeug,
  nicht in den Prompt.**

## Arbeitsweise / Präferenzen

- Vor dem Löschen bestehender Business-Logik nachfragen.
- Bei mehrdeutigem Projektstand nachfragen statt raten.
- Deutsch für UI-Texte, Code-Kommentare und Doku. **Echte Umlaute (ä ö ü ß) in
  JS-Strings, Template-Text und Kommentaren** — kein ae/oe/ue mehr.
  **Bezeichner bleiben ASCII** (`flaecheM2`, `laengeM`, `kategorieId`), ebenso
  i18n-Schlüssel und die Regions-IDs (`koeln`, `muensterland`), weil die gegen
  externe Daten bzw. `data-i18n` im HTML matchen müssen.
- Bei ArcGIS-JS-Arbeit den Skill `.claude/skills/arcgis-js-api/` nutzen:
  Namen gegen die installierten `.d.ts` prüfen, nichts raten, kein CDN.
- **`npm run lint` vor jedem Abschluss** (ESLint, nur Korrektheitsregeln).
  `vite build` ist grün bei undefinierten Bezeichnern — `no-undef` nicht.
  Genau so ist `MAX_TREFFER is not defined` in den Browser gelangt.
