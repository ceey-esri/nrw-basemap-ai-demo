// ArcGIS OAuth - der einzige Teil des Projekts, der aus dem Vorgängerstand
// unverändert übernommen wurde, weil er bereits zuverlässig funktioniert.
//
// Wichtig geblieben:
//  - Beim Laden wird nur der Status geprüft (kein Popup, kein Auto-Login).
//  - Der echte Login läuft ausschliesslich über einen echten Klick,
//    sonst blockt der Popup-Blocker.

import esriConfig from "@arcgis/core/config";
import OAuthInfo from "@arcgis/core/identity/OAuthInfo";
import esriId from "@arcgis/core/identity/IdentityManager";

import { PORTAL_URL, APP_ID } from "./config.js";

esriConfig.portalUrl = PORTAL_URL;
esriConfig.applicationName = "Genehmigungs-Screening";

const oauthInfo = new OAuthInfo({
  appId: APP_ID,
  portalUrl: PORTAL_URL,
  popup: true,
  flowType: "auto",
});
esriId.registerOAuthInfos([oauthInfo]);

const SHARING_URL = `${PORTAL_URL}/sharing`;
const STORAGE_KEY = "gp-screening-arcgis-auth";

// Login über Reloads hinweg behalten: IdentityManager-Zustand in localStorage
// serialisieren und beim Laden wiederherstellen.
try {
  const gespeichert = localStorage.getItem(STORAGE_KEY);
  if (gespeichert) esriId.initialize(JSON.parse(gespeichert));
} catch {
  /* korrupt / kein Storage - ignorieren */
}
function authSpeichern() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(esriId.toJSON()));
  } catch {
    /* ignorieren */
  }
}
function authVergessen() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignorieren */
  }
}
esriId.on("credential-create", authSpeichern);

/**
 * Verdrahtet den Login-Button und liefert ein Promise, das auflöst, sobald
 * der initiale Anmeldestatus bekannt ist (angemeldet oder nicht).
 *
 * @param {HTMLButtonElement} loginBtn
 * @param {HTMLElement} loginStatus
 * @param {(username: string | null) => void} [onChange]
 * @returns {Promise<string | null>} userId oder null
 */
export async function initAuth(loginBtn, loginStatus, onChange) {
  function setUI(username) {
    // Sichtbarer Text kommt aus app.js (i18n). Hier nur den Status merken.
    loginBtn.dataset.signedIn = username ? "1" : "";
    if (!loginBtn.textContent.trim()) {
      loginBtn.textContent = username ? "Abmelden" : "Anmelden";
    }
    if (!loginStatus.textContent.trim()) {
      loginStatus.textContent = username ? `Angemeldet als ${username}` : "Nicht angemeldet";
    }
    onChange?.(username ?? null);
  }

  loginBtn.addEventListener("click", async () => {
    const bereitsAngemeldet = loginBtn.dataset.signedIn === "1";

    if (bereitsAngemeldet) {
      esriId.destroyCredentials();
      authVergessen();
      setUI(null);
      return;
    }

    try {
      const credential = await esriId.getCredential(SHARING_URL);
      authSpeichern();
      setUI(credential.userId);
    } catch (err) {
      console.error("Login fehlgeschlagen:", err);
      setUI(null);
    }
  });

  try {
    const credential = await esriId.checkSignInStatus(SHARING_URL);
    setUI(credential.userId);
    return credential.userId;
  } catch {
    authVergessen();
    setUI(null);
    return null;
  }
}

/** Aktuelles ArcGIS-Token (für serverlose Feature-Service-Abfragen). */
export async function getToken() {
  try {
    const credential = await esriId.getCredential(SHARING_URL, {
      prompt: false,
    });
    return credential.token ?? null;
  } catch {
    return null;
  }
}
