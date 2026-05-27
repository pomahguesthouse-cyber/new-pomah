/**
 * AI LAB -> Knowledge & SOP.
 *
 * Two tabs:
 *  - Knowledge -- general knowledge-base files
 *  - SOP       -- SOP files grouped per AI agent
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  FileText, Upload, Trash2, Loader2, Save, Pencil, Link2, Plus,
  BookOpen, GraduationCap, ChevronDown, ChevronRight, Sparkles,
  Building2, DollarSign, BedDouble, Wrench, Calculator, UserCog,
  Copy, Check, Images, ExternalLink,
} from "lucide-react";
import {
  listSopDocuments,
  createSopDocument,
  updateSopDocumentContent,
  deleteSopDocument,
  seedDefaultSopDocuments,
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
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.doc,.docx,.txt";
const ALLOWED = ["pdf", "doc", "docx", "txt"];

const ACCEPT_BROSUR = ".pdf,.jpg,.jpeg,.png,.webp";
const ALLOWED_BROSUR = ["pdf", "jpg", "jpeg", "png", "webp"];

type DocCategory = "knowledge" | "sop";
type Tab = DocCategory | "brosur";

const AGENTS = [
  { key: "front-office",   name: "Front Office Agent",   icon: Building2,  desc: "Reservasi, check-in, info tamu" },
  { key: "pricing",        name: "Pricing Agent",         icon: DollarSign, desc: "Tarif dinamis & promo" },
  { key: "customer-care",  name: "Customer Care Agent",   icon: BedDouble,  desc: "Status & kesiapan kamar" },
  { key: "maintenance",    name: "Maintenance Agent",     icon: Wrench,     desc: "Perbaikan & fasilitas" },
  { key: "finance",        name: "Finance Agent",         icon: Calculator, desc: "Pembayaran & tagihan" },
  { key: "manager",        name: "Manager Agent",         icon: UserCog,    desc: "Percakapan manajerial" },
];

/* ================================================================== */
/* Shell                                                               */
/* ================================================================== */

export function SopKnowledgeView() {
  const [tab, setTab] = useState<Tab>("knowledge");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold tracking-tight">Knowledge &amp; SOP</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Dokumen yang dipakai agent AI sebagai dasar menjawab. Upload file (PDF, DOC, DOCX, TXT)
            atau tambahkan tautan referensi.
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
          <TabBtn active={tab === "knowledge"} icon={BookOpen}      label="Knowledge" onClick={() => setTab("knowledge")} />
          <TabBtn active={tab === "sop"}       icon={GraduationCap} label="SOP"       onClick={() => setTab("sop")} />
          <TabBtn active={tab === "brosur"}    icon={Images}        label="Brosur"    onClick={() => setTab("brosur")} />
        </div>

        {tab === "knowledge" ? <KnowledgePanel /> : tab === "sop" ? <SopPanel /> : <BrosurPanel />}

        {/* Link to Media Library */}
        <a
          href="/admin/media"
          className="mt-8 flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 transition hover:bg-muted/60 hover:border-stone-300"
        >
          <Images className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Media Library</p>
            <p className="text-xs text-muted-foreground">
              Kelola gambar &amp; video brosur di halaman Media Library — termasuk alt text dan rename.
            </p>
          </div>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        </a>
      </div>
    </div>
  );
}

