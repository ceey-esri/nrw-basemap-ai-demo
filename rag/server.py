"""RAG-Backend: Gesetzestexte und Regionalplan-Festlegungen.

Retrieval-only - die Synthese macht der Agent mit seinem eigenen Modell.

  POST /rechtsgrundlage  {frage}            -> Passagen aus dem Gesetzeskorpus
  POST /regionalplan     {region, frage}    -> Ziele/Grundsaetze des geltenden Plans

Start:  python rag/server.py
"""

from __future__ import annotations

from pathlib import Path

from functools import lru_cache

import re

import chromadb
import httpx
from rank_bm25 import BM25Okapi
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from korpus import RECHTSGEBIETE
from regionalplaene import REGIONEN

HIER = Path(__file__).resolve().parent
DB_DIR = HIER / "chroma_db"
COL_GESETZE = "rechtsgrundlagen"
COL_RP = "regionalplaene"
OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "embeddinggemma"
TOP_K = 6

# Hybride Suche: beide Zweige holen KANDIDATEN, nicht Ergebnisse. Erst die
# Fusion entscheidet. 40 je Zweig ist der uebliche Korridor - genug, damit ein
# Treffer, den nur ein Zweig sieht, noch nach oben fusionieren kann.
KANDIDATEN = 40

# Reciprocal Rank Fusion. Der Standardwert 60 daempft die Spitze: Platz 1 und
# Platz 2 eines Zweiges liegen danach nicht weit auseinander, weshalb ein
# Dokument, das in BEIDEN Zweigen mittelgut rankt, eines schlaegt, das nur in
# einem Zweig vorne steht. Genau das ist hier erwuenscht.
RRF_K = 60

# Enthaelt der Korpus ueberhaupt etwas zu dieser Frage? Entschieden wird das
# an der BESTEN Vektor-Aehnlichkeit der ganzen Anfrage, nicht je Treffer.
# Gemessen am 2026-10-09: die acht Katalogfragen liegen zwischen 0.584 und
# 0.727, abwegige Fragen ("Rezept fuer Apfelkuchen", "Bundesliga") bei 0.000
# bis 0.181. Die Schwelle liegt mit Abstand dazwischen.
#
# Warum nicht ueber BM25: Eine absolute Stichwortgrenze waere genau falsch
# herum - "Waldumwandlung Genehmigung" (einschlaegig) erreicht 9.80,
# "Bundesliga" (abwegig) 12.44. Die Stichwortpunktzahl haengt an der
# Wortseltenheit, nicht an der Einschlaegigkeit.
MIN_AEHNLICHKEIT = 0.45

# /belange: Treffer und Auszugslaenge. Mehr Zeichen als bei der Einzelsuche,
# weil die Aufzaehlung der oeffentlichen Belange in § 35 Abs. 3 BauGB sonst
# mitten in der Liste abbricht.
BELANGE_TREFFER = 6
BELANGE_ZEICHEN = 1200

# /belange, zweiter Teil: die ANKERNORMEN. Je Kategorie des Katalogs ist eine
# Norm benannt, die den Tatbestand traegt - LFoG NRW § 39 fuer die
# Waldumwandlung, DSchG NRW § 9 fuer die Erlaubnispflicht am Baudenkmal.
# Die werden NICHT gesucht, sondern ueber ihre Metadaten direkt geholt: kein
# Embedding, keine Aehnlichkeit, kein Rang.
#
# Der Grund ist der Befund, der die Belange-Suche bisher begrenzt hat: § 35
# Abs. 3 BauGB ist ein KATALOG - eine Passage, die viele Belange aufzaehlt, und
# deshalb als Entdeckungsschritt taugt. Ein Fachgesetz ist das nicht; es regelt
# ein Schutzgut. Der Wald taucht in § 35 Abs. 3 nie auf, auch nicht bei 14
# Treffern und auch nicht mit eingriffsbezogener Frage - der Vorhabentyp
# dominiert das Embedding.
#
# Dass § 35 Abs. 3 trotzdem zuverlaessig kommt, liegt nicht an guter
# Retrievalqualitaet, sondern daran, dass wir WISSEN, wo der Katalog steht.
# Dieselbe Kenntnis liegt fuer jede Kategorie im Katalog (`ankernorm` in
# kategorien.js) - also wird sie auch so benutzt. Damit faellt das Raten weg,
# und die Gruppe OFFEN schrumpft auf den Fall, dass eine Ankernorm im Korpus
# fehlt.
ANKER_ZEICHEN = 760

