# -*- coding: utf-8 -*-
"""Zieht die Tafel aus der Uebersicht und baut eine eigenstaendige Renderseite.

Das SVG arbeitet mit `currentColor`, erbt seine Farbe also vom Dokument. In der
Renderseite wird sie fest gesetzt, sonst kaeme Schwarz-auf-Transparent heraus.
"""
import io
import re

from pathlib import Path

# Relativ zum Skript, damit es aus jedem Arbeitsverzeichnis laeuft.
HIER = Path(__file__).resolve().parent
UEBERSICHT = str(HIER.parent / "praesentation" / "uebersicht.html")


SP = str(HIER)  # die Renderseite landet neben diesem Skript

s = io.open(UEBERSICHT, encoding="utf-8").read()
a = s.index("<svg ")
b = s.index("</svg>") + len("</svg>")
svg = s[a:b]

m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
w, h = int(float(m.group(1))), int(float(m.group(2)))

# Eine Randzone, damit beim Zuschneiden nichts an der Kante klebt.
RAND = 24
seite = f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<style>
  @page {{ margin: 0; }}
  html, body {{ margin: 0; padding: 0; background: #ffffff; }}
  body {{
    width: {w + 2 * RAND}px;
    height: {h + 2 * RAND}px;
    padding: {RAND}px;
    box-sizing: border-box;
    color: #16191d;
    font-family: "Segoe UI", "Avenir Next", system-ui, sans-serif;
  }}
  svg {{ display: block; width: {w}px; height: {h}px; }}
</style></head>
<body>
{svg}
</body></html>
"""
io.open(SP + r"\tafel_render.html", "w", encoding="utf-8").write(seite)
print(f"Renderseite gebaut: {w + 2 * RAND} x {h + 2 * RAND} px (SVG {w} x {h})")
