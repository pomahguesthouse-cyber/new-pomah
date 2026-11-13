/**
 * Jalur deterministik kanal manajer: bantuan, konfirmasi YA/KONFIRMASI,
 * pagination, perintah daftar/okupansi/pembayaran, RBAC, audit, rate limit.
 */

import { formatManagerCommandResult, formatRoomRatesList } from "@/ai/manager-command-parser";
import { executeTool, type ToolExecutionResult } from "@/tools/executor";
import type { ToolContext } from "@/tools/types";
import { logManagerAction, summarizeArgs } from "./audit";
import { parseManagerChatCommand } from "./commands";
import {
  isExplicitManagerConfirmation,
  isManagerCancelMessage,
  isManagerHelpMessage,
  isNextPageMessage,
} from "./confirm";
import { buildManagerHelp } from "./help";
import {
  clearPendingAction,
  getLastListQuery,
  getPendingAction,
  rememberLastListQuery,
  rememberPendingAction,
} from "./pending-actions";
import { checkManagerRateLimit } from "./rate-limit";
import {
  isManagerWriteTool,
  roleCanHardDelete,
  roleCanUseTool,
  type ManagerRole,
  unauthorizedToolMessage,
} from "./rbac";

export interface ManagerDispatchResult {
  handled: true;
  reply: string;
  toolsUsed: string[];
  intent: string;
}

function parseJson(output: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(output);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatOccupancy(output: string): string {
  const payload = parseJson(output);
  if (!payload) return output;
  if (payload.ok === false) return String(payload.error ?? "Gagal mengambil okupansi.");
  const lines = [
    `Okupansi ${payload.date_label ?? payload.date ?? ""}`,
    `${payload.occupied_count ?? 0}/${payload.total_rooms ?? 0} kamar terisi (${payload.occupancy_pct ?? 0}%)`,
    `Check-in: ${payload.arrivals ?? 0} · Check-out: ${payload.departures ?? 0}`,
  ];
  const occupied = Array.isArray(payload.occupied) ? payload.occupied : [];
  if (occupied.length) {
    lines.push("", "Terisi:");
    for (const row of occupied.slice(0, 20)) {
      const item = row as Record<string, unknown>;
      lines.push(`• ${item.room ?? "Kamar"} — ${item.guest ?? "Tamu"} (${item.ref ?? "-"})`);
    }
  }
  const vacant = Array.isArray(payload.vacant) ? payload.vacant : [];
  if (vacant.length) {
    const names = vacant
      .slice(0, 15)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return `${item.number ?? ""} ${item.room_type ?? ""}`.trim();
      })
      .filter(Boolean);
    lines.push("", `Kosong: ${names.join(", ")}${vacant.length > 15 ? "…" : ""}`);
  }
  return lines.join("\n");
}

function formatGenericToolResult(toolName: string, output: string): string {
  if (toolName === "get_occupancy_summary") return formatOccupancy(output);
  if (toolName === "get_bookings" || toolName === "update_room_rate" || toolName === "set_daily_room_rate") {
    return formatManagerCommandResult(
      { toolName: toolName as "get_bookings", rawArgs: "{}", label: toolName },
      output,
    );
  }
  const payload = parseJson(output);
  if (!payload) return output;
  if (payload.needs_confirmation) {
    return String(payload.error ?? payload.preview ?? "Perlu konfirmasi. Balas YA atau KONFIRMASI untuk lanjut, atau BATAL.");
  }
  if (payload.ok === false) return String(payload.error ?? "Perintah gagal diproses.");
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (toolName === "create_booking" && payload.ok) {
    const rooms = Array.isArray(payload.rooms)
      ? (payload.rooms as Array<any>).map((r) => `${r.quantity ?? 1}x ${r.room_type}`).join(", ")
      : String(payload.room_type ?? "");
    return [
      "✅ Booking dibuat",
      `🏷 ${payload.reference_code}`,
      `👤 ${(payload.guest as any)?.full_name ?? ""}`,
      `🛏 ${rooms}`,
      `📅 ${payload.check_in_tampil ?? payload.check_in} – ${payload.check_out_tampil ?? payload.check_out} (${payload.nights} malam)`,
      `💰 Total Rp${Number(payload.total ?? 0).toLocaleString("id-ID")}`,
    ].filter((line) => line.trim() !== "👤").join("\n");
  }
  return output;
}

function formatNeedsConfirmation(toolName: string, payload: Record<string, unknown>, fallback: string): string {
  const preview = typeof payload.preview === "string" ? payload.preview : "";
  const error = typeof payload.error === "string" ? payload.error : "";
  const body = preview || error || fallback;
  return `${body}\n\nBalas YA atau KONFIRMASI untuk menjalankan. Balas BATAL untuk membatalkan.`.trim();
}

