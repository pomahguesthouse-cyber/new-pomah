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
  Image, Copy, Check, ExternalLink, Tag,
} from "lucide-react";
import {
  listSopDocuments,
  createSopDocument,
  updateSopDocumentContent,
  deleteSopDocument,
  renameSopDocument,
  seedDefaultSopDocuments,
  type SopDocument,
} from "@/admin/modules/ai-lab/sop.functions";
import { convertToWebP } from "@/lib/image-webp";
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

const BROSUR_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const BROSUR_ALLOWED = ["pdf", "jpg", "jpeg", "png", "webp"];
const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];

type DocCategory = "knowledge" | "sop" | "brosur";

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
  const [tab, setTab] = useState<DocCategory>("knowledge");

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
          <TabBtn active={tab === "brosur"}    icon={Image}         label="Brosur"    onClick={() => setTab("brosur")} />
        </div>

        {tab === "knowledge" ? <KnowledgePanel /> : tab === "sop" ? <SopPanel /> : <BrosurPanel />}
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
/* Brosur panel                                                        */
/* ================================================================== */

function BrosurPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSopDocuments);
  const deleteFn = useServerFn(deleteSopDocument);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["sop-documents", "brosur"],
    queryFn: () => listFn({ data: { category: "brosur" } }),
  });
  const documents = (data?.documents ?? []) as SopDocument[];
  const refresh = () => qc.invalidateQueries({ queryKey: ["sop-documents", "brosur"] });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    let uploaded = 0;
    for (const rawFile of files) {
      const origExt = (rawFile.name.split(".").pop() ?? "").toLowerCase();
      if (!BROSUR_ALLOWED.includes(origExt)) { toast.error(`Format tidak didukung: ${rawFile.name}`); continue; }
      if (rawFile.size > 20 * 1024 * 1024) { toast.error(`File terlalu besar (maks 20 MB): ${rawFile.name}`); continue; }
      try {
        // Convert raster images to WebP for smaller size and better SEO
        const file = rawFile.type.startsWith("image/") ? await convertToWebP(rawFile) : rawFile;
        const ext = (file.name.split(".").pop() ?? origExt).toLowerCase();
        const baseName = rawFile.name.replace(/\.[^.]+$/, ""); // original name (no ext) for display
        const path = `brosur/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("sop-documents").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const createFn = (await import("@/admin/modules/ai-lab/sop.functions")).createSopDocument;
        // Store clean name (no UUID) so it doubles as the img alt text
        await createFn({ data: { name: baseName, filePath: path, fileType: ext, content: "", docCategory: "brosur" } });
        uploaded++;
      } catch (err) { toast.error(`Gagal: ${(err as Error).message}`); }
    }
    setUploading(false);
    if (uploaded > 0) { toast.success(`${uploaded} file diunggah`); refresh(); }
  };

  const remove = async (doc: SopDocument) => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    try { await deleteFn({ data: { id: doc.id } }); toast.success("File dihapus"); refresh(); }
    catch (err) { toast.error((err as Error).message); }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          File gambar &amp; PDF yang bisa dikirimkan ke tamu saat diminta.
        </p>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept={BROSUR_ACCEPT} multiple className="hidden" onChange={onPick} />
          <Button
            disabled={uploading}
            className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Mengunggah..." : "Upload File"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border py-16 text-muted-foreground">
          <Image className="h-10 w-10" />
          <p className="text-sm font-medium">Belum ada brosur.</p>
          <p className="text-xs">Upload gambar (JPG/PNG → otomatis dikonversi ke WebP) atau PDF.</p>
          <Button
            variant="outline"
            className="mt-2 gap-1.5"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" /> Pilih File
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <BrosurCard key={doc.id} doc={doc} onDelete={() => remove(doc)} onRenamed={refresh} />
          ))}
        </div>
      )}
    </>
  );
}

function BrosurCard({
  doc,
  onDelete,
  onRenamed,
}: {
  doc: SopDocument;
  onDelete: () => void;
  onRenamed: () => void;
}) {
  const ext = (doc.file_type ?? "").toLowerCase();
  const isImage = IMAGE_EXTS.includes(ext);
  const [copied, setCopied] = useState(false);
  const [editingAlt, setEditingAlt] = useState(false);
  const [altValue, setAltValue] = useState(doc.name);
  const [savingAlt, setSavingAlt] = useState(false);
  const renameFn = useServerFn(renameSopDocument);

  const publicUrl = doc.file_path
    ? supabase.storage.from("sop-documents").getPublicUrl(doc.file_path).data.publicUrl
    : null;

  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    toast.success("Link disalin!");
    setTimeout(() => setCopied(false), 2000);
  };

  const saveAlt = async () => {
    const trimmed = altValue.trim();
    if (!trimmed) return;
    setSavingAlt(true);
    try {
      await renameFn({ data: { id: doc.id, name: trimmed } });
      toast.success("Alt text diperbarui");
      setEditingAlt(false);
      onRenamed();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingAlt(false);
    }
  };

  return (
    <div className="group rounded-xl border border-border bg-white overflow-hidden flex flex-col">
      {/* Preview */}
      <div className="relative h-36 bg-stone-100 flex items-center justify-center overflow-hidden">
        {isImage && publicUrl ? (
          <img src={publicUrl} alt={doc.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-stone-400">
            <FileText className="h-10 w-10" />
            <span className="text-xs uppercase font-medium">{ext}</span>
          </div>
        )}
        {/* WebP badge */}
        {ext === "webp" && (
          <span className="absolute left-2 top-2 rounded bg-teal-700/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
            WebP
          </span>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs">
                <ExternalLink className="h-3.5 w-3.5" /> Buka
              </Button>
            </a>
          )}
          <Button
            size="sm"
            variant="destructive"
            className="h-8 gap-1 text-xs"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> Hapus
          </Button>
        </div>
      </div>

      {/* Alt text edit row */}
      {editingAlt ? (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
          <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={altValue}
            onChange={(e) => setAltValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveAlt();
              if (e.key === "Escape") { setEditingAlt(false); setAltValue(doc.name); }
            }}
            className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Deskripsi gambar (alt text)"
          />
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={savingAlt}
            onClick={saveAlt}
          >
            {savingAlt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setAltValue(doc.name); setEditingAlt(true); }}
          className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-left hover:bg-muted/30 transition"
          title="Edit alt text (SEO)"
        >
          <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground italic">
            {doc.name}
          </span>
          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        </button>
      )}

      {/* Info + copy action */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {ext} · {formatDateID(doc.created_at)}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={copyLink}
          disabled={!publicUrl}
          title="Salin link untuk dikirim ke tamu"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin Link"}
        </Button>
      </div>
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
