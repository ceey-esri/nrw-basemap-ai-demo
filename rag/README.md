# RAG-Backend – `holeRechtsgrundlage`

Vom geometrischen Befund zur belegten Fundstelle: liefert die einschlägigen
Passagen aus dem NRW-Gesetzeskorpus (`../Rechtsgrundlagen/`). **Retrieval-only** –
die Synthese (Verfahren / Behörde / Paragraph) macht der Screening-Agent selbst.

## Stack

| Teil | Wahl | warum |
|---|---|---|
| Embeddings | Ollama `embeddinggemma` (768-dim) | lokal vorhanden, deutsch-fähig, kein Key |
| Vektor-Store | ChromaDB (dateibasiert, `chroma_db/`) | klein, kein Server |
| Chunking | pro `§` (lange §§ pro Absatz), `pypdf` | Norm ist die zitierbare Einheit |
| API | FastAPI, `POST /rechtsgrundlage` | wie das alte `api.py` |

## Setup

```bash
# im Repo-Root
python -m venv rag/.venv
rag/.venv/Scripts/activate          # Windows;  source rag/.venv/bin/activate sonst
pip install -r rag/requirements.txt

# Ollama muss laufen und embeddinggemma haben:
ollama pull embeddinggemma
```

## Index bauen

```bash
cd rag
python ingest.py --dry     # nur Chunk-Zahlen prüfen
python ingest.py           # PDFs -> Chunks -> Embeddings -> chroma_db/
```

Neu ausführen, wenn PDFs in `../Rechtsgrundlagen/` oder `korpus.py` sich ändern.

## Server starten

**Automatisch:** `npm run dev` startet den RAG-Server über ein Vite-Plugin
([../vite.config.js](../vite.config.js)) mit und stoppt ihn beim Beenden. Läuft
schon einer auf :8000, wird nichts gestartet. Fehlt `rag/.venv`, gibt es nur
eine Warnung (App läuft dann mit Platzhalter-Fallback).

**Manuell:**

```bash
npm run rag                 # aus dem Repo-Root
# oder:
cd rag && .venv/Scripts/python.exe server.py
```

Voraussetzung in beiden Fällen: **Ollama läuft** (Autostart-Dienst) mit
`embeddinggemma`.

Test:

```bash
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/rechtsgrundlage \
  -H "content-type: application/json" \
  -d '{"rechtsgebiet":"wasserrecht","befund":"Vorhaben 8 m von einem Gewässer entfernt"}'
```

## Frontend-Anbindung

`src/config.js` → `RAG_URL`. Das Tool `holeRechtsgrundlage`
(`src/screening/tools.js`) ruft `POST {RAG_URL}/rechtsgrundlage` und fällt auf
den Platzhaltertext aus `pruefbereiche.js` zurück, wenn der Server nicht läuft.

## Grenzen / offen

- Kein Reranking, keine kuratierte „Befund → Norm"-Mapping-Tabelle (Phase 2).
- Bereich 9 (Nutzungskonflikte): kommunale B-Pläne/Satzungen sind nicht drin –
  müssten je Zielkommune nachgeladen werden.
- Gesetzesstände: siehe `stand` je Dokument in `korpus.py`; Stand wird im
  Retrieval-Ergebnis mitgeliefert.
