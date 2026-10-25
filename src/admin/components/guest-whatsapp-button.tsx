import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Headset } from "lucide-react";

/** 08xx / 8xx / +62xx / 620xx → 62xx (same rule as the WhatsApp inbox). */
export function canonicalGuestPhone(raw?: string | null): string {
  let n = (raw ?? "").replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("620")) n = "62" + n.slice(3);
  else if (n.startsWith("0")) n = "62" + n.slice(1);
  else if (/^8\d{7,13}$/.test(n)) n = "62" + n;
  return n;
}

/** Newest WhatsApp thread for a phone, read-only. */
async function findThreadId(phone: string): Promise<string | null> {
  const canon = canonicalGuestPhone(phone);
  if (!canon) return null;
  const local = "0" + canon.slice(2);
  const variants = Array.from(new Set([canon, "+" + canon, local, phone.trim()])).filter(Boolean);
  const list = variants.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
  const { data, error } = await supabase
    .from("whatsapp_threads")
    .select("id")
    .or(`canonical_phone.eq.${canon},phone.in.(${list})`)
    .order("last_message_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.2 4.24-9.44 9.45-9.44a9.4 9.4 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.21-4.24 9.44-9.45 9.44m8.04-17.48A11.3 11.3 0 0 0 12.05.7C5.78.7.68 5.8.68 12.06c0 2 .52 3.96 1.52 5.68L.58 23.7l6.1-1.6a11.33 11.33 0 0 0 5.37 1.37h.01c6.27 0 11.37-5.1 11.37-11.37 0-3.04-1.18-5.9-3.33-8.04" />
    </svg>
  );
}

/** Icon button: opens the guest's chat in the admin WhatsApp inbox, never the row's edit dialog. */
export function GuestWhatsAppButton({ phone, className }: { phone?: string | null; className?: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const disabled = !phone || busy;

  const open = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!phone || busy) return;
    setBusy(true);
    try {
      const id = await findThreadId(phone);
      if (id) await navigate({ to: "/admin/whatsapp", search: { thread: id } });
      else await navigate({ to: "/admin/whatsapp", search: { q: canonicalGuestPhone(phone) || phone } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuka chat WhatsApp");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      aria-label="Buka chat WhatsApp"
      title="Buka chat WhatsApp"
      disabled={disabled}
      onClick={open}
      onPointerDown={stop}
      onTouchStart={stop}
      onMouseDown={stop}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#1DA851] transition-colors hover:bg-[#25D366]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 dark:text-[#25D366] dark:hover:bg-[#25D366]/15",
        busy && "animate-pulse",
        className,
      )}
    >
      <WhatsAppGlyph className="h-5 w-5" />
    </button>
  );
}

/** wa.me link for the guest's number (opens WhatsApp / WhatsApp Business). */
export function guestWaMeUrl(raw?: string | null): string {
  const canon = canonicalGuestPhone(raw);
  return canon ? `https://wa.me/${canon}` : "";
}

/** Android app: hand off to Custom Tab → WhatsApp app (never inside the WebView). Web: new tab. */
async function openExternal(url: string): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    }
  } catch {
    // fall through to window.open
  }
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) window.location.href = url;
}

/** Customer-care icon: chat the guest from the WhatsApp Business app via wa.me. Hidden without a phone. */
export function GuestCustomerCareButton({ phone, className }: { phone?: string | null; className?: string }) {
  const url = guestWaMeUrl(phone);
  if (!url) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button
      type="button"
      aria-label="Chat via WhatsApp Business"
      title="Chat via WhatsApp Business"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void openExternal(url).catch(() => toast.error("Gagal membuka WhatsApp Business"));
      }}
      onPointerDown={stop}
      onTouchStart={stop}
      onMouseDown={stop}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sky-700 transition-colors hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-sky-400 dark:hover:bg-sky-400/15",
        className,
      )}
    >
      <Headset className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
