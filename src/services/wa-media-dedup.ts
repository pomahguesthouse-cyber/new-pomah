/**
 * Jejak kiriman media terbaru.
 *
 * Foto kamar memakai jendela 30 menit (`MEDIA_DEDUP_WINDOW_MS`) supaya retry
 * antrian tidak mengirim foto yang sama dua kali (regresi duplikat foto,
 * September 2026). Brosur PDF memakai jendela 2 jam
 * (`BROCHURE_DEDUP_WINDOW_MS`): dalam jendela itu fast-path membalas
 * "sudah dikirim"; setelahnya brosur dikirim ulang.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Jendela dedup foto kamar. */
export const MEDIA_DEDUP_WINDOW_MS = 30 * 60_000;

/** Jendela dedup brosur PDF: 2 jam (120 menit). Dipakai juga sebagai batas pencarian caption outbound. */
export const BROCHURE_DEDUP_WINDOW_MS = 2 * 60 * 60_000;

export function roomPhotoCaption(roomName: string): string {
  return `Foto kamar *${roomName}* 📸`;
}

export const BROCHURE_CAPTION = "Brosur Pomah Guesthouse 📄";

/**
 * Caption outbound Meta yang terkirim ke nomor ini dalam `windowMs`.
 * Default jendela foto; brosur meneruskan `BROCHURE_DEDUP_WINDOW_MS` supaya
 * pencarian caption sama panjang dengan jeda kirim ulang.
 */
export async function loadRecentOutboundCaptions(
  phone: string,
  windowMs: number = MEDIA_DEDUP_WINDOW_MS,
): Promise<Set<string>> {
  const captions = new Set<string>();
  try {
    const digits = String(phone ?? "")
      .replace(/\D/g, "")
      .replace(/^0/, "62");
    if (!digits) return captions;
    const since = new Date(Date.now() - windowMs).toISOString();
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
      .gte("created_at", since);
    for (const row of data ?? []) if (row.body) captions.add(row.body);
  } catch {
    /* non-fatal: lanjut tanpa dedup */
  }
  return captions;
}
