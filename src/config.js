// Zentrale Konfiguration.
// Die ArcGIS-OAuth-Werte stammen aus dem bereits funktionierenden Login-Stand
// des Projekts und wurden unverändert übernommen.

export const PORTAL_URL = "https://sandbox-esridech.maps.arcgis.com";
export const WEBMAP_ID = "c518ef79582a4bb9b1122fa3534627b0";
export const APP_ID = "MbL2herey4w8kIE4";

// Modell-Stufe für den LLMAgent (siehe @arcgis/ai-components).
// "fast" | "default" | "advanced" - verbraucht ArcGIS-Credits.
//
// Seit 2026-09-08 auf "fast", weil der Esri-Dienst unter Last mit HTTP 429
// abgewiesen hat ("exceeds the maximum usage size allowed during peak load").
// Die kleinere Stufe liegt in einem anderen Kontingent. Kommt der 429 auch
// hier, liegt es NICHT am Modell, sondern am geteilten Durchsatz der
// Organisation - dann hilft nur Provisioned Throughput auf Portalseite.
// Zum Zurückstellen: "default".
export const MODEL_TIER = "fast";

// RAG-Backend (siehe rag/): zwei Collections - Gesetzeskorpus und
// Regionalplan-Festlegungen. Läuft es nicht, melden die Tools das als Fehler.
export const RAG_URL = "http://127.0.0.1:8000";
