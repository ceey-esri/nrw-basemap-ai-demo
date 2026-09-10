"""Katalog der NRW-Regionalplaene + Zuordnung Kreis -> Planungsregion.

Die textlichen Festlegungen liegen als PDF in `Regionalplaene/`. Jede Datei
gehoert zu genau einer Planungsregion; die Regionen decken NRW vollstaendig
und ueberschneidungsfrei ab.

Wichtig: Der Regionalplan Ruhr (in Kraft seit 28.02.2024) hat die vorher
geltenden Plaene der Bezirke Duesseldorf, Muenster und Arnsberg im
RVR-Verbandsgebiet abgeloest. Das Verbandsgebiet ist daher aus diesen drei
Bezirken herausgeschnitten.
"""

from __future__ import annotations

# --- Planungsregionen -------------------------------------------------------
# id -> Anzeigename. Die id landet als Filter-Flag im Vektorindex.
REGIONEN = {
    "ruhr": "Metropole Ruhr",
    "duesseldorf": "Regierungsbezirk Duesseldorf (ohne RVR)",
    "koeln": "Regierungsbezirk Koeln",
    "muensterland": "Muensterland (ohne RVR)",
    "owl": "Ostwestfalen-Lippe",
    "arnsberg_soest_hsk": "Kreis Soest und Hochsauerlandkreis",
    "arnsberg_suedwestfalen": "Maerkischer Kreis, Olpe, Siegen-Wittgenstein",
}

# --- Kreise / kreisfreie Staedte je Region ---------------------------------
# Vollstaendig: 22 kreisfreie Staedte + 31 Kreise = 53 Gebietskoerperschaften.
KREISE = {
    "ruhr": [
        "Bochum", "Bottrop", "Dortmund", "Duisburg", "Essen", "Gelsenkirchen",
        "Hagen", "Hamm", "Herne", "Muelheim an der Ruhr", "Oberhausen",
        "Recklinghausen", "Unna", "Wesel", "Ennepe-Ruhr-Kreis",
    ],
    "duesseldorf": [
        "Duesseldorf", "Krefeld", "Moenchengladbach", "Remscheid", "Solingen",
        "Wuppertal", "Kleve", "Mettmann", "Viersen", "Rhein-Kreis Neuss",
    ],
    "koeln": [
        "Koeln", "Bonn", "Leverkusen", "StaedteRegion Aachen", "Dueren",
        "Euskirchen", "Heinsberg", "Oberbergischer Kreis", "Rhein-Erft-Kreis",
        "Rhein-Sieg-Kreis", "Rheinisch-Bergischer Kreis",
    ],
    "muensterland": ["Muenster", "Borken", "Coesfeld", "Steinfurt", "Warendorf"],
    "owl": [
        "Bielefeld", "Guetersloh", "Herford", "Hoexter", "Lippe",
        "Minden-Luebbecke", "Paderborn",
    ],
    "arnsberg_soest_hsk": ["Soest", "Hochsauerlandkreis"],
    "arnsberg_suedwestfalen": ["Maerkischer Kreis", "Olpe", "Siegen-Wittgenstein"],
}

