// Die neue Musterbildung aus radiusBelegt() isoliert, mit Erwartungswerten.
const ZAHLWORT = {
  1: ["ein", "einem", "einen"], 2: ["zwei"], 3: ["drei"], 4: ["vier"],
  5: ["fünf"], 6: ["sechs"], 7: ["sieben"], 8: ["acht"], 9: ["neun"],
  10: ["zehn"], 12: ["zwölf"], 15: ["fünfzehn"], 20: ["zwanzig"],
  25: ["fünfundzwanzig"], 30: ["dreißig", "dreissig"], 40: ["vierzig"],
  50: ["fünfzig"], 100: ["hundert", "einhundert"],
};

function muster(meter) {
  const METER = String.raw`(?:m|Meter|Metern)`;
  const KILOMETER = String.raw`(?:km|Kilometer|Kilometern)`;
  const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inMetern = [String(meter), meter.toLocaleString("de-DE"), ...(ZAHLWORT[meter] ?? [])];
  const zweige = [`(?:${inMetern.map(esc).join("|")})\\s*-?\\s*${METER}\\b`];
  if (meter % 1000 === 0) {
    const km = meter / 1000;
    const inKm = [String(km), ...(ZAHLWORT[km] ?? [])];
    zweige.push(`(?:${inKm.map(esc).join("|")})\\s*-?\\s*${KILOMETER}\\b`);
  }
  return new RegExp(`(?:^|[^0-9.,])(?:${zweige.join("|")})`, "i");
}

// [Radius, Text, erwartet]
const faelle = [
  // --- Die Falschtreffer aus dem Lauf vom 2026-10-11: muessen jetzt fallen ---
  [3000, "Im Außenbereich ist ein Vorhaben nach § 35 Abs. 3 Nr. 1 nur zulässig", false],
  [2000, "Die Erlaubnis nach den Absätzen 1 und 2 ist zu erteilen", false],
  [5000, "Die Erlaubnis nach Absatz 5 gilt entsprechend", false],
  [1000, "Festgelegt in Kapitel 1 Abschnitt 3", false],
  [3000, "Ziel IV.4-1: Waldbereiche sind zu sichern", false],

  // --- Echte Belege: muessen halten ---
  [5, "Der Gewässerrandstreifen ist im Außenbereich fünf Meter breit", true],
  [40, "Hochbauten jeder Art in einer Entfernung bis zu 40 Meter bei Bundesautobahnen", true],
  [20, "und bis zu 20 Meter bei Bundesstraßen außerhalb", true],
  [200, "Hochspannungsfreileitungen mit einer Gesamtlänge von bis zu 200 Metern", true],
  [3000, "Der Abstand beträgt 3.000 Meter", true],
  [3000, "Ein Schutzabstand von 3000 m ist einzuhalten", true],
  [3000, "Der Abstand beträgt 3 km", true],
  [3000, "Ein Abstand von 3 Kilometern", true],
  [1000, "Ein 1.000-m-Puffer um die Siedlung", true],
  [5000, "Der Umgebungsbereich reicht 5 km weit", true],

  // --- Abgrenzung: darf NICHT treffen ---
  [40, "bis zu 140 Meter gemessen vom äußeren Rand", false],
  [3000, "Der Abstand beträgt 3 Meter", false],   // km-Zahl mit Meter-Einheit
  [3, "Der Abstand beträgt 3 km", false],         // 3 m ist nicht 3 km
  [50, "Die Frist beträgt 50 Tage", false],
  [1000, "Es gilt eine Grenze von 1.000 Euro", false],
  [100, "hundertmal geprüft", false],             // Wortgrenze nach der Einheit
];

let fehler = 0;
console.log("Radius | erwartet | tatsächlich | Text");
console.log("-".repeat(96));
for (const [m, t, soll] of faelle) {
  const ist = muster(m).test(t);
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(
    `${String(m).padStart(6)} | ${(soll ? "JA" : "nein").padEnd(8)} | ` +
      `${(ist ? "JA" : "nein").padEnd(11)} | ${ok ? "  " : "<<"} ${t.slice(0, 58)}`,
  );
}
console.log("-".repeat(96));
console.log(fehler === 0 ? `Alle ${faelle.length} Fälle wie erwartet.` : `${fehler} FEHLSCHLAG/E`);
process.exit(fehler === 0 ? 0 : 1);
