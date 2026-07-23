/**
 * Pannellum360Viewer — thin React wrapper around Pannellum (loaded from CDN).
 *
 * Renders a multi-scene 360° virtual tour. Scenes are equirectangular photos;
 * hotspots either jump to another scene ("scene") or show a note ("info").
 *
 * In `editable` mode, clicking anywhere on the panorama reports the pitch/yaw
 * of that point via `onPick`, so the admin builder can place a hotspot exactly
 * where the user clicked. Pannellum is loaded lazily and only on the client
 * (SSR-safe: nothing touches `window` until the effect runs).
 */
import { useEffect, useRef } from "react";

export type WalkHotspot = {
  id?: string;
  pitch: number;
  yaw: number;
  type: "scene" | "info";
  label?: string | null;
  targetSceneId?: string | null;
};

export type WalkScene = {
  id: string;
  title?: string | null;
  imageUrl: string;
  hotspots: WalkHotspot[];
};

type Props = {
  scenes: WalkScene[];
  firstSceneId?: string | null;
  editable?: boolean;
  /** Fired in editable mode when the user clicks a point on the panorama. */
  onPick?: (coords: { pitch: number; yaw: number }) => void;
  /** Fired when the viewer switches scene (e.g. user clicks a scene hotspot). */
  onSceneChange?: (sceneId: string) => void;
  /** Fired after dragging an existing hotspot to a new position (editable mode). */
  onHotspotDragEnd?: (hotspotId: string, pitch: number, yaw: number) => void;
  className?: string;
};

const PANNELLUM_VERSION = "2.5.6";
const CSS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pannellum/${PANNELLUM_VERSION}/pannellum.css`;
const JS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pannellum/${PANNELLUM_VERSION}/pannellum.js`;

declare global {
  interface Window {
    // Pannellum has no bundled types; keep it loose.
    pannellum?: any;
  }
}

let loaderPromise: Promise<void> | null = null;

/** Inject Pannellum CSS + JS once; resolve when `window.pannellum` is ready. */
function loadPannellum(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.pannellum) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    if (!document.querySelector(`link[data-pannellum]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_URL;
      link.setAttribute("data-pannellum", "true");
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[data-pannellum]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Gagal memuat Pannellum")));
      if (window.pannellum) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = JS_URL;
    script.async = true;
    script.setAttribute("data-pannellum", "true");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat Pannellum"));
    document.body.appendChild(script);
  });
  return loaderPromise;
}

export function Pannellum360Viewer({
  scenes,
  firstSceneId,
  editable = false,
  onPick,
  onSceneChange,
  onHotspotDragEnd,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  // Keep latest callbacks without forcing a viewer rebuild.
  const onPickRef = useRef(onPick);
  const onSceneChangeRef = useRef(onSceneChange);
  const onHotspotDragEndRef = useRef(onHotspotDragEnd);
  onPickRef.current = onPick;
  onSceneChangeRef.current = onSceneChange;
  onHotspotDragEndRef.current = onHotspotDragEnd;
  // Timestamp of the last hotspot drag so we can suppress the click that would
  // otherwise be interpreted as "place a new hotspot".
  const lastDragEndRef = useRef(0);

  // Rebuild only when the scene graph structurally changes. NOTE: hotspot
  // pitch/yaw are intentionally excluded so dragging a hotspot (which Pannellum
  // already moves live) doesn't force a full rebuild that resets the camera.
  const graphKey = JSON.stringify(
    scenes.map((s) => ({
      i: s.id,
      u: s.imageUrl,
      h: s.hotspots.map((h) => ({ i: h.id, t: h.type, g: h.targetSceneId, l: h.label })),
    })),
  );

  useEffect(() => {
    let cancelled = false;

    async function build() {
      await loadPannellum();
      if (cancelled || !containerRef.current || !window.pannellum) return;

      // Tear down any previous instance before creating a new one.
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          /* ignore */
        }
        viewerRef.current = null;
      }
      containerRef.current.innerHTML = "";

      if (scenes.length === 0) return;

      const first =
        (firstSceneId && scenes.find((s) => s.id === firstSceneId)?.id) || scenes[0].id;

      // Drag handler shared by all hotspots in editable mode. Pannellum calls
      // this on mousedown/move/up during a drag; on release we read the new
      // pointer position and persist it. `args` carries the hotspot id.
      const dragHandler = (e: MouseEvent | TouchEvent, args: any) => {
        const type = (e as Event).type;
        if (type === "mouseup" || type === "touchend") {
          lastDragEndRef.current = Date.now();
          try {
            const coords = viewerRef.current?.mouseEventToCoords(e);
            if (Array.isArray(coords) && coords.length >= 2 && args?.id) {
              onHotspotDragEndRef.current?.(args.id, coords[0], coords[1]);
            }
          } catch {
            /* ignore */
          }
        }
      };

      const sceneConfig: Record<string, any> = {};
      for (const s of scenes) {
        sceneConfig[s.id] = {
          type: "equirectangular",
          panorama: s.imageUrl,
          title: s.title ?? undefined,
          hotSpots: s.hotspots.map((h) => {
            const base: any =
              h.type === "scene" && h.targetSceneId
                ? {
                    pitch: h.pitch,
                    yaw: h.yaw,
                    type: "scene",
                    text: h.label || scenes.find((x) => x.id === h.targetSceneId)?.title || "Pindah ruangan",
                    sceneId: h.targetSceneId,
                  }
                : { pitch: h.pitch, yaw: h.yaw, type: "info", text: h.label || "Info" };
            if (editable && h.id) {
              base.draggable = true;
              base.dragHandlerFunc = dragHandler;
              base.dragHandlerArgs = { id: h.id };
            }
            return base;
          }),
        };
      }

      const viewer = window.pannellum.viewer(containerRef.current, {
        default: {
          firstScene: first,
          sceneFadeDuration: 800,
          autoLoad: true,
          showControls: true,
          hfov: 110,
        },
        scenes: sceneConfig,
      });
      viewerRef.current = viewer;

      if (onSceneChangeRef.current) {
        viewer.on("scenechange", (sceneId: string) => onSceneChangeRef.current?.(sceneId));
      }

      if (editable) {
        // Click to capture pitch/yaw for placing a hotspot.
        const el = containerRef.current;
        const handler = (ev: MouseEvent) => {
          // Ignore the click that ends a hotspot drag.
          if (Date.now() - lastDragEndRef.current < 300) return;
          try {
            const coords = viewer.mouseEventToCoords(ev);
            if (Array.isArray(coords) && coords.length >= 2) {
              onPickRef.current?.({ pitch: coords[0], yaw: coords[1] });
            }
          } catch {
            /* viewer not ready */
          }
        };
        el.addEventListener("click", handler);
        // Stash for cleanup.
        (viewer as any).__pickHandler = { el, handler };
      }
    }

    void build();

    return () => {
      cancelled = true;
      const v = viewerRef.current;
      if (v?.__pickHandler) {
        v.__pickHandler.el.removeEventListener("click", v.__pickHandler.handler);
      }
      if (v) {
        try {
          v.destroy();
        } catch {
          /* ignore */
        }
      }
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, firstSceneId, editable]);

  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
}

export default Pannellum360Viewer;
