// Zusätzliche Eingabewege für die Vorhabengeometrie: Shapefile und
// Koordinaten - alternativ zum Zeichnen in der Karte.
//
// Shapefiles kann der Browser nicht selbst lesen. Der Portal-Endpunkt
// `content/features/generate` wandelt ein hochgeladenes ZIP serverseitig in
// eine FeatureCollection um; das ist der von Esri vorgesehene Weg und nutzt
// das vorhandene OAuth-Token.

import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import JSZip from "jszip";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";

import { PORTAL_URL } from "./config.js";
import { getToken } from "./oauth.js";

const GENERATE = `${PORTAL_URL}/sharing/rest/content/features/generate`;

/** Rohe Esri-JSON-Geometrie -> Geometry-Objekt. */
function zuGeometrie(roh, sr) {
  if (!roh) return null;
  const props = { spatialReference: roh.spatialReference ?? sr };
  if (roh.rings) return new Polygon({ ...props, rings: roh.rings });
  if (roh.paths) return new Polyline({ ...props, paths: roh.paths });
  if (roh.x != null && roh.y != null) return new Point({ ...props, x: roh.x, y: roh.y });
  return null;
}

/**
 * Liest ein gezipptes Shapefile über das Portal ein.
 * @param {File} datei ZIP mit .shp/.shx/.dbf/.prj
 * @returns {Promise<{geometrie: __esri.Geometry, anzahl: number, name: string}>}
 */
/** Die Teile, aus denen ein Shapefile besteht. .prj ist für den Raumbezug nötig. */
const SHP_TEILE = [".shp", ".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx"];
const SHP_PFLICHT = [".shp", ".shx", ".dbf"];

const endung = (name) => {
  const m = String(name).toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
};

/**
 * Packt lose Shapefile-Teile im Browser zu einem ZIP.
 *
 * Der Portal-Endpunkt nimmt nur Archive - Shapefiles liegen aber meistens als
 * lose .shp/.shx/.dbf/.prj nebeneinander. Wer die erst von Hand zippen muss,
 * gibt vorher auf.
 */
async function packeShapefile(dateien) {
  const teile = dateien.filter((d) => SHP_TEILE.includes(endung(d.name)));
  const fehlt = SHP_PFLICHT.filter((e) => !teile.some((d) => endung(d.name) === e));
  if (fehlt.length) {
    // Ein Shapefile besteht aus mehreren Dateien. Wählt jemand nur die .shp,
    // kann der Browser die Nachbardateien NICHT nachladen - er sieht immer
    // nur, was ausgewählt wurde. Deshalb der Ordner.
    const nurShp = teile.length === 1 && endung(teile[0].name) === ".shp";
    throw new Error(
      nurShp
        ? `"${teile[0].name}" allein genügt nicht: ein Shapefile besteht aus mehreren ` +
            `Dateien (es fehlen ${fehlt.join(", ")}). Der Browser darf die Nachbardateien ` +
            "nicht von sich aus lesen - wähle deshalb den ganzen ORDNER aus, dann werden " +
            "sie automatisch mitgenommen."
        : `Im gewählten Ordner fehlen: ${fehlt.join(", ")}. Er muss .shp, .shx und .dbf ` +
            "enthalten, möglichst auch .prj - sonst muss das Portal den Raumbezug raten.",
    );
  }
  if (!teile.some((d) => endung(d.name) === ".prj")) {
    console.warn("[Import] Keine .prj dabei - das Portal muss den Raumbezug raten.");
  }
  const zip = new JSZip();
  for (const d of teile) zip.file(d.name, await d.arrayBuffer());
  const blob = await zip.generateAsync({ type: "blob" });
  const basis = teile.find((d) => endung(d.name) === ".shp").name.replace(/\.shp$/i, "");
  return new File([blob], `${basis}.zip`, { type: "application/zip" });
}

/**
 * Liest ein Shapefile über das Portal ein - als ZIP oder als lose Teile.
 * @param {File[]|File} eingabe
 * @returns {Promise<{geometrie: __esri.Geometry, anzahl: number, name: string}>}
 */
