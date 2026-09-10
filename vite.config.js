import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const HIER = dirname(fileURLToPath(import.meta.url));
const RAG_PORT = 8000;

/**
 * Startet den RAG-Server (rag/server.py) zusammen mit `npm run dev` und stoppt
 * ihn beim Beenden. Laeuft schon einer auf Port 8000, wird nichts gestartet.
 * Braucht das venv unter rag/.venv (siehe rag/README.md); fehlt es, gibt es
 * nur eine Warnung - die App laeuft dann mit dem Platzhalter-Fallback.
 */
function ragServerPlugin() {
  let child = null;

  return {
    name: "rag-server",
    apply: "serve",
    async configureServer(server) {
      const schonDa = await fetch(`http://127.0.0.1:${RAG_PORT}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (schonDa) {
        server.config.logger.info("[rag] laeuft bereits auf :" + RAG_PORT);
        return;
      }

      const dir = resolve(HIER, "rag");
      const py = [
        resolve(dir, ".venv/Scripts/python.exe"), // Windows
        resolve(dir, ".venv/bin/python"), // macOS/Linux
      ].find(existsSync);

      if (!py) {
        server.config.logger.warn(
          "[rag] kein venv unter rag/.venv - RAG uebersprungen (Platzhalter-Fallback aktiv). Setup: rag/README.md",
        );
        return;
      }

      child = spawn(py, ["-m", "uvicorn", "server:app", "--port", String(RAG_PORT)], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const log = (buf) =>
        String(buf)
          .split("\n")
          .filter(Boolean)
          .forEach((l) => server.config.logger.info("[rag] " + l));
      child.stdout.on("data", log);
      child.stderr.on("data", log);
      child.on("exit", (code) => {
        if (code) server.config.logger.warn(`[rag] Server beendet (Code ${code})`);
        child = null;
      });

      const stop = () => {
        if (child) {
          child.kill();
          child = null;
        }
      };
      server.httpServer?.once("close", stop);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      process.once("exit", stop);
    },
  };
}

// Fester Port, damit die Redirect-URI der ArcGIS-App stabil bleibt
// (http://localhost:5173 in der ArcGIS-App unter "Redirect URIs").
export default defineConfig({
  plugins: [ragServerPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