# Welches Stueck einer Norm traegt den Tatbestand? NICHT das erste - bei
# DSchG NRW § 9 ist das erste Stueck ein Inhaltsverzeichnis-Artefakt aus 269
# Zeichen ("Abschnitt 3 / Denkmalbereiche / Herausgeber: ..."), der eigentliche
# Normtext steht im zweiten. Verlaesslich ist der Absatzmarker: gewaehlt wird
# das erste Stueck mit "(1)" am Zeilenanfang, und der Text beginnt dort.
# Das schneidet bei LFoG NRW § 39 zugleich den Fussnotenblock weg, der
# sonst die halbe Auszugslaenge frisst.
_ABS1 = re.compile(r"^\(1\)", re.M)

# Reste der PDF-Extraktion, die in den Chunks stehen: Fussnotenkoepfe,
# Herausgeberzeile und Seitenzaehler ("11 / 39", "- Seite 35 von 135 -").
_ANKER_RAUSCHEN = re.compile(
    r"^(?:Fußnoten zu .*|Herausgeber: .*|.*\d+ / \d+\s*|- Seite \d+ von \d+ -|Abschnitt \d+)$",
    re.M,
)

app = FastAPI(title="Screening RAG")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

_client = chromadb.PersistentClient(path=str(DB_DIR))


def _col(name: str):
    try:
        return _client.get_collection(name)
    except Exception:
        return None


# Ein dauerhafter Client statt eines neuen je Anfrage - spart den
# Verbindungsaufbau bei jeder Suche.
_http = httpx.Client(timeout=60)


# Die Suchtexte kommen aus dem festen Kategorien-Katalog und wiederholen sich
# deshalb ueber Laeufe hinweg. Der Cache erspart den Ollama-Roundtrip komplett.
@lru_cache(maxsize=512)
def _embed_query(text: str) -> tuple[float, ...]:
    r = _http.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": f"task: search result | query: {text}"},
    )
    r.raise_for_status()
    return tuple(r.json()["embeddings"][0])


# Tokenisierung fuer den Stichwortzweig. Deutsche Rechtstexte brauchen zwei
# Eigenheiten: Paragraphenzeichen trennen (die Nummer ist das Suchwort, nicht
# das "§"), und Ziffern bleiben erhalten - "38" in "§ 38 WHG" ist der
# entscheidende Token.
_TOKEN = re.compile(r"[a-zäöüß0-9]+", re.IGNORECASE)


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


class _Stichwortindex:
    """BM25 ueber eine ganze Collection, einmal beim ersten Zugriff gebaut.

    Der Dense-Zweig allein hat eine bekannte Schwaeche: Nennt die Anfrage einen
    Vorhabentyp, zieht dessen Embedding die Treffer zu sich, und die
    einschlaegige Norm faellt heraus. Gemessen fuer "Wasser" bei einer
    Windenergieanlage: BauGB und BNatSchG auf allen Plaetzen, keine
    Wassernorm - obwohl § 38 WHG mit dem gesuchten Abstand im Korpus steht.
    Ein Stichwortzweig ist dagegen unempfindlich, weil "Gewaesserrandstreifen"
    schlicht vorkommt oder nicht.
    """

    def __init__(self, col):
        daten = col.get(include=["documents", "metadatas"])
        self.ids: list[str] = daten["ids"]
        self.docs: list[str] = daten["documents"]
        self.metas: list[dict] = daten["metadatas"]
        # Die Ueberschrift mitindizieren: "Gewaesserrandstreifen" steht dort
        # oft praegnanter als im Fliesstext.
        korpus = [
            _tokens(f"{m.get('ueberschrift', '')} {m.get('zitat', '')} {d}")
            for d, m in zip(self.docs, self.metas)
        ]
        self.bm25 = BM25Okapi(korpus)

    def suche(self, query: str, where: dict | None, grenze: int):
        punkte = self.bm25.get_scores(_tokens(query))
        rang = sorted(range(len(punkte)), key=lambda i: punkte[i], reverse=True)
        out = []
        for i in rang:
            if punkte[i] <= 0:
                break
            if where and not all(self.metas[i].get(k) == v for k, v in where.items()):
                continue
            out.append((self.ids[i], self.docs[i], self.metas[i], float(punkte[i])))
            if len(out) >= grenze:
                break
        return out


_indizes: dict[str, _Stichwortindex] = {}


def _index(name: str, col):
    if name not in _indizes:
        _indizes[name] = _Stichwortindex(col)
    return _indizes[name]


