/**
 * AI LAB → Knowledge SOP.
 *
 * SOP knowledge entries the AI agents draw on. Two kinds:
 *  - Uploaded files (pdf/doc/docx/txt) stored in the `sop-documents`
 *    bucket — `.txt` content is extracted on upload.
 *  - External links (URL + description) for references the chatbot can
 *    cite or share with guests.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Loader2, Save, Pencil, Link2, Plus } from "lucide-react";
import {
  listSopDocuments,
  createSopDocument,
  updateSopDocumentContent,
  deleteSopDocument,
  type SopDocument,
} from "@/admin/modules/ai-lab/sop.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDateID } from "@/lib/utils";

const ACCEPT = ".pdf,.doc,.docx,.txt";
const ALLOWED = ["pdf", "doc", "docx", "txt"];

export function SopKnowledgeView() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSopDocuments);
  const createFn = useServerFn(createSopDocument);
  const deleteFn = useServerFn(deleteSopDocument);

  const { data, isLoading } = useQuery({
    queryKey: ["sop-documents"],
    queryFn: () => listFn(),
  });
  const documents = (data?.documents ?? []) as SopDocument[];

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["sop-documents"] });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.includes(ext)) {
      toast.error("Format harus PDF, DOC, DOCX, atau TXT");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Ukuran file maksimal 10 MB");
      return;
    }
    setUploading(true);
    try {
      const path = `sop/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("sop-documents")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      let content = "";
      if (ext === "txt") {
        try {
          content = (await file.text()).slice(0, 200000);
        } catch {
          content = "";
        }
      }

      await createFn({ data: { name: file.name, filePath: path, fileType: ext, content } });
      toast.success("Dokumen diunggah");
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (doc: SopDocument) => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    try {
      await deleteFn({ data: { id: doc.id } });
      toast.success("Entri dihapus");
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Knowledge SOP</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Dokumen SOP &amp; kebijakan (PDF, DOC, DOCX, TXT) atau tautan referensi. Isinya
              dipakai agent AI sebagai dasar menjawab.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
            <Button variant="outline" className="gap-1.5" onClick={() => setLinkOpen(true)}>
              <Link2 className="h-4 w-4" />
              Tambah Link
            </Button>
            <Button
              disabled={uploading}
              className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Mengunggah…" : "Upload Dokumen"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">Belum ada entri SOP.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <SopCard key={doc.id} doc={doc} onDelete={() => remove(doc)} onSaved={refresh} />
            ))}
          </div>
        )}
      </div>

      <LinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} onSaved={refresh} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add-link dialog                                                     */
/* ------------------------------------------------------------------ */

function LinkDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createSopDocument);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setUrl("");
    setDesc("");
  };

  const save = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error("Isi nama dan URL tautan");
      return;
    }
    setSaving(true);
    try {
      await createFn({
        data: { name: name.trim(), fileType: "link", sourceUrl: url.trim(), content: desc.trim() },
      });
      toast.success("Tautan ditambahkan");
      reset();
      onClose();
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Tambah Tautan SOP</DialogTitle>
          <DialogDescription>
            Daftarkan tautan referensi beserta keterangannya agar chatbot mudah memakainya.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">Nama / Judul</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="contoh: Panduan Check-in"
            />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">URL Tautan</p>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Keterangan</p>
            <Textarea
              rows={4}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Jelaskan isi tautan ini agar chatbot tahu kapan & bagaimana memakainya."
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            disabled={saving}
            className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
            onClick={save}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Tambah
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Entry card                                                          */
/* ------------------------------------------------------------------ */

function SopCard({
  doc,
  onDelete,
  onSaved,
}: {
  doc: SopDocument;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(updateSopDocumentContent);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.content ?? "");
  const [saving, setSaving] = useState(false);
  const isLink = !!doc.source_url;

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({ data: { id: doc.id, content: draft } });
      toast.success("Teks disimpan");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="flex items-start gap-3">
        <span
          className={
            isLink
              ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
              : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"
          }
        >
          {isLink ? <Link2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{doc.name}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isLink ? "tautan" : (doc.file_type ?? "—")} ·{" "}
            {new Date(doc.created_at).toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
            {doc.file_type ?? "—"} ·{" "}
            {formatDateID(doc.created_at)}
          </p>
          {isLink && (
            <a
              href={doc.source_url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-xs text-violet-700 underline underline-offset-2"
            >
              {doc.source_url}
            </a>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => {
              setDraft(doc.content ?? "");
              setEditing((v) => !v);
            }}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {isLink ? "Edit keterangan" : "Edit teks"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs text-rose-600 hover:text-rose-700"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={isLink ? 4 : 8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isLink
                ? "Keterangan tautan — agar chatbot tahu kapan memakainya."
                : "Tempel isi teks dokumen di sini. Teks ini yang dibaca agent AI."
            }
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              disabled={saving}
              className="h-8 gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
              onClick={save}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Simpan
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {doc.content?.trim() ? (
            <p className="line-clamp-3 whitespace-pre-line rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">
              {doc.content}
            </p>
          ) : (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700">
              {isLink
                ? "Belum ada keterangan. Klik “Edit keterangan” agar chatbot tahu cara memakai tautan ini."
                : "Belum ada teks. Klik “Edit teks” untuk menempelkan isi dokumen agar bisa dipakai agent AI."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
