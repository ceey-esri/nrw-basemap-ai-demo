# -*- coding: utf-8 -*-
"""Baut die Tafel der technischen Uebersicht neu.

Stand 2026-10-11: fuenf Subagenten, Hauptagent mit nur noch fuenf Werkzeugen,
und das RAG mit Korpus, Ollama und ChromaDB im selben Bild.
"""
import io

from pathlib import Path

# Relativ zum Skript, damit es aus jedem Arbeitsverzeichnis laeuft.
HIER = Path(__file__).resolve().parent
UEBERSICHT = str(HIER.parent / "praesentation" / "uebersicht.html")


P = UEBERSICHT

OR, ORH, SDK, GR, LI, ERG, DOK = (
    "#b8700f", "#c98a1e", "#1f6fb8", "#2b6e4f", "#7a66b8", "#1f7a63", "#8a6d3b")
L = []


def t(x, y, txt, size=11, fill="currentColor", op=None, w=None, anchor=None,
      fam="sans-serif"):
    a = f' text-anchor="{anchor}"' if anchor else ""
    o = f' fill-opacity="{op}"' if op else ""
    b = f' font-weight="{w}"' if w else ""
    L.append(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" '
             f'fill="{fill}"{o}{b}{a}>{txt}</text>')


def box(x, y, bw, h, farbe=None, stroke="currentColor", sop="0.45", sw="1", rx=6):
    f = f'fill="{farbe}" fill-opacity="0.12"' if farbe else 'fill="none"'
    L.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{h}" rx="{rx}" {f} '
             f'stroke="{stroke}" stroke-opacity="{sop}" stroke-width="{sw}"/>')


def pfeil(x1, y1, x2, y2, farbe, marker, sw="1.4"):
    L.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{farbe}" '
             f'stroke-width="{sw}" marker-end="url(#{marker})"/>')


def knick(d, farbe, marker, sw="1.3"):
    L.append(f'<path d="{d}" fill="none" stroke="{farbe}" stroke-width="{sw}" '
             f'marker-end="url(#{marker})"/>')


# ── Geometrie der Spalten ─────────────────────────────────────────────────
SDK_X, SDK_W = 16, 126
FN_X, FN_W = 156, 200
HA_X, HA_W = 486, 186
SA_X, SA_W = 802, 250
# Zwischen Subagenten und RAG eine Gasse von 48 px fuer die Sammelpfeile,
# zwischen RAG und Korpus eine von 132 px fuer die drei Zugriffspfeile samt
# Beschriftung. Vorher waren es 16 bzw. 24 px, und die Beschriftungen lagen
# im Nachbarkasten.
RAG_X, RAG_W = 1100, 200
AUF_X, AUF_W = 1432, 200
GASSE_SA = 1070          # Sammelpfeile der fragenden Agenten
GASSE_ANKER = 1082       # Rueckweg der Ankernorm
MITTE_L, MITTE_R = 421, 737          # Beschriftungsgassen
HA_R = HA_X + HA_W                   # 672
FN_R = FN_X + FN_W                   # 356


def funk(y, h, titel, datei, x=FN_X, bw=FN_W):
    box(x, y, bw, h)
    t(x + 14, y + 22, titel, 12.5, w="700")
    t(x + 14, y + 40, datei, 9.5, op="0.6", fam="monospace")