function resultStatus(payload: Record<string, unknown> | null): "ok" | "error" | "needs_confirmation" {
  if (!payload) return "error";
  if (payload.needs_confirmation) return "needs_confirmation";
  if (payload.ok === false) return "error";
  return "ok";
}

async function runAuthorizedTool(
  toolName: string,
  rawArgs: string,
  ctx: ToolContext,
  command: string,
): Promise<{ output: string; status: "ok" | "error" | "needs_confirmation" | "denied" }> {
  const role = ctx.managerRole ?? null;
  if (!roleCanUseTool(role, toolName) && toolName !== "help") {
    const message = unauthorizedToolMessage(role, toolName);
    await logManagerAction(ctx.supabaseAdmin as any, {
      actor_phone: ctx.phone ?? "",
      actor_role: role,
      actor_id: ctx.managerId,
      tool_name: toolName,
      command,
      args_summary: summarizeArgs(toolName, safeParseArgs(rawArgs)),
      result: "denied",
      error: message,
    });
    return { output: JSON.stringify({ ok: false, error: message }), status: "denied" };
  }

  if (toolName === "delete_booking") {
    const args = safeParseArgs(rawArgs);
    if (String(args.mode ?? "cancel") === "hard" && !roleCanHardDelete(role)) {
      const message = "Hapus permanen hanya untuk Super Admin. Gunakan batal (cancel) untuk membatalkan booking.";
      await logManagerAction(ctx.supabaseAdmin as any, {
        actor_phone: ctx.phone ?? "",
        actor_role: role,
        actor_id: ctx.managerId,
        tool_name: toolName,
        command,
        args_summary: summarizeArgs(toolName, args),
        result: "denied",
        error: message,
      });
      return { output: JSON.stringify({ ok: false, error: message }), status: "denied" };
    }
  }

  const executed: ToolExecutionResult = await executeTool(toolName, rawArgs, ctx);
  const payload = parseJson(executed.output);
  const status = resultStatus(payload);
  // Audit + pending store sudah ditangani executeTool untuk kanal manajer.
  return { output: executed.output, status };
}

function safeParseArgs(rawArgs: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawArgs || "{}");
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function maybeStorePending(
  phone: string,
  toolName: string,
  rawArgs: string,
  output: string,
  command: string,
): void {
  const payload = parseJson(output);
  if (!payload?.needs_confirmation) return;
  const args = { ...safeParseArgs(rawArgs), confirmed: true };
  rememberPendingAction({
    phone,
    toolName,
    args,
    preview: formatNeedsConfirmation(toolName, payload, "Perlu konfirmasi."),
    command,
  });
}

