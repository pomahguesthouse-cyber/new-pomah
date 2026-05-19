/**
 * AI LAB → Knowledge SOP.
 *
 * Upload SOP documents (pdf / doc / docx / txt). The files are stored in
 * the `sop-documents` bucket and their text `content` is what the AI
 * agents read when forming answers. `.txt` content is extracted on
 * upload; for other formats staff can paste/adjust the text.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Loader2, Save, Pencil } from "lucide-react";
import {
  listSopDocuments,
  createSopDocument,
  updateSopDocumentContent,
  deleteSopDocument,
  type SopDocument,
} from "@/admin/modules/ai-lab/sop.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

      // Plain-text content is extracted directly; other formats keep an
      // empty content that staff can paste in afterwards.
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
    if (!confirm(`Hapus dokumen "${doc.name}"?`)) return;
    try {
      await deleteFn({ data: { id: doc.id } });
      toast.success("Dokumen dihapus");
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
              Unggah dokumen SOP &amp; kebijakan (PDF, DOC, DOCX, TXT). Isi teksnya dipakai agent AI
              sebagai dasar menjawab.
            </p>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
          <Button
            disabled={uploading}
            className="shrink-0 gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">Belum ada dokumen SOP.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <SopCard key={doc.id} doc={doc} onDelete={() => remove(doc)} onSaved={refresh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({ data: { id: doc.id, content: draft } });
      toast.success("Teks dokumen disimpan");
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{doc.name}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {doc.file_type ?? "—"} ·{" "}
            {formatDateID(doc.created_at)}
          </p>
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
            Edit teks
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
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tempel isi teks dokumen di sini. Teks ini yang dibaca agent AI."
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
              Belum ada teks. Klik “Edit teks” untuk menempelkan isi dokumen agar bisa dipakai agent
              AI.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
