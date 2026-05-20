import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Save, Upload, Loader2, Trash2, Image as ImageIcon } from "lucide-react";
import { listSeoPages, upsertSeoPage } from "@/admin/modules/seo/seo.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/seo")({
  component: SeoPage,
});

type Page = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  og_image_url: string | null;
};

export function SeoPage() {
  const fn = useServerFn(listSeoPages);
  const upsert = useServerFn(upsertSeoPage);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["seo-pages"], queryFn: () => fn() });
  useRealtimeInvalidate("admin-seo-stream", ["seo_pages"], [["seo-pages"]]);

  type SeoInput = {
    id?: string;
    slug: string;
    title: string;
    description?: string | null;
    og_image_url?: string | null;
  };
  const m = useMutation({
    mutationFn: (v: SeoInput) => upsert({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-pages"] });
      toast.success("SEO saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">SEO</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page metadata</h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <a
            href="/sitemap.xml"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            sitemap.xml <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            llms.txt <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <div className="grid gap-4">
        {data.pages.map((p) => (
          <SeoRow key={p.id} page={p} onSave={(v) => m.mutate(v)} />
        ))}
      </div>
    </div>
  );
}

function SeoRow({ page, onSave }: { page: Page; onSave: (v: Page) => void }) {
  const [v, setV] = useState(page);
  const [uploading, setUploading] = useState(false);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-sm text-accent">{v.slug}</p>
        <Button size="sm" onClick={() => onSave(v)}>
          <Save className="mr-2 h-3.5 w-3.5" /> Save
        </Button>
      </div>
      <div className="mt-4 grid gap-3">
        <div>
          <Label className="text-xs">Title</Label>
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{v.title.length}/60</p>
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Textarea
            rows={2}
            value={v.description ?? ""}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {(v.description ?? "").length}/160
          </p>
        </div>
        <div>
          <Label className="text-xs">OG image URL</Label>
          <div className="mt-1 flex items-start gap-4">
            <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input bg-muted">
              {v.og_image_url ? (
                <img src={v.og_image_url} alt="OG Preview" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 text-sm"
                  value={v.og_image_url ?? ""}
                  onChange={(e) => setV({ ...v, og_image_url: e.target.value })}
                  placeholder="https://…"
                />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  id={`og-upload-${page.id}`}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!file.type.startsWith("image/")) {
                      toast.error("File harus berupa gambar");
                      return;
                    }
                    if (file.size > 2 * 1024 * 1024) {
                      toast.error("Ukuran gambar maksimal 2 MB");
                      return;
                    }
                    setUploading(true);
                    try {
                      const ext = file.name.split(".").pop() ?? "png";
                      const path = `seo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                      const { error } = await supabase.storage
                        .from("room-images")
                        .upload(path, file, { cacheControl: "3600", upsert: false });
                      if (error) throw error;
                      const { data } = supabase.storage.from("room-images").getPublicUrl(path);
                      setV({ ...v, og_image_url: data.publicUrl });
                      toast.success("Gambar OG berhasil diupload");
                    } catch (err) {
                      toast.error(`Upload gagal: ${(err as Error).message}`);
                    } finally {
                      setUploading(false);
                      e.target.value = "";
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 shrink-0"
                  disabled={uploading}
                  onClick={() => document.getElementById(`og-upload-${page.id}`)?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {uploading ? "Mengupload…" : "Upload"}
                </Button>
                {v.og_image_url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 text-destructive hover:text-destructive shrink-0"
                    disabled={uploading}
                    onClick={() => setV({ ...v, og_image_url: null })}
                  >
                    <Trash2 className="h-3 w-3" />
                    Hapus
                  </Button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Ukuran disarankan: 1200 x 630 piksel. Maksimal 2 MB.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
