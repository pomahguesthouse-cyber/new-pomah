import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const { data: property } = await supabasePublic
          .from("properties")
          .select("name, tagline, description, address, whatsapp_number, email")
          .limit(1)
          .single();
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
          lines.push(
            `- **${r.name}** ($${Number(r.base_rate).toFixed(0)}/night, sleeps ${r.capacity}${r.bed_type ? `, ${r.bed_type}` : ""}): ${r.description ?? ""}`,
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
