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
  Landmark,
  FileText,
  Users,
  Plus,
  Send,
  BellOff,
  Bell,
  Share2,
} from "lucide-react";
import { getPublicSiteData } from "@/public/functions/public.functions";
import {
  getDomainSettings,
  updateDomainSettings,
  getBrandingSettings,
  updateBrandingSettings,
  getIntegrationSettings,
  updateIntegrationSettings,
  getPropertySettings,
  updatePropertySettings,
  getPropertyManagers,
  addPropertyManager,
  updatePropertyManagerRole,
  togglePropertyManagerActive,
  deletePropertyManager,
  togglePropertyManagerMute,
  getSocialSettings,
  updateSocialSettings,
} from "@/admin/modules/settings/settings.functions";
import { Switch } from "@/components/ui/switch";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
          <TabsTrigger value="kredensial">Kredensial</TabsTrigger>
          <TabsTrigger value="domain">Domain</TabsTrigger>
          <TabsTrigger value="manager">Manager</TabsTrigger>
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

        <TabsContent value="kredensial">
          <CredentialTab />
        </TabsContent>

        <TabsContent value="domain">
          <DomainTab />
        </TabsContent>

        <TabsContent value="manager">
          <ManagerTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Properti tab                                                         */
/* ------------------------------------------------------------------ */

