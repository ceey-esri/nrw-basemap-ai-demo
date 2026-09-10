// Katalog der Kategorien des räumlichen Erstscreenings (8).
//
// HERLEITUNG - warum genau diese Bereiche:
//
// Ein raumbedeutsames Vorhaben wird an den Erfordernissen der Raumordnung
// gemessen (§ 3 Abs. 1 Nr. 1 ROG): den Zielen und Grundsätzen des geltenden
// Regionalplans. Die Regionalpläne sind nach § 7 ROG in Festlegungskapitel
// gegliedert - Siedlungsraum, Freiraum mit seinen Teilfunktionen, technische
// Infrastruktur, Rohstoffsicherung, Kulturlandschaft. Genau diese Gliederung
// bildet dieser Katalog ab; sie ist also nicht aus dem Datenbestand abgeleitet,
// sondern aus dem Instrument, an dem das Vorhaben zu messen ist.
//
// Je Kategorie sind zusätzlich die einschlägigen Fachgesetze benannt. Die
// stehen im RAG-Gesetzeskorpus und sind damit belegbar.
//
// `regionalplanSuche` ist der Suchtext für holeRegionalplan, `gesetzSuche`
// der für holeRechtsgrundlage. `layerMuster` sind Titel-Teilstrings der
// Webmap-Layer, die diesen Bereich räumlich abbilden.
//
// `stichworte` findet, was der Titel verschweigt: Waldflächen stecken in
// diesem Datenbestand als KLASSE in einem allgemeinen Flächenlayer, nicht in
// einem Layer namens "Wald". Die Wörter laufen gegen die Klassen des
// Renderers und die codierten Domänenwerte - beides steht in der Webmap und
// kostet keine Abfrage.
//
// OFFEN: Das ROG selbst liegt nicht im Korpus - der Rahmenbezug ist daher
// nicht per RAG belegbar, die Fachgesetze und der Regionalplan schon.

/**
 * @typedef {Object} Kategorie
 * @property {string} id
 * @property {string} titel
 * @property {string} titelEn
 * @property {string} rechtsrahmen   - warum dieser Bereich zu betrachten ist
 * @property {string} fachgesetze    - einschlägige Normen (im Korpus belegbar)
 * @property {string} regionalplanSuche
 * @property {string} gesetzSuche
 * @property {string[]} layerMuster
 * @property {string[]} stichworte
 * @property {"flaeche"|"laenge"} [leitmass] Messgrösse der Kennzahl;
 *   ohne Angabe entscheiden die Daten (Fläche schlägt Länge).
 */

