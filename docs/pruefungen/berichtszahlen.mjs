// unbelegteZahlen() aus tools.js isoliert.
function unbelegteZahlen(text, fakten) {
  const ziehen = (s) =>
    (String(s).match(/\d[\d.,]*/g) ?? []).map((z) => z.replace(/[.,]/g, ""));
  const belegt = new Set(ziehen(fakten));
  return [...new Set(ziehen(text).filter((z) => z && !belegt.has(z)))];
}

const fakten = [
  "Siedlung (3000 m): 277 Siedlungsflächen, 116,8 ha",
  "Verkehr (2000 m): 42 Verkehrswege, 1,73 km",
  "Wald (3000 m): 0 Objekte",
  "Planungsregion Münsterland, Regionalplan Münsterland 2025",
].join(" ");

const faelle = [
  ["Im 3000-m-Umfeld liegen 277 Siedlungsflächen mit 116,8 ha.", []],
  // Tausendertrennung anders geschrieben als in den Fakten:
  ["Im 3.000-m-Umfeld liegen 277 Siedlungsflächen.", []],
  // Dezimalpunkt statt Komma:
  ["Es wurden 1.73 km Verkehrswege gemessen.", []],
  // Gerundet - muss auffallen:
  ["Rund 280 Siedlungsflächen liegen im Umfeld.", ["280"]],
  // Addiert - muss auffallen:
  ["Insgesamt 319 Objekte wurden erfasst.", ["319"]],
  // Umgerechnet - muss auffallen:
  ["Die Fläche beträgt 1168000 m².", ["1168000"]],
  // Jahr aus den Fakten ist belegt:
  ["Es gilt der Regionalplan Münsterland 2025.", []],
  // Erfundenes Jahr:
  ["Es gilt der Regionalplan Münsterland 2024.", ["2024"]],
  // Keine Zahlen im Text:
  ["Im Untersuchungsraum liegen Siedlungsflächen und Verkehrswege.", []],
  // Mehrere erfundene auf einmal:
  ["Etwa 300 Flächen auf 120 ha.", ["300", "120"]],
  // BEKANNTE LUECKE: verrutschtes Dezimaltrennzeichen, gleiche Ziffernfolge.
  ["Es wurden 173 km Verkehrswege gemessen.", []],
];

let fehler = 0;
console.log("erwartet          | tatsächlich       | Text");
console.log("-".repeat(96));
for (const [text, soll] of faelle) {
  const ist = unbelegteZahlen(text, fakten);
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  const z = (a) => (a.length ? a.join(",") : "—");
  console.log(
    `${z(soll).padEnd(17)} | ${z(ist).padEnd(17)} | ${ok ? "  " : "<<"} ${text.slice(0, 54)}`,
  );
}
console.log("-".repeat(96));
console.log(fehler === 0 ? `Alle ${faelle.length} Fälle wie erwartet.` : `${fehler} FEHLSCHLAG/E`);
process.exit(fehler === 0 ? 0 : 1);
