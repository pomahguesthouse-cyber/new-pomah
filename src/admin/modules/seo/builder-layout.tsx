import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

/** Three columns from this width up. Fold inner (about 820–920) stays below it. */
export const BUILDER_TRIPLE_MIN = 1100;
/** Canvas plus one side panel. Narrower than this, panels become sheets. */
export const BUILDER_SPLIT_MIN = 768;

export type BuilderLayoutMode = "triple" | "split" | "overlay";

export function builderLayoutForWidth(width: number): BuilderLayoutMode {
  if (width >= BUILDER_TRIPLE_MIN) return "triple";
  if (width >= BUILDER_SPLIT_MIN) return "split";
  return "overlay";
}

export function useBuilderLayout(): BuilderLayoutMode {
  const [mode, setMode] = useState<BuilderLayoutMode>(() =>
    builderLayoutForWidth(typeof window === "undefined" ? 1280 : window.innerWidth),
  );

  useEffect(() => {
    const apply = () => setMode(builderLayoutForWidth(window.innerWidth));
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  return mode;
}

/** Local dev preview only. Production builds constant-fold DEV to false, and a deployed dev build still requires localhost. */
export function isPbFixtureRequest(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return false;
  return new URLSearchParams(window.location.search).get("pbFixture") === "1";
}

export function pbFixtureView(): string | null {
  if (!isPbFixtureRequest()) return null;
  return new URLSearchParams(window.location.search).get("view");
}

/** Shared shell for builder dialogs: cap at the visual viewport and scroll inside. */
export const builderDialogClass =
  "pb-tap flex max-h-[90dvh] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg";

type ScaledPreviewProps = {
  mode: "desktop" | "mobile";
  title: string;
  frameKey: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  src?: string;
  srcDoc?: string;
};

/**
 * Renders the preview iframe at a real desktop (1280) or phone (390) width,
 * then scales the frame so it fits the canvas without page overflow.
 */
export function ScaledPreview({ mode, title, frameKey, iframeRef, src, srcDoc }: ScaledPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pad = 16;
  const availW = Math.max(0, box.w - pad);
  const availH = Math.max(0, box.h - pad);
  const logicalW = mode === "mobile" ? 390 : 1280;
  const chrome = mode === "mobile" ? 24 : 0;
  const mobileH = 780;
  let scale = 1;
  let logicalH = 720;
  if (availW > 0 && availH > 0) {
    if (mode === "mobile") {
      scale = Math.min(1, availW / (logicalW + chrome), availH / (mobileH + chrome));
      logicalH = mobileH;
    } else {
      scale = Math.min(1, availW / logicalW);
      logicalH = Math.max(480, Math.floor(availH / scale));
    }
  }
  const outerW = logicalW + chrome;
  const outerH = logicalH + chrome;
  const ready = box.w > 8 && box.h > 8;

  return (
    <div ref={boxRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-stone-100 p-2">
      {ready ? (
        <div className="relative shrink-0" style={{ width: outerW * scale, height: outerH * scale }}>
          <div
            className={cn(
              "absolute left-0 top-0 overflow-hidden bg-white",
              mode === "mobile"
                ? "box-border rounded-[36px] border-[12px] border-stone-800 shadow-xl"
                : "rounded-xl border border-border shadow-xl",
            )}
            style={{
              width: outerW,
              height: outerH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {mode === "mobile" ? (
              <div className="pointer-events-none absolute left-1/2 top-2 z-10 flex h-6 w-32 -translate-x-1/2 items-center justify-center rounded-full bg-stone-800">
                <div className="h-1 w-12 rounded-full bg-stone-600" />
              </div>
            ) : null}
            <iframe
              ref={iframeRef}
              key={frameKey}
              title={title}
              src={srcDoc ? undefined : src}
              srcDoc={srcDoc}
              className={cn("block border-0", mode === "mobile" && "pt-4")}
              style={{ width: logicalW, height: logicalH }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