class Anfrage(BaseModel):
    frage: str
    top_k: int | None = None
    # nur fuer /rechtsgrundlage, optional
    rechtsgebiet: str | None = None
    # nur fuer /regionalplan
    region: str | None = None


@app.get("/health")
def health():
    g, r = _col(COL_GESETZE), _col(COL_RP)
    return {
        "status": "ok",
        "gesetze": g.count() if g else 0,
        "regionalplaene": r.count() if r else 0,
        "regionen": list(REGIONEN),
        "rechtsgebiete": RECHTSGEBIETE,
    }


def _suche(col, name: str, query: str, where, top_k: int):
    """Hybride Suche: Vektoren und Stichworte, fusioniert per RRF.

    Beide Zweige liefern eine Rangliste ueber dieselben Dokumente. Reciprocal
    Rank Fusion addiert je Dokument 1/(RRF_K + Rang) ueber beide Listen - ohne
    die Punktzahlen vergleichbar machen zu muessen, was zwischen Kosinus und
    BM25 ohnehin nicht geht. Das ist das uebliche Verfahren, wenn kein
    Cross-Encoder zum Nachsortieren zur Verfuegung steht.

    Zurueck kommen Treffer mit BEIDEN Teilbewertungen, damit nachvollziehbar
    bleibt, welcher Zweig einen Treffer nach oben gebracht hat.
    """
    res = col.query(
        query_embeddings=[list(_embed_query(query))],
        n_results=KANDIDATEN,
        where=where,
        include=["documents", "metadatas", "distances"],
    )
    dense = list(
        zip(res["ids"][0], res["documents"][0], res["metadatas"][0], res["distances"][0])
    )
    sparse = _index(name, col).suche(query, where, KANDIDATEN)

    punkte: dict[str, float] = {}
    daten: dict[str, tuple] = {}
    for rang, (i, doc, md, dist) in enumerate(dense):
        punkte[i] = punkte.get(i, 0.0) + 1.0 / (RRF_K + rang)
        daten[i] = (doc, md, 1.0 - dist, None)
    for rang, (i, doc, md, bm) in enumerate(sparse):
        punkte[i] = punkte.get(i, 0.0) + 1.0 / (RRF_K + rang)
        vorher = daten.get(i)
        daten[i] = (doc, md, vorher[2] if vorher else None, bm)

    # Abstinenz-Schwelle: Liegt die beste Aehnlichkeit der GANZEN Anfrage unter
    # der Grenze, enthaelt der Korpus nichts zum Thema. Dann lieber gar nichts
    # liefern als sechs beliebige Paragraphen, die das Modell als Befund liest.
    beste = max((1.0 - d for _, _, _, d in dense), default=0.0)
    if beste < MIN_AEHNLICHKEIT:
        return []

    geordnet = sorted(punkte, key=lambda i: punkte[i], reverse=True)
    out = []
    gesehen: set[str] = set()
    for i in geordnet:
        doc, md, aehnlich, bm = daten[i]
        # Ein Ziel kann ueber mehrere Chunks laufen. Zweimal dieselbe
        # Fundstelle verbraucht einen der wenigen Plaetze beim Modell, ohne
        # etwas hinzuzufuegen - es zaehlt der bestplatzierte Chunk.
        # `zitat` steht nicht in den Metadaten - es wird erst im Endpunkt
        # zusammengesetzt. Hier dieselben Bestandteile: Kuerzel plus Norm
        # (Gesetze) bzw. Nummer (Regionalplan). Das Kuerzel muss mit rein,
        # sonst faellt "§ 38" aus zwei verschiedenen Gesetzen zusammen.
        kennung = md.get("norm") or md.get("nummer")
        schluessel = f"{md.get('kuerzel', '')}|{kennung}" if kennung else f"doc{i}"
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        out.append((doc, md, aehnlich, bm, punkte[i]))
        if len(out) >= top_k:
            break
    return out


@app.post("/rechtsgrundlage")
def rechtsgrundlage(a: Anfrage):
    col = _col(COL_GESETZE)
    query = (a.frage or "").strip()
    if not col or not query:
        return {"treffer": [], "hinweis": "kein Index oder leere Anfrage"}

    where = {f"rb_{a.rechtsgebiet}": True} if a.rechtsgebiet in RECHTSGEBIETE else None
    treffer = [
        {
            "quelle": "Gesetz",
            "gesetz": md.get("gesetz"),
            "kuerzel": md.get("kuerzel"),
            "zitat": f"{md.get('kuerzel')} {md.get('norm')}",
            "ueberschrift": md.get("ueberschrift"),
            "stand": md.get("stand"),
            "quelle_url": md.get("quelle_url"),
            "score": round(rrf, 5),
            "aehnlichkeit": round(aehnlich, 3) if aehnlich is not None else None,
            "stichwort": round(bm, 2) if bm is not None else None,
            "text": doc,
        }
        for doc, md, aehnlich, bm, rrf in _suche(
            col, COL_GESETZE, query, where, a.top_k or TOP_K
        )
    ]
    return {"frage": query, "treffer": treffer}


