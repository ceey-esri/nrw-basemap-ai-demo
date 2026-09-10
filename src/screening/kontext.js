// Vorhaben-Kontext: von app.js gefüllter Zustand, den der Agent über das
// Werkzeug `holeVorhabenKontext` liest. Bewusst getrennt von der Karte, damit
// das Werkzeug nicht ins DOM greifen muss.

let getVorhabenTypFn = () => "";
let getKommentarFn = () => "";

export function initKontext(opts) {
  getVorhabenTypFn = opts.getVorhabenTyp ?? getVorhabenTypFn;
  getKommentarFn = opts.getKommentar ?? getKommentarFn;
}

export function getKontext() {
  return {
    vorhabenTyp: getVorhabenTypFn() || "(nicht angegeben)",
    kommentar: getKommentarFn() || "",
  };
}
