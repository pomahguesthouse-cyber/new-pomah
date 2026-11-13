/**
 * Dependency produksi: kabari tamu (menunggu mutasi) dan manajer (review/timeout).
 */
import { sendGuestWhatsApp } from "./guest-whatsapp.service";
import type { BankMutationAlert, MutationMatchDeps } from "./bank-mutation-match";

export async function notifyManagersBankMutation(db: any, alert: BankMutationAlert): Promise<void> {
  try {
    const { notifyBankMutationAlert } = await import("./manager-notifier.service");
    await notifyBankMutationAlert(db, alert);
  } catch (e) {
    console.warn("[moota] notify manager gagal (non-fatal):", e instanceof Error ? e.message : e);
  }
}

export function productionMutationDeps(db: any): MutationMatchDeps {
  return {
    notifyGuestWaiting: async ({ phone, body }) => {
      const res = await sendGuestWhatsApp(phone, body);
      if (!res.ok) throw new Error(res.error ?? "kirim WhatsApp gagal");
    },
    notifyManagers: (alert) => notifyManagersBankMutation(db, alert),
  };
}