/** @type {Kategorie[]} */
export const KATEGORIEN = [
  {
    id: "siedlung",
    leitmass: "flaeche",
    titel: "Siedlungsraum",
    titelEn: "Settlement area",
    rechtsrahmen:
      "Regionalplanerische Festlegung des Siedlungsraums - Allgemeine Siedlungsbereiche (ASB) " +
      "und Gewerbe- und Industrieansiedlungsbereiche (GIB). Steuert, wo sich Siedlungstätigkeit " +
      "konzentrieren soll und wo nicht.",
    fachgesetze: "§§ 1, 35 BauGB (Bauleitplanung, Aussenbereich); §§ 2-15 BauNVO",
    regionalplanSuche:
      "Allgemeine Siedlungsbereiche ASB und Gewerbe- und Industrieansiedlungsbereiche GIB, " +
      "Siedlungsentwicklung im Freiraum",
    gesetzSuche: "Zulässigkeit von Vorhaben im Aussenbereich und Art der baulichen Nutzung",
    layerMuster: ["Siedlungsflächen", "Bauwerke und Einrichtungen", "Flächen weiterer Nutzung"],
    stichworte: [
      "Siedlung",
      "Wohnbau",
      "Bebauung",
      "Wohnen",
      "Ortslage",
      "Gebäude",
    ],
  },
  {
    id: "natur",
    titel: "Natur und Landschaft",
    titelEn: "Nature and landscape",
    rechtsrahmen:
      "Freiraumschutz als Kern der regionalplanerischen Freiraumfestlegungen - Bereiche zum " +
      "Schutz der Natur (BSN) und Bereiche zum Schutz der Landschaft und landschaftsorientierten " +
      "Erholung (BSLE).",
    fachgesetze:
      "§§ 13-15 BNatSchG (Eingriffsregelung), § 30 BNatSchG (geschützte Biotope), " +
      "§§ 23-29 BNatSchG (Schutzgebiete); LNatSchG NRW",
    regionalplanSuche:
      "Bereiche zum Schutz der Natur BSN und zum Schutz der Landschaft BSLE, Freiraumschutz",
    gesetzSuche: "Eingriff in Natur und Landschaft, geschützte Teile von Natur und Landschaft",
    layerMuster: [
      "Natur- und bodenschutzrechtliche",
      "Naturdenkmäler",
      "Besondere Anlagen und Schutzgebiete",
      "BaumreihenundHecken",
    ],
    stichworte: [
      "Naturschutz",
      "Biotop",
      "Landschaftsschutz",
      "Hecke",
      "Baumreihe",
      "Gehölz",
      "Naturdenkmal",
      "FFH",
      "Vogelschutz",
    ],
  },
  {
    id: "wasser",
    titel: "Wasser",
    titelEn: "Water",
    rechtsrahmen:
      "Regionalplanerische Festlegungen zu Oberflächengewässern, Gewässeraün und " +
      "Überschwemmungsbereichen; Sicherung der Gewässerfunktionen im Freiraum.",
    fachgesetze:
      "§ 38 WHG (Gewässerrandstreifen), §§ 8-10 WHG (Gewässerbenutzung), " +
      "§ 78 WHG (Überschwemmungsgebiete); LWG NRW",
    regionalplanSuche: "Oberflächengewässer, Gewässeraün, Überschwemmungsbereiche, Hochwasserschutz",
    gesetzSuche: "Gewässerrandstreifen und Benutzung oberirdischer Gewässer",
    layerMuster: ["Gewässerpunkte", "Gewässerlinien", "Gewässerflächen"],
    stichworte: [
      "Gewässer",
      "Fluss",
      "Bach",
      "See",
      "Teich",
      "Überschwemmung",
      "Hochwasser",
      "Wasserschutz",
    ],
  },
  {
    id: "wald",
    leitmass: "flaeche",
    titel: "Wald und Forstwirtschaft",
    titelEn: "Forest and forestry",
    rechtsrahmen:
      "Regionalplanerische Waldbereiche und die Sicherung der Waldfunktionen als Teil des " +
      "Freiraums.",
    fachgesetze:
      "§ 1 Abs. 3 LFoG NRW (Waldbegriff), § 39 LFoG NRW (Waldumwandlung); § 2 BWaldG",
    regionalplanSuche: "Waldbereiche, Sicherung und Entwicklung des Waldes, Waldinanspruchnahme",
    gesetzSuche: "Umwandlung von Wald in eine andere Nutzungsart",
    layerMuster: ["Vegetationsflächen", "Laub- und Nadelbäume"],
    stichworte: [
      "Wald",
      "Forst",
      "Laubholz",
      "Nadelholz",
      "Mischholz",
      "Waldfläche",
    ],
  },
  {
    id: "verkehr",
    leitmass: "laenge",
    titel: "Verkehrsinfrastruktur",
    titelEn: "Transport infrastructure",
    rechtsrahmen:
      "Regionalplanerische Festlegungen zur Verkehrsinfrastruktur und zur Anbindung " +
      "raumbedeutsamer Vorhaben an das überörtliche Netz.",
    fachgesetze:
      "§ 9 FStrG (Anbauverbots- und -beschränkungszone), § 8 FStrG (Sondernutzung); " +
      "§ 25 StrWG NRW; § 123 BauGB (Erschliessung)",
    regionalplanSuche: "Verkehrsinfrastruktur, Strassen und Schienenwege, Anbindung an das Verkehrsnetz",
    gesetzSuche: "bauliche Anlagen an Strassen, Anbauverbotszone und Zufahrten",
    layerMuster: ["Verkehrswege", "Verkehrsflächen", "Verkehrspunkte"],
    stichworte: [
      "Straße",
      "Autobahn",
      "Bahn",
      "Schiene",
      "Weg",
      "Verkehr",
      "Flugplatz",
    ],
  },
  {
    id: "energie",
    leitmass: "laenge",
    titel: "Energieanlagen und Leitungsnetze",
    titelEn: "Energy installations and utility networks",
    rechtsrahmen:
      "Regionalplanerische Festlegungen zu Leitungstrassen, Energieversorgung und " +
      "Windenergie- bzw. Solarenergiebereichen.",
    fachgesetze: "§§ 43 ff. EnWG (Planfeststellung Hoch-/Höchstspannung); Wegerecht nach TKG",
    regionalplanSuche:
      "Leitungstrassen, Energieversorgung, Windenergiebereiche, Freiflächensolarenergie",
    gesetzSuche: "Leitungsanlagen und Wegerechte der Energie- und Telekommunikationsversorgung",
    layerMuster: ["Versorgungsleitungen und Transportanlagen", "Pumpen"],
    stichworte: [
      "Leitung",
      "Freileitung",
      "Umspann",
      "Windenergie",
      "Photovoltaik",
      "Kraftwerk",
      "Energieversorgung",
      "Umspannwerk",
      "Windenergieanlage",
    ],
  },
  {
    id: "landwirtschaft",
    leitmass: "flaeche",
    titel: "Landwirtschaft",
    titelEn: "Agriculture",
    rechtsrahmen:
      "Erhalt der landwirtschaftlichen Nutzfläche als eigener Freiraumbelang der " +
      "Regionalplanung; die Inanspruchnahme guter Böden ist zu begründen und zu minimieren.",
    fachgesetze:
      "§ 1a Abs. 2 BauGB (Umwidmungssperrklausel, sparsamer Umgang mit Grund und Boden); " +
      "§ 15 BNatSchG (Ausgleich, Rücksicht auf agrarstrukturelle Belange)",
    regionalplanSuche:
      "Landwirtschaft, landwirtschaftliche Nutzflächen, Agrarstruktur, Inanspruchnahme " +
      "landwirtschaftlicher Flächen",
    gesetzSuche:
      "Umwidmung landwirtschaftlich genutzter Flächen und agrarstrukturelle Belange beim " +
      "Ausgleich",
    layerMuster: ["Vegetationsflächen", "Flächen weiterer Nutzung"],
    stichworte: [
      "Landwirtschaft",
      "Acker",
      "Grünland",
      "Weide",
      "Obstplantage",
      "Gartenland",
      "Streuobst",
    ],
  },
  {
    id: "kulturlandschaft",
    titel: "Kulturlandschaft und Denkmäler",
    titelEn: "Cultural landscape and monuments",
    rechtsrahmen:
      "Regionalplanerische Festlegungen zur Erhaltung bedeutsamer Kulturlandschaften und " +
      "kulturlandschaftlich wertvoller Bereiche.",
    fachgesetze:
      "§ 9 DSchG NRW (erlaubnispflichtige Massnahmen, auch in der Umgebung), " +
      "§§ 13-16 DSchG NRW (Bodendenkmäler)",
    regionalplanSuche: "Kulturlandschaft, kulturlandschaftlich bedeutsame Bereiche, Denkmalpflege",
    gesetzSuche: "Massnahmen an Baudenkmälern und in ihrer Umgebung, Bodendenkmäler",
    layerMuster: ["Historische Bauwerke"],
    stichworte: [
      "Denkmal",
      "Bodendenkmal",
      "Historisch",
      "Burg",
      "Kloster",
      "Kirche",
      "Kulturlandschaft",
    ],
  },
];

/** @param {string} id */
export function getKategorie(id) {
  return KATEGORIEN.find((f) => f.id === id) ?? null;
}

/**
 * @param {string} id
 * @param {"de"|"en"} [lang]
 */
export function kategorieTitel(id, lang) {
  const f = getKategorie(id);
  if (!f) return id;
  return lang === "en" ? f.titelEn : f.titel;
}

/** Kompakte Liste für den Agent-Prompt. */
export function kategorienListe() {
  return KATEGORIEN.map(
    (f) => `- ${f.id}: ${f.titel} — ${f.rechtsrahmen} Fachrecht: ${f.fachgesetze}`,
  ).join("\n");
}
