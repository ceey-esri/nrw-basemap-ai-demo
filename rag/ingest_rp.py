"""Regionalplan-PDFs -> Chunks (pro Ziel/Grundsatz) -> Embeddings -> ChromaDB.

Eigene Collection `regionalplaene`, damit der Gesetzeskorpus unberuehrt bleibt.

Aufruf:  python rag/ingest_rp.py            (alles neu aufbauen)
         python rag/ingest_rp.py --dry     (nur Chunks zeigen, nichts schreiben)
         python rag/ingest_rp.py --nur muensterland   (eine Region)

Voraussetzung: Ollama laeuft mit embeddinggemma.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from ingest import DB_DIR, EMBED_MODEL, embed
from regionalplaene import KORPUS_RP, REGIONEN

HIER = Path(__file__).resolve().parent
PDF_DIR = HIER.parent / "Regionalplaene"
COLLECTION = "regionalplaene"

MAX_CHUNK = 1800
MIN_CHUNK = 60

# Die Plaene nummerieren unterschiedlich - zwei Muster decken die Mehrheit ab.
# A: "G II.1-1 Demografischer Wandel"  (Muensterland, OWL)
MARKER_A = re.compile(
    r"^\s*(Z|G|Ziel|Grundsatz)\s+"
    r"((?:[IVXLC]+|\d+)(?:\.\d+)*\s*-\s*\d+[a-z]?)"
    r"\s+(\S.*)$"
)
# B: "1.4-1 Ziel: Nutzungskonforme Entwicklung in GIB sichern"  (RP Ruhr)
MARKER_B = re.compile(
    r"^\s*(\d+(?:\.\d+)*\s*-\s*\d+[a-z]?)\s+(Ziel|Grundsatz)\s*:?\s+(\S.*)$"
)
ABSATZ_SPLIT = re.compile(r"(?=\n\(\d+[a-z]?\)\s)")

ART = {"Z": "Ziel", "G": "Grundsatz", "ZIEL": "Ziel", "GRUNDSATZ": "Grundsatz"}

# Unterhalb dieser Chunk-Zahl greift der seitenweise Fallback.
MIN_MARKER_TREFFER = 25


def _ist_verzeichnis(fenster: str) -> bool:
    """Inhaltsverzeichnis: Punktfuehrung zur Seitenzahl.

    Der Titel bricht im Verzeichnis oft um, die Punkte stehen erst in der
    Folgezeile - deshalb wird ein Fenster aus mehreren Zeilen geprueft.
    """
    return bool(re.search(r"\.{4,}", fenster))


# "Ziel 6.3-3 LEP NRW (...)" ist ein Querverweis auf den Landesentwicklungsplan
# im Fliesstext, keine eigene Festlegung dieses Regionalplans.
FREMDVERWEIS = re.compile(r"^(LEP|LPlG|ROG)\b", re.IGNORECASE)


def _marker(ln: str):
    """(stil, art, nummer, titel) oder None."""
    m = MARKER_A.match(ln)
    if m:
        return "A", ART.get(m.group(1).upper(), m.group(1)), m.group(2), m.group(3).strip()
    m = MARKER_B.match(ln)
    if m:
        return "B", ART.get(m.group(2).upper(), m.group(2)), m.group(1), m.group(3).strip()
    return None


def festlegungen(text: str):
    """Zerlegt den Plantext in (art, nummer, ueberschrift, body).

    Die Plaene nummerieren unterschiedlich. Beide Muster werden gesucht, aber
    nur das im Dokument dominierende wird verwendet - sonst reissen vereinzelte
    Fehltreffer des jeweils anderen Musters echte Festlegungen auseinander.
    """
    zeilen = text.splitlines()
    roh = []
    for i, ln in enumerate(zeilen):
        gefunden = _marker(ln)
        if not gefunden:
            continue
        stil, art, nummer, titel = gefunden
        if FREMDVERWEIS.match(titel):
            continue
        if _ist_verzeichnis(" ".join(zeilen[i : i + 3])):
            continue
        roh.append((i, stil, art, re.sub(r"\s+", "", nummer), titel))

    if not roh:
        return
    n_a = sum(1 for x in roh if x[1] == "A")
    dominant = "A" if n_a >= len(roh) - n_a else "B"
    treffer = [x for x in roh if x[1] == dominant]

    for k, (i, _stil, art, nummer, titel) in enumerate(treffer):
        ende = treffer[k + 1][0] if k + 1 < len(treffer) else len(zeilen)
        body = "\n".join(zeilen[i:ende]).strip()
        if len(body) >= MIN_CHUNK:
            yield art, nummer, titel, body


def seiten_roh(pfad: Path) -> list[str]:
    """Seitentexte EINMAL extrahieren, Kopf-/Fusszeilen entfernen.

    Die grossen Plaene wuerden sonst zweimal gelesen (Marker-Pfad und
    Seiten-Fallback).
    """
    from collections import Counter

    from pypdf import PdfReader

    seiten = [(s.extract_text() or "") for s in PdfReader(str(pfad)).pages]

    zaehler: Counter[str] = Counter()
    for s in seiten:
        for z in {ln.strip() for ln in s.splitlines() if ln.strip()}:
            zaehler[z] += 1
    haeufig = {z for z, c in zaehler.items() if c >= max(4, len(seiten) * 0.3)}

    raus = []
    for s in seiten:
        zeilen = [ln.rstrip() for ln in s.splitlines() if ln.strip() and ln.strip() not in haeufig]
        roh = "\n".join(zeilen).replace("­", "")
        roh = re.sub(r"[^\S\n]+", " ", roh)
        raus.append(re.sub(r"\n{3,}", "\n\n", roh).strip())
    return raus


def seitenweise(seiten: list[str]):
    """Fallback fuer Plaene ohne erkennbare Marker: ein Chunk je Seite.

    Fundstelle ist dann die Seitenzahl statt einer Ziel-Nummer. Weniger
    praezise, aber fuers Retrieval brauchbar.
    """
    for nr, roh in enumerate(seiten, start=1):
        if len(roh) < 300:  # Deckblatt, Kartenseite, fast leer
            continue
        for teil in teile_lang("", roh):
            if len(teil) >= MIN_CHUNK:
                yield nr, teil


def teile_lang(kopf: str, body: str):
    if len(body) <= MAX_CHUNK:
        yield body
        return
    stueck = ""
    for abs_ in ABSATZ_SPLIT.split(body):
        if len(stueck) + len(abs_) > MAX_CHUNK and stueck.strip():
            yield stueck.strip()
            stueck = kopf + "\n"
        stueck += abs_
    if stueck.strip():
        yield stueck.strip()


def _basis_md(datei: str, meta: dict) -> dict:
    md = {
        "datei": datei,
        "plan": meta["plan"],
        "kuerzel": meta["kuerzel"],
        "region": meta["region"],
        "region_name": REGIONEN[meta["region"]],
        "stand": meta["stand"],
        "quelle_url": meta["quelle_url"],
    }
    for rid in REGIONEN:
        md[f"rp_{rid}"] = rid == meta["region"]
    return md


def chunks_fuer(datei: str, meta: dict):
    pfad = PDF_DIR / datei
    seiten = seiten_roh(pfad)
    treffer = list(festlegungen("\n".join(seiten)))

    if len(treffer) >= MIN_MARKER_TREFFER:
        n = 0
        for art, nummer, titel, body in treffer:
            kopf = body.splitlines()[0]
            for teil in teile_lang(kopf, body):
                if len(teil) < MIN_CHUNK:
                    continue
                n += 1
                bez = f"{meta['kuerzel']} {art} {nummer} - {titel}"
                md = {**_basis_md(datei, meta), "art": art, "nummer": nummer,
                      "ueberschrift": titel[:200], "seite": 0, "modus": "festlegung"}
                yield {
                    "id": f"{meta['region']}::{nummer}::{n}",
                    "doc": f"title: {bez} | text: {teil}",
                    "anzeige": f"{bez}\n{teil}",
                    "md": md,
                }
        return

    # Fallback: seitenweise, Fundstelle = Seitenzahl
    n = 0
    for seite, teil in seitenweise(seiten):
        n += 1
        bez = f"{meta['kuerzel']}, S. {seite}"
        md = {**_basis_md(datei, meta), "art": "Auszug", "nummer": f"S. {seite}",
              "ueberschrift": "", "seite": seite, "modus": "seite"}
        yield {
            "id": f"{meta['region']}::s{seite}::{n}",
            "doc": f"title: {bez} | text: {teil}",
            "anzeige": f"{bez}\n{teil}",
            "md": md,
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="nur zaehlen, nichts schreiben")
    ap.add_argument("--nur", help="nur diese Region ingesten")
    args = ap.parse_args()

    alle = []
    for datei, meta in KORPUS_RP.items():
        if args.nur and meta["region"] != args.nur:
            continue
        pfad = PDF_DIR / datei
        if not pfad.exists():
            print(f"FEHLT: {datei}", file=sys.stderr)
            continue
        print(f"lese {datei} ...", flush=True)
        cs = list(chunks_fuer(datei, meta))
        print(f"  {meta['kuerzel']:24s} {len(cs):5d} Festlegungs-Chunks", flush=True)
        alle.extend(cs)

    print(f"\nGesamt: {len(alle)} Chunks")
    if args.dry:
        for c in alle[:5]:
            print("\n---", c["id"], "---\n", c["anzeige"][:400])
        return
    if not alle:
        print("Nichts zu schreiben.", file=sys.stderr)
        return

    import chromadb

    print(f"\nEmbeddings via Ollama ({EMBED_MODEL}) ...", flush=True)
    vektoren = embed([c["doc"] for c in alle])

    print(f"Schreibe nach {DB_DIR} ...", flush=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    try:
        client.delete_collection(COLLECTION)
    except Exception:
        pass
    col = client.create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})
    for i in range(0, len(alle), 256):
        teil = alle[i : i + 256]
        col.add(
            ids=[c["id"] for c in teil],
            embeddings=vektoren[i : i + len(teil)],
            documents=[c["anzeige"] for c in teil],
            metadatas=[c["md"] for c in teil],
        )
    print(f"Fertig. {col.count()} Chunks in Collection '{COLLECTION}'.")


if __name__ == "__main__":
    main()