export async function dispatchManagerChat(input: {
  phone: string;
  message: string;
  toolCtx: ToolContext;
  role: ManagerRole | null;
  rooms?: Array<{ name: string; base_rate?: unknown; extrabed_rate?: unknown; capacity?: unknown }>;
}): Promise<ManagerDispatchResult | { handled: false }> {
  const message = String(input.message ?? "").trim();
  const phone = input.phone;
  const ctx = { ...input.toolCtx, phone, isManager: true as const, managerRole: input.role ?? input.toolCtx.managerRole };

  if (isManagerHelpMessage(message)) {
    return { handled: true, reply: buildManagerHelp(ctx.managerRole ?? null), toolsUsed: [], intent: "manager_help" };
  }

  if (isManagerCancelMessage(message)) {
    const pending = getPendingAction(phone);
    clearPendingAction(phone);
    return {
      handled: true,
      reply: pending ? "Dibatalkan. Tidak ada perubahan yang disimpan." : "Tidak ada perintah yang menunggu konfirmasi.",
      toolsUsed: [],
      intent: "manager_cancel",
    };
  }

  if (isExplicitManagerConfirmation(message)) {
    const pending = getPendingAction(phone);
    if (!pending) {
      return { handled: false };
    }
    const rate = checkManagerRateLimit(phone, { write: true });
    if (!rate.ok) {
      await logManagerAction(ctx.supabaseAdmin as any, {
        actor_phone: phone,
        actor_role: ctx.managerRole ?? null,
        actor_id: ctx.managerId,
        tool_name: pending.toolName,
        command: message,
        result: "rate_limited",
        error: rate.reason,
      });
      return { handled: true, reply: `${rate.reason} (coba lagi ${rate.retryAfterSec} detik).`, toolsUsed: [], intent: "manager_rate_limited" };
    }
    const result = await runAuthorizedTool(
      pending.toolName,
      JSON.stringify({ ...pending.args, confirmed: true }),
      { ...ctx, idempotencyKey: pending.writeIdempotencyKey },
      pending.command ?? message,
    );
    if (result.status !== "needs_confirmation") clearPendingAction(phone);
    return {
      handled: true,
      reply: formatGenericToolResult(pending.toolName, result.output),
      toolsUsed: [pending.toolName],
      intent: "manager_confirm",
    };
  }

  if (isNextPageMessage(message)) {
    const last = getLastListQuery(phone);
    if (!last) return { handled: false };
    const args = { ...last.args, offset: Number(last.args.offset ?? 0) + Number(last.args.limit ?? 10) };
    const result = await runAuthorizedTool(last.toolName, JSON.stringify(args), ctx, message);
    rememberLastListQuery({ phone, toolName: last.toolName, args, updatedAt: Date.now() });
    const payload = parseJson(result.output);
    const formatted = formatGenericToolResult(last.toolName, result.output);
    const suffix = payload?.has_more ? "\n\nKetik LAGI untuk halaman berikutnya." : "";
    return { handled: true, reply: `${formatted}${suffix}`, toolsUsed: [last.toolName], intent: "manager_next_page" };
  }

  const parsed = parseManagerChatCommand(message, ctx.today);
  if (!parsed) return { handled: false };

  if (parsed.toolName === "help") {
    return { handled: true, reply: buildManagerHelp(ctx.managerRole ?? null), toolsUsed: [], intent: "manager_help" };
  }
  if (parsed.toolName === "list_bank_mutations") {
    if (!roleCanUseTool(ctx.managerRole ?? null, "list_bank_mutations")) {
      return { handled: true, reply: unauthorizedToolMessage(ctx.managerRole ?? null, "list_bank_mutations"), toolsUsed: [], intent: "manager_denied" };
    }
    const { loadTodayBankMutations } = await import("@/services/bank-mutation-match");
    const loaded = await loadTodayBankMutations(ctx.supabaseAdmin as any);
    return { handled: true, reply: loaded.text, toolsUsed: ["list_bank_mutations"], intent: "manager_command:mutations_today" };
  }
  if (parsed.toolName === "list_room_rates") {
    if (!roleCanUseTool(ctx.managerRole ?? null, "list_room_rates")) {
      return { handled: true, reply: unauthorizedToolMessage(ctx.managerRole ?? null, "list_room_rates"), toolsUsed: [], intent: "manager_denied" };
    }
    return {
      handled: true,
      reply: formatRoomRatesList((input.rooms ?? ctx.rooms) as any),
      toolsUsed: [],
      intent: "manager_command:lihat_harga",
    };
  }

  const write = isManagerWriteTool(parsed.toolName);
  const rate = checkManagerRateLimit(phone, { write });
  if (!rate.ok) {
    await logManagerAction(ctx.supabaseAdmin as any, {
      actor_phone: phone,
      actor_role: ctx.managerRole ?? null,
      actor_id: ctx.managerId,
      tool_name: parsed.toolName,
      command: message,
      result: "rate_limited",
      error: rate.reason,
    });
    return { handled: true, reply: `${rate.reason} (coba lagi ${rate.retryAfterSec} detik).`, toolsUsed: [], intent: "manager_rate_limited" };
  }

  const result = await runAuthorizedTool(parsed.toolName, parsed.rawArgs, ctx, message);
  if (result.status === "denied") {
    return { handled: true, reply: formatGenericToolResult(parsed.toolName, result.output), toolsUsed: [], intent: "manager_denied" };
  }
  maybeStorePending(phone, parsed.toolName, parsed.rawArgs, result.output, message);
  if (parsed.toolName === "get_bookings" || parsed.toolName === "get_occupancy_summary") {
    rememberLastListQuery({
      phone,
      toolName: parsed.toolName,
      args: safeParseArgs(parsed.rawArgs),
      updatedAt: Date.now(),
    });
  }
  const payload = parseJson(result.output);
  let reply = result.status === "needs_confirmation"
    ? formatNeedsConfirmation(parsed.toolName, payload ?? {}, formatGenericToolResult(parsed.toolName, result.output))
    : formatGenericToolResult(parsed.toolName, result.output);
  if (payload?.has_more) reply += "\n\nKetik LAGI untuk halaman berikutnya.";
  return {
    handled: true,
    reply,
    toolsUsed: [parsed.toolName],
    intent: parsed.label,
  };
}

export { formatOccupancy };
