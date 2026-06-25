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

      <Card className="p-4 space-y-2">
        <div className="text-sm font-semibold">Entri City Guide</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : (data?.items?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">Belum ada entri.</div>
        ) : (
          <div className="space-y-2">
            {data!.items.map((it: any) => (
              <div
                key={it.id}
                className={`flex items-start gap-3 border rounded-md p-3 ${
                  it.is_published ? "bg-emerald-50/50 border-emerald-200" : "bg-stone-50 border-stone-200"
                }`}
              >
                {it.image_url ? (
                  <img
                    src={it.image_url}
                    alt={it.title}
                    className="w-20 h-20 object-cover rounded-md border flex-shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-md border bg-stone-100 flex items-center justify-center flex-shrink-0">
                    <ImageIcon className="h-6 w-6 text-stone-300" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] capitalize">{it.category}</Badge>
                    {it.is_published ? (
                      <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">PUBLISHED</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">DRAFT</Badge>
                    )}
                    {it.badge && <Badge variant="outline" className="text-[10px]">{it.badge}</Badge>}
                  </div>
                  <div className="font-medium text-sm mt-1">{it.title}</div>
                  {it.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{it.description}</div>
                  )}
                  <div className="flex gap-3 mt-1 text-[11px] text-stone-600">
                    {it.date_text && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{it.date_text}</span>}
                    {it.location_text && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{it.location_text}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {!it.image_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-indigo-600 border-indigo-200"
                      onClick={() => handleGenerateImage(it.id)}
                      disabled={generatingIds.has(it.id)}
                    >
                      {generatingIds.has(it.id) ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3 w-3 mr-1" />
                      )}
                      Generate gambar
                    </Button>
                  )}
                  <Button
                    size="sm" variant="outline" className="h-7"
                    onClick={() => handlePublishToggle(it.id, it.is_published)}
                  >
                    {it.is_published ? <><EyeOff className="h-3 w-3 mr-1" />Unpublish</> : <><Eye className="h-3 w-3 mr-1" />Publish</>}
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-7 text-red-600"
                    onClick={() => handleDelete(it.id)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />Hapus
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
