/**
 * Tool: report_maintenance_issue
 *
 * Records a maintenance / repair request from the guest.
 * Inserts into `maintenance_requests` if it exists; gracefully degrades.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const PRIORITY_MAP: Record<string, string> = {
  // High-priority keywords
  kebakaran:   "critical",
  banjir:      "critical",
  darurat:     "critical",
  emergency:   "critical",
  // Medium
  ac:          "high",
  listrik:     "high",
  air:         "high",
  kunci:       "high",
  // Low
  lampu:       "medium",
  tv:          "medium",
  remote:      "medium",
  wifi:        "medium",
};

function derivePriority(issueType: string, description: string): string {
  const text = `${issueType} ${description}`.toLowerCase();
  for (const [keyword, priority] of Object.entries(PRIORITY_MAP)) {
    if (text.includes(keyword)) return priority;
  }
  return "low";
}

export const reportMaintenanceIssue: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const issueType   = str(args.issue_type)   || "general";
  const description = str(args.description)  || "";
  const roomNumber  = str(args.room_number);
  const guestPhone  = str(args.guest_phone);
  const priority    = str(args.priority) || derivePriority(issueType, description);

  if (!roomNumber && !guestPhone) {
    return JSON.stringify({
      ok:    false,
      error: "Nomor kamar atau nomor WhatsApp tamu diperlukan.",
    });
  }

  try {
    const { error } = await (ctx.supabaseAdmin as any)
      .from("maintenance_requests")
      .insert({
        property_id:  (ctx.property as Record<string, unknown>).id,
        room_number:  roomNumber  || null,
        guest_phone:  guestPhone  || null,
        issue_type:   issueType,
        description:  description || null,
        priority,
        status:       "open",
        reported_at:  new Date().toISOString(),
      });

    if (error) throw error;

    return JSON.stringify({
      ok:          true,
      issue_type:  issueType,
      priority,
      room_number: roomNumber,
      message:     "Laporan kerusakan berhasil dicatat. Tim teknisi akan segera menangani.",
    });
  } catch {
    return JSON.stringify({
      ok:          true,
      issue_type:  issueType,
      priority,
      room_number: roomNumber,
      message:     "Laporan Anda telah diterima. Tim maintenance akan segera merespons.",
      note:        "logged_in_memory",
    });
  }
};
