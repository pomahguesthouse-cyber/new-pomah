/**
 * Page rendering engine.
 *
 * Walks a `PageContent` document, resolves each node against the
 * component registry and renders it. The SAME renderer powers both the
 * editor canvas and the public `/p/$slug` route — guaranteeing that what
 * the user designs is exactly what visitors see.
 */
import type { PageContent, PageNode } from "./types";
import { getComponent } from "./registry";

/** Render a single node. Unknown types render a safe placeholder. */
export function NodeRenderer({ node }: { node: PageNode }) {
  const def = getComponent(node.type);
  if (!def) {
    return (
      <div className="bg-amber-50 px-6 py-4 text-center text-xs text-amber-700">
        Unknown component: {node.type}
      </div>
    );
  }
  // Merge defaults so older documents missing newer props still render.
  const props = { ...def.defaults, ...node.props };
  return <>{def.render(props)}</>;
}

/** Render an entire page document. */
export function PageRenderer({ content }: { content: PageContent }) {
  const nodes = content?.nodes ?? [];
  if (nodes.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-stone-400">
        This page has no content yet.
      </div>
    );
  }
  return (
    <>
      {nodes.map((node) => (
        <NodeRenderer key={node.id} node={node} />
      ))}
    </>
  );
}