function TabBtn({
  active, icon: Icon, label, onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition",
        active ? "bg-white shadow-sm text-teal-900" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

/* ================================================================== */
/* Knowledge panel (flat list)                                         */
/* ================================================================== */

function KnowledgePanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSopDocuments);
  const createFn = useServerFn(createSopDocument);
  const deleteFn = useServerFn(deleteSopDocument);

  const { data, isLoading } = useQuery({
    queryKey: ["sop-documents", "knowledge"],
    queryFn: () => listFn({ data: { category: "knowledge" } }),
  });
  const documents = (data?.documents ?? []) as SopDocument[];

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sop-documents", "knowledge"] });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.includes(ext)) { toast.error("Format harus PDF, DOC, DOCX, atau TXT"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Ukuran file maksimal 10 MB"); return; }
    setUploading(true);
    try {
      const path = `knowledge/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("sop-documents").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      let content = "";
      if (ext === "txt") { try { content = (await file.text()).slice(0, 200000); } catch { content = ""; } }
      await createFn({ data: { name: file.name, filePath: path, fileType: ext, content, docCategory: "knowledge" } });
      toast.success("Dokumen diunggah");
      refresh();
    } catch (err) { toast.error((err as Error).message); } finally { setUploading(false); }
  };

  const remove = async (doc: SopDocument) => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    try { await deleteFn({ data: { id: doc.id } }); toast.success("Entri dihapus"); refresh(); }
    catch (err) { toast.error((err as Error).message); }
  };

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
        <Button variant="outline" className="gap-1.5" onClick={() => setLinkOpen(true)}>
          <Link2 className="h-4 w-4" /> Tambah Link
        </Button>
        <Button
          disabled={uploading}
          className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Mengunggah..." : "Upload Dokumen"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : documents.length === 0 ? (
        <EmptyState label="Belum ada file Knowledge." />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <DocCard key={doc.id} doc={doc} onDelete={() => remove(doc)} onSaved={refresh} />
          ))}
        </div>
      )}

      <LinkDialog open={linkOpen} docCategory="knowledge" agentKey={null} onClose={() => setLinkOpen(false)} onSaved={refresh} />
    </>
  );
}

/* ================================================================== */
/* Brosur panel (files sent to guests on request)                     */
/* ================================================================== */

function BrosurPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSopDocuments);
  const createFn = useServerFn(createSopDocument);
  const deleteFn = useServerFn(deleteSopDocument);

  const { data, isLoading } = useQuery({
    queryKey: ["sop-documents", "brosur"],
    queryFn: () => listFn({ data: { category: "brosur" } }),
  });
  // Only files in the dedicated `brosur` bucket are sendable brochures; exclude
  // Media Library assets (room-images bucket) that share doc_category='brosur'.
  const documents = ((data?.documents ?? []) as SopDocument[]).filter(
    (d) => (d.storage_bucket ?? "").toLowerCase() === "brosur",
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sop-documents", "brosur"] });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_BROSUR.includes(ext)) { toast.error("Format harus PDF, JPG, PNG, atau WEBP"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Ukuran file maksimal 10 MB"); return; }
    setUploading(true);
    try {
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("brosur").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      await createFn({ data: { name: file.name, filePath: path, fileType: ext, docCategory: "brosur", storageBucket: "brosur" } });
      toast.success("Brosur diunggah");
      refresh();
    } catch (err) { toast.error((err as Error).message); } finally { setUploading(false); }
  };

  const remove = async (doc: SopDocument) => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    try { await deleteFn({ data: { id: doc.id } }); toast.success("Brosur dihapus"); refresh(); }
    catch (err) { toast.error((err as Error).message); }
  };

  return (
    <>
      <div className="mb-4 rounded-xl border border-dashed border-teal-300 bg-teal-50 px-4 py-3">
        <p className="text-sm text-teal-800">
          File di sini dikirim otomatis oleh chatbot saat tamu meminta brosur, katalog, atau foto kamar.
          Upload PDF atau gambar (JPG, PNG, WEBP).
        </p>
      </div>

      <div className="mb-4 flex justify-end">
        <input ref={fileRef} type="file" accept={ACCEPT_BROSUR} className="hidden" onChange={onPick} />
        <Button
          disabled={uploading}
          className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Mengunggah..." : "Upload Brosur"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : documents.length === 0 ? (
        <EmptyState label="Belum ada file brosur." />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <BrosurCard key={doc.id} doc={doc} onDelete={() => remove(doc)} />
          ))}
        </div>
      )}
    </>
  );
}

function BrosurCard({ doc, onDelete }: { doc: SopDocument; onDelete: () => void }) {
  const bucket = doc.storage_bucket?.trim() || "sop-documents";
  const publicUrl = doc.file_path
    ? supabase.storage.from(bucket).getPublicUrl(doc.file_path).data.publicUrl
    : null;
  const isImage = /\.(jpe?g|png|webp|gif)$/i.test(doc.file_path ?? "");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-white p-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stone-100">
        {isImage && publicUrl ? (
          <img src={publicUrl} alt={doc.name} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-5 w-5 text-stone-500" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{doc.name}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {doc.file_type ?? "—"} · {formatDateID(doc.created_at)}
        </p>
      </div>
      {publicUrl && (
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-stone-100 hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0 px-2 text-xs text-rose-600 hover:text-rose-700"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ================================================================== */
/* SOP panel (grouped by agent)                                        */
/* ================================================================== */

function SopPanel() {
  const qc = useQueryClient();
  const seedFn = useServerFn(seedDefaultSopDocuments);
  const [seeding, setSeeding] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ "front-office": true });

  const seed = async () => {
    setSeeding(true);
    try {
      const res = await seedFn({ data: undefined });
      if (res.seeded === 0) toast.info("Semua SOP default sudah ada.");
      else {
        toast.success(`${res.seeded} SOP default berhasil ditambahkan!`);
        qc.invalidateQueries({ queryKey: ["sop-documents"] });
      }
    } catch (err) { toast.error((err as Error).message); }
    finally { setSeeding(false); }
  };

  return (
    <>
      {/* Seed button */}
      <div className="mb-5 flex items-center justify-between rounded-xl border border-dashed border-teal-300 bg-teal-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-teal-900">Isi SOP Default per Agent</p>
          <p className="text-xs text-teal-700">Tambahkan konten SOP bawaan untuk setiap agent yang belum memiliki SOP.</p>
        </div>
        <Button
          disabled={seeding}
          className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800 shrink-0"
          onClick={seed}
        >
          {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {seeding ? "Mengisi..." : "Isi Default"}
        </Button>
      </div>

      {/* Agent sections */}
      <div className="space-y-3">
        {AGENTS.map((agent) => (
          <AgentSection
            key={agent.key}
            agent={agent}
            expanded={!!open[agent.key]}
            onToggle={() => setOpen((o) => ({ ...o, [agent.key]: !o[agent.key] }))}
          />
        ))}
      </div>
    </>
  );
}

function AgentSection({
  agent,
  expanded,
  onToggle,
}: {
  agent: (typeof AGENTS)[number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSopDocuments);
  const deleteFn = useServerFn(deleteSopDocument);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const qKey = ["sop-documents", "sop", agent.key];
  const { data, isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => listFn({ data: { category: "sop", agentKey: agent.key } }),
    enabled: expanded,
  });
  const documents = (data?.documents ?? []) as SopDocument[];
  const refresh = () => qc.invalidateQueries({ queryKey: qKey });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.includes(ext)) { toast.error("Format harus PDF, DOC, DOCX, atau TXT"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Ukuran file maksimal 10 MB"); return; }
    setUploading(true);
    try {
      const path = `sop/${agent.key}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("sop-documents").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      let content = "";
      if (ext === "txt") { try { content = (await file.text()).slice(0, 200000); } catch { content = ""; } }
      const createFn = (await import("@/admin/modules/ai-lab/sop.functions")).createSopDocument;
      await createFn({ data: { name: file.name, filePath: path, fileType: ext, content, docCategory: "sop", agentKey: agent.key } });
      toast.success("Dokumen diunggah");
      refresh();
    } catch (err) { toast.error((err as Error).message); } finally { setUploading(false); }
  };

  const remove = async (doc: SopDocument) => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    try { await deleteFn({ data: { id: doc.id } }); toast.success("Entri dihapus"); refresh(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const Icon = agent.icon;

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      {/* Header */}
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 transition"
        onClick={onToggle}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{agent.name}</p>
          <p className="text-xs text-muted-foreground">{agent.desc}</p>
        </div>
        {!expanded && (
          <span className="text-xs text-muted-foreground mr-1">
            {data ? `${documents.length} file` : ""}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {/* Toolbar */}
          <div className="mb-3 flex justify-end gap-2">
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setLinkOpen(true)}>
              <Link2 className="h-3.5 w-3.5" /> Tambah Link
            </Button>
            <Button
              size="sm"
              disabled={uploading}
              className="gap-1.5 h-8 text-xs bg-teal-700 text-white hover:bg-teal-800"
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Mengunggah..." : "Upload"}
            </Button>
          </div>

          {/* List */}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : documents.length === 0 ? (
            <EmptyState label={`Belum ada SOP untuk ${agent.name}.`} compact />
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <DocCard key={doc.id} doc={doc} compact onDelete={() => remove(doc)} onSaved={refresh} />
              ))}
            </div>
          )}
        </div>
      )}

      <LinkDialog
        open={linkOpen}
        docCategory="sop"
        agentKey={agent.key}
        onClose={() => setLinkOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}

