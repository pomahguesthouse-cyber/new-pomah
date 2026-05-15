import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Save } from "lucide-react";
import { listSeoPages, upsertSeoPage } from "@/modules/seo/seo.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/seo")({
  component: SeoPage,
});

type Page = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  og_image_url: string | null;
};

function SeoPage() {
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
          <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            sitemap.xml <ExternalLink className="h-3 w-3" />
          </a>
          <a href="/llms.txt" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
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
          <Input
            value={v.og_image_url ?? ""}
            onChange={(e) => setV({ ...v, og_image_url: e.target.value })}
            placeholder="https://…"
          />
        </div>
      </div>
    </Card>
  );
}
