import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Search, Send, Loader2, Merge, X } from "lucide-react";
import {
  listContacts,
  getContactDetail,
  updateContact,
  mergeContacts,
  sendPreArrivalReminder,
} from "@/admin/functions/contacts.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/contacts")({
  component: ContactsPage,
});

type ContactRow = {
  id: string;
  full_name: string;
  real_name: string | null;
  display_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  source: string | null;
  tags: string[] | null;
  total_bookings: number;
  total_spent: number;
  last_seen_at: string | null;
  first_seen_at: string | null;
  avatar_url: string | null;
};

function ContactsPage() {
  const listFn = useServerFn(listContacts);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState<{ sourceId: string } | null>(null);

  const query = useQuery({
    queryKey: ["contacts", { search, source }],
    queryFn: () =>
      listFn({
        data: {
          search: search || undefined,
          source: source || undefined,
          limit: 100,
          offset: 0,
        },
      }),
  });

  const rows = (query.data?.rows ?? []) as ContactRow[];
  const total = query.data?.total ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Kontak tamu terpusat — dari WhatsApp, booking, dan input manual.
          </p>
        </div>
        <div className="ml-auto text-sm text-muted-foreground">Total: {total}</div>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[240px]">
            <Label htmlFor="search">Cari</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nama, nomor, atau email"
                className="pl-8"
              />
            </div>
          </div>
          <div className="w-40">
            <Label htmlFor="source">Sumber</Label>
            <select
              id="source"
              className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Semua</option>
              <option value="whatsapp">whatsapp</option>
              <option value="manual">manual</option>
              <option value="booking_form">booking_form</option>
              <option value="direct">direct</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Nama</th>
                <th className="text-left px-3 py-2">Kontak</th>
                <th className="text-left px-3 py-2">Sumber</th>
                <th className="text-right px-3 py-2">Booking</th>
                <th className="text-right px-3 py-2">Total spent</th>
                <th className="text-left px-3 py-2">Terakhir</th>
                <th className="text-right px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Memuat…
                  </td>
                </tr>
              )}
              {!query.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Tidak ada kontak.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const name = r.real_name || r.display_name || r.full_name || "(tanpa nama)";
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.phone || r.phone_normalized || r.email || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.source && <Badge variant="secondary">{r.source}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right">{r.total_bookings}</td>
                    <td className="px-3 py-2 text-right">
                      {r.total_spent > 0
                        ? `Rp ${Number(r.total_spent).toLocaleString("id-ID")}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.last_seen_at
                        ? new Date(r.last_seen_at).toLocaleDateString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>
                          Detail
                        </Button>
                        {mergeMode ? (
                          mergeMode.sourceId !== r.id ? (
                            <MergeButton
                              sourceId={mergeMode.sourceId}
                              targetId={r.id}
                              onDone={() => {
                                setMergeMode(null);
                                query.refetch();
                              }}
                            />
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setMergeMode(null)}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          )
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setMergeMode({ sourceId: r.id })}
                            title="Merge kontak ini ke kontak lain"
                          >
                            <Merge className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {mergeMode && (
        <div className="fixed bottom-4 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-md shadow-lg text-sm">
          Mode merge aktif — klik ikon merge pada kontak tujuan.
        </div>
      )}

      {openId && (
        <ContactDetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => query.refetch()} />
      )}
    </div>
  );
}

function MergeButton({
  sourceId,
  targetId,
  onDone,
}: {
  sourceId: string;
  targetId: string;
  onDone: () => void;
}) {
  const fn = useServerFn(mergeContacts);
  const mut = useMutation({
    mutationFn: () => fn({ data: { sourceId, targetId } }),
    onSuccess: () => {
      toast.success("Kontak berhasil di-merge");
      onDone();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  return (
    <Button
      size="sm"
      variant="default"
      onClick={() => {
        if (confirm("Merge kontak sumber ke kontak ini? Semua booking & thread akan dipindahkan.")) {
          mut.mutate();
        }
      }}
      disabled={mut.isPending}
    >
      {mut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Merge ke sini"}
    </Button>
  );
}

function ContactDetailDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detailFn = useServerFn(getContactDetail);
  const updateFn = useServerFn(updateContact);
  const reminderFn = useServerFn(sendPreArrivalReminder);
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["contact-detail", id],
    queryFn: () => detailFn({ data: { id } }),
  });

  const contact = detail.data?.contact as ContactRow & { notes?: string | null } | undefined;
  const bookings = (detail.data?.bookings ?? []) as Array<{
    id: string;
    reference_code: string | null;
    check_in: string;
    check_out: string;
    status: string;
    payment_status: string;
    total_amount: number;
  }>;
  const threads = (detail.data?.threads ?? []) as Array<{
    id: string;
    phone: string;
    last_message_at: string | null;
    last_message_preview: string | null;
    chat_summary: string | null;
  }>;

  const [realName, setRealName] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  useMemo(() => {
    if (contact) {
      setRealName(contact.real_name ?? "");
      setNotes((contact.notes as string) ?? "");
      setTags((contact.tags ?? []).join(", "));
    }
  }, [contact?.id]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          id,
          real_name: realName.trim() || null,
          notes: notes.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Tersimpan");
      qc.invalidateQueries({ queryKey: ["contact-detail", id] });
      onChanged();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const reminderMut = useMutation({
    mutationFn: (bookingId: string) => reminderFn({ data: { bookingId } }),
    onSuccess: () => toast.success("Pengingat pra-check-in terkirim"),
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {contact?.real_name || contact?.display_name || contact?.full_name || "Kontak"}
          </DialogTitle>
        </DialogHeader>

        {detail.isLoading && <div className="text-muted-foreground">Memuat…</div>}

        {contact && (
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Nomor</div>
                <div>{contact.phone || contact.phone_normalized || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Email</div>
                <div>{contact.email || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Sumber</div>
                <div>{contact.source || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total booking</div>
                <div>{contact.total_bookings}</div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-sm">Edit</h3>
              <div>
                <Label>Nama asli</Label>
                <Input value={realName} onChange={(e) => setRealName(e.target.value)} />
              </div>
              <div>
                <Label>Tag (pisahkan koma)</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, langganan" />
              </div>
              <div>
                <Label>Catatan</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Menyimpan…" : "Simpan"}
              </Button>
            </section>

            <section>
              <h3 className="font-semibold text-sm mb-2">Booking ({bookings.length})</h3>
              <div className="space-y-1 text-sm">
                {bookings.length === 0 && (
                  <div className="text-muted-foreground">Belum ada booking.</div>
                )}
                {bookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between border rounded px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">{b.reference_code ?? b.id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.check_in} → {b.check_out} · {b.status} · {b.payment_status}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reminderMut.mutate(b.id)}
                      disabled={reminderMut.isPending}
                    >
                      <Send className="w-3 h-3 mr-1" />
                      Kirim pengingat
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-semibold text-sm mb-2">Percakapan WhatsApp ({threads.length})</h3>
              <div className="space-y-1 text-sm">
                {threads.length === 0 && (
                  <div className="text-muted-foreground">Belum ada percakapan.</div>
                )}
                {threads.map((t) => (
                  <div key={t.id} className="border rounded px-3 py-2">
                    <div className="text-xs text-muted-foreground">
                      {t.phone} ·{" "}
                      {t.last_message_at
                        ? new Date(t.last_message_at).toLocaleString("id-ID")
                        : "—"}
                    </div>
                    {t.chat_summary && <div className="mt-1">{t.chat_summary}</div>}
                    {t.last_message_preview && (
                      <div className="mt-1 italic text-muted-foreground">
                        "{t.last_message_preview}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
