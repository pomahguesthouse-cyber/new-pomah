import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CITY_GUIDE_ARTICLES } from "@/public/content/approved-seo";
import {
  deleteLandingBrief,
  deleteSeoLandmark,
  generateLandingFromBrief,
  listLandingBriefs,
  listSeoLandmarks,
  saveLandingBrief,
  saveSeoLandmark,
  type LandingBrief,
  type LandmarkRow,
} from "@/admin/modules/seo/landing-briefs.functions";
import { FIXTURE_BRIEFS, FIXTURE_LANDMARKS } from "@/admin/modules/seo/builder-fixture";
import { isPbFixtureRequest } from "@/admin/modules/seo/builder-layout";

type BriefDraft = {
  id?: string;
  primary_keyword: string;
  secondary_keywords: string;
  intent: string;
  slug: string;
  target_audience: string;
  unique_angle: string;
  landmark_ids: string[];
  faq_seeds: string;
  review_keywords: string;
  explore_slugs: string[];
  min_capacity: number;
  status: LandingBrief["status"];
};

const emptyBrief = (): BriefDraft => ({
  primary_keyword: "",
  secondary_keywords: "",
  intent: "",
  slug: "",
  target_audience: "",
  unique_angle: "",
  landmark_ids: [],
  faq_seeds: "",
  review_keywords: "wisuda, keluarga",
  explore_slugs: [],
  min_capacity: 0,
  status: "draft",
});

