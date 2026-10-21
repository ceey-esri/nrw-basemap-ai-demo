// Das alte Muster gegen echte Dienstfehler UND gegen gueltige Fachantworten.
const ALT = /\b429\b|too many requests|rate.?limit|high demand/i;

// Neu: die Zahl 429 gilt nur im Fehlerkontext. Die eindeutigen Wortmarken
// bleiben, dazu die Groessenabweisung des Esri-Dienstes.
const NEU =
  /too many requests|rate.?limit|high demand|exceeds the maximum usage size|error during (?:message processing|intent detection)|(?:http|statuscode|status(?:\s*code)?|code|error|fehler)\D{0,10}429\b/i;

const echteFehler = [
  "The system is currently experiencing high demand. Please try again later.",
  "429 Too Many Requests",
  "Request failed with status code 429",
  "HTTP 429",
  "Fehler 429",
  "Statuscode 429",
  "exceeds the maximum usage size allowed during peak load",
  "Error during intent detection",
  "rate limit exceeded",
  "rate-limit reached",
];

const gueltigeAntworten = [
  "Vegetationsflächen: 429 Objekte, 8518608 m², Aufteilung nach klasse",
  "Siedlungsflächen: 1.429 Objekte, 355435 m²",
  "Linienhafte Bauwerke: 99 Objekte, 1,429 km",
  "Natur- und bodenschutzrechtliche Flächen: 2 Objekte, 607104 m²",
  "Verkehrswege: 42 Objekte, 12.429 m, Aufteilung nach klasse",
  "Ackerland: 3.429 ha",
  "RELEVANT: ja — ZITAT: § 429 BauGB", // kein echter Paragraph, aber denkbar
];

let fehler = 0;
console.log("ALT  | NEU  | erwartet | Text");
console.log("-".repeat(88));
for (const t of echteFehler) {
  const a = ALT.test(t), n = NEU.test(t);
  if (!n) fehler++;
  console.log(
    `${(a ? "JA" : "nein").padEnd(4)} | ${(n ? "JA" : "nein").padEnd(4)} | ` +
      `${"FEHLER".padEnd(8)} | ${n ? "  " : "<<"} ${t.slice(0, 52)}`,
  );
}
console.log("-".repeat(88));
for (const t of gueltigeAntworten) {
  const a = ALT.test(t), n = NEU.test(t);
  if (n) fehler++;
  console.log(
    `${(a ? "JA" : "nein").padEnd(4)} | ${(n ? "JA" : "nein").padEnd(4)} | ` +
      `${"gültig".padEnd(8)} | ${n ? "<<" : "  "} ${t.slice(0, 52)}`,
  );
}
console.log("-".repeat(88));
const alteFalsch = gueltigeAntworten.filter((t) => ALT.test(t)).length;
console.log(`Das alte Muster hielt ${alteFalsch} von ${gueltigeAntworten.length} gültigen Antworten für Dienstfehler.`);
console.log(fehler === 0 ? "Das neue Muster: alle Fälle korrekt." : `${fehler} FEHLSCHLAG/E`);
process.exit(fehler === 0 ? 0 : 1);
