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
// `ankernorm` ist die Norm, die den TATBESTAND des Belangs trägt - die Stelle,
// an der das Gesetz eine Genehmigung, eine Erlaubnis oder ein Verbot anknüpft.
// Sie wird im RAG nicht gesucht, sondern über ihre Metadaten (Kürzel + Norm)
// direkt geholt. Der Unterschied ist nicht Tempo, sondern Verlässlichkeit:
//
// § 35 Abs. 3 BauGB taugt als Entdeckungsschritt, weil er ein KATALOG ist -
// eine Passage, die viele Belange aufzählt. Ein Fachgesetz ist das nicht, es
// regelt ein Schutzgut. Deshalb lässt sich aus dem LFoG keine Liste holen -
// aber es braucht auch keine: zu welchem Belang es gehört, wissen wir ja.
// Und dass § 35 Abs. 3 zuverlässig gefunden wird, liegt nicht an guter
// Retrievalqualität, sondern daran, dass wir seine Fundstelle KENNEN. Genau
// diese Kenntnis steht hier je Kategorie - also wird sie auch so benutzt.
//
// Was das löst: Der Wald stand in § 35 Abs. 3 nie (die Waldumwandlung regelt
// § 39 LFoG NRW) und fiel aus dem Entdeckungsschritt heraus - auch bei 14
// Treffern und auch mit eingriffsbezogener Frage, weil der Vorhabentyp das
// Embedding dominiert. Mit der Ankernorm liegt § 39 LFoG NRW im Wortlaut vor
// dem Modell, und die Gruppe OFFEN schrumpft auf den einen nachprüfbaren Fall,
// dass eine Ankernorm im Korpus fehlt.
//
// Nebenbefund, der dem Radius zugutekommt: § 38 WHG ("fünf Meter"), § 9 FStrG
// ("40 Meter", "20 Meter") und § 43 EnWG ("200 Metern") tragen ihre Maße im
// Wortlaut. Die stehen damit deterministisch in dem Text, den radiusBelegt()
// in tools.js gegenprüft - vorher hing das daran, ob die Suche sie fand.
//
// Alle acht am 2026-10-11 gegen rag/chroma_db geprüft: vorhanden, und der
// gewählte Textausschnitt beginnt bei jeder am Absatz (1), also am Tatbestand.
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
 * @property {{kuerzel: string, norm: string, titel: string}} ankernorm
 *   Die Norm, die den Tatbestand dieses Belangs trägt. Wird im RAG NICHT
 *   gesucht, sondern über ihre Metadaten direkt geholt - siehe unten.
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
    ankernorm: {
      kuerzel: "BauGB",
      norm: "§ 35",
      titel: "Bauen im Aussenbereich",
    },
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
    ankernorm: {
      kuerzel: "BNatSchG",
      norm: "§ 14",
      titel: "Eingriffe in Natur und Landschaft",
    },
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
    ankernorm: {
      kuerzel: "WHG",
      norm: "§ 38",
      titel: "Gewaesserrandstreifen",
    },
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
    ankernorm: {
      kuerzel: "LFoG NRW",
      norm: "§ 39",
      titel: "Umwandlung von Wald in eine andere Nutzungsart",
    },
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
    ankernorm: {
      kuerzel: "FStrG",
      norm: "§ 9",
      titel: "Bauliche Anlagen an Bundesfernstrassen",
    },
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
    ankernorm: {
      kuerzel: "EnWG",
      norm: "§ 43",
      titel: "Erfordernis der Planfeststellung",
    },
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
    ankernorm: {
      kuerzel: "BauGB",
      norm: "§ 1a",
      titel: "Sparsamer Umgang mit Grund und Boden",
    },
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
    ankernorm: {
      kuerzel: "DSchG NRW",
      norm: "§ 9",
      titel: "Erlaubnispflichten bei Baudenkmaelern",
    },
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

/**
 * Die Ankernormen aller Kategorien - so, wie /belange sie erwartet.
 *
 * Geht als Teil der Anfrage mit, damit das Backend sie über ihre Metadaten
 * holen kann. Der Katalog ist hier die Wissensquelle, nicht die Suche.
 */
export function ankernormen() {
  return KATEGORIEN.filter((f) => f.ankernorm).map((f) => ({
    kategorieId: f.id,
    kuerzel: f.ankernorm.kuerzel,
    norm: f.ankernorm.norm,
  }));
}

/** Ankernorm einer Kategorie als lesbares Zitat, z. B. "LFoG NRW § 39". */
export function ankerZitat(id) {
  const a = getKategorie(id)?.ankernorm;
  return a ? `${a.kuerzel} ${a.norm}` : null;
}