export async function shapefileLesen(eingabe) {
  const dateien = Array.isArray(eingabe) ? eingabe : [eingabe];
  if (!dateien.length) throw new Error("Keine Datei gewählt.");

  const zipDatei = dateien.find((d) => /\.zip$/i.test(d.name));
  const datei = zipDatei ?? (await packeShapefile(dateien));

  console.info("[Import] Shapefile", {
    gewaehlt: dateien.map((d) => d.name),
    hochgeladen: datei.name,
    groesse: datei.size,
  });

  const token = await getToken();
  if (!token) throw new Error("Nicht angemeldet - für den Shapefile-Import wird ein ArcGIS-Login gebraucht.");

  const name = datei.name.replace(/\.zip$/i, "");
  const form = new FormData();
  form.append("file", datei);
  form.append("filetype", "shapefile");
  form.append(
    "publishParameters",
    JSON.stringify({
      name,
      targetSR: { wkid: 4326 },
      maxRecordCount: 4000,
      enforceInputFileSizeLimit: true,
      enforceOutputJsonSizeLimit: true,
      generalize: false,
    }),
  );
  form.append("f", "json");
  form.append("token", token);

  const resp = await fetch(GENERATE, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`Portal-Antwort ${resp.status} (${resp.statusText})`);
  const data = await resp.json();
  if (data.error) {
    // Die Detailmeldungen des Portals sagen meist genau, was fehlt (etwa eine
    // fehlende .prj) - die gehoeren in die Fehlermeldung, nicht nur ins Log.
    console.error("[Import] Portal-Fehler", data.error);
    const details = (data.error.details ?? []).filter(Boolean).join(" ");
    throw new Error(
      [data.error.message ?? "Portal konnte die Datei nicht lesen.", details]
        .filter(Boolean)
        .join(" - "),
    );
  }

  const layer = data.featureCollection?.layers?.[0];
  const features = layer?.featureSet?.features ?? [];
  if (!features.length) throw new Error("Das Shapefile enthält keine Geometrien.");

  const sr = layer.featureSet.spatialReference ?? { wkid: 4326 };
  const geometrien = features.map((f) => zuGeometrie(f.geometry, sr)).filter(Boolean);
  if (!geometrien.length) throw new Error("Keine lesbare Geometrie im Shapefile.");

  // Mehrere Features zu einer Vorhabengeometrie zusammenfassen, soweit der
  // Typ das hergibt; sonst das erste nehmen.
  let geometrie = geometrien[0];
  if (geometrien.length > 1 && geometrien.every((g) => g.type === geometrien[0].type)) {
    try {
      geometrie = geometryEngine.union(geometrien) ?? geometrien[0];
    } catch {
      /* Union nicht möglich - erstes Feature genügt */
    }
  }
  return { geometrie, anzahl: geometrien.length, name };
}

/**
 * Eingabeformate für Koordinaten. `wkid` ist das Raumbezugssystem, `dms` sagt,
 * ob Grad/Minute/Sekunde geparst werden muss. ETRS89/UTM 32N ist der amtliche
 * Standard in NRW; Gauß-Krüger begegnet einem noch in älteren Beständen.
 */
export const KOORD_FORMATE = [
  {
    id: "wgs84",
    wkid: 4326,
    name: "WGS 84 dezimal",
    felder: "Breite, Länge",
    beispiel: "51.5145, 7.4653",
  },
  {
    id: "wgs84dms",
    wkid: 4326,
    dms: true,
    name: "WGS 84 Grad/Minute/Sekunde",
    felder: "Breite, Länge",
    beispiel: "51°30'52\"N, 7°27'55\"E",
  },
  {
    id: "utm32",
    wkid: 25832,
    name: "ETRS89 / UTM 32N (amtlich NRW)",
    felder: "Rechtswert, Hochwert",
    beispiel: "392000, 5708000",
  },
  {
    id: "utm33",
    wkid: 25833,
    name: "ETRS89 / UTM 33N",
    felder: "Rechtswert, Hochwert",
    beispiel: "292000, 5710000",
  },
  {
    id: "gk2",
    wkid: 31466,
    name: "Gauß-Krüger Zone 2 (DHDN)",
    felder: "Rechtswert, Hochwert",
    beispiel: "2578000, 5710000",
  },
  {
    id: "gk3",
    wkid: 31467,
    name: "Gauß-Krüger Zone 3 (DHDN)",
    felder: "Rechtswert, Hochwert",
    beispiel: "3392000, 5708000",
  },
  {
    id: "webmerc",
    wkid: 3857,
    name: "WGS 84 / Web Mercator",
    felder: "X, Y",
    beispiel: "830000, 6710000",
  },
];