function PropertyTab() {
  const getFn = useServerFn(getPropertySettings);
  const updateFn = useServerFn(updatePropertySettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["property-settings"],
    queryFn: () => getFn(),
  });
  useRealtimeInvalidate("admin-settings-stream", ["properties"], [["property-settings"], ["public-site"]]);

  const mutation = useMutation({
    mutationFn: (v: {
      id: string;
      name?: string | null;
      tagline?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      email?: string | null;
      phone?: string | null;
      whatsapp_number?: string | null;
      currency?: string | null;
      timezone?: string | null;
    }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-settings"] });
      qc.invalidateQueries({ queryKey: ["public-site"] });
      toast.success("Tersimpan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  const id = data?.id ?? null;

  const fields = [
    { key: "name", label: "Name", type: "text" },
    { key: "tagline", label: "Tagline", type: "text" },
    { key: "address", label: "Address", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "text" },
    { key: "whatsapp_number", label: "WhatsApp", type: "text" },
    { key: "currency", label: "Currency", type: "text" },
    { key: "timezone", label: "Timezone", type: "text" },
  ] as const;

  return (
    <div className="space-y-4">
      {!id && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground max-w-2xl">
          Data properti belum ada.
        </p>
      )}
      <Card className="max-w-2xl divide-y divide-border p-0">
        {fields.map((f) => (
          <InlinePropertyRow
            key={f.key}
            label={f.label}
            value={(data as any)?.[f.key] ?? null}
            disabled={!id || mutation.isPending}
            onSave={(v) => id && mutation.mutate({ id, [f.key]: v })}
          />
        ))}
      </Card>
    </div>
  );
}

function InlinePropertyRow({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const startEdit = () => {
    setDraft(value ?? "");
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
  };
  const save = () => {
    onSave(draft.trim() || null);
    setEditing(false);
  };

  return (
    <div className="group flex min-h-[48px] items-center gap-4 px-5 py-2 text-sm transition hover:bg-muted/30">
      <dt className="w-32 shrink-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center justify-between gap-4">
        {editing ? (
          <div className="flex w-full items-center gap-2">
            <Input
              autoFocus
              className="h-8 flex-1 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={save}>
              <Check className="h-4 w-4 text-green-600" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancel}>
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <>
            <span className="truncate">{value || "—"}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              disabled={disabled}
              onClick={startEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </dd>
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
/* Kredensial tab — Fonnte WhatsApp & AI Chatbot Keys                  */
/* ------------------------------------------------------------------ */

function CredentialTab() {
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
      telegram_bot_token?: string | null;
      ai_api_key?: string | null;
      ai_base_url?: string | null;
      ai_model?: string | null;
    }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration-settings"] });
      toast.success("Kredensial tersimpan");
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
          Data properti belum ada — kredensial belum bisa disimpan.
        </p>
      )}
      <TextSettingCard
        icon={<MessageCircle className="h-4 w-4" />}
        label="WhatsApp Token — Fonnte"
        description="Token API dari fonnte.com untuk menghubungkan WhatsApp dengan aplikasi ini."
        placeholder="Token Fonnte"
        secret
        value={(data as any)?.fonnte_token ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, fonnte_token: v })}
      />
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>Webhook Fonnte (wajib):</strong>{" "}
        <code className="break-all">
          {typeof window !== "undefined"
            ? `${window.location.origin}/api/fonnte`
            : "https://pomahguesthouse.com/api/fonnte"}
        </code>
        <br />
        Jangan pakai Supabase Edge Function (<code>…/functions/v1/whatsapp-webhook</code>) — itu
        proyek/layanan lain dan tidak menjalankan chatbot aplikasi ini.
      </p>
      <TextSettingCard
        icon={<Send className="h-4 w-4" />}
        label="Telegram Bot Token"
        description="Token dari @BotFather (format: 123456:ABC-DEF…). Setelah diisi, buka Admin → Telegram lalu klik 'Setup webhook' untuk menyambungkan."
        placeholder="123456789:ABCDEF..."
        secret
        value={(data as any)?.telegram_bot_token ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, telegram_bot_token: v })}
      />
      <TextSettingCard
        icon={<Sparkles className="h-4 w-4" />}
        label="AI Chatbot — API Key"
        description="Kosongkan untuk memakai Lovable AI (default). Isi hanya bila ingin LLM lain (OpenAI-compatible)."
        placeholder="Kosong = Lovable AI"
        secret
        value={data?.ai_api_key ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, ai_api_key: v })}
      />
      <TextSettingCard
        icon={<Sparkles className="h-4 w-4" />}
        label="AI Chatbot — Base URL"
        description="Endpoint OpenAI-compatible. Hanya dipakai bila API Key di atas diisi."
        placeholder="https://api.openai.com/v1"
        value={data?.ai_base_url ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, ai_base_url: v })}
      />
      <TextSettingCard
        icon={<Sparkles className="h-4 w-4" />}
        label="AI Chatbot — Model"
        description="Kosongkan untuk default. Lewat Lovable AI gunakan format mis. google/gemini-2.5-flash."
        placeholder="google/gemini-2.5-flash"
        value={data?.ai_model ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, ai_model: v })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Integrasi tab — Google services & Payment                           */
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
      payment_bank_name?: string | null;
      payment_account_number?: string | null;
      payment_account_holder?: string | null;
      hotel_policy?: string | null;
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
        icon={<Landmark className="h-4 w-4" />}
        label="Pembayaran — Nama Bank"
        description="Bank tujuan transfer yang disampaikan chatbot setelah tamu booking."
        placeholder="contoh: Bank BCA"
        value={data?.payment_bank_name ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, payment_bank_name: v })}
      />
      <TextSettingCard
        icon={<Landmark className="h-4 w-4" />}
        label="Pembayaran — Nomor Rekening"
        description="Nomor rekening tujuan transfer."
        placeholder="contoh: 0095584379"
        value={data?.payment_account_number ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, payment_account_number: v })}
      />
      <TextSettingCard
        icon={<Landmark className="h-4 w-4" />}
        label="Pembayaran — Atas Nama"
        description="Nama pemilik rekening."
        placeholder="contoh: Faizal Abdurachman"
        value={data?.payment_account_holder ?? null}
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, payment_account_holder: v })}
      />
      <TextSettingCard
        icon={<FileText className="h-4 w-4" />}
        label="Kebijakan Hotel"
        description="Ditampilkan di dialog konfirmasi pemesanan. Satu poin kebijakan per baris."
        placeholder={"Tidak boleh merokok di dalam kamar\nTidak diperbolehkan membawa durian\n…"}
        value={data?.hotel_policy ?? null}
        multiline
        disabled={disabled}
        onSave={(v) => id && mutation.mutate({ id, hotel_policy: v })}
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
  multiline,
  disabled,
  onSave,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  placeholder: string;
  value: string | null;
  secret?: boolean;
  multiline?: boolean;
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
            multiline ? (
              <div className="mt-3 space-y-2">
                <Textarea
                  autoFocus
                  rows={6}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={placeholder}
                  className="text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" className="h-8" onClick={cancel}>
                    <X className="mr-1 h-4 w-4" />
                    Batal
                  </Button>
                  <Button size="sm" className="h-8" onClick={save}>
                    <Check className="mr-1 h-4 w-4" />
                    Simpan
                  </Button>
                </div>
              </div>
            ) : (
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
            )
          ) : (
            <div className="mt-2">
              {value ? (
                multiline ? (
                  <p className="whitespace-pre-line rounded bg-muted px-2 py-1.5 text-sm">
                    {value}
                  </p>
                ) : (
                  <code className="break-all rounded bg-muted px-2 py-0.5 font-mono text-sm">
                    {display}
                  </code>
                )
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

/* ------------------------------------------------------------------ */
/* Manager Tab                                                        */
/* ------------------------------------------------------------------ */

function ManagerTab() {
  const getFn = useServerFn(getPropertyManagers);
  const addFn = useServerFn(addPropertyManager);
  const updateFn = useServerFn(updatePropertyManagerRole);
  const toggleActiveFn = useServerFn(togglePropertyManagerActive);
  const deleteFn = useServerFn(deletePropertyManager);
  const toggleMuteFn = useServerFn(togglePropertyManagerMute);
  
  
  const getPropFn = useServerFn(getPropertySettings);
  const qc = useQueryClient();

  const { data: property } = useQuery({
    queryKey: ["property-settings"],
    queryFn: () => getPropFn(),
  });
  
  const { data: managers, isLoading } = useQuery({
    queryKey: ["property-managers"],
    queryFn: () => getFn(),
  });

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"super_admin" | "booking_manager" | "viewer">("super_admin");

  const addMut = useMutation({
    mutationFn: (v: any) => addFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-managers"] });
      setPhone("");
      setName("");
      toast.success("Manager berhasil ditambahkan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: (v: any) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-managers"] });
      toast.success("Peran berhasil diubah");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-managers"] });
      toast.success("Manager berhasil dihapus");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleActiveMut = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggleActiveFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-managers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleMuteMut = useMutation({
    mutationFn: (v: { id: string; is_muted: boolean }) => toggleMuteFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-managers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleAdd = () => {
    if (!property?.id) return toast.error("Data properti tidak ditemukan");
    if (!phone || !name) return toast.error("Nomor dan Nama harus diisi");
    addMut.mutate({ property_id: property.id, phone, name, role });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  return (
    <div className="space-y-6 max-w-4xl">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Daftar Manager</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Nomor pengelola yang akan dilayani AI Admin dengan sapaan personal. Nomor yang tidak terdaftar di sini akan dianggap sebagai tamu.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
          <Input 
            placeholder="Nomor (e.g. 628123456789)" 
            value={phone} 
            onChange={e => setPhone(e.target.value)}
            className="flex-1"
          />
          <Input 
            placeholder="Nama Manager (e.g. Bu Titik)" 
            value={name} 
            onChange={e => setName(e.target.value)}
            className="flex-1"
          />
          <div className="w-48 shrink-0">
            <Select value={role} onValueChange={(v: any) => setRole(v)}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder="Pilih Peran" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="super_admin">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span>Super Admin</span>
                  </div>
                </SelectItem>
                <SelectItem value="booking_manager">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span>Booking Manager</span>
                  </div>
                </SelectItem>
                <SelectItem value="viewer">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-gray-400" />
                    <span>Viewer</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={addMut.isPending} className="bg-teal-600 hover:bg-teal-700 text-white shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            Tambah
          </Button>
        </div>

        {/* Legend */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-muted/50 p-3 rounded-md text-sm">
            <div className="flex items-center gap-2 font-medium mb-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Super Admin
            </div>
            <div className="text-muted-foreground text-xs pl-4">Akses penuh semua fitur</div>
          </div>
          <div className="bg-muted/50 p-3 rounded-md text-sm">
            <div className="flex items-center gap-2 font-medium mb-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              Booking Manager
            </div>
            <div className="text-muted-foreground text-xs pl-4">Kelola booking (tanpa statistik pendapatan)</div>
          </div>
          <div className="bg-muted/50 p-3 rounded-md text-sm">
            <div className="flex items-center gap-2 font-medium mb-1">
              <div className="w-2 h-2 rounded-full bg-gray-400" />
              Viewer
            </div>
            <div className="text-muted-foreground text-xs pl-4">Hanya lihat ketersediaan kamar</div>
          </div>
        </div>

        {/* List */}
        <div className="space-y-3">
          {managers?.map(m => (
            <div key={m.id} className="flex items-center justify-between p-4 rounded-lg border border-border bg-white shadow-sm">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{m.name}</span>
                  {m.role === "super_admin" && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Super Admin</span>}
                  {m.role === "booking_manager" && <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Booking Manager</span>}
                  {m.role === "viewer" && <span className="bg-gray-400 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Viewer</span>}
                </div>
                <div className="text-sm text-muted-foreground">{m.phone}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2" title="Aktif menerima notifikasi">
                  <Switch
                    checked={m.is_active ?? true}
                    onCheckedChange={(checked) => toggleActiveMut.mutate({ id: m.id, is_active: checked })}
                  />
                  <span className="text-xs text-muted-foreground">{m.is_active ?? true ? "Aktif" : "Nonaktif"}</span>
                </div>
                <Select 
                  value={m.role} 
                  onValueChange={(v: any) => updateMut.mutate({ id: m.id, role: v })}
                >
                  <SelectTrigger className="w-40 h-8 text-xs bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin" className="text-xs">Super Admin</SelectItem>
                    <SelectItem value="booking_manager" className="text-xs">Booking Manager</SelectItem>
                    <SelectItem value="viewer" className="text-xs">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 transition-colors",
                    (m as any).is_muted
                      ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                      : "text-muted-foreground hover:text-amber-500 hover:bg-amber-50",
                  )}
                  title={(m as any).is_muted ? "Notifikasi dinonaktifkan — klik untuk aktifkan" : "Klik untuk menonaktifkan notifikasi"}
                  onClick={() => toggleMuteMut.mutate({ id: m.id, is_muted: !(m as any).is_muted })}
                >
                  {(m as any).is_muted ? (
                    <BellOff className="w-4 h-4" />
                  ) : (
                    <Bell className="w-4 h-4" />
                  )}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (confirm("Hapus manager ini?")) {
                      deleteMut.mutate(m.id);
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
          {managers?.length === 0 && (
             <div className="text-center p-6 border border-dashed rounded-lg text-muted-foreground text-sm">
               Belum ada manager yang didaftarkan.
             </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-2 text-base">Cara Kerja Filter Nomor</h3>
        <p className="text-sm text-muted-foreground mb-4">Bagaimana Orchestrator membedakan tamu dan pengelola</p>
        <ul className="space-y-2 text-sm text-foreground">
          <li className="flex items-center gap-2"><span className="text-blue-500 shrink-0">🔀</span> Pesan masuk diterima oleh <strong className="font-semibold">Orchestrator</strong></li>
          <li className="flex items-center gap-2"><span className="text-gray-500 shrink-0">📱</span> Nomor dicek di daftar manager di atas</li>
          <li className="flex items-center gap-2"><span className="text-green-500 shrink-0">✅</span> Jika terdaftar → dialihkan ke <strong className="font-semibold">Manager Bot</strong> (AI Admin)</li>
          <li className="flex items-center gap-2"><span className="text-purple-500 shrink-0">👤</span> Jika tidak terdaftar → dialihkan ke <strong className="font-semibold">Intent Router</strong> → agent tamu</li>
          <li className="flex items-center gap-2"><span className="text-pink-500 shrink-0">🤖</span> Manager Bot menyapa personal: <em className="italic">"Halo Bu Titik! Ada yang bisa saya bantu?"</em></li>
        </ul>
      </Card>
    </div>
  );
}
