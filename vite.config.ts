// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

const xyflowShimPath = fileURLToPath(new URL("./src/lib/xyflow-react-shim.ts", import.meta.url));

function xyflowDefaultExportShim() {
  return {
    name: "xyflow-default-export-shim",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (source !== "@xyflow/react") return null;
      if (importer?.endsWith("xyflow-react-shim.ts")) return null;
      if (importer?.endsWith("src/routes/admin/ai-lab.tsx")) return xyflowShimPath;
      return null;
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
    plugins: [xyflowDefaultExportShim(), mcpPlugin()],
  },
});
