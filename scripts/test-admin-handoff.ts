import assert from "node:assert/strict";
import {
  ADMIN_HANDOFF_PAUSE_MS,
  buildAdminHandoffGuestReply,
  buildAdminHandoffNotice,
  detectGuestHandoffTrigger,
  laterPause,
  replyDefersToStaff,
  triggerAdminHandoff,
  detectTransferClaim,
  TRANSFER_CLAIM_REPLY,
} from "../src/services/wa-autoreply/admin-handoff";

// Pemicu dari pesan tamu
for (const t of ["admin", "Min", "Bisa bicara dengan admin?", "minta nomor admin kak", "saya mau ngobrol sama orang, jangan bot", "tolong hubungkan ke staf"]) {
  assert.equal(detectGuestHandoffTrigger(t), "admin_request", t);
}
// Aliif PG-K66KR: ancaman cancel
for (const t of ["Kalau gitu saya cancel aja kak", "batalin aja deh", "saya minta refund", "mending pindah ke hotel lain"]) {
  assert.equal(detectGuestHandoffTrigger(t), "cancel_threat", t);
}
for (const t of ["kok belum dibalas kak?", "Saya kecewa sekali", "AC kamarnya rusak", "dari tadi gak dibales"]) {
  assert.equal(detectGuestHandoffTrigger(t), "complaint", t);
}
// Bukan pemicu
for (const t of ["Halo kak", "Ada kamar untuk 2 orang tanggal 20?", "Kalau batal kena biaya berapa kak?", "Wifi passwordnya apa?", "Di dapur disediain alat masaknya kak?"]) {
  assert.equal(detectGuestHandoffTrigger(t), null, t);
}

// Ika PG-GDWES 17 Okt: bot menyerahkan ke tim → handoff "tidak tahu"
assert.ok(replyDefersToStaff("Untuk alat masak yang tersedia di dapur, izinkan kami konfirmasi ke tim dulu ya, Kak."));
assert.ok(replyDefersToStaff("Baik, Kak. Kami akan segera konfirmasi ke tim mengenai perlengkapan dapur."));
assert.ok(!replyDefersToStaff("Kami cek terlebih dahulu ya, Kak."));
assert.ok(!replyDefersToStaff("Check-in mulai pukul 14:00, Kak."));

// Balasan tamu tanpa batas waktu
for (const k of ["admin_request", "payment_proof", "cancel_threat", "complaint", "unknown_answer", "facility_unknown"] as const) {
  const r = buildAdminHandoffGuestReply(k);
  assert.ok(/admin/i.test(r));
  assert.ok(!/\d+\s*(menit|jam|x\s*24|×\s*24)|segera|secepatnya/i.test(r), `tanpa ETA: ${r}`);
  assert.ok(!/Rani/.test(r));
}

const notice = buildAdminHandoffNotice({
  kind: "payment_proof", phone: "+62 812-3456-8868", guestName: "Azaaa", bookingCode: "PG-ABCDE",
  trigger: "Sudah masuk ya kak", threadId: "11111111-1111-1111-1111-111111111111", pauseUntil: "2026-10-17T09:00:00Z",
});
assert.match(notice.message, /PERLU ADMIN — Tamu mengirim bukti transfer/);
assert.match(notice.message, /6281234568868/);
assert.match(notice.message, /Kembalikan ke AI/);
assert.equal(notice.url, "/admin/whatsapp?thread=11111111-1111-1111-1111-111111111111");
assert.equal(notice.templateParams.length, 4);

assert.equal(laterPause(null, "2026-10-19T10:00:00Z"), "2026-10-19T10:00:00Z");
assert.equal(laterPause("2026-10-19T16:00:00Z", "2026-10-19T10:01:00Z"), "2026-10-19T16:00:00Z");
assert.equal(laterPause("2026-10-19T09:00:00Z", "2026-10-19T10:01:00Z"), "2026-10-19T10:01:00Z");

// triggerAdminHandoff: tiket + jeda thread + notifikasi
{
  const updates: any[] = [];
  const db = {
    from: (t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ai_paused_until: null } }) }) }),
      update: (v: any) => ({ eq: async () => { updates.push([t, v]); return {}; } }),
    }),
  };
  const notified: any[] = [];
  const now = new Date("2026-10-17T02:35:00Z");
  const res = await triggerAdminHandoff(db, {
    phone: "6281234568868", threadId: "t1", kind: "cancel_threat", triggerMessage: "saya cancel aja", now,
    context: { bookingCode: "PG-K66KR" },
  }, {
    createTicket: async () => ({ id: "tk1" }),
    notify: async (_db, n) => { notified.push(n); },
  });
  assert.equal(res.ticketId, "tk1");
  assert.equal(res.pausedUntil, new Date(now.getTime() + ADMIN_HANDOFF_PAUSE_MS).toISOString());
  assert.deepEqual(updates[0], ["whatsapp_threads", { ai_paused_until: res.pausedUntil }]);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].bookingCode, "PG-K66KR");

  const res2 = await triggerAdminHandoff(db, { phone: "x", threadId: "t1", kind: "payment_proof", triggerMessage: "", notify: false, now }, {
    createTicket: async () => null, notify: async () => { throw new Error("tidak boleh dipanggil"); },
  });
  assert.equal(res2.ticketId, null);
}

// Item 6: klaim sudah transfer → alert admin, tanpa ETA, status tetap belum lunas
for (const t of ["sudah transfer ya kak", "Udah tf kak", "barusan saya transfer", "sudah saya bayar lunas"]) {
  assert.equal(detectTransferClaim(t), true, t);
}
for (const t of ["kalau sudah transfer harus kirim bukti?", "transfer ke mana kak?", "nanti saya transfer"]) {
  assert.equal(detectTransferClaim(t), false, t);
}
assert.ok(!/\d+\s*(menit|jam)|1\s*[x×]\s*24|segera|lunas/i.test(TRANSFER_CLAIM_REPLY));
assert.match(TRANSFER_CLAIM_REPLY, /Kami cek terlebih dahulu ya, Kak/);

console.log("✓ admin handoff: pemicu, balasan tanpa ETA, notifikasi, jeda bot");
