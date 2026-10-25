import { memo, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { WA_KEYBOARD_TEXT_PROPS } from "./wa-keyboard";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/services/wa-outbound-attachment";
import {
  canSubmitReply,
  type ComposerSendPayload,
} from "@/admin/modules/whatsapp/wa-composer-send";

type ComposerAttachment = {
  phase: "processing" | "uploading" | "ready";
  name: string;
  size: number;
  mime: string;
  previewUrl: string | null;
  progress: number;
  path: string | null;
};

type ReplyComposerProps = {
  compact: boolean;
  metaWindowClosed: boolean;
  metaWindowMessage: string;
  attachment: ComposerAttachment | null;
  attachmentBusy: boolean;
  onSend: (payload: ComposerSendPayload) => boolean;
  onPickFile: (list: FileList | null) => void;
  onClearAttachment: () => void;
  fileAccept: string;
};

/**
 * Kolom balasan yang state ketikannya tidak ikut me-render ulang daftar pesan.
 * Tap Kirim memakai pointerdown + preventDefault supaya keyboard Android tidak
 * menutup (dan menelan tap) saat textarea kehilangan fokus.
 */
export const ReplyComposer = memo(function ReplyComposer({
  compact,
  metaWindowClosed,
  metaWindowMessage,
  attachment,
  attachmentBusy,
  onSend,
  onPickFile,
  onClearAttachment,
  fileAccept,
}: ReplyComposerProps) {
    const [draft, setDraft] = useState("");
    const draftRef = useRef("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const consumedPath = useRef<string | null>(null);
    const attachmentRef = useRef(attachment);
    const busyRef = useRef(attachmentBusy);
    const closedRef = useRef(metaWindowClosed);
    const onSendRef = useRef(onSend);
    attachmentRef.current = attachment;
    busyRef.current = attachmentBusy;
    closedRef.current = metaWindowClosed;
    onSendRef.current = onSend;
    if (!attachment?.path) consumedPath.current = null;

    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      if (!compact) {
        el.style.height = "";
        return;
      }
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, [draft, compact]);

    const visibleAttachment =
      attachment && attachment.path && consumedPath.current === attachment.path ? null : attachment;
    const attachmentReady = visibleAttachment?.phase === "ready" && !!visibleAttachment.path;
    const canSubmit = canSubmitReply({
      body: draft,
      attachmentReady,
      attachmentBusy,
      metaWindowClosed,
    });

    const submit = () => {
      const att = attachmentRef.current;
      const ready =
        !!att && att.phase === "ready" && !!att.path && consumedPath.current !== att.path;
      const body = draftRef.current;
      if (
        !canSubmitReply({
          body,
          attachmentReady: ready,
          attachmentBusy: busyRef.current,
          metaWindowClosed: closedRef.current,
        })
      ) {
        return;
      }
      const snapshotAtt = ready
        ? {
            path: att.path as string,
            name: att.name,
            mime: att.mime,
            size: att.size,
            previewUrl: att.previewUrl,
          }
        : null;
      draftRef.current = "";
      const field = textareaRef.current;
      if (field) {
        field.value = "";
        if (compact) field.style.height = "auto";
      }
      setDraft("");
      if (snapshotAtt) consumedPath.current = snapshotAtt.path;
      const accepted = onSendRef.current({ body: body.trim(), attachment: snapshotAtt });
      if (!accepted) {
        draftRef.current = body;
        if (field) field.value = body;
        setDraft(body);
        if (snapshotAtt && consumedPath.current === snapshotAtt.path) consumedPath.current = null;
      }
    };

    const onSendPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      // preventDefault menahan fokus di textarea: keyboard tidak menutup,
      // jadi tombol tidak bergeser sebelum pointerup (tap Android yang "hilang").
      event.preventDefault();
      const el = event.currentTarget;
      el.dataset.pressed = "true";
      const clear = () => {
        delete el.dataset.pressed;
      };
      el.addEventListener("pointerup", clear, { once: true });
      el.addEventListener("pointercancel", clear, { once: true });
      submit();
    };

    return (
      <footer
        className={cn(
          "wa-reply-footer relative z-20 min-w-0 max-w-full shrink-0 border-t border-border bg-card",
          "px-2 pt-2 min-[700px]:px-3 min-[700px]:pt-3 lg:p-3",
          "pb-2 lg:pb-3",
        )}
      >
        {metaWindowClosed && (
          <p
            role="status"
            className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-950 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
          >
            {metaWindowMessage}
          </p>
        )}
        {visibleAttachment && (
          <div className="mb-2 flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5">
            {visibleAttachment.previewUrl ? (
              <img
                src={visibleAttachment.previewUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-red-500 text-white">
                <FileText className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{visibleAttachment.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {visibleAttachment.phase === "processing"
                  ? "Memproses gambar…"
                  : visibleAttachment.phase === "uploading"
                    ? `Mengunggah ${visibleAttachment.progress}% · ${formatFileSize(visibleAttachment.size)}`
                    : formatFileSize(visibleAttachment.size)}
              </span>
              {visibleAttachment.phase === "uploading" && (
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/10">
                  <span
                    className="block h-full bg-[#008069]"
                    style={{ width: `${visibleAttachment.progress}%` }}
                  />
                </span>
              )}
            </span>
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              style={{ touchAction: "manipulation" }}
              aria-label="Hapus lampiran"
              onClick={onClearAttachment}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={fileAccept}
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            void onPickFile(files);
            e.target.value = "";
          }}
        />
        {compact ? (
          <div className="flex min-w-0 items-end gap-1.5 min-[700px]:gap-2">
            <AttachButton
              disabled={metaWindowClosed || attachmentBusy}
              title={metaWindowClosed ? metaWindowMessage : "Lampirkan berkas"}
              onPick={() => fileRef.current?.click()}
            />
            <Textarea
              ref={textareaRef}
              placeholder="Ketik balasan…"
              rows={1}
              value={draft}
              onChange={(e) => {
                draftRef.current = e.target.value;
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              {...WA_KEYBOARD_TEXT_PROPS}
              enterKeyHint="enter"
              className="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl px-3 py-2.5 text-base leading-5 md:text-base"
            />
            <SendButton
              compact
              canSubmit={canSubmit}
              title={metaWindowClosed ? metaWindowMessage : "Kirim"}
              onPointerDown={onSendPointerDown}
            />
          </div>
        ) : (
          <>
            <Textarea
              ref={textareaRef}
              placeholder="Type a reply…  ⌘/Ctrl + Enter to send"
              {...WA_KEYBOARD_TEXT_PROPS}
              rows={2}
              value={draft}
              onChange={(e) => {
                draftRef.current = e.target.value;
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              className="min-h-16 resize-none text-base md:text-sm"
            />
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <AttachButton
                disabled={metaWindowClosed || attachmentBusy}
                title={metaWindowClosed ? metaWindowMessage : "Lampirkan berkas"}
                onPick={() => fileRef.current?.click()}
              />
              <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {draft.length} chars
              </p>
              <SendButton
                compact={false}
                canSubmit={canSubmit}
                title={metaWindowClosed ? metaWindowMessage : "Send"}
                onPointerDown={onSendPointerDown}
              />
            </div>
          </>
        )}
      </footer>
    );
});

function AttachButton({
  disabled,
  title,
  onPick,
}: {
  disabled: boolean;
  title: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-40"
      style={{ touchAction: "manipulation" }}
      aria-label="Lampirkan berkas"
      title={title}
      disabled={disabled}
      onClick={onPick}
    >
      <Paperclip className="h-5 w-5" />
    </button>
  );
}

function SendButton({
  compact,
  canSubmit,
  title,
  onPointerDown,
}: {
  compact: boolean;
  canSubmit: boolean;
  title: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={compact ? "Kirim" : "Send"}
      aria-disabled={!canSubmit}
      title={title}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "inline-flex shrink-0 touch-manipulation select-none items-center justify-center bg-primary text-primary-foreground shadow",
        "h-11 min-h-11 min-w-11 active:scale-95 data-[pressed=true]:scale-95",
        compact ? "w-11 rounded-full" : "rounded-md px-4",
        !canSubmit && "opacity-40",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={(event) => {
        // Cadangan untuk WebView yang tetap memindahkan fokus pada mousedown.
        event.preventDefault();
      }}
    >
      <Send
        className={compact ? "pointer-events-none h-4 w-4" : "pointer-events-none mr-2 h-3.5 w-3.5"}
      />
      {compact ? null : "Send"}
    </button>
  );
}