def sdkbox(y, eintraege, x=SDK_X, bw=SDK_W, nach_rechts=True):
    """Blaue Spalte: SDK-Aufrufe, je mit Ort der Ausfuehrung."""
    h = 14 + 27 * len(eintraege)
    box(x, y, bw, h, SDK, SDK, "1", "1.4")
    yy = y + 20
    for name, ort in eintraege:
        t(x + 10, yy, name, 8.6, fill=SDK, w="700", fam="monospace")
        t(x + 10, yy + 11, ort, 7.8, fill=SDK, op="0.75")
        yy += 27
    if nach_rechts:
        pfeil(x + bw + 14, y + h // 2, x + bw + 4, y + h // 2, SDK, "pfs", "1.3")
    return h


def paar(y, x1, x2, mitte, hin, rueck, hin2=None, rueck2=None):
    """Orange hinaus, gruen zurueck, Beschriftung in der Gasse."""
    pfeil(x1, y, x2, y, OR, "pfo")
    pfeil(x2, y + 30, x1, y + 30, GR, "pfg")
    t(mitte, y - 6, hin, 9.3, fill=OR, anchor="middle", w="600")
    if hin2:
        t(mitte, y + 6, hin2, 9.3, fill=OR, anchor="middle", w="600")
    t(mitte, y + 44, rueck, 9.3, fill=GR, anchor="middle", w="600")
    if rueck2:
        t(mitte, y + 56, rueck2, 9.3, fill=GR, anchor="middle", w="600")


# ── Spaltenkoepfe ─────────────────────────────────────────────────────────
t(SDK_X + SDK_W // 2, 20, "MAPS SDK", 10, fill=SDK, w="600", anchor="middle",
  fam="monospace")
t(SDK_X + SDK_W // 2, 32, "Operator / Abfrage", 8, fill=SDK, op="0.8",
  anchor="middle")
t(FN_X + FN_W // 2, 26, "FUNKTIONEN · fester Code", 10, op="0.6",
  anchor="middle", fam="monospace")
t(SA_X + SA_W // 2, 20, "WERKZEUG &#8594; SUBAGENT", 10, fill=ORH, w="600",
  anchor="middle", fam="monospace")
t(RAG_X + RAG_W // 2, 20, "RAG · JE ANFRAGE", 10, fill=LI, w="600",
  anchor="middle", fam="monospace")
t(AUF_X + AUF_W // 2, 20, "KORPUS · EINMAL AUFGEBAUT", 10, fill=DOK, w="600",
  anchor="middle", fam="monospace")
L.append(f'<line x1="{SDK_X}" y1="40" x2="{AUF_X + AUF_W}" y2="40" '
         f'stroke="currentColor" stroke-opacity="0.2"/>')

# ── Hauptagent ────────────────────────────────────────────────────────────
box(HA_X, 54, HA_W, 1000, OR, OR, "1", "2")
t(HA_X + HA_W // 2, 80, "ScreeningAgent", 13.5, w="800", anchor="middle")
t(HA_X + HA_W // 2, 97, "orchestriert", 9.5, fill=OR, w="600", anchor="middle",
  fam="monospace")
L.append(f'<line x1="{HA_X + 14}" y1="108" x2="{HA_R - 14}" y2="108" '
         f'stroke="{OR}" stroke-opacity="0.4"/>')
for i, z in enumerate([
    "Er entscheidet:", "· Reihenfolge der Aufrufe",
    "· welche Kategorien geprüft,", "&#160;&#160;welche verworfen werden",
    "· welcher Radius gemeldet wird", "· wann er nachfasst",
]):
    t(HA_X + 14, 128 + i * 16, z, 9.8, op="0.8" if i == 0 else "0.72")
L.append(f'<line x1="{HA_X + 14}" y1="238" x2="{HA_R - 14}" y2="238" '
         f'stroke="{OR}" stroke-opacity="0.4"/>')
for i, z in enumerate([
    "Fünf Werkzeuge, mehr", "nicht. Er sucht keine", "Layer, misst nichts,",
    "liest keine Karte und", "formuliert den Bericht", "nicht selbst.",
]):
    t(HA_X + 14, 258 + i * 15, z, 9.8, op="0.72")
t(HA_X + HA_W // 2, 1040, "&lt;arcgis-assistant&gt;, off-screen", 9, op="0.55",
  anchor="middle", fam="monospace")

# ── Linke Kette: SDK &#8592; Funktion &#8592; Hauptagent ──────────────────
funk(60, 50, "holeVorhabenKontext", "tools.js")
paar(76, HA_X - 10, FN_R + 10, MITTE_L, "&#8212;", "Vorhabenart, Maße")

funk(150, 50, "bestimmeRegion", "regionen.js · tools.js")
sdkbox(148, [("layer.queryFeatures()", "Abfrage am Dienst")])
paar(166, HA_X - 10, FN_R + 10, MITTE_L, "Vorhabengeometrie",
     "Planungsregion + Plan")

funk(560, 50, "meldeRelevanz", "radiusBelegt() · tools.js")
sdkbox(552, [("geodesicBufferOperator", "lokal im Browser"),
             ("geodeticAreaOperator", "lokal im Browser")])
paar(576, HA_X - 10, FN_R + 10, MITTE_L, "Kategorie + Radius",
     "Zone + Beleg ja/nein")

funk(660, 50, "meldeNichtRelevant", "tools.js")
paar(676, HA_X - 10, FN_R + 10, MITTE_L, "Begründung + Fundstelle",
     "vermerkt")

# Ergebnis
box(FN_X, 1020, FN_W, 70, ERG, ERG, "1", "2")
t(FN_X + 14, 1044, "Panel + Karte", 13, w="800")
t(FN_X + 14, 1061, "ERGEBNIS", 9.5, fill=ERG, w="700", fam="monospace")
t(FN_X + 14, 1078, "analyse.js · karte.js", 9.5, op="0.65", fam="monospace")
sdkbox(1018, [("FeatureFilter.objectIds", "lokal im Browser"),
              ("view.goTo()", "lokal im Browser")])
knick(f"M {FN_X + 100} 980 L {FN_X + 100} 1016", GR, "pfg", "1.4")
t(FN_X + 112, 1004, "Objekte auf ObjectIDs gefiltert", 9.3, fill=GR, w="600")

# ── Rechte Kette: Hauptagent &#8594; Werkzeug &#8594; Subagent ────────────
def werkzeug(y, h, titel, datei):
    box(SA_X, y, SA_W, h)
    t(SA_X + 14, y + 22, titel, 12.5, w="700")
    t(SA_X + 14, y + 40, datei, 9.5, op="0.6", fam="monospace")


def agent(y, h, name, zusatz=None, zusatz2=None):
    box(SA_X, y, SA_W, h, ORH, ORH, "1", "1.5")
    t(SA_X + 14, y + 22, name, 12.5, w="700")
    if zusatz:
        t(SA_X + 14, y + 39, zusatz, 9.3, op="0.72")
    if zusatz2:
        t(SA_X + 14, y + 52, zusatz2, 9.3, op="0.72")
    pfeil(SA_X + SA_W // 2, y - 8, SA_X + SA_W // 2, y - 3, ORH, "pfa")


werkzeug(140, 48, "klaereBelange", "subagenten.js")
paar(156, HA_R + 10, SA_X - 10, MITTE_R, "Vorhaben + Katalog",
     "BELEGT · NICHT BERÜHRT", rueck2="OFFEN, je Kategorie")
agent(198, 64, "BelangeAgent", "§ 35 Abs. 3 BauGB + 8 Ankernormen",
      "Vollständigkeit im Code geprüft")

werkzeug(300, 48, "recherchiere", "subagenten.js · Promise.all")
paar(316, HA_R + 10, SA_X - 10, MITTE_R, "kategorieId + Vorhaben",
     "RELEVANT · ZITAT", rueck2="KERN · RADIUS")
agent(358, 38, "RegionalplanAgent")
agent(402, 38, "GesetzAgent")
t(SA_X + 14, 456, "parallel · je eigener thread_id", 9.3, op="0.65",
  fam="monospace")

werkzeug(560, 48, "pruefeKategorie", "subagenten.js")
paar(576, HA_R + 10, SA_X - 10, MITTE_R, "kategorieId",
     "je Layer Anzahl + Maß")
# 236 statt 126 Hoehe: der SDK-Kasten gehoert IN den Agenten, weil es seine
# eigenen Aufrufe sind. Mit 126 ragte er 82 px unten heraus.
agent(654, 236, "LayerAgent", "eigene Werkzeuge, recursionLimit 40")
t(SA_X + 14, 712, "beschreibeLayer", 10.5, w="700", fam="monospace")
t(SA_X + 14, 728, "queryLayer", 10.5, w="700", fam="monospace")
sdkbox(748, [("queryFeatureCount()", "Abfrage am Dienst"),
             ("layer.queryFeatures()", "Abfrage am Dienst"),
             ("intersectionOperator", "lokal im Browser"),
             ("geodeticArea/Length", "lokal im Browser")],
       x=SA_X + 108, bw=134, nach_rechts=False)
pfeil(SA_X + 100, 768, SA_X + 104, 768, SDK, "pfs", "1.3")

werkzeug(920, 48, "fasseZusammen", "tools.js &#8594; bericht.js")
paar(936, HA_R + 10, SA_X - 10, MITTE_R, "Befunde als Fakten",
     "3 bis 6 Sätze")
agent(998, 64, "BerichtAgent", "keine Werkzeuge",
      "Zahlen gegen die Fakten geprüft")

# ── RAG: die Suche je Anfrage ─────────────────────────────────────────────
box(RAG_X, 54, RAG_W, 482, LI, LI, "1", "1.5")
t(RAG_X + RAG_W // 2, 76, "retrieval-only", 10.5, w="700", anchor="middle")
t(RAG_X + RAG_W // 2, 90, "Python · FastAPI · Port 8000", 8.2, op="0.7",
  anchor="middle", fam="monospace")
t(RAG_X + RAG_W // 2, 102, "KEIN Modell, das Text erzeugt", 8.2, op="0.7",
  anchor="middle", fam="monospace")
t(RAG_X + RAG_W // 2, 116, "angefragt von 3 Subagenten", 8.2, fill=LI,
  w="600", anchor="middle")

SCHRITTE = [
    ("1 Suchtext bauen", "wirkungsfrage() — Belang zuerst"),
    ("2 Frage &#8594; Vektor", "ruft Ollama"),
    ("3 Vektorsuche", "liest ChromaDB · 40 Kandidaten"),
    ("4 Stichwortsuche", "BM25 im Prozess · 40 Kandidaten"),
    ("5 Fusion", "Reciprocal Rank Fusion, k=60"),
    ("6 Abstinenzschwelle", "unter 0,45 &#8594; leere Liste"),
    ("7 Dubletten raus", "je Fundstelle ein Chunk"),
]
S_Y, S_H, S_GAP = 126, 38, 14
for i, (titel, sub) in enumerate(SCHRITTE):
    yy = S_Y + i * (S_H + S_GAP)
    box(RAG_X + 12, yy, RAG_W - 24, S_H, None, LI, "0.5", rx=4)
    t(RAG_X + 22, yy + 15, titel, 9.5, w="700")
    t(RAG_X + 22, yy + 29, sub, 8.2, op="0.7", fam="monospace")
    if i:
        pfeil(RAG_X + RAG_W // 2, yy - 10, RAG_X + RAG_W // 2, yy - 4, LI,
              "pfl", "1.2")

# Ergebnis des RAG
t(RAG_X + RAG_W // 2, 520, "&#8594; Passagen im Wortlaut", 9.5, fill=LI,
  w="700", anchor="middle")

# Wer das RAG anspricht: Belange-, Regionalplan- und Gesetzes-Agent.
# Drei Zubringer auf EINE Sammelleitung, damit nicht drei Knicke
# nebeneinander durch eine 48 px schmale Gasse muessen.
for ay in (225, 377, 421):
    L.append(f'<line x1="{SA_X + SA_W + 4}" y1="{ay}" x2="{GASSE_SA}" y2="{ay}" '
             f'stroke="{LI}" stroke-width="1.2" stroke-opacity="0.75"/>')
L.append(f'<line x1="{GASSE_SA}" y1="421" x2="{GASSE_SA}" y2="92" '
         f'stroke="{LI}" stroke-width="1.2" stroke-opacity="0.75"/>')
pfeil(GASSE_SA, 92, RAG_X - 4, 92, LI, "pfl", "1.2")

# ── Korpus, Ollama, ChromaDB ──────────────────────────────────────────────
def dokbox(y, h, titel, zeilen, farbe=DOK):
    box(AUF_X, y, AUF_W, h, farbe, farbe, "1", "1.5")
    t(AUF_X + 14, y + 20, titel, 11.5, w="700")
    for i, z in enumerate(zeilen):
        t(AUF_X + 14, y + 36 + i * 13, z, 8.4, op="0.78", fam="monospace")


dokbox(54, 92, "Original-PDF", [
    "Rechtsgrundlagen/  21 PDF · 12 MB",
    "Regionalplaene/    28 PDF · 481 MB",
    "amtliche Dokumente, unverändert",
    "7 Planungsregionen, 21 Gesetze",
])
pfeil(AUF_X + AUF_W // 2, 150, AUF_X + AUF_W // 2, 174, DOK, "pfd")
t(AUF_X + AUF_W // 2 + 8, 166, "Ingest, einmal", 8.6, fill=DOK, w="600")

dokbox(178, 76, "Chunking", [
    "ingest.py · ingest_rp.py",
    "§-Marker bzw. Ziel-Nummer,",
    "sonst seitenweise",
    "&#8594; 5.801 Chunks",
])
pfeil(AUF_X + AUF_W // 2, 258, AUF_X + AUF_W // 2, 282, DOK, "pfd")

box(AUF_X, 286, AUF_W, 78, LI, LI, "1", "1.5")
t(AUF_X + 14, 306, "Ollama", 11.5, w="700")
t(AUF_X + 14, 320, "embeddinggemma · Port 11434", 8.4, op="0.78",
  fam="monospace")
t(AUF_X + 14, 333, "übersetzt Text in Zahlen —", 8.4, op="0.78")
t(AUF_X + 14, 346, "erzeugt KEINEN Text", 8.4, op="0.78", w="700")
t(AUF_X + 14, 359, "lru_cache auf die Frage", 8.4, op="0.6", fam="monospace")
pfeil(AUF_X + AUF_W // 2, 368, AUF_X + AUF_W // 2, 392, DOK, "pfd")
t(AUF_X + AUF_W // 2 + 8, 384, "Vektor je Chunk", 8.6, fill=DOK, w="600")

box(AUF_X, 396, AUF_W, 88, LI, LI, "1", "1.5")
t(AUF_X + 14, 416, "ChromaDB", 11.5, w="700")
t(AUF_X + 14, 430, "rag/chroma_db · auf Platte", 8.4, op="0.78",
  fam="monospace")
t(AUF_X + 14, 445, "rechtsgrundlagen  4.407", 8.4, op="0.78", fam="monospace")
t(AUF_X + 14, 458, "regionalplaene    1.394", 8.4, op="0.78", fam="monospace")
t(AUF_X + 14, 472, "Vektor + Metadaten je Chunk", 8.4, op="0.6")

# Zugriffe aus der Suche heraus - je eigene Spur in der Gasse, damit sich
# die Knicke nicht ueberlagern. Die Beschriftung sitzt rechtsbuendig ueber
# dem letzten waagerechten Stueck, kurz vor dem Zielkasten.
# (Schrittmitte = S_Y + i * (S_H + S_GAP) + 19)
for quelle_y, spur, ziel_y, beschriftung in (
    (197, AUF_X - 102, 325, "Frage einbetten"),
    (249, AUF_X - 82, 430, "Vektorsuche"),
    (301, AUF_X - 62, 455, "Volltext für BM25"),
):
    knick(f"M {RAG_X + RAG_W - 8} {quelle_y} L {spur} {quelle_y} "
          f"L {spur} {ziel_y} L {AUF_X - 4} {ziel_y}", LI, "pfl", "1.2")
    t(AUF_X - 10, ziel_y - 7, beschriftung, 8.4, fill=LI, w="600",
      anchor="end")

# Die Ankernorm: gezielt geholt, nicht gesucht.
# Die Ankernorm ist ein zweiter, direkter Zugriff auf dieselbe ChromaDB -
# deshalb der Pfeil von oben. Der Rueckweg laeuft UNTER dem RAG-Kasten
# entlang zum BelangeAgent; vorher zeigte er 14 px nach links ins Leere.
pfeil(AUF_X + 100, 488, AUF_X + 100, 506, GR, "pfg", "1.3")
box(AUF_X, 510, AUF_W, 74, GR, GR, "1", "1.5")
t(AUF_X + 14, 530, "Ankernorm", 11.5, w="700")
t(AUF_X + 14, 544, "col.get(where={kuerzel,norm})", 8.4, op="0.78",
  fam="monospace")
t(AUF_X + 14, 558, "GEHOLT, nicht gesucht:", 8.4, op="0.78", w="700")
t(AUF_X + 14, 571, "kein Embedding, kein Rang", 8.4, op="0.78")
knick(f"M {AUF_X - 4} 556 L {GASSE_ANKER} 556 L {GASSE_ANKER} 245 "
      f"L {SA_X + SA_W + 4} 245", GR, "pfg", "1.2")
t(RAG_X + RAG_W // 2, 549, "§ 39 LFoG NRW für &#8222;wald&#8220; — "
  "geht mit der Antwort zurück", 8.4, fill=GR, w="600", anchor="middle")

HOEHE = 1110
WEITE = AUF_X + AUF_W + 16

svg = f'''<figure class="tafel">
    <svg viewBox="0 0 {WEITE} {HOEHE}" role="img"
         aria-label="Der Hauptagent als Säule in der Mitte. Links die Funktionen mit ihren Maps-SDK-Aufrufen, rechts vier Werkzeuge mit je einem Subagenten, daneben die sieben Suchschritte des RAG-Backends und rechts der Korpus aus Original-PDFs über Chunking und Ollama in die ChromaDB.">
      <defs>
        <marker id="pfo" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,1 10,5 0,9" fill="{OR}"/></marker>
        <marker id="pfg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,1 10,5 0,9" fill="{GR}"/></marker>
        <marker id="pfa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,1 10,5 0,9" fill="{ORH}"/></marker>
        <marker id="pfl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,1 10,5 0,9" fill="{LI}"/></marker>
        <marker id="pfs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,1 10,5 0,9" fill="{SDK}"/></marker>
        <marker id="pfd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polygon points="0,1 10,5 0,9" fill="{DOK}"/></marker>
      </defs>
      {chr(10).join("      " + z for z in L)}
    </svg>
    <figcaption>
      <strong>Jeder orange Pfeil geht vom Hauptagenten aus</strong> — hinaus mit
      dem, was er übergibt, grün zurück mit dem, was er bekommt. Links seine
      vier Code-Funktionen, ganz links <strong>blau die Maps-SDK-Aufrufe</strong>
      mit dem Ort: <em>lokal im Browser</em> für die Geometrie-Operatoren,
      <em>Abfrage am Dienst</em> für die Layerabfragen. Rechts die vier
      Werkzeuge, hinter denen je ein Subagent steckt — der
      <strong>LayerAgent</strong> hat als einziger selbst Werkzeuge und damit
      auch eigene SDK-Aufrufe. Daneben lila die sieben Schritte, die jede Suche
      durchläuft, und rechts der Weg der <strong>Original-PDFs</strong> über das
      Chunking und <strong>Ollama</strong> in die <strong>ChromaDB</strong>.
      Grün abgesetzt die Ankernorm: sie wird nicht gesucht, sondern über ihre
      Fundstelle geholt.
    </figcaption>
  </figure>'''

s = io.open(P, encoding="utf-8").read()
a = s.index('<figure class="tafel">')
b = s.index("</figure>") + len("</figure>")
io.open(P, "w", encoding="utf-8").write(s[:a] + svg + s[b:])
print("Tafel neu gebaut:", WEITE, "x", HOEHE)
