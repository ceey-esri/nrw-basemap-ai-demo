// Zuordnung Kreis / kreisfreie Stadt -> Planungsregion -> geltender Regionalplan.
//
// Spiegelt `rag/regionalpläne.py`. Wird gebraucht, damit das Tool
// `bestimmeRegion` aus dem Verschnitt mit den Gemeindegrenzen deterministisch
// den richtigen Plan findet - das darf das Modell nicht raten.
//
// Wichtig: Der Regionalplan Ruhr hat die Pläne der Bezirke Düsseldorf,
// Münster und Arnsberg im RVR-Verbandsgebiet abgelöst.

export const REGIONEN = {
  ruhr: {
    name: "Metropole Ruhr",
    plan: "Regionalplan Ruhr",
    stand: "Lesefassung August 2026 (in Kraft seit 28.02.2024)",
    url: "/Regionalplaene/RVR_Broschuere_Regionalplan2026_LY_20260818_1.pdf",
  },
  duesseldorf: {
    name: "Regierungsbezirk Düsseldorf (ohne RVR)",
    plan: "Regionalplan Düsseldorf (RPD)",
    stand: "Gesamtfassung 05.03.2026",
    url: "/Regionalplaene/20260305_3_32_rpd_plan_gesamt_opti150maxbild.pdf",
  },
  koeln: {
    name: "Regierungsbezirk Köln",
    plan: "Regionalplan Köln (Neuaufstellung)",
    stand: "Stand September 2025",
    url: "/Regionalplaene/Regionalplan%20Koeln/A-1_Textliche_Festlegungen.pdf",
  },
  muensterland: {
    name: "Münsterland (ohne RVR)",
    plan: "Regionalplan Münsterland",
    stand: "2025",
    url: "/Regionalplaene/32_rp-msl_1_textliche_festlegungen.pdf",
  },
  owl: {
    name: "Ostwestfalen-Lippe",
    plan: "Regionalplan OWL",
    stand: "rechtskräftig seit 16.04.2024",
    url: "/Regionalplaene/3.32_regionalplanowl2020_textteil.pdf",
  },
  arnsberg_soest_hsk: {
    name: "Kreis Soest und Hochsauerlandkreis",
    plan: "Regionalplan Arnsberg - Teilabschnitt Soest/HSK",
    stand: "März 2012",
    url: "/Regionalplaene/textl_darstellung.pdf",
  },
  arnsberg_suedwestfalen: {
    name: "Märkischer Kreis, Olpe, Siegen-Wittgenstein",
    plan: "Regionalplan Arnsberg - Teilplan MK/OE/SI",
    stand: "Februar 2025",
    url: "/Regionalplaene/festlegungen_und_erlaeuterungen.pdf",
  },
};

/** Kreise und kreisfreie Städte je Region - deckt NRW vollständig ab (53). */
const KREISE = {
  ruhr: [
    "Bochum", "Bottrop", "Dortmund", "Duisburg", "Essen", "Gelsenkirchen",
    "Hagen", "Hamm", "Herne", "Mülheim an der Ruhr", "Oberhausen",
    "Recklinghausen", "Unna", "Wesel", "Ennepe-Ruhr-Kreis",
  ],
  duesseldorf: [
    "Düsseldorf", "Krefeld", "Mönchengladbach", "Remscheid", "Solingen",
    "Wuppertal", "Kleve", "Mettmann", "Viersen", "Rhein-Kreis Neuss",
  ],
  koeln: [
    "Köln", "Bonn", "Leverkusen", "Städteregion Aachen", "Aachen", "Düren",
    "Euskirchen", "Heinsberg", "Oberbergischer Kreis", "Rhein-Erft-Kreis",
    "Rhein-Sieg-Kreis", "Rheinisch-Bergischer Kreis",
  ],
  muensterland: ["Münster", "Borken", "Coesfeld", "Steinfurt", "Warendorf"],
  owl: [
    "Bielefeld", "Gütersloh", "Herford", "Höxter", "Lippe",
    "Minden-Lübbecke", "Paderborn",
  ],
  arnsberg_soest_hsk: ["Soest", "Hochsauerlandkreis"],
  arnsberg_suedwestfalen: ["Märkischer Kreis", "Olpe", "Siegen-Wittgenstein"],
};

/**
 * Drei Kreise tragen einen Namen, den keine ihrer Gemeinden führt - die
 * Kreis-Auflösung über die Gemeindenamen läuft dort ins Leere. Ergänzt über
 * ihre Kreisstädte.
 *
 * Das ist die EINZIGE von Hand eingetragene Ortskenntnis in dieser Datei;
 * alles andere kommt aus dem Grenzlayer. Prüfbar: Meschede liegt im
 * Hochsauerlandkreis, Lüdenscheid im Märkischen Kreis, Schwelm im
 * Ennepe-Ruhr-Kreis.
 */
const KREISSTADT = {
  arnsberg_soest_hsk: ["Meschede"],
  arnsberg_suedwestfalen: ["Lüdenscheid"],
  ruhr: ["Schwelm"],
};

