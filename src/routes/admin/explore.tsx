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
