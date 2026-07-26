/**
 * Shared loader for a PUBLISHED 360° tour, used by the public room-detail page
 * and anywhere else that needs to embed a tour. Reads via the browser Supabase
 * client (anon) — RLS only exposes published tours/scenes/hotspots.
 */
import { supabase } from "@/integrations/supabase/client";
import type { WalkScene } from "./pannellum-viewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type PublicTour = {
  title: string | null;
  slug: string | null;
  firstSceneId: string | null;
  scenes: WalkScene[];
};

/** Load a room type's published tour, or null if none/empty. */
export async function loadPublishedTourByRoomTypeId(roomTypeId: string): Promise<PublicTour | null> {
  if (!roomTypeId) return null;

  const { data: tour } = await sb
    .from("walkthrough_tours")
    .select("id, title, slug, default_scene_id, is_published")
    .eq("room_type_id", roomTypeId)
    .eq("is_published", true)
    .maybeSingle();
  if (!tour) return null;

  const { data: sceneRows } = await sb
    .from("walkthrough_scenes")
    .select("id, title, image_url, order_index")
    .eq("tour_id", tour.id)
    .order("order_index", { ascending: true });
  const scenes = (sceneRows ?? []) as Array<{ id: string; title: string | null; image_url: string }>;
  if (scenes.length === 0) return null;

  const ids = scenes.map((s) => s.id);
  const { data: hsRows } = await sb
    .from("walkthrough_hotspots")
    .select("scene_id, target_scene_id, type, label, label_mode, pitch, yaw")
    .in("scene_id", ids);
  const hotspots = (hsRows ?? []) as Array<{
    scene_id: string;
    target_scene_id: string | null;
    type: "scene" | "info";
    label: string | null;
    label_mode: "hover" | "always";
    pitch: number;
    yaw: number;
  }>;

  const walkScenes: WalkScene[] = scenes.map((s) => ({
    id: s.id,
    title: s.title,
    imageUrl: s.image_url,
    hotspots: hotspots
      .filter((h) => h.scene_id === s.id)
      .map((h) => ({
        pitch: Number(h.pitch),
        yaw: Number(h.yaw),
        type: h.type,
        label: h.label,
        labelMode: h.label_mode,
        targetSceneId: h.target_scene_id,
      })),
  }));

  return {
    title: tour.title ?? null,
    slug: (tour.slug as string | null) ?? null,
    firstSceneId: (tour.default_scene_id as string | null) ?? scenes[0]?.id ?? null,
    scenes: walkScenes,
  };
}
