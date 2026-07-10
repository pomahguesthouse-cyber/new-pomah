import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// URL for Google Review
const REVIEW_LINK = "https://g.page/r/CcJj347h2ojvEBM/review";

// Configuration for WhatsApp API (using WPPConnect from your whatsapp.service.ts logic)
const WPP_BASE_URL = (Deno.env.get("WPP_BASE_URL") ?? "").replace(/\/+$/, "");
const WPP_SESSION = Deno.env.get("WPP_SESSION") ?? "";

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Property Info (to get name and wpp_token)
    const { data: prop, error: propErr } = await supabase
      .from("properties")
      .select("name, wpp_token")
      .single();

    if (propErr || !prop?.wpp_token) {
      throw new Error("Property configuration or WPP token not found");
    }

    // 2. Find guests who checked out TODAY
    // Standard checkout is usually 12:00, we run this at 13:00
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
      .eq("status", "checked_out"); // Ensure they are actually checked out

    if (bookingsErr) throw bookingsErr;

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ message: "No check-outs today." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = [];

    // 3. Send WhatsApp message to each guest
    for (const booking of bookings) {
      const guest = booking.guests as any;
      if (!guest?.phone) continue;

      const message = 
        `Halo Kak ${guest.full_name}, terima kasih banyak sudah menginap di ${prop.name} 🙏\n\n` +
        `Kami berharap Kakak mendapatkan pengalaman menginap yang menyenangkan. ` +
        `Jika Kakak ada waktu luang, kami akan sangat berterima kasih jika Kakak berkenan memberikan ulasan di Google Maps kami di sini ya:\n\n` +
        `${REVIEW_LINK}\n\n` +
        `Ulasan Kakak sangat berarti bagi kami untuk terus memberikan pelayanan terbaik. Sampai jumpa di kunjungan berikutnya! ✨`;

      // Simplified send logic for WPPConnect based on your service
      const url = `${WPP_BASE_URL}/api/${encodeURIComponent(WPP_SESSION)}/send-message`;
      
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${prop.wpp_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: [guest.phone],
          message: message,
          isGroup: false
        }),
      });

      results.push({
        booking: booking.reference_code,
        phone: guest.phone,
        success: res.ok,
      });
    }

    return new Response(JSON.stringify({ processed: results.length, details: results }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
