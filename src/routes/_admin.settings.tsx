import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe, ShieldCheck, ExternalLink, Check, Pencil, X } from "lucide-react";
import { getPublicSiteData } from "@/lib/public.functions";
import { getDomainSettings, updateDomainSettings } from "@/modules/settings/settings.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/settings")({
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
          <TabsTrigger value="domain">Domain</TabsTrigger>
        </TabsList>

        <TabsContent value="properti">
          <PropertyTab />
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
    mutationFn: (v: { id: string; public_domain?: string | null; admin_domain?: string | null }) =>
      updateFn({ data: v }),
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
        label="Public Domain"
        description="Domain utama yang diakses tamu untuk melihat halaman depan, kamar, dan pemesanan."
        placeholder="contoh: pomahguesthouse.com"
        value={data?.public_domain ?? null}
        disabled={!data?.id || mutation.isPending}
        onSave={(v) =>
          data?.id && mutation.mutate({ id: data.id, public_domain: v })
        }
      />

      {/* Admin domain */}
      <DomainCard
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Admin Domain"
        description="Domain khusus staf untuk mengakses dashboard admin."
        placeholder="contoh: admin.pomahguesthouse.com"
        value={data?.admin_domain ?? null}
        disabled={!data?.id || mutation.isPending}
        onSave={(v) =>
          data?.id && mutation.mutate({ id: data.id, admin_domain: v })
        }
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
                  <code
                    className={cn(
                      "rounded bg-muted px-2 py-0.5 font-mono text-sm",
                    )}
                  >
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
