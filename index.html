<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>NRW Basemap – Konfliktprüfung</title>
  <script type="module" src="https://js.arcgis.com/5.1/"></script>
  <link rel="stylesheet" href="style.css" />
</head>
<body>

  <div id="app">
    <aside id="side-panel">
      <div id="vorhaben-panel">
        <label for="vorhaben-typ">Was möchten Sie prüfen?</label>
        <select id="vorhaben-typ">
          <option value="versorgungsanlage">Neue Versorgungsanlage (Pumpe)</option>
          <option value="verkehrsflaeche">Neue Verkehrsfläche</option>
          <option value="siedlungsflaeche">Neue Siedlungsfläche</option>
        </select>
      </div>

      <div id="criteria-panel">
        <p class="panel-label">Zu prüfende Aspekte</p>
        <label><input type="checkbox" data-layer="Naturdenkmäler" /> Naturdenkmäler</label>
        <label><input type="checkbox" data-layer="Punktförmige historische Bauwerke und Einrichtungen" /> Historische Bauwerke</label>
        <label><input type="checkbox" data-layer="Gewässerflächen" /> Gewässer</label>
        <label><input type="checkbox" data-layer="Flächenhafte Verwaltungsgebiete" /> Schutzgebiete/Verwaltung</label>
        <label><input type="checkbox" data-layer="Versorgungsleitungen und Transportanlagen" /> Versorgungsleitungen</label>
        <label><input type="checkbox" data-layer="Verkehrsflächen" /> Verkehrsflächen</label>

        <button id="run-check-btn">Prüfung starten</button>
        <p class="hint">Erst Punkt auf der Karte setzen, dann prüfen.</p>
      </div>

      <div id="results-panel">
        <p class="panel-label">Einschätzung</p>
        <div id="results-list">
          <p class="hint">Noch keine Prüfung durchgeführt.</p>
        </div>
      </div>
    </aside>

    <div id="map-container"></div>
  </div>

  <script type="module">
    const [esriConfig, OAuthInfo, esriId] = await $arcgis.import([
      "esri/config",
      "esri/identity/OAuthInfo",
      "esri/identity/IdentityManager",
    ]);

    esriConfig.portalUrl = "https://sandbox-esridech.maps.arcgis.com";

    const oauthInfo = new OAuthInfo({
      appId: "lfWzQkKp1EH37Zfw",
      portalUrl: esriConfig.portalUrl,
      popup: true,
    });
    esriId.registerOAuthInfos([oauthInfo]);

    const mapEl = document.createElement("arcgis-map");
    mapEl.setAttribute("item-id", "e9cb820a2b1046d18f6cc9c37dce3768");
    mapEl.setAttribute("zoom", "10");
    document.getElementById("map-container").appendChild(mapEl);

    // für app.js zugänglich machen, da beide Skripte type="module" sind (eigener Scope)
    window.__mapEl = mapEl;
  </script>

  <script type="module" src="app.js"></script>
</body>
</html>