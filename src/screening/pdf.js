// PDF des räumlichen Erstscreenings.
//
// Kennzahlen + Übersicht je Kategorie + Zusammenfassung, aus dem
// Analyse-Store (analyse.js). Rein clientseitig via jsPDF.

import { jsPDF } from "jspdf";

import { getAnalyse } from "./analyse.js";
import { alleFundstellen } from "./rag.js";
import { kategorieTitel } from "./kategorien.js";

const nf = new Intl.NumberFormat("de-DE");

function flaeche(m2) {
  if (m2 == null) return "-";
  return m2 >= 10000 ? `${nf.format(Math.round((m2 / 10000) * 10) / 10)} ha` : `${nf.format(m2)} m2`;
}

/** @param {{ vorhabenTyp?: string }} meta */
export function erzeugePdf(meta = {}) {
  const a = getAnalyse();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const R = 15;
  const B = doc.internal.pageSize.getWidth() - 2 * R;
  let y = R;

  const zeile = (text, opt = {}) => {
    const { size = 10, style = "normal", gap = 5, color = [0, 0, 0] } = opt;
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const t of doc.splitTextToSize(String(text), B)) {
      if (y > doc.internal.pageSize.getHeight() - R) {
        doc.addPage();
        y = R;
      }
      doc.text(t, R, y);
      y += gap;
    }
  };
  const grau = { size: 9, color: [90, 90, 90], gap: 4.5 };

  zeile("Räumliches Erstscreening", { size: 16, style: "bold", gap: 8 });
  zeile(`Erstellt: ${new Date().toLocaleString("de-DE")}`, grau);
  if (a.vorhabenArt || meta.vorhabenTyp)
    zeile(`Vorhabenart: ${a.vorhabenArt || meta.vorhabenTyp}`, grau);
  y += 3;

  // --- Kennzahlen ---
  zeile("Kennzahlen", { size: 12, style: "bold", gap: 6 });
  if (a.region?.name) {
    zeile(`Planungsregion: ${a.region.name}`, grau);
    if (a.region.gemeinde) zeile(`Gemeinde / Kreis: ${a.region.gemeinde}`, grau);
    zeile(`Geltender Regionalplan: ${a.region.plan} (${a.region.stand})`, grau);
  }
  if (a.vorhabenMasze.flaecheM2 != null)
    zeile(`Vorhabenflaeche: ${flaeche(a.vorhabenMasze.flaecheM2)}`, grau);
  if (a.vorhabenMasze.laengeM != null)
    zeile(`Trassenlänge: ${nf.format(a.vorhabenMasze.laengeM)} m`, grau);
  const objekte = a.abfragen.reduce((s, x) => s + x.anzahl, 0);
  zeile(`Relevante Kategorien: ${a.relevanz.length}`, grau);
  zeile(`Objekte im Untersuchungsraum: ${nf.format(objekte)}`, grau);
  y += 3;

  // --- Kernaussagen ---
  if (a.kernaussagen?.length) {
    zeile("Kernaussagen", { size: 12, style: "bold", gap: 6 });
    for (const k of a.kernaussagen) zeile(`- ${k}`, { size: 10, gap: 4.8 });
    y += 3;
  }

  // --- Relevante Kategorien ---
  zeile("Relevante Kategorien", { size: 12, style: "bold", gap: 6 });
  const alleIds = a.relevanz.map((r) => r.kategorieId);
  for (const x of a.abfragen) if (!alleIds.includes(x.kategorieId)) alleIds.push(x.kategorieId);
  const objekteVon = (id) =>
    a.abfragen.filter((x) => x.kategorieId === id).reduce((s2, x) => s2 + x.anzahl, 0);
  const abgefragt = a.abfragen.length > 0;
  const ids = abgefragt ? alleIds.filter((id) => objekteVon(id) > 0) : alleIds;
  const ohne = abgefragt ? alleIds.filter((id) => objekteVon(id) === 0) : [];
  if (ids.length === 0) zeile("Keine Kategorien mit Objekten im Umfeld.", { style: "italic" });

  for (const id of ids) {
    const liste = a.abfragen.filter((x) => x.kategorieId === id);
    const r = a.relevanz.find((x) => x.kategorieId === id);
    y += 2;
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = R;
    }
    doc.setDrawColor(210);
    doc.line(R, y, R + B, y);
    y += 5;
    const summe = liste.reduce((s, x) => s + x.anzahl, 0);
    const summeFlaeche = liste.reduce((s, x) => s + (x.flaecheM2 ?? 0), 0);
    const summeLaenge = liste.reduce((s, x) => s + (x.laengeM ?? 0), 0);
    const kopf = kategorieTitel(id);
    const leit = summeLaenge > 0
      ? `${nf.format(Math.round(summeLaenge))} m`
      : summeFlaeche > 0
        ? flaeche(summeFlaeche)
        : `${nf.format(summe)} Objekte`;
    zeile(liste.length ? `${kopf} - ${leit} (${nf.format(summe)} Objekte)` : kopf, {
      size: 11,
      style: "bold",
      gap: 5,
    });
    if (r?.begruendung) zeile(r.begruendung, { size: 9.5, gap: 4.5 });
    if (r?.radiusMeter != null)
      zeile(
        `Untersuchungszone: ${r.radiusMeter > 0 ? `${nf.format(r.radiusMeter)} m` : "nur Vorhabenflaeche"}` +
          (r.zoneFlaecheM2 ? ` (${flaeche(r.zoneFlaecheM2)})` : ""),
        { size: 9.5, style: "bold", gap: 4.4 },
      );
    if (r?.radiusBegruendung) zeile(r.radiusBegruendung, { size: 9, gap: 4.2 });
    if (r?.regionalplan)
      zeile(`Regionalplan: ${r.regionalplan}`, { size: 9, style: "italic", color: [90, 90, 90], gap: 4.2 });
    if (r?.gesetz)
      zeile(`Fachrecht: ${r.gesetz}`, { size: 9, style: "italic", color: [90, 90, 90], gap: 4.2 });
    // Aufschlüsselung JE LAYER nach dem fachlich tragenden Attribut. Bewusst
    // nicht über die Layer eines Themas hinweg summiert: Hecken zählen in
    // Kilometern, Schutzgebiete in Quadratmetern - eine gemeinsame Liste wäre
    // eine Falschaussage.
    const rang = (g) => g.laenge || g.flaeche || g.anzahl;
    for (const x of liste) {
      const zusatz = [
        x.flaecheM2 ? flaeche(x.flaecheM2) : null,
        x.laengeM ? `${nf.format(x.laengeM)} m` : null,
      ]
        .filter(Boolean)
        .join(", ");
      zeile(`  - ${x.layer}: ${nf.format(x.anzahl)}${zusatz ? ` (${zusatz})` : ""}`, {
        size: 9,
        gap: 4.2,
      });
      const gruppen = (x.aufschluesselung ?? [])
        .map((g) => ({
          wert: g.wert,
          anzahl: g.anzahl ?? 0,
          flaeche: g.flaecheM2 ?? 0,
          laenge: g.laengeM ?? 0,
        }))
        .sort((g1, g2) => rang(g2) - rang(g1));
      for (const g of gruppen) {
        const mass =
          g.laenge > 0
            ? `${nf.format(Math.round(g.laenge))} m`
            : g.flaeche > 0
              ? flaeche(g.flaeche)
              : `${nf.format(g.anzahl)}x`;
        zeile(`      ${g.wert}: ${mass} (${nf.format(g.anzahl)})`, { size: 9, gap: 4.2 });
      }
    }
  }

  // Geprüft und verworfen - gehört in den Bericht, sonst sieht es aus, als
  // wäre der Belang übersehen worden.
  if (a.nichtRelevant?.length) {
    y += 4;
    zeile("Geprüft, nicht einschlägig", { size: 12, style: "bold", gap: 6 });
    for (const n of a.nichtRelevant) {
      zeile(`${kategorieTitel(n.kategorieId)}: ${n.begruendung}`, { size: 9.5, gap: 4.4 });
      if (n.fundstelle)
        zeile(`  ${n.fundstelle}`, { size: 9, style: "italic", color: [110, 110, 110], gap: 4.2 });
    }
  }

  if (ohne.length) {
    y += 3;
    zeile(
      "Geprüft, keine Objekte im Umfeld: " + ohne.map((id) => kategorieTitel(id)).join(", "),
      { size: 9, style: "italic", color: [110, 110, 110], gap: 4.2 },
    );
  }

  // --- Fundstellen ---
  const rp = alleFundstellen("regionalplan:");
  const ges = alleFundstellen("gesetz:");
  if (rp.length || ges.length) {
    doc.addPage();
    y = R;
    zeile("Herangezogene Fundstellen", { size: 14, style: "bold", gap: 8 });
    for (const [titel, liste] of [
      ["Regionalplan", rp],
      ["Gesetzeskorpus", ges],
    ]) {
      if (!liste.length) continue;
      zeile(titel, { size: 11, style: "bold", gap: 6 });
      for (const f of liste) {
        zeile(`${f.zitat}${f.ueberschrift ? ` - ${f.ueberschrift}` : ""}`, {
          size: 9.5,
          style: "bold",
          gap: 4.4,
        });
        if (f.stand) zeile(`Stand: ${f.stand}`, { size: 8, color: [120, 120, 120], gap: 4 });
        zeile(String(f.text ?? "").slice(0, 900), { size: 8.5, color: [70, 70, 70], gap: 3.8 });
        y += 2;
      }
    }
  }

  y += 4;
  zeile(
    "Räumliches Erstscreening auf Basis der vorliegenden Geodaten. Keine Aussage zur " +
      "Raumverträglichkeit oder Zulässigkeit; Ziele der Raumordnung sind im Wortlaut " +
      "wiedergegeben, ihre Beachtung prüft die zuständige Behörde.",
    { size: 8, style: "italic", color: [120, 120, 120], gap: 3.8 },
  );

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  doc.save(`Erstscreening_${stamp}.pdf`);
}
