// Schlanke Absicherung gegen genau die Fehlerklasse, die der Vite-Build
// durchlässt: `no-undef` hätte "MAX_TREFFER is not defined" gefunden, bevor
// der Fehler im Browser landete. Kein Stilregelwerk - nur Korrektheit.

import globals from "globals";

export default [
  {
    files: ["**/*.js"],
    ignores: ["dist/**", "node_modules/**", "rag/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-self-assign": "error",
      "require-atomic-updates": "off",
    },
  },
];
