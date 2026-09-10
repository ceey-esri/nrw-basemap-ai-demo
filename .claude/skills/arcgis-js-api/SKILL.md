---
name: arcgis-js-api
description: Use whenever touching the ArcGIS Maps SDK for JavaScript in this repo - anything importing @arcgis/core, @arcgis/map-components, @arcgis/ai-components, @esri/calcite-components, or working with <arcgis-*> web components, Sketch/OAuth/FeatureLayer/geometryEngine, the AI assistant / custom agents, or the RAG tool wiring. Enforces: verify names against the installed .d.ts files, never guess component/method names, never add a CDN tag.
---

# ArcGIS Maps SDK for JavaScript — working rules for this repo

SDK version installed: **5.1.20** (`@arcgis/core`, `@arcgis/map-components`,
`@arcgis/ai-components`), `@esri/calcite-components` **5.1.2**. Docs:
<https://developers.arcgis.com/javascript/latest/> (JS-rendered — `WebFetch`
usually returns a blank page; use the local type defs instead).

## Rule 1 — the installed `.d.ts` files are the source of truth

Before using ANY component, class, method, property, event, or enum value:
**grep the local type definitions.** Do not rely on memory or the guess.

| what | where |
|---|---|
| Web component exists? | `node_modules/@arcgis/map-components/dist/components/` and `.../@arcgis/ai-components/dist/components/` (one dir per `arcgis-*` tag) |
| Component props/methods/events | `node_modules/@arcgis/<pkg>/dist/components/<tag>/customElement.d.ts` |
| Core class API (FeatureLayer, geometryEngine, Sketch widget, IdentityManager…) | `node_modules/@arcgis/core/**/*.d.ts` |
| Widget event payload types | `node_modules/@arcgis/core/widgets/<Widget>/types.d.ts` |
| Calcite components | `node_modules/@esri/calcite-components/dist/components/` |

Useful greps:
```
grep -rlE 'arcgis-<name>' node_modules/@arcgis/*/dist/components/   # tag exists?
grep -oE 'accessor [a-zA-Z]+'  .../customElement.d.ts               # properties
grep -oE 'arcgis[A-Z][a-zA-Z]+' .../customElement.d.ts              # events
sed -n '/interface CreateEvent/,/^}/p' node_modules/@arcgis/core/widgets/Sketch/types.d.ts
```

If a name isn't in the type defs, it doesn't exist in 5.1 — find the real one.

## Rule 2 — npm imports only, never a CDN `<script>`

Custom agents (`@arcgis/ai-components/agent-utils`) only build via the npm path.
A `<script src="https://js.arcgis.com/...">` tag would double-load the SDK.

## Rule 3 — component lifecycle

- `<arcgis-*>` components are Lumina/Lit elements. Their `load()` runs in a
  `queueMicrotask` after `connectedCallback` (both parent and children).
- `<arcgis-map>`: `await el.viewOnReady()` before touching `el.map` / `el.view`.
- Widgets (`arcgis-search`, `arcgis-layer-list`, `arcgis-sketch`, `arcgis-expand`,
  …) are placed **inside `<arcgis-map>` via `slot="top-left|top-right|…"`**, not
  by a `position` prop.
- Wrap a widget in `<arcgis-expand>` (with `slot`) to make it a collapsible
  corner button; `expanded` defaults `false`.

## Repo-specific gotchas already hit

### Map click + hitTest (identify a clicked graphic)
```js
mapEl.addEventListener("arcgisViewClick", async (e) => {
  const res = await mapEl.hitTest(e.detail, { include: [someLayer] });
  const g = res.results?.[0]?.graphic;   // e.detail has .x .y .mapPoint
});
```

### arcgis-measurement
Props: `activeTool` (`"distance"|"area"|"direct-line"|…`), `linearUnit`
(`"meters"` etc.), `areaUnit` (`"square-meters"`), `view`. Methods
`startMeasurement()`, `clear()`. Slot it into `<arcgis-map>` (wrap in
`<arcgis-expand>` for a corner button).

### arcgis-sketch
- Component props actually exist: `creationMode` (`"single"|"continuous"|
  "update"`), `availableCreateTools` (`"point"|"polygon"|"polyline"|"rectangle"|
  "circle"|"freehandPolygon"|"freehandPolyline"`), `showCreateToolsFreehandPolygon`,
  `hideSelectionToolsLassoSelection`, `hideSelectionToolsRectangleSelection`,
  `hideDuplicateButton`, `hideDeleteButton`, `layer`, `defaultGraphicsLayerDisabled`,
  `view`. Methods: `create()`, `complete()`, `cancel()`, `delete()`, `undo()`, `redo()`.
- Events: `arcgisCreate` / `arcgisUpdate` / `arcgisDelete` / `arcgisDuplicate` /
  `arcgisReady` / `arcgisRedo` / `arcgisUndo`. **`event.detail` is the raw widget
  event** (`@arcgis/core/widgets/Sketch/types.d.ts` → `CreateEvent`):
  `{ graphic?, graphics?, state, tool, toolEventInfo }`.
  `state` ∈ `"start" | "active" | "complete" | "cancel"` (create) /
  `"start" | "active" | "complete"` (update).
- The completed graphic is added to `sketch.layer` automatically; read geometry
  from `event.detail.graphic.geometry` (create) or `event.detail.graphics[0]`
  (update).