export function getFormat(id) {
  return KOORD_FORMATE.find((f) => f.id === id) ?? KOORD_FORMATE[0];
}

/** "51°30'52.4\"N" -> 51.5145. Akzeptiert auch 51 30 52.4 N. */
function gradLesen(text) {
  const m = String(text).match(
    /(-?\d+(?:[.,]\d+)?)\s*[°d ]\s*(?:(\d+(?:[.,]\d+)?)\s*['m′]?\s*)?(?:(\d+(?:[.,]\d+)?)\s*["s″]?\s*)?([NSEWnsewOo])?/,
  );
  if (!m) return null;
  const z = (v) => (v == null ? 0 : parseFloat(String(v).replace(",", ".")));
  let wert = Math.abs(z(m[1])) + z(m[2]) / 60 + z(m[3]) / 3600;
  const hs = (m[4] ?? "").toUpperCase();
  if (z(m[1]) < 0 || hs === "S" || hs === "W") wert = -wert;
  return { wert, halbkugel: hs };
}

/**
 * Parst eine Koordinateneingabe im gewählten Format.
 *
 * Bei WGS 84 wird die Reihenfolge über den Wertebereich bzw. die Himmels-
 * richtung erkannt ("51.5, 7.4" wie "7.4 51.5"). Bei projizierten Systemen
 * geht das nicht - dort gilt die Eingabereihenfolge Rechtswert, Hochwert.
 *
 * @returns {{x:number, y:number, wkid:number}|null}
 */
export function koordinatenLesen(text, formatId) {
  const fmt = getFormat(formatId);
  const roh = String(text ?? "").trim();
  if (!roh) return null;

  if (fmt.dms) {
    const teile = roh.split(/[,;]|(?<=[NSEWnsewOo])\s+/).filter((x) => x.trim());
    if (teile.length < 2) return null;
    const a = gradLesen(teile[0]);
    const b = gradLesen(teile[1]);
    if (!a || !b) return null;
    // Himmelsrichtung schlägt die Reihenfolge; sonst ist der größere Wert die Breite.
    const aIstBreite = "NS".includes(a.halbkugel)
      ? true
      : "NS".includes(b.halbkugel)
        ? false
        : Math.abs(a.wert) > Math.abs(b.wert);
    const breite = aIstBreite ? a.wert : b.wert;
    const laenge = aIstBreite ? b.wert : a.wert;
    if (Math.abs(breite) > 90 || Math.abs(laenge) > 180) return null;
    return { x: laenge, y: breite, wkid: 4326 };
  }

  const zahlen = roh.replace(/,(?=\s*\d)/g, " ").match(/-?\d+[.,]?\d*/g);
  if (!zahlen || zahlen.length < 2) return null;
  const [a, b] = zahlen.slice(0, 2).map((z) => parseFloat(z.replace(",", ".")));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (fmt.wkid === 4326) {
    // In NRW liegt die Breite bei ~50-53, die Länge bei ~5-10.
    const breite = Math.abs(a) > Math.abs(b) ? a : b;
    const laenge = Math.abs(a) > Math.abs(b) ? b : a;
    if (Math.abs(breite) > 90 || Math.abs(laenge) > 180) return null;
    return { x: laenge, y: breite, wkid: 4326 };
  }
  return { x: a, y: b, wkid: fmt.wkid };
}
