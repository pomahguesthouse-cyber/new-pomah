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

function makeAiLabRootScrollable() {
  return {
    name: "make-ai-lab-root-scrollable",
    enforce: "pre" as const,
    transform(code: string) {
      if (!code.includes("WhatsApp AI Control Room")) return null;
      let next = code.replace(
        '<div className="min-h-[100dvh] bg-[#070b14] text-slate-100">',
        '<div className="bg-slate-950 text-slate-100" style={{ height: "100dvh", overflowY: "auto", overscrollBehaviorY: "contain" }}>',
      );
      next = next.replace(
        '<main className="mx-auto grid max-w-[1500px] gap-4 p-3 md:p-5 xl:grid-cols-[232px_minmax(0,1fr)_340px]">',
        '<main className="mx-auto grid max-w-[1500px] gap-4 p-3 md:p-5" style={{ gridTemplateColumns: "232px minmax(0, 1fr)", alignItems: "start" }}>',
      );
      next = next.replace(/\n\s*<aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">\n\s*<InspectorPanel selectedNode=\{selectedNode\} config=\{config\} snapshot=\{snapshot\} health=\{health\} quality=\{quality \?\? \[\]\} openDrawer=\{setDrawer\} \/>\n\s*<AuditMiniPanel openDrawer=\{setDrawer\} \/>\n\s*<\/aside>/, "");
      if (next === code) return null;
      return { code: next, map: null };
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
    plugins: [fixXyflowDefaultImport(), makeAiLabRootScrollable(), mcpPlugin()],
  },
});
