import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const REVIEW_LINK = "https://g.page/r/CcJj347h2ojvEBM/review";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp/messages";

function gatewayHeaders(): Record<string, string> | null {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const waKey = Deno.env.get("WHATSAPP_API_KEY") ?? "";
  if (!lovableKey || !waKey) return null;
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": waKey,
    "Content-Type": "application/json",
  };
}

function toRecipient(phone: string): string {
  let p = String(phone ?? "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

Deno.serve(async (req) => {
  try {
    const headers = gatewayHeaders();
    if (!headers) {
      throw new Error("WhatsApp Business belum terhubung (LOVABLE_API_KEY / WHATSAPP_API_KEY)");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: prop, error: propErr } = await supabase
      .from("properties")
      .select("name")
      .limit(1)
      .maybeSingle();

    if (propErr || !prop?.name) {
      throw new Error("Property configuration not found");
    }

    const today = new Date().toISOString().split("T")[0];

    const { data: bookings, error: bookingsErr } = await supabase
      .from("bookings")
      .select(`
        id,
        reference_code,
        check_out,
        guests (
          full_name,
          phone
        )
      `)
      .eq("check_out", today)
      .eq("status", "checked_out");

    if (bookingsErr) throw bookingsErr;

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ message: "No check-outs today." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const booking of bookings) {
      const guest = booking.guests as { full_name?: string; phone?: string } | null;
      const to = toRecipient(guest?.phone ?? "");
      if (!/^\d{8,15}$/.test(to)) continue;

      const message =
        `Halo Kak ${guest?.full_name ?? ""}, terima kasih banyak sudah menginap di ${prop.name} 🙏\n\n` +
        `Kami berharap Kakak mendapatkan pengalaman menginap yang menyenangkan. ` +
        `Jika Kakak ada waktu luang, kami akan sangat berterima kasih jika Kakak berkenan memberikan ulasan di Google Maps kami di sini ya:\n\n` +
        `${REVIEW_LINK}\n\n` +
        `Ulasan Kakak sangat berarti bagi kami untuk terus memberikan pelayanan terbaik. Sampai jumpa di kunjungan berikutnya! ✨`;

      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message, preview_url: true },
        }),
      });

      results.push({
        booking: booking.reference_code,
        phone: to,
        success: res.ok,
      });
    }

    return new Response(JSON.stringify({ processed: results.length, details: results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
