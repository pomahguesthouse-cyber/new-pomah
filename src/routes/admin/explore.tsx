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
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, MapPin, Coffee, Calendar, Newspaper } from "lucide-react";

import {
  listExploreItems,
  createExploreItem,
  updateExploreItem,
  deleteExploreItem,
  type ExploreCategory,
  type ExploreItem,
} from "@/admin/modules/explore/explore.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/explore")({
  head: () => ({ meta: [{ title: "Explore Content — Admin" }] }),
  component: ExploreAdminPage,
});

const CATEGORY_META: Record<ExploreCategory, { label: string; icon: typeof MapPin }> = {
  destination: { label: "Destinasi Wisata", icon: MapPin },
  culinary: { label: "Kuliner", icon: Coffee },
  event: { label: "Event", icon: Calendar },
  news: { label: "Berita", icon: Newspaper },
};

const CATEGORIES: ExploreCategory[] = ["destination", "culinary", "event", "news"];

type FormState = {
  id?: string;
  category: ExploreCategory;
  title: string;
  description: string;
  image_url: string;
  rating: string;
  badge: string;
  date_text: string;
  location_text: string;
  sort_order: number;
  is_published: boolean;
};

function emptyForm(category: ExploreCategory): FormState {
  return {
    category,
    title: "",
    description: "",
    image_url: "",
    rating: "",
    badge: "",
    date_text: "",
    location_text: "",
    sort_order: 0,
    is_published: true,
  };
}

function ExploreAdminPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listExploreItems);
  const createFn = useServerFn(createExploreItem);
  const updateFn = useServerFn(updateExploreItem);
  const deleteFn = useServerFn(deleteExploreItem);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["admin-explore-items"],
    queryFn: () => listFn(),
  });

  const [tab, setTab] = useState<ExploreCategory>("destination");
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExploreItem | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-explore-items"] });
    qc.invalidateQueries({ queryKey: ["public-explore-items"] });
  };

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const payload = {
        category: f.category,
        title: f.title.trim(),
        description: f.description.trim() || null,
        image_url: f.image_url.trim() || null,
        rating: f.rating.trim() === "" ? null : Number(f.rating),
        badge: f.badge.trim() || null,
        date_text: f.date_text.trim() || null,
        location_text: f.location_text.trim() || null,
        sort_order: Number(f.sort_order) || 0,
        is_published: f.is_published,
      };
      if (f.id) {
        await updateFn({ data: { id: f.id, patch: payload } });
      } else {
        await createFn({ data: payload });
      }
    },
    onSuccess: () => {
      toast.success("Tersimpan");
      setForm(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Dihapus");
      setConfirmDelete(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Gagal menghapus"),
  });

  const togglePublish = (item: ExploreItem) => {
    updateFn({ data: { id: item.id, patch: { is_published: !item.is_published } } })
      .then(() => {
        toast.success(item.is_published ? "Disembunyikan" : "Diterbitkan");
        invalidate();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal mengubah status"));
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Explore Content</h1>
          <p className="text-sm text-muted-foreground">
            Kelola konten halaman <span className="font-mono">/explore</span> — destinasi, kuliner,
            event, dan berita.
          </p>
        </div>
        <Button onClick={() => setForm(emptyForm(tab))}>
          <Plus className="mr-2 h-4 w-4" /> Tambah Item
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ExploreCategory)}>
        <TabsList className="grid w-full grid-cols-4">
          {CATEGORIES.map((c) => {
            const Icon = CATEGORY_META[c].icon;
            return (
              <TabsTrigger key={c} value={c} className="gap-2">
                <Icon className="h-4 w-4" /> {CATEGORY_META[c].label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CATEGORIES.map((c) => {
          const list = items.filter((i) => i.category === c);
          return (
            <TabsContent key={c} value={c} className="mt-6">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Memuat…</p>
              ) : list.length === 0 ? (
                <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
                  Belum ada item. Klik "Tambah Item" untuk membuat.
                </div>
              ) : (
                <div className="space-y-2">
                  {list.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 rounded-lg border bg-card p-4"
                    >
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.title}
                          className="h-16 w-16 rounded object-cover"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-medium">{item.title}</h3>
                          {!item.is_published && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                              Draft
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-1 text-sm text-muted-foreground">
                          {item.description ?? "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Urutan: {item.sort_order}
                          {item.rating != null && ` · ⭐ ${item.rating}`}
                          {item.badge && ` · ${item.badge}`}
                          {item.date_text && ` · ${item.date_text}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => togglePublish(item)}
                          title={item.is_published ? "Sembunyikan" : "Terbitkan"}
                        >
                          {item.is_published ? (
                            <Eye className="h-4 w-4" />
                          ) : (
                            <EyeOff className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setForm({
                              id: item.id,
                              category: item.category,
                              title: item.title,
                              description: item.description ?? "",
                              image_url: item.image_url ?? "",
                              rating: item.rating != null ? String(item.rating) : "",
                              badge: item.badge ?? "",
                              date_text: item.date_text ?? "",
                              location_text: item.location_text ?? "",
                              sort_order: item.sort_order,
                              is_published: item.is_published,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setConfirmDelete(item)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Editor Dialog */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit Item" : "Tambah Item"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Kategori</Label>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as ExploreCategory })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_META[c].label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label>Judul *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="contoh: Lawang Sewu"
                />
              </div>

              <div className="grid gap-2">
                <Label>Deskripsi</Label>
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label>URL Gambar</Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Rating (0–5)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={form.rating}
                    onChange={(e) => setForm({ ...form, rating: e.target.value })}
                    placeholder="khusus destinasi"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Badge / Kategori Mini</Label>
                  <Input
                    value={form.badge}
                    onChange={(e) => setForm({ ...form, badge: e.target.value })}
                    placeholder="khusus kuliner — Cemilan, dll"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Tanggal (teks)</Label>
                  <Input
                    value={form.date_text}
                    onChange={(e) => setForm({ ...form, date_text: e.target.value })}
                    placeholder="event/berita — 15 Agustus 2026"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Lokasi</Label>
                  <Input
                    value={form.location_text}
                    onChange={(e) => setForm({ ...form, location_text: e.target.value })}
                    placeholder="khusus event"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Urutan</Label>
                  <Input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) =>
                      setForm({ ...form, sort_order: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Switch
                    checked={form.is_published}
                    onCheckedChange={(v) => setForm({ ...form, is_published: v })}
                  />
                  <Label>Diterbitkan</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Batal
            </Button>
            <Button
              disabled={!form?.title.trim() || saveMut.isPending}
              onClick={() => form && saveMut.mutate(form)}
            >
              {saveMut.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus item ini?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title}" akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
