// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

function fixAiLabXyflowImport() {
  return {
    name: "fix-ai-lab-xyflow-import",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.endsWith("src/routes/admin/ai-lab.tsx")) return null;
      if (!code.includes('import ReactFlow, {')) return null;
      return {
        code: code.replace('import ReactFlow, {', 'import { ReactFlow,'),
        map: null,
      };
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [fixAiLabXyflowImport(), mcpPlugin()],
  },
});