function norm(s) {
  let t = String(s ?? "").toLowerCase();
  t = t
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
  for (const weg of ["kreisfreie stadt", "landkreis", "stadt", "kreis", ","]) {
    t = t.replaceAll(weg, " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

const LOOKUP = new Map();
for (const [rid, namen] of Object.entries(KREISE)) {
  for (const n of namen) LOOKUP.set(norm(n), rid);
}
for (const [rid, namen] of Object.entries(KREISSTADT)) {
  for (const n of namen) LOOKUP.set(norm(n), rid);
}

/**
 * Region-Id zu einem Kreis- oder Stadtnamen; null, wenn unbekannt.
 * @param {string} name
 */
export function regionFuer(name) {
  const n = norm(name);
  if (!n) return null;
  if (LOOKUP.has(n)) return LOOKUP.get(n);

  // Nur noch in EINE Richtung und nur auf Wortgrenzen: der gesuchte Name muss
  // vollständig in einem Kreisnamen vorkommen ("Neuss" in "Rhein-Kreis Neuss",
  // "Aachen" in "Städteregion Aachen").
  //
  // Die umgekehrte Richtung war still falsch: "Lippetal" (Kreis Soest) lief
  // über "Lippe" nach OWL, "Bad Münstereifel" (Kreis Euskirchen) über
  // "Münster" ins Münsterland. Eine falsche Region ist schlimmer als keine.
  const teile = (x) => x.split(/[\s-]+/).filter((w) => w.length >= 4);
  const gesucht = teile(n);
  if (!gesucht.length) return null;
  for (const [k, rid] of LOOKUP) {
    const imKreis = new Set(teile(k));
    if (gesucht.every((w) => imKreis.has(w))) return rid;
  }
  return null;
}

/**
 * Durchsucht alle Attributwerte eines Features nach einem bekannten
 * Kreis-/Stadtnamen und liefert die Region.
 * @param {Record<string, unknown>} attrs
 */
export function regionAusAttributen(attrs) {
  for (const [feld, wert] of Object.entries(attrs ?? {})) {
    if (typeof wert !== "string" || wert.length < 3) continue;
    const rid = regionFuer(wert);
    if (rid) return { region: rid, gefundenIn: feld, name: wert };
  }
  return regionAusSchluessel(attrs);
}

/**
 * Der Grenzlayer "Gemeindegrenzen 2024" führt die amtlichen Schlüsselfelder:
 * AGS (8-stellig), ARS (12-stellig) sowie SN_L / SN_R / SN_K / SN_G einzeln.
 * Er deckt ganz Deutschland ab - das Beispielobjekt ist Flensburg.
 */
const NRW = "05";

/** Liegt die Gebietskörperschaft in Nordrhein-Westfalen? */
export function istNRW(attrs) {
  const ags = String(attrs?.AGS ?? "").replace(/\D/g, "");
  if (ags.length >= 2) return ags.startsWith(NRW);
  return String(attrs?.SN_L ?? "") === NRW;
}

/**
 * Die ersten fünf Stellen des AGS identifizieren den KREIS
 * (Land 2 + Regierungsbezirk 1 + Kreis 2). Damit lassen sich alle Gemeinden
 * eines Kreises im selben Layer wiederfinden.
 */
export function kreisSchluessel(attrs) {
  const ags = String(attrs?.AGS ?? "").replace(/\D/g, "");
  if (ags.length >= 5) return ags.slice(0, 5);
  const l = String(attrs?.SN_L ?? "");
  const r = String(attrs?.SN_R ?? "");
  const k = String(attrs?.SN_K ?? "").padStart(2, "0");
  return l && r ? `${l}${r}${k}`.slice(0, 5) : null;
}

/**
 * Letzter Ausweg: der Regierungsbezirk aus SN_R.
 *
 * BEWUSSTE GRENZE - nur zwei Bezirke sind darüber eindeutig:
 * Köln (3) und Detmold (7) haben keine Überschneidung mit dem
 * Regionalplan Ruhr. Düsseldorf (1) und Münster (5) verlieren je einen Kreis
 * ans RVR-Gebiet, Arnsberg (9) sogar mehrere und zerfällt zusätzlich in zwei
 * Teilpläne. Für die drei liefert diese Funktion deshalb NICHTS, statt eine
 * falsche Region zu liefern.
 */
const BEZIRK_EINDEUTIG = { 3: "koeln", 7: "owl" };

export function regionAusSchluessel(attrs) {
  if (!istNRW(attrs)) return null;
  const schluessel = kreisSchluessel(attrs);
  const bezirk = schluessel ? Number(schluessel[2]) : null;
  const rid = bezirk == null ? null : BEZIRK_EINDEUTIG[bezirk];
  if (!rid) return null;
  return {
    region: rid,
    gefundenIn: "SN_R (Regierungsbezirk)",
    name: String(attrs?.GEN ?? schluessel ?? ""),
    ueberBezirk: true,
  };
}
