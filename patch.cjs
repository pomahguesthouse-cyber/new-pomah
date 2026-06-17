const fs = require('fs');
let content = fs.readFileSync('src/routes/admin/whatsapp.tsx', 'utf8');

content = content.replace(
  'toast.success("Ringkasan obrolan berhasil dibuat!");',
  'toast.success("Context summary berhasil diperbarui");'
);

const panelCode = `              <ContextSummaryPanel
                thread={thread.thread}
                onRegenerate={() => summarizeMut.mutate()}
                regenerating={summarizeMut.isPending}
              />

              <Separator />

              <WhatsappSummary
                thread={thread.thread}`;

content = content.replace(
  `              <WhatsappSummary
                thread={thread.thread}`,
  panelCode
);

const componentCode = `  );
}

// ── Context Summary Panel (structured JSON display) ─────────────────────────

interface SummaryJsonData {
  short_summary?: string | null;
  guest_name?: string | null;
  last_topic?: string | null;
  room_type?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guest_count?: string | number | null;
  booking_status?: string | null;
  payment_status?: string | null;
  complaint_active?: boolean | null;
  needs_human?: boolean | null;
  unresolved_question?: string | null;
}

function ContextSummaryPanel({
  thread,
  onRegenerate,
  regenerating,
}: {
  thread: Record<string, any>;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  // Safely parse chat_summary_json
  let json: SummaryJsonData | null = null;
  try {
    const raw = thread.chat_summary_json;
    if (raw && typeof raw === "object" && Object.keys(raw).length > 0) {
      json = raw as SummaryJsonData;
    } else if (typeof raw === "string" && raw.trim().startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        json = parsed as SummaryJsonData;
      }
    }
  } catch {
    // Invalid JSON — fall through to fallback
  }

  const fallbackText = thread.chat_summary || null;
  const hasJson = !!json;
  const hasFallback = !!fallbackText;
  const updatedAt = thread.chat_summary_updated_at;

  const v = (val: unknown): string => {
    if (val === null || val === undefined || val === "") return "−";
    if (typeof val === "boolean") return val ? "Ya" : "Tidak";
    return String(val);
  };

  const statusColor = (status: string | null | undefined) => {
    if (!status) return "text-muted-foreground";
    switch (status) {
      case "confirmed": return "text-emerald-600";
      case "paid": return "text-emerald-600";
      case "pending": return "text-amber-600";
      case "partial": return "text-amber-600";
      case "cancelled": return "text-rose-600";
      case "unpaid": return "text-rose-600";
      case "inquiry": return "text-blue-600";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Context Summary
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-primary hover:text-primary/80"
          disabled={regenerating}
          onClick={onRegenerate}
          title="Regenerate context summary menggunakan AI"
        >
          <RefreshCw className={cn("mr-1 h-3 w-3", regenerating && "animate-spin")} />
          {regenerating ? "Generating..." : "Regenerate"}
        </Button>
      </div>

      {hasJson ? (
        <div className="mt-2 space-y-1.5">
          {/* Short summary */}
          {json!.short_summary && (
            <div className="rounded-md border border-border bg-card p-2">
              <p className="text-xs leading-relaxed text-foreground">{json!.short_summary}</p>
            </div>
          )}

          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">Nama tamu</dt>
            <dd className="font-medium truncate">{v(json!.guest_name)}</dd>

            <dt className="text-muted-foreground">Topik terakhir</dt>
            <dd className="font-medium truncate">{v(json!.last_topic)}</dd>

            <dt className="text-muted-foreground">Tipe kamar</dt>
            <dd className="font-medium truncate">{v(json!.room_type)}</dd>

            <dt className="text-muted-foreground">Check-in</dt>
            <dd className="font-medium">{v(json!.check_in)}</dd>

            <dt className="text-muted-foreground">Check-out</dt>
            <dd className="font-medium">{v(json!.check_out)}</dd>

            <dt className="text-muted-foreground">Jumlah tamu</dt>
            <dd className="font-medium">{v(json!.guest_count)}</dd>

            <dt className="text-muted-foreground">Status booking</dt>
            <dd className={cn("font-medium", statusColor(json!.booking_status))}>
              {v(json!.booking_status)}
            </dd>

            <dt className="text-muted-foreground">Pembayaran</dt>
            <dd className={cn("font-medium", statusColor(json!.payment_status))}>
              {v(json!.payment_status)}
            </dd>

            <dt className="text-muted-foreground">Komplain aktif</dt>
            <dd className={cn("font-medium", json!.complaint_active ? "text-rose-600" : "")}>
              {v(json!.complaint_active)}
            </dd>

            <dt className="text-muted-foreground">Butuh human</dt>
            <dd className={cn("font-medium", json!.needs_human ? "text-amber-600" : "")}>
              {v(json!.needs_human)}
            </dd>
          </dl>

          {json!.unresolved_question && json!.unresolved_question !== "null" && (
            <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Pertanyaan belum selesai
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                {json!.unresolved_question}
              </p>
            </div>
          )}

          {updatedAt && (
            <p className="text-[9px] text-muted-foreground mt-1">
              Diperbarui: {formatRelativeDateID(updatedAt)}
            </p>
          )}
        </div>
      ) : hasFallback ? (
        <div className="mt-2">
          <div className="rounded-md border border-border bg-card p-2">
            <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">
              {fallbackText}
            </p>
          </div>
          {updatedAt && (
            <p className="text-[9px] text-muted-foreground mt-1">
              Diperbarui: {formatRelativeDateID(updatedAt)}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground italic">
            Klik Regenerate untuk membuat versi terstruktur.
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">
            Belum ada context summary. Klik <strong>Regenerate</strong> untuk membuat.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({`;

content = content.replace(
  '  );\n}\n\nfunction Row({',
  componentCode
);

fs.writeFileSync('src/routes/admin/whatsapp.tsx', content, 'utf8');
console.log("Patched whatsapp.tsx successfully");
