// Vorhaben-Kontext: kleiner, von app.js gefuellter Zustand, den die Agenten
// ueber das Tool `holeVorhabenKontext` lesen (Vorhabentyp, angehakte
// Pruefbereiche). Bewusst getrennt von der Karte, damit tools.js nicht die
// halbe App importieren muss.

const state = {
  /** @type {string} */
  vorhabenTyp: "",
  /** @type {() => string[]} */
  aktivePruefbereiche: () => [],
  /** @type {(ids: string[]) => void} */
  setzePruefbereiche: () => {},
};

export function initKontext({ getVorhabenTyp, getAktivePruefbereiche, setzePruefbereiche }) {
  Object.defineProperty(state, "vorhabenTyp", { get: getVorhabenTyp, configurable: true });
  state.aktivePruefbereiche = getAktivePruefbereiche;
  state.setzePruefbereiche = setzePruefbereiche;
}

export function getKontext() {
  return {
    vorhabenTyp: state.vorhabenTyp || "(nicht angegeben)",
    aktivePruefbereiche: state.aktivePruefbereiche(),
  };
}

export function setzePruefbereiche(ids) {
  state.setzePruefbereiche(ids);
}
