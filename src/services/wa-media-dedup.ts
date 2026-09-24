/**
 * Jejak kiriman media 30 menit terakhir.
 *
 * Dipakai bersama oleh `send_room_photos` dan fast-path foto/brosur supaya
 * retry antrian tidak mengirim foto yang sama dua kali (regresi duplikat
 * foto, September 2026).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MEDIA_DEDUP_WINDOW_MS = 30 * 60_000;

export function roomPhotoCaption(roomName: string): string {
  return `Foto kamar *${roomName}* 📸`;
}

export const BROCHURE_CAPTION = "Brosur Pomah Guesthouse 📄";

/** Caption outbound Meta yang baru saja terkirim ke nomor ini. */
export async function loadRecentOutboundCaptions(phone: string): Promise<Set<string>> {
  const captions = new Set<string>();
  try {
    const digits = String(phone ?? "")
      .replace(/\D/g, "")
      .replace(/^0/, "62");
    if (!digits) return captions;
    const { data } = await (
      supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              gte: (
                k: string,
                v: string,
              ) => Promise<{ data: Array<{ body: string | null }> | null }>;
            };
          };
        };
      }
    )
      .from("whatsapp_meta_outbound")
      .select("body")
      .eq("recipient", digits)
      .gte("created_at", new Date(Date.now() - MEDIA_DEDUP_WINDOW_MS).toISOString());
    for (const row of data ?? []) if (row.body) captions.add(row.body);
  } catch {
    /* non-fatal: lanjut tanpa dedup */
  }
  return captions;
}
