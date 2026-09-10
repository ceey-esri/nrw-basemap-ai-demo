// PDF-Uebersicht der Befunde.
//
// Baut aus den gesammelten Befunden (ergebnis.js) und dem Vermerk-Text ein
// einfaches, druckbares PDF (jsPDF, rein clientseitig - kein Server).

import { jsPDF } from "jspdf";

import { getBefunde } from "./ergebnis.js";

const AMPEL_LABEL = {
  rot: "ROT  - Verfahren ausgeloest",
  gelb: "GELB - Naehe / vertiefte Pruefung",
  gruen: "GRUEN - keine Betroffenheit",
  ungeprueft: "OFFEN - nicht geprueft (Daten fehlen)",
};

/**
 * @param {{ vorhabenTyp?: string, vermerkText?: string, flaecheM2?: number }} meta
 */
export function erzeugePdf(meta = {}) {
  const befunde = getBefunde();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const R = 15; // Rand
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

  zeile("Genehmigungs-Screening - Befunduebersicht", { size: 16, style: "bold", gap: 8 });
  zeile(`Erstellt: ${new Date().toLocaleString("de-DE")}`, { size: 9, color: [90, 90, 90] });
  if (meta.vorhabenTyp) zeile(`Vorhabentyp: ${meta.vorhabenTyp}`, { size: 9, color: [90, 90, 90] });
  if (meta.flaecheM2)
    zeile(`Vorhabenflaeche: ${meta.flaecheM2.toLocaleString("de-DE")} m2`, {
      size: 9,
      color: [90, 90, 90],
    });
  y += 2;
  zeile(
    "Screening-/Scoping-Beschleuniger, kein Ersatz fuer ein Fachgutachten. " +
      "Rechtsgrundlagen mit Praefix PLATZHALTER sind noch nicht per RAG belegt.",
    { size: 8, style: "italic", color: [120, 120, 120], gap: 4 },
  );
  y += 4;

  if (befunde.length === 0) {
    zeile("Keine Befunde vorhanden.", { style: "italic" });
  }

  for (const b of befunde) {
    y += 2;
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = R;
    }
    doc.setDrawColor(210);
    doc.line(R, y, R + B, y);
    y += 5;
    zeile(b.bereich, { size: 12, style: "bold", gap: 5 });
    zeile(AMPEL_LABEL[b.ampel] ?? b.ampel, { size: 9, style: "bold", gap: 5 });
    zeile(b.aussage, { gap: 5 });
    if (b.verfahren) zeile(`Verfahren: ${b.verfahren}`, { size: 9, gap: 4 });
    if (b.behoerde) zeile(`Behoerde: ${b.behoerde}`, { size: 9, gap: 4 });
    if (b.rechtsgrundlage) zeile(`Grundlage: ${b.rechtsgrundlage}`, { size: 9, gap: 4 });
    if (b.pufferMeter != null)
      zeile(
        `Suchradius: ${b.pufferMeter} m${b.pufferBegruendung ? ` - ${b.pufferBegruendung}` : ""}`,
        { size: 9, gap: 4 },
      );
    if (b.hinweis) zeile(`Hinweis: ${b.hinweis}`, { size: 9, style: "italic", gap: 4 });
  }

  if (meta.vermerkText) {
    doc.addPage();
    y = R;
    zeile("Scoping-Vermerk (Entwurf)", { size: 14, style: "bold", gap: 8 });
    zeile(meta.vermerkText, { size: 9, gap: 4.2 });
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  doc.save(`Screening-Befunde_${stamp}.pdf`);
}
