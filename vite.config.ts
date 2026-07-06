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
      const next = code.replace(
        'className="min-h-[100dvh] bg-[#070b14] text-slate-100"',
        'className="h-[100dvh] overflow-y-auto overscroll-y-contain bg-[#070b14] text-slate-100"',
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
  overflow-y: hidden !important;
  scrollbar-gutter: stable !important;
}
body:has(div[class*="bg-[#070b14]"]) {
  position: static !important;
  overscroll-behavior-y: auto !important;
}
body:has(div[class*="bg-[#070b14]"]) > div,
body:has(div[class*="bg-[#070b14]"]) #root,
body:has(div[class*="bg-[#070b14]"]) [data-tanstack-router-root] {
  height: 100dvh !important;
  min-height: 100dvh !important;
  max-height: 100dvh !important;
  overflow-y: hidden !important;
}
div[class*="bg-[#070b14]"] {
  height: 100dvh !important;
  min-height: 100dvh !important;
  max-height: 100dvh !important;
  overflow-y: auto !important;
  scrollbar-width: thin !important;
}
div[class*="bg-[#070b14]"] > main,
div[class*="bg-[#070b14]"] > main > section,
div[class*="bg-[#070b14]"] > main > aside {
  min-height: 0 !important;
}
@media (min-width: 1280px) {
  html body div[class*="bg-[#070b14]"] > main {
    grid-template-columns: 232px minmax(0, 1fr) !important;
    max-width: 1500px !important;
  }
  html body div[class*="bg-[#070b14]"] > main > aside:last-of-type,
  html body div[class*="bg-[#070b14]"] > main > aside:last-child,
  html body div[class*="bg-[#070b14]"] > main > aside[class*="xl:sticky"]:last-of-type {
    position: static !important;
    inset: auto !important;
    top: auto !important;
    right: auto !important;
    left: auto !important;
    bottom: auto !important;
    z-index: auto !important;
    grid-column: 2 / 3 !important;
    width: auto !important;
    max-width: none !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    padding-left: 0 !important;
    transform: none !important;
    translate: none !important;
    transition: none !important;
    filter: none !important;
    opacity: 1 !important;
  }
  html body div[class*="bg-[#070b14]"] > main > aside:last-of-type::before,
  html body div[class*="bg-[#070b14]"] > main > aside:last-child::before,
  html body div[class*="bg-[#070b14]"] > main > aside[class*="xl:sticky"]:last-of-type::before {
    content: none !important;
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    min-height: 0 !important;
    border: 0 !important;
    background: transparent !important;
  }
}
div[class*="bg-[#070b14]"] .react-flow__pane,
div[class*="bg-[#070b14]"] .react-flow__viewport {
  overscroll-behavior: contain !important;
}
`;
  const js = `
(function () {
  var css = ${JSON.stringify(css)};
  function install() {
    var old = document.getElementById('ai-control-panel-scroll-styles-runtime');
    if (old) old.remove();
    var style = document.createElement('style');
    style.id = 'ai-control-panel-scroll-styles-runtime';
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();`;

  return {
    name: "ai-control-panel-scroll-styles",
    transformIndexHtml(html: string) {
      const withHead = html.includes("ai-control-panel-scroll-styles")
        ? html
        : html.replace(
            "</head>",
            `<style id="ai-control-panel-scroll-styles">${css}</style></head>`,
          );
      if (withHead.includes("ai-control-panel-scroll-styles-runtime")) return withHead;
      return withHead.replace(
        "</body>",
        `<script id="ai-control-panel-scroll-styles-runtime">${js}</script></body>`,
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
    plugins: [fixXyflowDefaultImport(), makeAiLabRootScrollable(), aiControlPanelScrollStyles(), mcpPlugin()],
  },
});
