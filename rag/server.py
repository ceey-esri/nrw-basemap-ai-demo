"""RAG-Backend: Gesetzestexte und Regionalplan-Festlegungen.

Retrieval-only - die Synthese macht der Agent mit seinem eigenen Modell.

  POST /rechtsgrundlage  {frage}            -> Passagen aus dem Gesetzeskorpus
  POST /regionalplan     {region, frage}    -> Ziele/Grundsaetze des geltenden Plans

Start:  python rag/server.py
"""

from __future__ import annotations

from pathlib import Path

from functools import lru_cache

import chromadb
import httpx
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


def _suche(col, query: str, where, top_k: int):
    res = col.query(
        query_embeddings=[list(_embed_query(query))],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )
    return zip(res["documents"][0], res["metadatas"][0], res["distances"][0])


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
            "score": round(1 - dist, 3),
            "text": doc,
        }
        for doc, md, dist in _suche(col, query, where, a.top_k or TOP_K)
    ]
    return {"frage": query, "treffer": treffer}


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
            "score": round(1 - dist, 3),
            "text": doc,
        }
        for doc, md, dist in _suche(col, query, where, a.top_k or TOP_K)
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
