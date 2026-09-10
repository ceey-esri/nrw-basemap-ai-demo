"""PDF-Korpus -> Chunks (pro Paragraph) -> Embeddings (Ollama) -> ChromaDB.

Aufruf:  python rag/ingest.py            (alles neu aufbauen)
         python rag/ingest.py --dry     (nur Chunks zeigen, nichts schreiben)

Voraussetzung: Ollama laeuft (http://localhost:11434) mit dem Modell
embeddinggemma.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

import httpx
from pypdf import PdfReader

from korpus import KORPUS, RECHTSGEBIETE

HIER = Path(__file__).resolve().parent
PDF_DIR = HIER.parent / "Rechtsgrundlagen"
DB_DIR = HIER / "chroma_db"
COLLECTION = "rechtsgrundlagen"

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "embeddinggemma"

MAX_CHUNK = 1600          # Zeichen; laengere Paragraphen werden nach Absaetzen geteilt
MIN_CHUNK = 40            # kuerzere Fragmente verwerfen

PARA_SPLIT = re.compile(r"(?=\n§\s*\d+[a-z]?\s)")
ABSATZ_SPLIT = re.compile(r"(?=\n\(\d+[a-z]?\)\s)")
NORM_RE = re.compile(r"§\s*(\d+[a-z]?)")

# Zeilen, die als Kopf-/Fusszeile oder Navigationsrest rausfliegen.
NOISE_RE = re.compile(
    r"^(seite \d+|- \d+ -|\d+\s*/\s*\d+|ausdruck vom|juris gmbh|"
    r"gesetze im internet|recht\.nrw\.de|www\.|https?://|stand:|"
    r"ein service des|bundesministeri|\s*)$",
    re.IGNORECASE,
)


def pdf_text(pfad: Path) -> str:
    reader = PdfReader(str(pfad))
    seiten = [(s.extract_text() or "") for s in reader.pages]

    # Zeilen, die auf vielen Seiten identisch auftauchen -> Kopf/Fuss.
    zeilen_counter: Counter[str] = Counter()
    for s in seiten:
        for z in {ln.strip() for ln in s.splitlines() if ln.strip()}:
            zeilen_counter[z] += 1
    haeufig = {z for z, c in zeilen_counter.items() if c >= max(3, len(seiten) * 0.3)}

    raus = []
    for s in seiten:
        for ln in s.splitlines():
            t = ln.strip()
            if not t or t in haeufig or NOISE_RE.match(t):
                continue
            raus.append(ln.rstrip())
    text = "\n".join(raus)
    text = text.replace("­", "")  # weiches Trennzeichen
    text = re.sub(r"[^\S\n]+", " ", text)  # jede Nicht-Newline-Whitespace -> Space (auch \xa0)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def ab_body(text: str) -> str:
    """Alles vor dem ersten echten Paragraphen (Kopf, Inhaltsuebersicht) weg.

    Ein Body-Paragraph ist einer, auf den NICHT sofort der naechste `§` folgt
    (Inhaltsverzeichnis-Zeilen haben dicht aufeinanderfolgende `§`-Eintraege).
    """
    for mm in re.finditer(r"(?=\n§\s*\d+[a-z]?[ \t])", text):
        s = mm.start()
        naechstes = text[s + 1 : s + 260].find("\n§")
        if naechstes == -1 or naechstes > 120:
            return text[s:]
    b = re.search(r"\n§\s*\d", text)
    return text[b.start() :] if b else text


def _ist_inhalt(roh: str) -> bool:
    """Grober Filter gegen uebriggebliebene Inhaltsverzeichnis-Zeilen."""
    if len(roh) > 220:
        return True
    if re.search(r"\(\d+[a-z]?\)\s", roh):  # hat einen Absatz
        return True
    rest = roh.split("\n", 1)[1] if "\n" in roh else ""
    return len(rest.strip()) > 60


def paragraphen(text: str):
    for roh in PARA_SPLIT.split(text):
        roh = roh.strip()
        if len(roh) < MIN_CHUNK or not roh.startswith("§"):
            continue
        m = NORM_RE.match(roh)
        if not m or not _ist_inhalt(roh):
            continue
        norm = f"§ {m.group(1)}"
        erste_zeile = roh.splitlines()[0].strip()
        ueberschrift = erste_zeile[len(norm):].strip(" -–")
        yield norm, ueberschrift, roh


def teile_lang(norm: str, ueberschrift: str, body: str):
    if len(body) <= MAX_CHUNK:
        yield body
        return
    kopf = body.splitlines()[0]
    stueck = ""
    for abs_ in ABSATZ_SPLIT.split(body):
        if len(stueck) + len(abs_) > MAX_CHUNK and stueck:
            yield stueck.strip()
            stueck = kopf + "\n"
        stueck += abs_
    if stueck.strip():
        yield stueck.strip()


def chunks_fuer(datei: str, meta: dict):
    pfad = PDF_DIR / datei
    text = ab_body(pdf_text(pfad))
    n = 0
    for norm, ueberschrift, body in paragraphen(text):
        for teil in teile_lang(norm, ueberschrift, body):
            if len(teil) < MIN_CHUNK:
                continue
            titel = f"{meta['kuerzel']} {norm}" + (f" - {ueberschrift}" if ueberschrift else "")
            n += 1
            md = {
                "datei": datei,
                "gesetz": meta["gesetz"],
                "kuerzel": meta["kuerzel"],
                "ebene": meta["ebene"],
                "norm": norm,
                "ueberschrift": ueberschrift[:200],
                "quelle_url": meta["quelle_url"],
                "stand": meta["stand"],
                "kontext": bool(meta.get("kontext")),
                "rechtsgebiete_str": ",".join(meta["rechtsgebiete"]),
            }
            for rg in RECHTSGEBIETE:
                md[f"rb_{rg}"] = rg in meta["rechtsgebiete"]
            yield {
                "id": f"{datei}::{norm}::{n}",
                "titel": titel,
                "doc": f"title: {titel} | text: {teil}",
                "anzeige": f"{titel}\n{teil}",
                "md": md,
            }


def embed(texte: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    with httpx.Client(timeout=180) as client:
        for i in range(0, len(texte), 32):
            batch = texte[i : i + 32]
            r = client.post(
                f"{OLLAMA_URL}/api/embed",
                json={"model": EMBED_MODEL, "input": batch},
            )
            r.raise_for_status()
            out.extend(r.json()["embeddings"])
            print(f"  embeddings {i + len(batch)}/{len(texte)}", end="\r")
    print()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="nur Chunks zaehlen/zeigen")
    args = ap.parse_args()

    alle = []
    for datei, meta in KORPUS.items():
        if not (PDF_DIR / datei).exists():
            print(f"FEHLT: {datei}", file=sys.stderr)
            continue
        cs = list(chunks_fuer(datei, meta))
        print(f"{datei:60s} {len(cs):4d} Chunks  [{','.join(meta['rechtsgebiete'])}]")
        alle.extend(cs)

    print(f"\nGesamt: {len(alle)} Chunks aus {len(KORPUS)} Dokumenten")
    if args.dry:
        for c in alle[:3]:
            print("\n---", c["id"], "---\n", c["anzeige"][:400])
        return

    import chromadb

    print(f"\nEmbeddings via Ollama ({EMBED_MODEL}) ...")
    vektoren = embed([c["doc"] for c in alle])

    print(f"Schreibe nach {DB_DIR} ...")
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
