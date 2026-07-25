/**
 * /tour/$slug — public 360° virtual tour viewer for one room type.
 *
 * Reads the PUBLISHED walkthrough for the room type (RLS allows anon to see
 * only published tours) and renders it fullscreen with Pannellum. Scene
 * hotspots let the visitor walk between rooms.
 */
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Compass, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Pannellum360Viewer, type WalkScene } from "@/admin/modules/walkthrough/pannellum-viewer";

export const Route = createFileRoute("/tour/$slug")({
  head: () => ({ meta: [{ title: "Virtual Tour 360° — Pomah Guesthouse" }] }),
  component: TourViewerPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type TourData = {
  roomTypeName: string;
  title: string | null;
  firstSceneId: string | null;
  scenes: WalkScene[];
} | null;

async function loadTour(slug: string): Promise<TourData> {
  // 1) Try a tour whose own editable slug matches.
  let tour: any = null;
  let roomTypeName = "";
  const { data: bySlug } = await sb
    .from("walkthrough_tours")
    .select("id, title, default_scene_id, is_published, room_type_id")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (bySlug) {
    tour = bySlug;
    const { data: rt } = await sb
      .from("room_types")
      .select("name")
      .eq("id", bySlug.room_type_id)
      .maybeSingle();
    roomTypeName = rt?.name ?? "";
  } else {
    // 2) Fall back to resolving by the room type's own slug.
    const { data: rt } = await sb
      .from("room_types")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (!rt) return null;
    roomTypeName = rt.name;
    const { data: byRoom } = await sb
      .from("walkthrough_tours")
      .select("id, title, default_scene_id, is_published")
      .eq("room_type_id", rt.id)
      .eq("is_published", true)
      .maybeSingle();
    tour = byRoom;
  }

  if (!tour) return { roomTypeName, title: null, firstSceneId: null, scenes: [] };

  const { data: sceneRows } = await sb
    .from("walkthrough_scenes")
    .select("id, title, image_url, order_index")
    .eq("tour_id", tour.id)
    .order("order_index", { ascending: true });
  const scenes = (sceneRows ?? []) as Array<{ id: string; title: string | null; image_url: string }>;

  const ids = scenes.map((s) => s.id);
  const { data: hsRows } = ids.length
    ? await sb
        .from("walkthrough_hotspots")
        .select("id, scene_id, target_scene_id, type, label, label_mode, pitch, yaw")
        .in("scene_id", ids)
    : { data: [] };
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
    roomTypeName,
    title: tour.title ?? null,
    firstSceneId: (tour.default_scene_id as string | null) ?? scenes[0]?.id ?? null,
    scenes: walkScenes,
  };
}

function TourViewerPage() {
  const { slug } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["public-tour", slug],
    queryFn: () => loadTour(slug),
  });

  const scenes = useMemo(() => data?.scenes ?? [], [data]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat tour…
      </div>
    );
  }

  if (!data || scenes.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-black text-white">
        <Compass className="h-10 w-10 opacity-70" />
        <p className="text-sm opacity-80">Virtual tour untuk kamar ini belum tersedia.</p>
        <Link to="/" className="text-sm text-primary underline">
          Kembali ke beranda
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-black">
      <Pannellum360Viewer scenes={scenes} firstSceneId={data.firstSceneId} />
      <div className="pointer-events-none absolute left-0 top-0 flex w-full items-center justify-between p-3">
        <Link
          to="/"
          className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-black/70"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Pomah Guesthouse
        </Link>
        <span className="rounded-full bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur">
          {data.title || `${data.roomTypeName} · Virtual Tour 360°`}
        </span>
      </div>
    </div>
  );
}