- **Repro'd bug (SDK 5.1): geometry sync worked for points, silently not for
  polygons** when relying on events / `graphics.on("change")`. Fix that stuck:
  `sketch.defaultGraphicsLayerDisabled = true` + set `sketch.layer` after
  `viewOnReady()` + `reactiveUtils.watch(() => skizzenLayer.graphics.length, …)`
  + a low-freq `setInterval` poll as a net. Don't trust a single mechanism.

### OAuth (`@arcgis/core/identity/IdentityManager`)
- Not persisted across reloads by default. Serialize `esriId.toJSON()` to
  `localStorage` on `esriId.on("credential-create", …)` and restore with
  `esriId.initialize(JSON.parse(...))` before `checkSignInStatus()`.
- Login only on a real click (popup blocker).

### `<arcgis-assistant>` + custom agents (`@arcgis/ai-components`)
- No agents built in — register at least one `<arcgis-assistant-agent>`.
- **Race**: the assistant runs its orchestrator init (checks registered agents)
  in a microtask on connect; `register()` only re-inits if an orchestrator
  already exists. So `<arcgis-assistant-agent>` children must be appended (with
  `.agent` set) **before the `<arcgis-assistant>` enters the DOM**, else
  permanent "No agents found."
- `agent-utils`: `createLLMAgent`, `createFunctionTool`, `createSchema`
  (also `createWorkflowAgent` + `createSequentialWorkflow`/Parallel/Router/… —
  **but in this repo the WorkflowAgent path ran without executing tools
  ("fertig" with no results); the coordinator is a single `LLMAgent`**).
  `agent.registration` → assign to `<arcgis-assistant-agent>.agent`.
- Long agent runs hit LangGraph's recursion limit (~25). It lives in
  `AgentExecutionConfig` (`.run(state, config)`), not the constructor — bump it
  by mutating `req.config.recursionLimit` in an agent middleware `handler`.
- `createSchema` field shapes: `string` (+ optional `enum`), `number`, `boolean`,
  `array` (`itemType: "string"` or a nested object `{type:"object", fields:{…}}`),
  `object` (`fields:{…}`).
- Agent middleware hooks: `beforeAgent`/`afterAgent` (`{agent, state, nodeName}`),
  `beforeModel`/`afterModel` (`(state, runtime)` — langchain shape, no agent ref).
  FunctionTool middleware: `{ name, handler: (req, next) => … }`, `req.tool.name`,
  `req.input`.
- `modelTier`: `"fast" | "default" | "advanced"` (hosted Esri models, costs credits).
- Assistant methods/props used: `submitMessage(text)`, `heading`, `entryMessage`,
  `suggestedPrompts`, `keepSuggestedPrompts`, `referenceElement`; events
  `arcgisResponse`, `arcgisError`, `arcgisReady`.

### geometry-Operatoren (`@arcgis/core/geometry/operators/`)
- Die `geometryEngine`-Funktionen `geodesicArea`, `geodesicLength` und
  `geodesicBuffer` sind **seit 4.32 abgekündigt** und arbeiten laut d.ts *"only
  with WGS84 (wkid: 4326) and Web Mercator"*. Für Daten in ETRS89/UTM32
  (NRW-Standard) liefern sie stillschweigend falsche Zahlen. Ersatz:
  `geodeticAreaOperator`, `geodeticLengthOperator`, `geodesicBufferOperator`.
- **`isLoaded()`/`load()` hat NICHT jeder Operator.** Einzeln greppen, nicht von
  einem auf den anderen schliessen — genau so ist
  `intersectionOperator.isLoaded is not a function` in den Browser gelangt:
  ```
  intersectionOperator      accelerateGeometry execute executeMany
  geodeticAreaOperator      isLoaded load execute
  geodeticLengthOperator    isLoaded load execute
  geodesicBufferOperator    isLoaded load execute executeMany
  ```
  Prüfbefehl:
  `grep -oE 'export function [a-zA-Z]+' node_modules/@arcgis/core/geometry/operators/<op>.d.ts`
- Verschnitt und Messung setzen dasselbe Bezugssystem voraus: bei einer
  FeatureLayer-Abfrage `query.outSpatialReference` setzen, sonst kommen die
  Features in der Projektion des Layers zurück.

### geometry / query
- Use the **sync** `@arcgis/core/geometry/geometryEngine` (`geodesicBuffer`,
  `geodesicArea`) — `*Async` had a web-worker problem here.
- Project points with `@arcgis/core/geometry/operators/projectOperator`
  (`await load()` / `isLoaded()` then `execute(geom, sr)`).
- `FeatureLayer` query + `applyEdits` use the IdentityManager token automatically;
  no separate REST client needed.
- CSS: import `@arcgis/core/assets/esri/themes/light/main.css`,
  `@esri/calcite-components/main.css`, `@arcgis/ai-components/main.css`.
  Only Google Fonts is allowed as an external host in artifacts — n/a here (Vite app).

## Checklist before writing ArcGIS code

1. grep the component dir — does the `arcgis-*` tag exist in 5.1?
2. grep `customElement.d.ts` — exact prop / event / method names & value enums.
3. For events, open the widget's `types.d.ts` — real `event.detail` shape.
4. Slot widgets into `<arcgis-map>`; `await viewOnReady()` before `.map`/`.view`.
5. Build after — `npx vite build` must stay green.