/* ================================================================== */
/* Shared components                                                   */
/* ================================================================== */

function EmptyState({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground",
      compact ? "py-6" : "py-16",
    )}>
      <FileText className={compact ? "h-5 w-5" : "h-8 w-8"} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function LinkDialog({
  open,
  docCategory,
  agentKey,
  onClose,
  onSaved,
}: {
  open: boolean;
  docCategory: DocCategory;
  agentKey: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createSopDocument);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setUrl(""); setDesc(""); };

  const save = async () => {
    if (!name.trim() || !url.trim()) { toast.error("Isi nama dan URL tautan"); return; }
    setSaving(true);
    try {
      await createFn({
        data: {
          name: name.trim(),
          fileType: "link",
          sourceUrl: url.trim(),
          content: desc.trim(),
          docCategory,
          agentKey: agentKey ?? "",
        },
      });
      toast.success("Tautan ditambahkan");
      reset();
      onClose();
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const title = docCategory === "knowledge" ? "Knowledge" : "SOP";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Tambah Tautan {title}</DialogTitle>
          <DialogDescription>
            Daftarkan tautan referensi beserta keterangannya agar chatbot mudah memakainya.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">Nama / Judul</p>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="contoh: Panduan Check-in" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">URL Tautan</p>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
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
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={saving} className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800" onClick={save}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Tambah
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocCard({
  doc,
  compact,
  onDelete,
  onSaved,
}: {
  doc: SopDocument;
  compact?: boolean;
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
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className={cn("rounded-xl border border-border bg-white", compact ? "p-3" : "p-4")}>
      <div className="flex items-start gap-3">
        <span className={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          compact ? "h-8 w-8" : "h-9 w-9",
          isLink ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700",
        )}>
          {isLink ? <Link2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{doc.name}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isLink ? "tautan" : (doc.file_type ?? "—")} · {formatDateID(doc.created_at)}
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
            onClick={() => { setDraft(doc.content ?? ""); setEditing((v) => !v); }}
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
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Batal</Button>
            <Button
              size="sm"
              disabled={saving}
              className="h-8 gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
              onClick={save}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
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
                ? "Belum ada keterangan. Klik Edit keterangan agar chatbot tahu cara memakai tautan ini."
                : "Belum ada teks. Klik Edit teks untuk menempelkan isi dokumen agar bisa dipakai agent AI."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
