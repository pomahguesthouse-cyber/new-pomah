/**
 * Admin → Content Manager
 *
 * Dashboard untuk Content Manager Agent: trigger discovery per kategori,
 * review draft yang dihasilkan, publish/unpublish, hapus.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Newspaper, Sparkles, Loader2, Eye, EyeOff, Trash2, MapPin, Calendar,
  ImageIcon,
} from "lucide-react";
import {
  runContentDiscovery,
  listExploreItemsForAdmin,
  toggleExplorePublish,
  deleteExploreItem,
  generateExploreImageFn,
} from "@/admin/functions/content.functions";

export const Route = createFileRoute("/admin/content-manager")({
  component: ContentManagerPage,
});

const CATEGORIES = [
  { value: "event",     label: "Event" },
  { value: "destinasi", label: "Destinasi" },
  { value: "kuliner",   label: "Kuliner" },
  { value: "tips",      label: "Tips" },
] as const;

function ContentManagerPage() {
  const runFn = useServerFn(runContentDiscovery);
  const listFn = useServerFn(listExploreItemsForAdmin);
  const toggleFn = useServerFn(toggleExplorePublish);
  const deleteFn = useServerFn(deleteExploreItem);
  const generateImageFn = useServerFn(generateExploreImageFn);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["explore-items-admin"],
    queryFn: () => listFn(),
  });

  const purgedCount = (data as any)?.purgedCount ?? 0;

  const [category, setCategory] = useState<typeof CATEGORIES[number]["value"]>("event");
  const [extra, setExtra] = useState("");
  const [running, setRunning] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [agentLog, setAgentLog] = useState<{ reply: string; tools: string[] } | null>(null);

  async function handleRun() {
    setRunning(true);
    setAgentLog(null);
    try {
      const res: any = await runFn({ data: { category, extra_keywords: extra || undefined } });
      if (!res?.ok) throw new Error(res?.error ?? "Gagal");
      setAgentLog({ reply: res.reply ?? "", tools: res.toolsUsed ?? [] });
      qc.invalidateQueries({ queryKey: ["explore-items-admin"] });
      toast.success("Content discovery selesai");
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setRunning(false);
    }
  }

  async function handlePublishToggle(id: string, current: boolean) {
    try {
      await toggleFn({ data: { id, publish: !current } });
      qc.invalidateQueries({ queryKey: ["explore-items-admin"] });
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Hapus entri ini?")) return;
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["explore-items-admin"] });
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }

  async function handleGenerateImage(id: string) {
    setGeneratingIds((prev) => new Set(prev).add(id));
    try {
      await generateImageFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["explore-items-admin"] });
      toast.success("Gambar berhasil digenerate");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal generate gambar");
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Newspaper className="h-5 w-5 text-emerald-700" />
        <h1 className="text-lg font-semibold">Content Manager — City Guide</h1>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-amber-600" />
          Jalankan Content Discovery
        </div>
        <p className="text-xs text-muted-foreground">
          Content Manager Agent akan mencari konten terbaru via web search, hindari duplikat dengan entri existing,
          dan menulis 2-5 entri baru (draft, perlu publish manual).
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as any)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <Input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Keyword tambahan opsional (mis. 'kota lama', 'akhir pekan')"
            className="flex-1 min-w-[200px]"
            disabled={running}
          />
          <Button onClick={handleRun} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Run Agent
          </Button>
        </div>
        {agentLog && (
          <div className="rounded-md border bg-stone-50 p-3 text-xs">
            <div className="font-semibold mb-1">Ringkasan dari Agent:</div>
            <div className="whitespace-pre-wrap text-stone-700">{agentLog.reply}</div>
            {agentLog.tools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {agentLog.tools.map((t) => (
                  <span key={t} className="text-[10px] bg-stone-200 px-1.5 py-0.5 rounded">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-3 md:p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Entri City Guide</div>
          {purgedCount > 0 && (
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
              {purgedCount} event lewat tanggal otomatis dihapus
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : (data?.items?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">Belum ada entri.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
            {data!.items.map((it: any) => (
              <div
                key={it.id}
                className={`flex flex-col border rounded-md overflow-hidden ${
                  it.is_published ? "bg-emerald-50/50 border-emerald-200" : "bg-stone-50 border-stone-200"
                }`}
              >
                {it.image_url ? (
                  <img
                    src={it.image_url}
                    alt={it.title}
                    className="w-full aspect-[4/3] object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full aspect-[4/3] bg-stone-100 flex items-center justify-center">
                    <ImageIcon className="h-6 w-6 text-stone-300" />
                  </div>
                )}
                <div className="p-2 flex-1 flex flex-col min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant="outline" className="text-[9px] capitalize px-1 py-0">{it.category}</Badge>
                    {it.is_published ? (
                      <Badge className="bg-emerald-100 text-emerald-700 text-[9px] px-1 py-0">PUB</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-700 border-amber-300">DRAFT</Badge>
                    )}
                  </div>
                  <div className="font-medium text-xs md:text-sm mt-1 line-clamp-2">{it.title}</div>
                  <div className="mt-1 space-y-0.5 text-[10px] text-stone-600">
                    {it.date_text && (
                      <div className="flex items-center gap-1 truncate">
                        <Calendar className="h-3 w-3 shrink-0" />
                        <span className="truncate">{it.date_text}</span>
                      </div>
                    )}
                    {it.location_text && (
                      <div className="flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{it.location_text}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {!it.image_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-1.5 text-[10px] text-indigo-600 border-indigo-200"
                        onClick={() => handleGenerateImage(it.id)}
                        disabled={generatingIds.has(it.id)}
                      >
                        {generatingIds.has(it.id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ImageIcon className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm" variant="outline" className="h-6 px-1.5 text-[10px]"
                      onClick={() => handlePublishToggle(it.id, it.is_published)}
                    >
                      {it.is_published ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-6 px-1.5 text-[10px] text-red-600"
                      onClick={() => handleDelete(it.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
