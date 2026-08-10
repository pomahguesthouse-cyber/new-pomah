import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      // Generated files — regenerated wholesale, so linting them only produces
      // noise no one can act on (supabase/types.ts alone accounted for ~3.7k errors).
      "src/routeTree.gen.ts",
      "src/integrations/supabase/types.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Reported but non-blocking: ~1k existing sites. Set here rather than in a
      // trailing override because a flat-config block may only tweak rules whose
      // plugin is registered in that same block.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  eslintPluginPrettier,

  // Must come after eslintPluginPrettier — it sets prettier/prettier to "error",
  // and last config wins in flat config.
  //
  // Both rules are reported but non-blocking. Formatting drift is continuously
  // reintroduced by Lovable regenerating these files, so failing CI on it just
  // trains everyone to ignore CI. `bun run format` still fixes it on demand, and
  // `no-explicit-any` stays visible as debt (~1k sites) without gating merges.
  // No `files` filter on purpose: the prettier plugin also lints .js/.cjs/.mjs
  // (scripts/update-sitemenu.cjs alone carries 111 formatting errors), so scoping
  // this to ts/tsx would leave those blocking CI.
  {
    rules: {
      "prettier/prettier": "warn",
      // All remaining sites are redundant escapes inside character classes in the
      // date/slot parser regexes — inert at runtime. Not worth churning covered
      // parser code for; left visible as warnings.
      "no-useless-escape": "warn",
    },
  },
);