class Ankernorm(BaseModel):
    """Eine Norm, die ueber ihre Metadaten geholt wird - nicht gesucht."""

    kuerzel: str
    norm: str
    kategorieId: str | None = None


def _ankernorm(col, kuerzel: str, norm: str) -> dict | None:
    """Holt eine benannte Norm deterministisch - ohne Embedding, ohne Rang.

    `col.get(where=...)` ist ein reiner Metadatenzugriff. Es gibt hier also
    keine Aehnlichkeit, keine Abstinenzschwelle und nichts zu fusionieren: die
    Norm kommt zurueck oder sie steht nicht im Korpus. Genau das ist der Punkt -
    bei einer Norm, deren Fundstelle wir kennen, ist Suchen der falsche
    Mechanismus.

    Eine lange Norm liegt als mehrere Chunks vor (`teile_lang` im Ingest). Die
    laufende Nummer steht am Ende der Chunk-ID, darueber laeuft die Sortierung
    in Dokumentreihenfolge.
    """
    try:
        r = col.get(
            where={"$and": [{"kuerzel": {"$eq": kuerzel}}, {"norm": {"$eq": norm}}]},
            include=["documents", "metadatas"],
        )
    except Exception:
        return None
    if not r.get("ids"):
        return None

    def nummer(kennung: str) -> int:
        teil = kennung.rsplit("::", 1)[-1]
        return int(teil) if teil.isdigit() else 0

    stuecke = sorted(
        zip(r["ids"], r["documents"], r["metadatas"]), key=lambda p: nummer(p[0])
    )
    gewaehlt = next((st for st in stuecke if _ABS1.search(st[1])), None)
    if gewaehlt is None:
        gewaehlt = max(stuecke, key=lambda st: len(st[1]))

    text = gewaehlt[1]
    m = _ABS1.search(text)
    if m:
        text = text[m.start():]
    text = re.sub(r"\n{2,}", "\n", _ANKER_RAUSCHEN.sub("", text)).strip()

    # Die Ueberschrift kann im gewaehlten Stueck fehlen (bei LFoG NRW § 39 und
    # DSchG NRW § 9 traegt sie nur das erste Stueck) - deshalb aus allen.
    md = gewaehlt[2]
    ueberschrift = next(
        (st[2].get("ueberschrift") for st in stuecke if st[2].get("ueberschrift")), ""
    )
    return {
        "zitat": f"{kuerzel} {norm}",
        "gesetz": md.get("gesetz"),
        "kuerzel": kuerzel,
        "norm": norm,
        "ueberschrift": ueberschrift,
        "stand": md.get("stand"),
        "quelle_url": md.get("quelle_url"),
        "stuecke": len(stuecke),
        "wortlaut": text[:ANKER_ZEICHEN],
    }


class Vorhabenfrage(BaseModel):
    vorhaben: str
    top_k: int | None = None
    ankernormen: list[Ankernorm] | None = None


