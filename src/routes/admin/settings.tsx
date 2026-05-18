import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Globe,
  ExternalLink,
  Check,
  Pencil,
  X,
  Upload,
  Trash2,
  Loader2,
  Image as ImageIcon,
  MessageCircle,
  MapPin,
  BarChart3,
  Tag,
  Search,
  Sparkles,
} from "lucide-react";
import { getPublicSiteData } from "@/public/functions/public.functions";
import {
  getDomainSettings,
  updateDomainSettings,
  getBrandingSettings,
  updateBrandingSettings,
  getIntegrationSettings,
  updateIntegrationSettings,
} from "@/admin/modules/settings/settings.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Storage bucket reused for branding assets (logos / favicon). */
const BRANDING_BUCKET = "room-images";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Konfigurasi
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
      </header>

      <Tabs defaultValue="properti" className="space-y-6">
        <TabsList>
          <TabsTrigger value="properti">Properti</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="integrasi">Integrasi</TabsTrigger>
          <TabsTrigger value="domain">Domain</TabsTrigger>
        </TabsList>

        <TabsContent value="properti">
          <PropertyTab />
        </TabsContent>

        <TabsContent value="branding">
          <BrandingTab />
        </TabsContent>

        <TabsContent value="integrasi">
          <IntegrationTab />
        </TabsContent>

        <TabsContent value="domain">
          <DomainTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Properti tab                                                         */
/* ------------------------------------------------------------------ */

function PropertyTab() {
  const fn = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fn() });
  useRealtimeInvalidate("admin-settings-stream", ["properties"], [["public-site"]]);
  const p = data?.property;

  return (
    <div className="space-y-4">
      <Card className="max-w-2xl divide-y divide-border p-0">
        {(
          [
            ["Name", p?.name],
            ["Tagline", p?.tagline],
            ["Address", p?.address],
            ["City", p?.city],
            ["Country", p?.country],
            ["Email", p?.email],
            ["Phone", p?.phone],
            ["WhatsApp", p?.whatsapp_number],
            ["Currency", p?.currency],
            ["Timezone", p?.timezone],
          ] as [string, string | null | undefined][]
        ).map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-4 px-5 py-3 text-sm">
            <dt className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {k}
            </dt>
            <dd className="col-span-2">{v || "—"}</dd>
          </div>
        ))}
      </Card>
      <p className="max-w-2xl text-xs text-muted-foreground">
        Editing property settings is coming soon — for now, update the database directly.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Domain tab                                                           */
/* ------------------------------------------------------------------ */

function DomainTab() {
  const getFn = useServerFn(getDomainSettings);
  const updateFn = useServerFn(updateDomainSettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["domain-settings"],
    queryFn: () => getFn(),
  });

  const mutation = useMutation({
    mutationFn: (v: { id: string; public_domain?: string | null }) => updateFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["domain-settings"] }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat…</p>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Public domain */}
      <DomainCard
        icon={<Globe className="h-4 w-4" />}
        label="Domain"
        description="Domain utama aplikasi. Tamu mengakses halaman depan di domain ini, sementara staf membuka dashboard di /admin."
        placeholder="contoh: pomahliving.com"
        value={data?.public_domain ?? null}
        disabled={!data?.id || mutation.isPending}
        onSave={(v) => data?.id && mutation.mutate({ id: data.id, public_domain: v })}
      />

      <p className="text-xs text-muted-foreground">
        Pastikan DNS sudah diarahkan ke server ini sebelum menyimpan domain. Perubahan domain tidak
        otomatis mengonfigurasi SSL/TLS.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reusable domain card with inline edit                                */
/* ------------------------------------------------------------------ */

