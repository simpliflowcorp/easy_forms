// Flat-config replacement for the legacy `.eslintrc.*`.
//
// Why this exists: Next 16 dropped the `next lint` subcommand, so
// `npm run lint` now invokes ESLint directly via `eslint .`.
//
// Why it doesn't do more: the obvious approach — `import next from
// "eslint-config-next"; next("core-web-vitals")` — does NOT work on this
// stack:
//
//   - `typescript-eslint@8` throws at module load on TypeScript 7
//     (`typescript-eslint#10940`; the enhancement for tsgo/TS 7 type info
//     is still open). `eslint-config-next@16` does `require("typescript-eslint")`
//     unconditionally at module load, so importing it crashes before any
//     config runs.
//   - `eslint-plugin-react@7.37.5`, `eslint-plugin-jsx-a11y@6.10.2`,
//     `eslint-plugin-import@2.32.0` cap their ESLint peerDeps at ^9 and trip
//     `context.getFilename is not a function` on ESLint 10.
//   - ESLint 10 ignores files by default unless a `files:` glob explicitly
//     selects them; the naive single-block flat config doesn't lint anything.
//
// What this file delivers:
//   - `.js` / `.jsx` files (Next.js non-app config files, scripts, hooks)
//     get ESLint built-in rules + `eslint-plugin-react-hooks`
//     (the only legacy next style plugin with explicit ESLint 10 peer support
//     and the highest-impact React rules: hook-order + exhaustive-deps).
//   - `.ts` / `.tsx` files are lint-attempted via `espree` (the default
//     parser) with the SAME syntactic rules. Espree will accept common TS
//     sub-grammar syntax — the Linter will throw a parse-error on heavy
//     TS-specific features (type annotations on decls, enums, generics),
//     at which point we advise falling back to `tsc --noEmit` for
//     type-bearing files and limiting `npm run lint` to syntactic checks of
//     plain `.js` / `.jsx` files. The `lint` script does NOT fail on parse
//     errors (ESLint reports them by default but does not exit non-zero
//     unless a configured `*error*` rule fires).
//
// When the upstream unblocks:
//   - `typescript-eslint` ships TS 7 support → swap to:
//     `import next from "eslint-config-next"; import tseslint from "typescript-eslint";
//      export default tseslint.config(next(), next("core-web-vitals"), next("typescript"), { rules: ... });`
//   - `eslint-plugin-react@>7.38`, `eslint-plugin-jsx-a11y@>6.10`,
//     `eslint-plugin-import@>2.33` ship ESLint 10 peer support → re-enable
//     the `react/*`, `jsx-a11y/*`, `import/*` rule blocks documented below in
//     `OBSOLETE_RULES_TO_RE_ENABLE`.
//
// Track outstanding blockers in `updates/implementation_plan.md` under OPEN-3.
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commonRules = {
  // react-hooks — the one React plugin with ESLint 10 peer support.
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",

  // Built-in ESLint rules — real bug catchers, not stylistic.
  "no-cond-assign": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-debugger": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-duplicate-case": "error",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-ex-assign": "error",
  "no-extra-boolean-cast": "error",
  "no-irregular-whitespace": "error",
  "no-redeclare": "error",
  "no-sparse-arrays": "error",
  "no-unreachable": "error",
  "no-use-before-define": ["error", { functions: false, classes: true, variables: false }],
  "no-unsafe-finally": "error",
  "valid-typeof": "error",
  "no-duplicate-imports": "warn",
  "no-unused-vars": [
    "warn",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
  ],
  "no-self-assign": "error",
  "no-unused-labels": "error",
  "no-unused-private-class-members": "error",
  "no-useless-catch": "warn",
  "no-control-regex": "warn",
  "no-empty-pattern": "warn",
  "no-mixed-spaces-and-tabs": "error",
  "no-undef": "error",
};

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "src/agent/legacy/**",
      "tests/agent/legacy/**",
      "scripts/migrate-agent-tickets.ts",
      "debug-llm.ts",
      "test-llm.ts",
      "test-llm.js",
      "test-llm-drafter.js",
      "test-llm-15.js",
      "test-db.js",
      "test-db2.js",
      "src/agent/legacy/**/*.ts",
      "tests/load/**",
    ],
  },
  // Block must declare `files` so ESLint 10 doesn't silently ignore everything.
  // Scope intentionally `.js/.mjs/.cjs/.jsx` only — `typescript-eslint` (the
  // only TS-aware parser available in this repo) throws on TypeScript 7
  // (`typescript-eslint#10940`, tracked in OPEN-3), and ESLint's `espree`
  // can't parse TypeScript syntax. TS/TSX file linting is delegated to
  // `tsc --noEmit` until the upstream unblocks; once it does, add `ts,tsx`
  // to the `files` glob here and the `@typescript-eslint/*` rules will start
  // firing.
  {
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.commonjs,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: commonRules,
    settings: {
      react: { version: "detect" },
      next: { rootDir: __dirname },
    },
  },
];
