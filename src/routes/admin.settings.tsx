import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData } from "@/lib/public.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const fn = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fn() });
  const p = data?.property;

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Property</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
      </header>
      <Card className="max-w-2xl divide-y divide-border p-0">
        {[
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
        ].map(([k, v]) => (
          <div key={k as string} className="grid grid-cols-3 gap-4 px-5 py-3 text-sm">
            <dt className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{k}</dt>
            <dd className="col-span-2">{(v as string) || "—"}</dd>
          </div>
        ))}
      </Card>
      <p className="max-w-2xl text-xs text-muted-foreground">
        Editing property settings is coming soon — for now, update the database directly.
      </p>
    </div>
  );
}