# --- Die PDF-Dokumente ------------------------------------------------------
# datei (relativ zu Regionalplaene/) -> Metadaten
KORPUS_RP = {
    "20260305_3_32_rpd_plan_gesamt_opti150maxbild.pdf": {
        "plan": "Regionalplan Duesseldorf (RPD)",
        "kuerzel": "RPD",
        "region": "duesseldorf",
        "stand": "Gesamtfassung 05.03.2026",
        "quelle_url": "https://www.brd.nrw.de/Themen/Planen-Bauen/Regionalplanung/Regionalplan-Duesseldorf-RPD-Planwerk-und-Aenderungsverfahren-2",
    },
    "RVR_Broschuere_Regionalplan2026_LY_20260818_1.pdf": {
        "plan": "Regionalplan Ruhr",
        "kuerzel": "RP Ruhr",
        "region": "ruhr",
        "stand": "Lesefassung August 2026 (in Kraft seit 28.02.2024)",
        "quelle_url": "https://www.rvr.ruhr/themen/staatliche-regionalplanung/",
    },
    "Regionalplan Koeln/A-1_Textliche_Festlegungen.pdf": {
        "plan": "Regionalplan Koeln (Neuaufstellung)",
        "kuerzel": "RP Koeln",
        "region": "koeln",
        "stand": "Stand September 2025",
        "quelle_url": "https://www.bezreg-koeln.nrw.de/themen/kommunales-planung-bauen-und-verkehr/regionalplanung/regionalplan-koeln",
    },
    "32_rp-msl_1_textliche_festlegungen.pdf": {
        "plan": "Regionalplan Muensterland",
        "kuerzel": "RP Muensterland",
        "region": "muensterland",
        "stand": "2025",
        "quelle_url": "https://www.bezreg-muenster.de/themen/regionalplanung-und-regionalrat/regionalplan-muensterland",
    },
    "3.32_regionalplanowl2020_textteil.pdf": {
        "plan": "Regionalplan Ostwestfalen-Lippe (OWL)",
        "kuerzel": "RP OWL",
        "region": "owl",
        "stand": "rechtskraeftig seit 16.04.2024",
        "quelle_url": "https://www.bezreg-detmold.nrw.de/wir-ueber-uns/organisationsstruktur/abteilung-3/dezernat-32/regionalplan-owl",
    },
    "textl_darstellung.pdf": {
        "plan": "Regionalplan Arnsberg - Teilabschnitt Kreis Soest und Hochsauerlandkreis",
        "kuerzel": "RP Arnsberg (Soest/HSK)",
        "region": "arnsberg_soest_hsk",
        "stand": "Maerz 2012",
        "quelle_url": "https://www.bra.nrw.de/kommunalaufsicht-planung-verkehr/regionalrat-und-regionalentwicklung/regionalplan-arnsberg/raeumlicher-teilabschnitt-kreis-soest-und-hochsauerlandkreis",
    },
    "festlegungen_und_erlaeuterungen.pdf": {
        "plan": "Regionalplan Arnsberg - Raeumlicher Teilplan Maerkischer Kreis, Olpe, Siegen-Wittgenstein",
        "kuerzel": "RP Arnsberg (MK/OE/SI)",
        "region": "arnsberg_suedwestfalen",
        "stand": "Februar 2025",
        "quelle_url": "https://www.bra.nrw.de/kommunalaufsicht-planung-verkehr/regionalrat-und-regionalentwicklung/regionalplan-arnsberg",
    },
}


def _norm(s: str) -> str:
    """Namen vergleichbar machen: Umlaute, Klein, Zusaetze weg."""
    s = (s or "").lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    for weg in ("kreisfreie stadt", "stadt ", "kreis ", "landkreis ", ", stadt", ","):
        s = s.replace(weg, " ")
    return " ".join(s.split())


# Nachschlagetabelle: normalisierter Name -> region-id
_LOOKUP = {}
for _rid, _namen in KREISE.items():
    for _n in _namen:
        _LOOKUP[_norm(_n)] = _rid


def region_fuer(name: str) -> str | None:
    """Planungsregion zu einem Kreis- oder Stadtnamen. None, wenn unbekannt."""
    n = _norm(name)
    if n in _LOOKUP:
        return _LOOKUP[n]
    # Teiltreffer: "Kreis Soest" vs. "Soest", "Muelheim" vs. "Muelheim an der Ruhr"
    for k, rid in _LOOKUP.items():
        if k and (k in n or n in k):
            return rid
    return None


def plan_fuer_region(region: str) -> dict | None:
    for datei, meta in KORPUS_RP.items():
        if meta["region"] == region:
            return {"datei": datei, **meta}
    return None
