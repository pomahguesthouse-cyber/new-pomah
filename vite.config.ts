// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { sep } from "path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// Windows fix: @lovable.dev/mcp-js resolves routesDir with `path.resolve` (which
// returns native "\" separators on Windows) and then asserts it starts with
// Vite's `config.root`, which Vite normalizes to POSIX "/". On Windows those never
// match and dev/build throws `routesDir "src/routes" must resolve under ...`.
// We hand the plugin a `config.root` using native separators so its internal
// resolve() and the assertion agree. No-op on POSIX (sep === "/"), so Lovable's
// Linux cloud builds are unaffected.
function mcpPluginWin() {
  const plugin = mcpPlugin();
  const originalConfigResolved = plugin.configResolved as
    | ((config: { root: string }) => unknown)
    | undefined;
  if (typeof originalConfigResolved === "function") {
    plugin.configResolved = function (config: { root: string }) {
      const nativeRoot = config.root.split("/").join(sep);
      return originalConfigResolved.call(this, { ...config, root: nativeRoot });
    } as typeof plugin.configResolved;
  }
  return plugin;
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
//
// NOTE: the AI Lab layout adjustments (compact KPI row, no right drawer, React Flow
// import fix) that used to live here as a build-time `aiLabRouteTransforms()` string
// patch are now baked directly into src/routes/admin/ai-lab.tsx, so the page renders
// identically in local dev and on hosted builds. The fragile transform was removed.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPluginWin()],
  },
});
