import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const { data: propData } = await supabasePublic.rpc("get_public_property" as never);
        const property = (propData ?? {}) as Record<string, string | null | undefined>;
        const { data: roomTypes } = await supabasePublic
          .from("room_types")
          .select("name, slug, description, base_rate, capacity, bed_type");

        const lines: string[] = [];
        lines.push(`# ${property?.name ?? "Pomah Guesthouse"}`);
        if (property?.tagline) lines.push("", `> ${property.tagline}`);
        if (property?.description) lines.push("", property.description);
        lines.push("", "## Contact");
        if (property?.address) lines.push(`- Address: ${property.address}`);
        if (property?.whatsapp_number) lines.push(`- WhatsApp: ${property.whatsapp_number}`);
        if (property?.email) lines.push(`- Email: ${property.email}`);
        lines.push("", "## Pages");
        lines.push(`- [Home](${origin}/)`);
        lines.push(`- [Rooms](${origin}/rooms)`);
        lines.push(`- [Book](${origin}/book)`);
        lines.push("", "## Rooms");
        for (const r of roomTypes ?? []) {
          const rateFormatted = `Rp ${Number(r.base_rate).toLocaleString("id-ID")}`;
          lines.push(
            `- [${r.name}](${origin}/rooms/${r.slug}) (${rateFormatted}/night, sleeps ${r.capacity}${r.bed_type ? `, ${r.bed_type}` : ""}): ${r.description ?? ""}`,
          );
        }
        return new Response(lines.join("\n"), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
