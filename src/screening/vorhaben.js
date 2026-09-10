// Katalog der Vorhabentypen für das räumliche Erstscreening.
//
// Ersetzt den früheren Prüfbereich-Katalog: Es gibt keine fest verdrahteten
// Rechtsgebiete mehr. Der Agent leitet aus Gesetzestexten und dem geltenden
// Regionalplan selbst ab, welche Themen für das jeweilige Vorhaben relevant
// sind.

/** @typedef {"wind"|"gewerbe"|"strasse"|"mobilfunk"|"aussenbereich"|"pv"} VorhabenId */

/**
 * @typedef {Object} Vorhaben
 * @property {VorhabenId} id
 * @property {string} titel
 * @property {string} titelEn
 * @property {string} beschreibung  - Kontext für die RAG-Suche des Agenten
 * @property {"punkt"|"linie"|"flaeche"} geometrie - übliche Geometrie
 */

/** @type {Vorhaben[]} */
export const VORHABEN = [
  {
    id: "wind",
    titel: "Windenergieanlage",
    titelEn: "Wind turbine",
    beschreibung:
      "Errichtung einer Windenergieanlage oder eines Windparks. Raumbedeutsam durch Höhe, " +
      "Abstände zu Siedlung und Infrastruktur, Windenergiebereiche des Regionalplans.",
    geometrie: "punkt",
  },
  {
    id: "gewerbe",
    titel: "Gewerbe / Industrie",
    titelEn: "Commercial / industrial",
    beschreibung:
      "Gewerbliche oder industrielle Baufläche. Regionalplanerisch als Gewerbe- und " +
      "Industrieansiedlungsbereich (GIB) relevant, dazu Erschliessung und Freiraumanspruch.",
    geometrie: "flaeche",
  },
  {
    id: "strasse",
    titel: "Strasse / Verkehrsweg",
    titelEn: "Road / transport route",
    beschreibung:
      "Neubau oder Ausbau eines Verkehrswegs. Linienhaftes Vorhaben, das Freiraum, Gewässer, " +
      "Wald und bestehende Infrastruktur quert.",
    geometrie: "linie",
  },
  {
    id: "mobilfunk",
    titel: "Mobilfunkmast / Antenne",
    titelEn: "Mobile mast / antenna",
    beschreibung:
      "Punktförmige Telekommunikationsanlage. Relevant vor allem durch Standortbezug zu " +
      "Freiraum, Landschaftsbild und bestehender Infrastruktur.",
    geometrie: "punkt",
  },
  {
    id: "aussenbereich",
    titel: "Aussenbereichsvorhaben",
    titelEn: "Outer-area project",
    beschreibung:
      "Vorhaben im baulichen Aussenbereich ausserhalb der Siedlungsbereiche. " +
      "Regionalplanerisch am Freiraumschutz und den Allgemeinen Freiraum- und Agrarbereichen zu messen.",
    geometrie: "flaeche",
  },
  {
    id: "pv",
    titel: "Freiflächen-Photovoltaik",
    titelEn: "Ground-mounted photovoltaics",
    beschreibung:
      "Solarenergieanlage auf Freifläche. Regionalplanerisch über Festlegungen zu " +
      "Freiflächensolarenergieanlagen und Freiraumschutz gesteuert.",
    geometrie: "flaeche",
  },
];

/** @param {string} id */
export function getVorhaben(id) {
  return VORHABEN.find((v) => v.id === id) ?? null;
}

/**
 * @param {string} id
 * @param {"de"|"en"} [lang]
 */
export function vorhabenTitel(id, lang) {
  const v = getVorhaben(id);
  if (!v) return id;
  return lang === "en" ? v.titelEn : v.titel;
}
