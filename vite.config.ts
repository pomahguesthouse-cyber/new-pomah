// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

function fixXyflowDefaultImport() {
  return {
    name: "fix-xyflow-default-import",
    enforce: "pre" as const,
    transform(code: string) {
      if (!code.includes("@xyflow/react")) return null;
      const next = code.replace(
        /import\s+ReactFlow\s*,\s*\{/g,
        "import { ReactFlow,",
      );
      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}

function aiControlPanelScrollStyles() {
  const css = `
html:has(div[class*="bg-[#070b14]"]),
body:has(div[class*="bg-[#070b14]"]) {
  height: auto !important;
  min-height: 100% !important;
  max-height: none !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-gutter: stable !important;
}
body:has(div[class*="bg-[#070b14]"]) {
  position: static !important;
  overscroll-behavior-y: auto !important;
}
body:has(div[class*="bg-[#070b14]"]) > div,
body:has(div[class*="bg-[#070b14]"]) #root,
body:has(div[class*="bg-[#070b14]"]) [data-tanstack-router-root] {
  height: auto !important;
  min-height: 100% !important;
  max-height: none !important;
  overflow-y: visible !important;
}
div[class*="bg-[#070b14]"] {
  min-height: 100vh !important;
  height: auto !important;
  max-height: none !important;
  overflow-y: visible !important;
}
div[class*="bg-[#070b14]"] > main,
div[class*="bg-[#070b14]"] > main > section,
div[class*="bg-[#070b14]"] > main > aside {
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
}
div[class*="bg-[#070b14]"] .react-flow__pane,
div[class*="bg-[#070b14]"] .react-flow__viewport {
  overscroll-behavior: contain !important;
}
`;

  return {
    name: "ai-control-panel-scroll-styles",
    transformIndexHtml(html: string) {
      if (html.includes("ai-control-panel-scroll-styles")) return html;
      return html.replace(
        "</head>",
        `<style id="ai-control-panel-scroll-styles">${css}</style></head>`,
      );
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
    plugins: [fixXyflowDefaultImport(), aiControlPanelScrollStyles(), mcpPlugin()],
  },
});