function DomainCard({
  icon,
  label,
  description,
  placeholder,
  value,
  disabled,
  onSave,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  placeholder: string;
  value: string | null;
  disabled?: boolean;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function startEdit() {
    setDraft(value ?? "");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(value ?? "");
  }

  function save() {
    onSave(draft.trim() || null);
    setEditing(false);
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
            {!editing && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={disabled}
                onClick={startEdit}
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>

          {editing ? (
            <div className="mt-3 flex items-center gap-2">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                className="h-8 text-sm font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") cancel();
                }}
              />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={save}>
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancel}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              {value ? (
                <>
                  <code className={cn("rounded bg-muted px-2 py-0.5 font-mono text-sm")}>
                    {value}
                  </code>
                  <a
                    href={`https://${value}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title={`Buka https://${value}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </>
              ) : (
                <span className="text-sm text-muted-foreground/60 italic">Belum dikonfigurasi</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Branding tab — guesthouse logo, invoice logo, favicon                */
/* ------------------------------------------------------------------ */

function BrandingTab() {
  const getFn = useServerFn(getBrandingSettings);
  const updateFn = useServerFn(updateBrandingSettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["branding-settings"],
    queryFn: () => getFn(),
  });

  const mutation = useMutation({
    mutationFn: (v: {
      id: string;
      logo_url?: string | null;
      invoice_logo_url?: string | null;
      favicon_url?: string | null;
    }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branding-settings"] });
      toast.success("Branding tersimpan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  const id = data?.id ?? null;

  return (
    <div className="max-w-2xl space-y-4">
      {!id && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Data properti belum ada — branding belum bisa disimpan.
        </p>
      )}
      <LogoUploadCard
        label="Logo Penginapan"
        description="Logo utama penginapan, tampil di header & halaman publik."
        value={data?.logo_url ?? null}
        disabled={!id}
        onChange={(url) => id && mutation.mutate({ id, logo_url: url })}
      />
      <LogoUploadCard
        label="Logo Invoice"
        description="Logo yang tampil pada dokumen invoice / struk pemesanan."
        value={data?.invoice_logo_url ?? null}
        disabled={!id}
        onChange={(url) => id && mutation.mutate({ id, invoice_logo_url: url })}
      />
      <LogoUploadCard
        label="Favicon"
        description="Ikon kecil pada tab browser. Disarankan gambar persegi."
        square
        value={data?.favicon_url ?? null}
        disabled={!id}
        onChange={(url) => id && mutation.mutate({ id, favicon_url: url })}
      />
      <p className="text-xs text-muted-foreground">Format gambar (PNG/JPG/SVG), maksimal 2 MB.</p>
    </div>
  );
}

/** A single image-upload card: preview + upload/replace/remove. */
function LogoUploadCard({
  label,
  description,
  value,
  square,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: string | null;
  square?: boolean;
  disabled?: boolean;
  onChange: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
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
      const path = `branding/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success(`${label} terupload`);
    } catch (e) {
      toast.error(
        `Upload gagal: ${(e as Error).message}. Pastikan bucket "${BRANDING_BUCKET}" sudah dibuat (public) di Supabase Storage.`,
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted",
            square ? "h-16 w-16" : "h-16 w-28",
          )}
        >
          {value ? (
            <img src={value} alt={label} className="h-full w-full object-contain" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {uploading ? "Mengupload…" : value ? "Ganti" : "Upload"}
            </Button>
            {value && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-destructive hover:text-destructive"
                disabled={disabled || uploading}
                onClick={() => onChange(null)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Hapus
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Integrasi tab — Fonnte WhatsApp + Google services                   */
/* ------------------------------------------------------------------ */

function IntegrationTab() {
  const getFn = useServerFn(getIntegrationSettings);
  const updateFn = useServerFn(updateIntegrationSettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["integration-settings"],
    queryFn: () => getFn(),
  });

  const mutation = useMutation({
    mutationFn: (v: {
      id: string;
      fonnte_token?: string | null;
      google_place_id?: string | null;
      google_places_api_key?: string | null;
      google_analytics_id?: string | null;
      google_tag_manager_id?: string | null;
      google_search_console?: string | null;
      ai_api_key?: string | null;
      ai_base_url?: string | null;
      ai_model?: string | null;
    }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration-settings"] });
      toast.success("Integrasi tersimpan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  const id = data?.id ?? null;
  const disabled = !id || mutation.isPending;

  return (
    <div className="max-w-2xl space-y-4">
      {!id && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Data properti belum ada — integrasi belum bisa disimpan.
        </p>
      )}
      <TextSettingCard
        icon={<MessageCircle className="h-4 w-4" />}
        label="WhatsApp Token — Fonnte"
        description="Token API dari fonnte.com untuk menghubungkan WhatsApp dengan aplikasi ini."
        placeholder="Token Fonnte"
        secret
        value={data?.fonnte_token ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, fonnte_token: v })}
      />
      <TextSettingCard
        icon={<MapPin className="h-4 w-4" />}
        label="Google Place ID"
        description="ID lokasi Google Maps penginapan (untuk ulasan & peta)."
        placeholder="contoh: ChIJ..."
        value={data?.google_place_id ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, google_place_id: v })}
      />
      <TextSettingCard
        icon={<MapPin className="h-4 w-4" />}
        label="Google Places API Key"
        description="API key Google Cloud (Places API aktif) untuk widget ulasan Google di halaman depan."
        placeholder="API key"
        secret
        value={data?.google_places_api_key ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, google_places_api_key: v })}
      />
      <TextSettingCard
        icon={<BarChart3 className="h-4 w-4" />}
        label="Google Analytics ID"
        description="Measurement ID Google Analytics 4."
        placeholder="contoh: G-XXXXXXXXXX"
        value={data?.google_analytics_id ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, google_analytics_id: v })}
      />
      <TextSettingCard
        icon={<Tag className="h-4 w-4" />}
        label="Google Tag Manager ID"
        description="Container ID Google Tag Manager."
        placeholder="contoh: GTM-XXXXXXX"
        value={data?.google_tag_manager_id ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, google_tag_manager_id: v })}
      />
      <TextSettingCard
        icon={<Search className="h-4 w-4" />}
        label="Google Search Console"
        description="Kode verifikasi Search Console (isi meta tag verification)."
        placeholder="kode verifikasi"
        value={data?.google_search_console ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, google_search_console: v })}
      />
      <TextSettingCard
        icon={<Sparkles className="h-4 w-4" />}
        label="AI Chatbot — API Key"
        description="API key LLM (OpenAI-compatible) untuk webchat AI di halaman depan."
        placeholder="sk-…"
        secret
        value={data?.ai_api_key ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, ai_api_key: v })}
      />
      <TextSettingCard
        icon={<Sparkles className="h-4 w-4" />}
        label="AI Chatbot — Base URL"
        description="Endpoint OpenAI-compatible. Kosongkan untuk OpenAI default."
        placeholder="https://api.openai.com/v1"
        value={data?.ai_base_url ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, ai_base_url: v })}
      />
      <TextSettingCard
        icon={<Sparkles className="h-4 w-4" />}
        label="AI Chatbot — Model"
        description="Nama model, mis. gpt-4o-mini. Kosongkan untuk default."
        placeholder="gpt-4o-mini"
        value={data?.ai_model ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, ai_model: v })}
      />
    </div>
  );
}

/** Generic inline-edit card for a single text setting. */
function TextSettingCard({
  icon,
  label,
  description,
  placeholder,
  value,
  secret,
  disabled,
  onSave,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  placeholder: string;
  value: string | null;
  secret?: boolean;
  disabled?: boolean;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function startEdit() {
    setDraft(value ?? "");
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(value ?? "");
  }
  function save() {
    onSave(draft.trim() || null);
    setEditing(false);
  }

  const display = secret && value ? `${value.slice(0, 4)}••••••••` : value;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
            {!editing && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={disabled}
                onClick={startEdit}
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>

          {editing ? (
            <div className="mt-3 flex items-center gap-2">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                className="h-8 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") cancel();
                }}
              />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={save}>
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancel}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-2">
              {value ? (
                <code className="break-all rounded bg-muted px-2 py-0.5 font-mono text-sm">
                  {display}
                </code>
              ) : (
                <span className="text-sm italic text-muted-foreground/60">Belum diatur</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