function fromRow(row: LandingBrief): BriefDraft {
  return {
    id: row.id,
    primary_keyword: row.primary_keyword,
    secondary_keywords: (row.secondary_keywords ?? []).join(", "),
    intent: row.intent ?? "",
    slug: row.slug,
    target_audience: row.target_audience ?? "",
    unique_angle: row.unique_angle ?? "",
    landmark_ids: row.landmark_ids ?? [],
    faq_seeds: (row.faq_seeds ?? []).join("\n"),
    review_keywords: (row.review_keywords ?? []).join(", "),
    explore_slugs: row.explore_slugs ?? [],
    min_capacity: row.min_capacity ?? 0,
    status: row.status,
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function LandingBriefsAdmin({
  onGenerated,
  initialTab = "brief",
}: {
  onGenerated?: () => void;
  initialTab?: "brief" | "landmark";
}) {
  const [tab, setTab] = useState<"brief" | "landmark">(initialTab);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 border-b border-stone-200 px-1 pb-2">
        <button
          type="button"
          className={`min-h-10 flex-1 rounded px-3 text-sm font-semibold ${tab === "brief" ? "bg-teal-700 text-white" : "bg-stone-100"}`}
          onClick={() => setTab("brief")}
        >
          Brief keyword
        </button>
        <button
          type="button"
          className={`min-h-10 flex-1 rounded px-3 text-sm font-semibold ${tab === "landmark" ? "bg-teal-700 text-white" : "bg-stone-100"}`}
          onClick={() => setTab("landmark")}
        >
          Landmark
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pt-3">
        {tab === "brief" ? <BriefTab onGenerated={onGenerated} /> : <LandmarkTab />}
      </div>
    </div>
  );
}

function BriefTab({ onGenerated }: { onGenerated?: () => void }) {
  const fixture = isPbFixtureRequest();
  const listFn = useServerFn(listLandingBriefs);
  const saveFn = useServerFn(saveLandingBrief);
  const deleteFn = useServerFn(deleteLandingBrief);
  const generateFn = useServerFn(generateLandingFromBrief);
  const landmarkFn = useServerFn(listSeoLandmarks);
  const query = useQuery({ queryKey: ["landing-briefs"], queryFn: () => listFn(), enabled: !fixture });
  const landmarks = useQuery({ queryKey: ["seo-landmarks-admin"], queryFn: () => landmarkFn(), enabled: !fixture });
  const [draft, setDraft] = useState<BriefDraft>(() =>
    fixture && FIXTURE_BRIEFS[0] ? fromRow(FIXTURE_BRIEFS[0]) : emptyBrief(),
  );
  const [busy, setBusy] = useState(false);

  const save = async (status: LandingBrief["status"]) => {
    if (fixture) {
      toast.success("Pratinjau: brief tidak disimpan");
      return;
    }
    const slug = draft.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!draft.primary_keyword.trim() || !slug) {
      toast.error("Keyword utama dan slug wajib diisi.");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveFn({
        data: {
          id: draft.id,
          primary_keyword: draft.primary_keyword.trim(),
          secondary_keywords: splitList(draft.secondary_keywords),
          intent: draft.intent,
          slug,
          target_audience: draft.target_audience,
          unique_angle: draft.unique_angle,
          landmark_ids: draft.landmark_ids,
          faq_seeds: draft.faq_seeds.split("\n").map((line) => line.trim()).filter(Boolean),
          review_keywords: splitList(draft.review_keywords),
          explore_slugs: draft.explore_slugs,
          room_type_ids: [],
          min_capacity: draft.min_capacity > 0 ? draft.min_capacity : null,
          status,
        },
      });
      setDraft((current) => ({ ...current, id: saved.id, slug, status }));
      await query.refetch();
      toast.success(status === "approved" ? "Brief disetujui" : "Brief tersimpan");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (fixture) {
      toast.success("Pratinjau: generate tidak dijalankan");
      return;
    }
    if (!draft.id || draft.status !== "approved") {
      toast.error("Setujui brief dulu sebelum generate.");
      return;
    }
    setBusy(true);
    try {
      const result = await generateFn({ data: { briefId: draft.id } });
      toast.success(`Draf dibuat di /lp/${result.slug}. Belum dipublikasikan dan noindex.`);
      setDraft((current) => ({ ...current, status: "generated" }));
      await query.refetch();
      onGenerated?.();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const briefs = fixture ? FIXTURE_BRIEFS : (query.data?.briefs ?? []);
  const landmarkRows = fixture ? FIXTURE_LANDMARKS : (landmarks.data?.landmarks ?? []);
  return (
    <div className="flex h-full min-h-0 flex-col">
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto min-[800px]:grid-cols-[minmax(0,200px)_minmax(0,1fr)] min-[800px]:overflow-hidden">
      <div className="max-h-48 space-y-2 overflow-y-auto min-[800px]:max-h-full">
        <Button type="button" size="sm" variant="outline" className="h-10 w-full" onClick={() => setDraft(emptyBrief())}>
          Brief baru
        </Button>
        {query.data?.missing ? (
          <p className="text-[11px] text-amber-800">Tabel brief belum ada. Jalankan migrasi SQL setelah deploy.</p>
        ) : null}
        {briefs.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setDraft(fromRow(row))}
            className="block min-h-10 w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50"
          >
            <span className="block break-words font-medium">{row.primary_keyword}</span>
            <span className="text-stone-500">{row.status}</span>
          </button>
        ))}
      </div>
      <div className="min-w-0 space-y-3 min-[800px]:overflow-y-auto">
        <Field label="Keyword utama">
          <Input value={draft.primary_keyword} onChange={(e) => setDraft({ ...draft, primary_keyword: e.target.value })} />
        </Field>
        <Field label="Keyword sekunder" hint="Pisahkan dengan koma.">
          <Input value={draft.secondary_keywords} onChange={(e) => setDraft({ ...draft, secondary_keywords: e.target.value })} />
        </Field>
        <div className="grid gap-3 min-[480px]:grid-cols-2">
          <Field label="Intent">
            <Input value={draft.intent} onChange={(e) => setDraft({ ...draft, intent: e.target.value })} placeholder="menginap keluarga" />
          </Field>
          <Field label="Slug">
            <Input
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
            />
          </Field>
        </div>
        <Field label="Target pembaca">
          <Input value={draft.target_audience} onChange={(e) => setDraft({ ...draft, target_audience: e.target.value })} />
        </Field>
        <Field label="Sudut unik">
          <Textarea value={draft.unique_angle} rows={2} onChange={(e) => setDraft({ ...draft, unique_angle: e.target.value })} />
        </Field>
        <Field label="Benih FAQ" hint="Satu pertanyaan WhatsApp per baris.">
          <Textarea value={draft.faq_seeds} rows={4} onChange={(e) => setDraft({ ...draft, faq_seeds: e.target.value })} />
        </Field>
        <Field label="Kata kunci ulasan">
          <Input value={draft.review_keywords} onChange={(e) => setDraft({ ...draft, review_keywords: e.target.value })} />
        </Field>
        <Field label="Kapasitas minimum kamar">
          <NumericInput
            value={draft.min_capacity}
            min={0}
            max={20}
            onValueChange={(min_capacity) => setDraft({ ...draft, min_capacity })}
          />
        </Field>
        <Field label="Landmark">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {landmarkRows.map((row) => (
              <label key={row.id} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-teal-700"
                  checked={draft.landmark_ids.includes(row.id)}
                  onChange={() => {
                    const has = draft.landmark_ids.includes(row.id);
                    setDraft({
                      ...draft,
                      landmark_ids: has
                        ? draft.landmark_ids.filter((id) => id !== row.id)
                        : [...draft.landmark_ids, row.id],
                    });
                  }}
                />
                <span className="break-words">
                  {row.name}
                  {row.verified ? "" : " (belum diverifikasi)"}
                </span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Artikel /explore">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {CITY_GUIDE_ARTICLES.map((article) => (
              <label key={article.canonicalSlug} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-teal-700"
                  checked={draft.explore_slugs.includes(article.canonicalSlug)}
                  onChange={() => {
                    const has = draft.explore_slugs.includes(article.canonicalSlug);
                    setDraft({
                      ...draft,
                      explore_slugs: has
                        ? draft.explore_slugs.filter((slug) => slug !== article.canonicalSlug)
                        : [...draft.explore_slugs, article.canonicalSlug],
                    });
                  }}
                />
                <span className="break-words">{article.title}</span>
              </label>
            ))}
          </div>
        </Field>
        <p className="text-[11px] text-stone-500">Status: {draft.status}. Generate hanya jalan setelah brief disetujui.</p>
      </div>
    </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-stone-200 bg-white py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" size="sm" variant="outline" className="h-10" disabled={busy} onClick={() => save("draft")}>
            Simpan draf
          </Button>
          <Button type="button" size="sm" className="h-10" disabled={busy} onClick={() => save("approved")}>
            Setujui
          </Button>
          <Button type="button" size="sm" className="h-10 bg-teal-700 text-white" disabled={busy || draft.status !== "approved"} onClick={generate}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}
          </Button>
          {draft.id ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10"
              disabled={busy}
              onClick={async () => {
                if (!draft.id) return;
                if (fixture) {
                  toast.success("Pratinjau: brief tidak dihapus");
                  return;
                }
                setBusy(true);
                try {
                  await deleteFn({ data: { id: draft.id } });
                  setDraft(emptyBrief());
                  await query.refetch();
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Hapus
            </Button>
          ) : null}
        </div>
    </div>
  );
}

function LandmarkTab() {
  const fixture = isPbFixtureRequest();
  const listFn = useServerFn(listSeoLandmarks);
  const saveFn = useServerFn(saveSeoLandmark);
  const deleteFn = useServerFn(deleteSeoLandmark);
  const query = useQuery({ queryKey: ["seo-landmarks-admin"], queryFn: () => listFn(), enabled: !fixture });
  const [row, setRow] = useState<Partial<LandmarkRow>>({ name: "", category: "kampus", verified: false, sort_order: 0 });
  const [busy, setBusy] = useState(false);
  const landmarks = fixture ? FIXTURE_LANDMARKS : (query.data?.landmarks ?? []);

  const save = async () => {
    if (fixture) {
      toast.success("Pratinjau: landmark tidak disimpan");
      return;
    }
    if (!row.name?.trim()) {
      toast.error("Nama landmark wajib diisi.");
      return;
    }
    setBusy(true);
    try {
      await saveFn({
        data: {
          id: row.id,
          name: row.name.trim(),
          category: row.category || "lainnya",
          lat: row.lat ?? null,
          lng: row.lng ?? null,
          road_distance_km: row.road_distance_km ?? null,
          travel_minutes: row.travel_minutes ?? null,
          verified: row.verified === true,
          notes: row.notes ?? null,
          sort_order: row.sort_order ?? 0,
        },
      });
      toast.success("Landmark tersimpan");
      setRow({ name: "", category: "kampus", verified: false, sort_order: 0 });
      await query.refetch();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      {query.data?.missing ? (
        <p className="text-[11px] text-amber-800">Tabel landmark belum ada. Jalankan migrasi SQL setelah deploy.</p>
      ) : null}
      <p className="text-[11px] text-stone-600">
        Centang verified hanya setelah jarak jalan dan waktu tempuh dicek. Angka yang belum diverifikasi tidak boleh masuk halaman publik.
      </p>
      <div className="grid gap-2 min-[480px]:grid-cols-2">
        <Field label="Nama">
          <Input value={row.name ?? ""} onChange={(e) => setRow({ ...row, name: e.target.value })} />
        </Field>
        <Field label="Kategori">
          <Input value={row.category ?? ""} onChange={(e) => setRow({ ...row, category: e.target.value })} />
        </Field>
        <Field label="Latitude">
          <Input value={row.lat ?? ""} onChange={(e) => setRow({ ...row, lat: e.target.value === "" ? null : Number(e.target.value) })} />
        </Field>
        <Field label="Longitude">
          <Input value={row.lng ?? ""} onChange={(e) => setRow({ ...row, lng: e.target.value === "" ? null : Number(e.target.value) })} />
        </Field>
        <Field label="Jarak jalan (km)">
          <Input
            value={row.road_distance_km ?? ""}
            onChange={(e) => setRow({ ...row, road_distance_km: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
        <Field label="Menit berkendara">
          <Input
            value={row.travel_minutes ?? ""}
            onChange={(e) => setRow({ ...row, travel_minutes: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field label="Catatan">
        <Textarea value={row.notes ?? ""} rows={2} onChange={(e) => setRow({ ...row, notes: e.target.value })} />
      </Field>
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <span className="text-xs font-medium">Sudah diverifikasi</span>
        <Switch checked={row.verified === true} onCheckedChange={(verified) => setRow({ ...row, verified })} />
      </div>
      <ul className="space-y-2">
        {landmarks.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
            <button type="button" className="min-h-10 min-w-0 flex-1 text-left" onClick={() => setRow(item)}>
              <span className="block break-words font-medium">{item.name}</span>
              <span className={item.verified ? "text-emerald-700" : "text-amber-700"}>
                {item.verified ? "terverifikasi" : "belum diverifikasi"}
                {item.road_distance_km != null ? ` · ${item.road_distance_km} km` : ""}
                {item.category ? ` · ${item.category}` : ""}
              </span>
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 shrink-0 items-center px-3 text-sm text-red-600"
              onClick={async () => {
                if (fixture) {
                  toast.success("Pratinjau: landmark tidak dihapus");
                  return;
                }
                await deleteFn({ data: { id: item.id } });
                await query.refetch();
              }}
            >
              Hapus
            </button>
          </li>
        ))}
      </ul>
    </div>
      <div className="flex shrink-0 border-t border-stone-200 bg-white py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="button" size="sm" className="h-10" disabled={busy} onClick={save}>
          Simpan landmark
        </Button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
