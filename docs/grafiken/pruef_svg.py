import io
import re
import xml.etree.ElementTree as E

from pathlib import Path

# Relativ zum Skript, damit es aus jedem Arbeitsverzeichnis laeuft.
HIER = Path(__file__).resolve().parent
UEBERSICHT = str(HIER.parent / "praesentation" / "uebersicht.html")


P = UEBERSICHT

s = io.open(P, encoding="utf-8").read()
a = s.index("<svg ")
b = s.index("</svg>") + 6
frag = s[a:b]

# Numerische Entitaeten sind in XML gueltig, benannte nicht - hier gibt es nur
# numerische, also direkt parsen.
baum = E.fromstring(frag)
ns = "" if not baum.tag.startswith("{") else baum.tag[:baum.tag.index("}") + 1]
zaehler = {}
for el in baum.iter():
    tag = el.tag.replace(ns, "")
    zaehler[tag] = zaehler.get(tag, 0) + 1
print("SVG wohlgeformt.", ", ".join(f"{k}={v}" for k, v in sorted(zaehler.items())))

# Liegt etwas ausserhalb des viewBox?
vb = baum.get("viewBox").split()
w, h = float(vb[2]), float(vb[3])
raus = []
for el in baum.iter(f"{ns}rect"):
    x, y = float(el.get("x")), float(el.get("y"))
    bw, bh = float(el.get("width")), float(el.get("height"))
    if x < 0 or y < 0 or x + bw > w or y + bh > h:
        raus.append(f"rect {x},{y} {bw}x{bh}")
for el in baum.iter(f"{ns}text"):
    x, y = float(el.get("x")), float(el.get("y"))
    if x < 0 or y < 0 or x > w or y > h:
        raus.append(f"text {x},{y} {(el.text or '')[:24]}")
print("viewBox:", w, "x", h, "- ausserhalb:", raus if raus else "nichts")

# Verweisen alle marker-end auf definierte Marker?
ids = {el.get("id") for el in baum.iter(f"{ns}marker")}
benutzt = set(re.findall(r"url\(#([^)]+)\)", frag))
print("Marker definiert:", sorted(ids))
fehlt = benutzt - ids
print("Marker benutzt aber undefiniert:", sorted(fehlt) if fehlt else "keine")
