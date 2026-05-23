import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { MediaPicker } from "@/admin/components/media-picker";
import { getPropertySettings, updatePropertySettings } from "@/admin/modules/settings/settings.functions";
import { ExploreConfig, mergeExploreConfig } from "@/admin/modules/explore/explore.config";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";

export const Route = createFileRoute("/admin/explore")({
  component: AdminExplorePage,
});

function AdminExplorePage() {
  const getFn = useServerFn(getPropertySettings);
  const updateFn = useServerFn(updatePropertySettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["property-settings"],
    queryFn: () => getFn(),
  });
  useRealtimeInvalidate("admin-explore-stream", ["properties"], [["property-settings"], ["public-site"]]);

  const mutation = useMutation({
    mutationFn: (v: { id: string; explore_config: any }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-settings"] });
      qc.invalidateQueries({ queryKey: ["public-site"] });
      toast.success("Berhasil disimpan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [config, setConfig] = useState<ExploreConfig | null>(null);

  // Sync state on load
  if (data && !config && !isLoading) {
    setConfig(mergeExploreConfig((data as any).explore_config));
  }

  if (isLoading || !config) return <p className="p-6 text-sm text-muted-foreground">Memuat...</p>;

  const id = data?.id;

  const handleSave = () => {
    if (!id) return;
    mutation.mutate({ id, explore_config: config });
  };

  return (
    <div className="space-y-6 p-6 md:p-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">City Guide</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Jelajahi Semarang</h1>
        </div>
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
        </Button>
      </div>

      {/* Hero Section */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg">Hero Banner</h2>
        <Card className="p-5 space-y-4 max-w-2xl">
          <div>
            <label className="text-sm font-medium">Judul</label>
            <Input
              value={config.hero.heading}
              onChange={(e) => setConfig({ ...config, hero: { ...config.hero, heading: e.target.value } })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Sub-judul</label>
            <Textarea
              value={config.hero.subheading}
              onChange={(e) => setConfig({ ...config, hero: { ...config.hero, subheading: e.target.value } })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Gambar Latar (Background)</label>
            <MediaPicker
              value={config.hero.bgImageUrl}
              onChange={(url) => setConfig({ ...config, hero: { ...config.hero, bgImageUrl: url || "" } })}
            />
          </div>
        </Card>
      </section>

      {/* Destinations */}
      <section className="space-y-4">
        <div className="flex items-center justify-between max-w-4xl">
          <h2 className="font-semibold text-lg">Destinasi Wisata</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setConfig({
                ...config,
                destinations: [...config.destinations, { name: "", desc: "", image: "", rating: "5.0" }],
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Tambah Destinasi
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 max-w-5xl">
          {config.destinations.map((dest, i) => (
            <Card key={i} className="p-4 space-y-4 relative">
              <Button
                size="icon"
                variant="destructive"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                onClick={() =>
                  setConfig({ ...config, destinations: config.destinations.filter((_, idx) => idx !== i) })
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
              <MediaPicker
                value={dest.image}
                onChange={(url) => {
                  const newDests = [...config.destinations];
                  newDests[i].image = url || "";
                  setConfig({ ...config, destinations: newDests });
                }}
              />
              <Input
                placeholder="Nama Destinasi"
                value={dest.name}
                onChange={(e) => {
                  const newDests = [...config.destinations];
                  newDests[i].name = e.target.value;
                  setConfig({ ...config, destinations: newDests });
                }}
              />
              <Textarea
                placeholder="Deskripsi Singkat"
                className="h-20 text-sm"
                value={dest.desc}
                onChange={(e) => {
                  const newDests = [...config.destinations];
                  newDests[i].desc = e.target.value;
                  setConfig({ ...config, destinations: newDests });
                }}
              />
              <div className="flex items-center gap-2">
                <span className="text-sm">Rating:</span>
                <Input
                  className="w-20"
                  placeholder="4.8"
                  value={dest.rating}
                  onChange={(e) => {
                    const newDests = [...config.destinations];
                    newDests[i].rating = e.target.value;
                    setConfig({ ...config, destinations: newDests });
                  }}
                />
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Culinary */}
      <section className="space-y-4">
        <div className="flex items-center justify-between max-w-4xl">
          <h2 className="font-semibold text-lg">Kuliner Terbaik</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setConfig({
                ...config,
                culinary: [...config.culinary, { name: "", desc: "", image: "", category: "Cemilan" }],
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Tambah Kuliner
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 max-w-5xl">
          {config.culinary.map((cul, i) => (
            <Card key={i} className="p-4 space-y-4 relative">
              <Button
                size="icon"
                variant="destructive"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                onClick={() =>
                  setConfig({ ...config, culinary: config.culinary.filter((_, idx) => idx !== i) })
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
              <MediaPicker
                value={cul.image}
                onChange={(url) => {
                  const newCul = [...config.culinary];
                  newCul[i].image = url || "";
                  setConfig({ ...config, culinary: newCul });
                }}
              />
              <Input
                placeholder="Nama Kuliner"
                value={cul.name}
                onChange={(e) => {
                  const newCul = [...config.culinary];
                  newCul[i].name = e.target.value;
                  setConfig({ ...config, culinary: newCul });
                }}
              />
              <Input
                placeholder="Kategori (Makan Siang/Malam/Cemilan)"
                value={cul.category}
                onChange={(e) => {
                  const newCul = [...config.culinary];
                  newCul[i].category = e.target.value;
                  setConfig({ ...config, culinary: newCul });
                }}
              />
              <Textarea
                placeholder="Deskripsi Singkat"
                className="h-20 text-sm"
                value={cul.desc}
                onChange={(e) => {
                  const newCul = [...config.culinary];
                  newCul[i].desc = e.target.value;
                  setConfig({ ...config, culinary: newCul });
                }}
              />
            </Card>
          ))}
        </div>
      </section>

      {/* Events & News Container */}
      <div className="grid gap-8 lg:grid-cols-2 max-w-5xl">
        {/* Events */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Event Mendatang</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setConfig({
                  ...config,
                  events: [...config.events, { title: "", date: "", location: "", desc: "" }],
                })
              }
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-4">
            {config.events.map((ev, i) => (
              <Card key={i} className="p-4 space-y-3 relative">
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                  onClick={() => setConfig({ ...config, events: config.events.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Nama Event"
                    value={ev.title}
                    onChange={(e) => {
                      const newEv = [...config.events];
                      newEv[i].title = e.target.value;
                      setConfig({ ...config, events: newEv });
                    }}
                  />
                  <Input
                    placeholder="Tanggal (mis. 15 Agustus 2026)"
                    value={ev.date}
                    onChange={(e) => {
                      const newEv = [...config.events];
                      newEv[i].date = e.target.value;
                      setConfig({ ...config, events: newEv });
                    }}
                  />
                </div>
                <Input
                  placeholder="Lokasi"
                  value={ev.location}
                  onChange={(e) => {
                    const newEv = [...config.events];
                    newEv[i].location = e.target.value;
                    setConfig({ ...config, events: newEv });
                  }}
                />
                <Textarea
                  placeholder="Deskripsi Singkat"
                  className="h-16 text-sm"
                  value={ev.desc}
                  onChange={(e) => {
                    const newEv = [...config.events];
                    newEv[i].desc = e.target.value;
                    setConfig({ ...config, events: newEv });
                  }}
                />
              </Card>
            ))}
          </div>
        </section>

        {/* News */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Berita Lainnya</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setConfig({
                  ...config,
                  news: [...config.news, { title: "", date: "", desc: "", url: "#" }],
                })
              }
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-4">
            {config.news.map((nw, i) => (
              <Card key={i} className="p-4 space-y-3 relative">
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                  onClick={() => setConfig({ ...config, news: config.news.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Judul Berita"
                    value={nw.title}
                    onChange={(e) => {
                      const newNw = [...config.news];
                      newNw[i].title = e.target.value;
                      setConfig({ ...config, news: newNw });
                    }}
                  />
                  <Input
                    placeholder="Tanggal (mis. 10 Mei 2026)"
                    value={nw.date}
                    onChange={(e) => {
                      const newNw = [...config.news];
                      newNw[i].date = e.target.value;
                      setConfig({ ...config, news: newNw });
                    }}
                  />
                </div>
                <Input
                  placeholder="URL Artikel (https://...)"
                  value={nw.url}
                  onChange={(e) => {
                    const newNw = [...config.news];
                    newNw[i].url = e.target.value;
                    setConfig({ ...config, news: newNw });
                  }}
                />
                <Textarea
                  placeholder="Deskripsi Singkat"
                  className="h-16 text-sm"
                  value={nw.desc}
                  onChange={(e) => {
                    const newNw = [...config.news];
                    newNw[i].desc = e.target.value;
                    setConfig({ ...config, news: newNw });
                  }}
                />
              </Card>
            ))}
          </div>
        </section>
      </div>
      <div className="pb-10"></div>
    </div>
  );
}
