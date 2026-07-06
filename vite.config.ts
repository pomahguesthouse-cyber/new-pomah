// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

function isAiLabRoute(id: string) {
  return id.includes("/src/routes/admin/ai-lab.tsx") || id.includes("\\src\\routes\\admin\\ai-lab.tsx");
}

function aiLabRouteTransforms() {
  return {
    name: "ai-lab-route-only-transforms",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!isAiLabRoute(id)) return null;
      let next = code;

      // React Flow exports ReactFlow as a named export. Keep this fix scoped to
      // AI Lab so other routes/packages are never rewritten.
      next = next.replace(/import\s+ReactFlow\s*,\s*\{/g, "import { ReactFlow,");
      next = next.replace(/\n\s*Controls,/g, "");
      next = next.replace(/\n\s*<Controls[^>]*\/?>/g, "");

      // Keep the AI Lab page scrollable without using global CSS selectors.
      next = next.replace(
        '<div className="min-h-[100dvh] bg-[#070b14] text-slate-100">',
        '<div className="bg-slate-950 text-slate-100" style={{ height: "100dvh", overflowY: "auto", overscrollBehaviorY: "contain" }}>',
      );
      next = next.replace(
        '<main className="mx-auto grid max-w-[1500px] gap-4 p-3 md:p-5 xl:grid-cols-[232px_minmax(0,1fr)_340px]">',
        '<main className="mx-auto grid max-w-[1500px] gap-4 p-3 md:p-5" style={{ gridTemplateColumns: "232px minmax(0, 1fr)", alignItems: "start" }}>',
      );

      // Canvas first, compact KPI cards below it, then alerts and panels.
      next = next.replace(
        /\n\s*<KpiStrip snapshot=\{snapshot\} metrics=\{metrics\} health=\{health\} latestQueue=\{latestQueue\} openDrawer=\{setDrawer\} \/>\n\s*<OperationalAlerts snapshot=\{snapshot\} health=\{health\} retryTotal=\{retryTotal\} openDrawer=\{setDrawer\} \/>\n\s*(<AiReactFlowCanvas[\s\S]*?\n\s*\/>)\n\s*<QualityScorePanel/,
        `\n          $1\n          <KpiStrip snapshot={snapshot} metrics={metrics} health={health} latestQueue={latestQueue} openDrawer={setDrawer} />\n          <OperationalAlerts snapshot={snapshot} health={health} retryTotal={retryTotal} openDrawer={setDrawer} />\n          <QualityScorePanel`,
      );

      // Compact KPI row. Inline styles are used because Tailwind does not scan
      // strings injected by Vite transforms.
      next = next.replace(
        '<section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">',
        '<section className="grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }}>',
      );
      next = next.replace(
        'className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-left text-slate-100 transition hover:border-emerald-400/50"',
        'className="rounded-xl border border-slate-800 bg-slate-950/70 text-left text-slate-100 transition hover:border-emerald-400/50" style={{ minHeight: "74px", padding: "8px 10px" }}',
      );
      next = next.replace(
        'className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneClass(card.tone, "bg"))}',
        'className={cn("flex items-center justify-center rounded-lg", toneClass(card.tone, "bg"))} style={{ width: "26px", height: "26px" }}',
      );
      next = next.replace(
        '<card.icon className={cn("h-4 w-4", toneClass(card.tone, "text"))} />',
        '<card.icon className={cn("h-3.5 w-3.5", toneClass(card.tone, "text"))} />',
      );
      next = next.replace(
        '<p className="mt-3 truncate text-[11px] text-slate-400">{card.label}</p>',
        '<p className="mt-1.5 truncate text-[10px] leading-3 text-slate-400">{card.label}</p>',
      );
      next = next.replace(
        '<p className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-white">{card.value}</p>',
        '<p className="mt-0.5 truncate text-lg font-semibold leading-5 tracking-tight text-white">{card.value}</p>',
      );
      next = next.replace(
        '<p className={cn("mt-0.5 truncate text-[10px]", toneClass(card.tone, "text"))}>{card.delta}</p>',
        '<p className={cn("mt-0.5 truncate text-[9px] leading-3", toneClass(card.tone, "text"))}>{card.delta}</p>',
      );

      // Remove the old right detail drawer from AI Lab only.
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
    plugins: [aiLabRouteTransforms(), mcpPlugin()],
  },
});