@app.post("/belange")
def belange(a: Vorhabenfrage):
    """Welche Belange sind fuer DIESES Vorhaben einschlaegig?

    Die umgekehrte Frage zu /rechtsgrundlage: dort ist der Belang vorgegeben
    und gesucht wird die Norm, hier ist nur das Vorhaben bekannt.

    Entscheidend ist, WIE die Antwort zustande kommt. Zwei Verfahren wurden
    verworfen, bevor dieses blieb:

    1. *Treffer je Rechtsgebiet auszaehlen* (ueber die `rb_<gebiet>`-Flags der
       Chunks). Misst mit, wie dick ein Gesetz ist: Leitungsrecht stellt 1.382
       der 4.407 Chunks, Waldrecht 179 - entsprechend landete Leitungsrecht bei
       Wind, Mobilfunk UND Photovoltaik auf Platz 1.
    2. *Dasselbe, normiert auf den Korpusanteil* (Lift). Kippt in die
       Gegenrichtung: die kleinen Gebiete gewinnen, und bei einer
       Windenergieanlage fiel ausgerechnet der Naturschutz heraus.

    Das Verfahren, das bleibt, zaehlt gar nichts: **Die Liste der Belange steht
    im Gesetz.** § 35 Abs. 3 BauGB zaehlt die oeffentlichen Belange auf, die
    einem Aussenbereichsvorhaben entgegenstehen koennen - Naturschutz,
    Landschaftspflege, Bodenschutz, Denkmalschutz, Wasserwirtschaft,
    Hochwasserschutz, Verkehr, Agrarstruktur. Gemessen am 2026-10-09 liegt die
    Norm fuer alle sechs Vorhabenarten unter den ersten fuenf Treffern, bei
    vieren auf Platz 1. Dazu kommen die vorhabenspezifischen Normen
    (BNatSchG § 45b bei Wind, FStrG § 9 bei Photovoltaik, TKG bei Mobilfunk).

    Zurueck gehen also die Passagen im Wortlaut - gelesen wird sie vom Modell.
    Das ist Lesen statt Raten, und die Fundstelle steht daneben.
    """
    col = _col(COL_GESETZE)
    vorhaben = (a.vorhaben or "").strip()
    if not col or not vorhaben:
        return {"passagen": [], "hinweis": "kein Index oder leeres Vorhaben"}

    frage = (
        f"{vorhaben}. Welche öffentlichen Belange und Schutzgüter können einem "
        "solchen Vorhaben entgegenstehen oder durch es beeinträchtigt werden?"
    )
    treffer = _suche(col, COL_GESETZE, frage, None, a.top_k or BELANGE_TREFFER)
    passagen = [
        {
            "zitat": f"{md.get('kuerzel')} {md.get('norm')}",
            "gesetz": md.get("gesetz"),
            "ueberschrift": md.get("ueberschrift"),
            "stand": md.get("stand"),
            "quelle_url": md.get("quelle_url"),
            "aehnlichkeit": round(aehnlich, 3) if aehnlich is not None else None,
            # Laenger als bei der Einzelsuche: die Aufzaehlung in § 35 Abs. 3
            # BauGB braucht Platz, sonst bricht die Liste mittendrin ab.
            "auszug": doc[:BELANGE_ZEICHEN],
        }
        for doc, md, aehnlich, bm, _rrf in treffer
    ]
    # Die Ankernormen daneben: nicht gesucht, sondern geholt. Fehlt eine im
    # Korpus, geht sie als `fehlend` zurueck - dann bleibt diese Kategorie beim
    # Modell in der Gruppe OFFEN, und zwar aus einem nachpruefbaren Grund.
    anker, fehlend = [], []
    for an in a.ankernormen or []:
        gefunden = _ankernorm(col, an.kuerzel.strip(), an.norm.strip())
        if gefunden:
            anker.append({**gefunden, "kategorieId": an.kategorieId})
        else:
            fehlend.append(
                {
                    "kategorieId": an.kategorieId,
                    "zitat": f"{an.kuerzel} {an.norm}",
                }
            )

    return {
        "vorhaben": vorhaben,
        "frage": frage,
        "passagen": passagen,
        "ankernormen": anker,
        "ankerFehlend": fehlend,
    }


@app.post("/regionalplan")
def regionalplan(a: Anfrage):
    col = _col(COL_RP)
    query = (a.frage or "").strip()
    if not col or not query:
        return {"treffer": [], "hinweis": "kein Index oder leere Anfrage"}

    where = {f"rp_{a.region}": True} if a.region in REGIONEN else None
    treffer = [
        {
            "quelle": "Regionalplan",
            "plan": md.get("plan"),
            "region": md.get("region"),
            "region_name": md.get("region_name"),
            "art": md.get("art"),
            "nummer": md.get("nummer"),
            "zitat": f"{md.get('kuerzel')} {md.get('art')} {md.get('nummer')}",
            "ueberschrift": md.get("ueberschrift"),
            "stand": md.get("stand"),
            "quelle_url": md.get("quelle_url"),
            "score": round(rrf, 5),
            "aehnlichkeit": round(aehnlich, 3) if aehnlich is not None else None,
            "stichwort": round(bm, 2) if bm is not None else None,
            "text": doc,
        }
        for doc, md, aehnlich, bm, rrf in _suche(
            col, COL_RP, query, where, a.top_k or TOP_K
        )
    ]
    return {
        "frage": query,
        "region": a.region,
        "gefiltert": where is not None,
        "treffer": treffer,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
