/**
 * Jejak kiriman media terbaru.
 *
 * Foto kamar memakai jendela 30 menit (`MEDIA_DEDUP_WINDOW_MS`) supaya retry
 * antrian tidak mengirim foto yang sama dua kali (regresi duplikat foto,
 * September 2026). Brosur PDF boleh dikirim lagi setelah 30 menit, atau
 * segera bila tamu minta ulang, dengan plafon 3 kali per 24 jam. Klaim
 * "sudah dikirim" hanya bila kiriman tercatat di thread yang sama.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Jendela dedup foto kamar. */
export const MEDIA_DEDUP_WINDOW_MS = 30 * 60_000;

/**
 * Jendela lama pencarian caption (2 jam). Keputusan kirim ulang memakai
 * `BROCHURE_RESEND_AFTER_MS` (30 menit) dan jejak thread, bukan konstanta ini.
 */
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

export interface ThreadBrochureSend {
  at: number;
}

/**
 * Kiriman brosur yang tercatat di `whatsapp_messages` untuk thread ini
 * dalam 24 jam terakhir. Bukan caption Meta per nomor: tanpa baris ini
 * bot tidak boleh mengklaim brosur sudah dikirim.
 */
export async function loadThreadBrochureSendTimes(
  threadId: string | null | undefined,
  now: number = Date.now(),
): Promise<number[]> {
  const times: number[] = [];
  const id = (threadId ?? "").trim();
  if (!id) return times;
  try {
    const since = new Date(now - 24 * 60 * 60_000).toISOString();
    const { data } = await (
      supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (
                k: string,
                v: string,
              ) => {
                gte: (
                  k: string,
                  v: string,
                ) => Promise<{
                  data: Array<{
                    sent_at: string | null;
                    body: string | null;
                    metadata: Record<string, unknown> | null;
                  }> | null;
                }>;
              };
            };
          };
        };
      }
    )
      .from("whatsapp_messages")
      .select("sent_at, body, metadata")
      .eq("thread_id", id)
      .eq("direction", "out")
      .gte("sent_at", since);
    for (const row of data ?? []) {
      const md = (row.metadata ?? {}) as Record<string, unknown>;
      const body = row.body ?? "";
      const logged =
        body === BROCHURE_CAPTION ||
        md.source === "bot_brochure" ||
        md.agent_key === "brochure-fast-path";
      if (!logged || md.send_status === "failed") continue;
      const at = Date.parse(row.sent_at ?? "");
      if (Number.isFinite(at)) times.push(at);
    }
  } catch {
    /* non-fatal: anggap belum ada jejak, jangan klaim sudah dikirim */
  }
  return times;
}
