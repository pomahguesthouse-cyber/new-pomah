/**
 * Page rendering engine.
 *
 * Walks a `PageContent` document — sections, each a responsive grid of
 * elements — and renders it. The SAME element registry powers both the
 * editor canvas and the public `/p/$slug` route, so what the user
 * designs is exactly what visitors see.
 */
import type { Element, PageContent, PageTheme, Section } from "./types";
import { normalizePage } from "./types";
import { getComponent } from "./registry";

/** Inner content max-width per section width setting. */
export const WIDTH_CLASS: Record<Section["width"], string> = {
  full: "max-w-none",
  wide: "max-w-6xl",
  narrow: "max-w-3xl",
};

const FONT_CLASS: Record<PageTheme["fontFamily"], string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
};

/** Render a single element. Unknown types render a safe placeholder. */
export function ElementView({ element }: { element: Element }) {
  const def = getComponent(element.type);
  if (!def) {
    return (
      <div className="bg-amber-50 px-4 py-3 text-center text-xs text-amber-700">
        Unknown element: {element.type}
      </div>
    );
  }
  const props = { ...def.defaults, ...element.props };
  return <>{def.render(props)}</>;
}

/** Render one section: a responsive grid container of elements. */
export function SectionView({ section }: { section: Section }) {
  const cols = Math.max(1, Math.min(section.columns ?? 1, 4));
  return (
    <section
      style={{
        background: section.bgColor,
        paddingTop: section.paddingY,
        paddingBottom: section.paddingY,
      }}
    >
      <div className={`mx-auto px-6 ${WIDTH_CLASS[section.width] ?? "max-w-6xl"}`}>
        {section.elements.length === 0 ? null : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: section.gap,
            }}
          >
            {section.elements.map((el) => (
              <div key={el.id} style={{ gridColumn: `span ${Math.min(el.colSpan ?? cols, cols)}` }}>
                <ElementView element={el} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Render an entire page document (public route entry point). */
export function PageRenderer({ content }: { content: unknown }) {
  const doc: PageContent = normalizePage(content);
  if (doc.sections.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-stone-400">
        This page has no content yet.
      </div>
    );
  }
  return (
    <div
      className={FONT_CLASS[doc.theme.fontFamily] ?? "font-sans"}
      style={{ background: doc.theme.bgColor, color: doc.theme.textColor }}
    >
      {doc.sections.map((section) => (
        <SectionView key={section.id} section={section} />
      ))}
    </div>
  );
}
