/**
 * Tool executor.
 *
 * Routes an LLM tool-call by name to its handler, returns a JSON string.
 * Add new tools by importing their handler and adding an entry to HANDLERS.
 * The orchestrator never needs to change when a new tool is added.
 */

import { TOOL_LABELS }                   from "./registry";
import { checkRoomAvailability }          from "./availability.tool";
import { createBooking }                  from "./booking.tool";
import { startBookingDetails }            from "./start-booking.tool";
import { requestHousekeepingService }     from "./housekeeping/request-service.tool";
import { reportMaintenanceIssue }         from "./maintenance/report-issue.tool";
import { getPaymentInfo }                 from "./finance/get-payment-info.tool";
import { getPaymentProofResult }          from "./finance/get-payment-proof-result.tool";
import { sendInvoice }                    from "./finance/send-invoice.tool";
import { updatePaymentStatus }            from "./finance/update-payment-status.tool";
import { ccPaymentProofToAdmin }          from "./finance/cc-payment-proof-to-admin.tool";
import { getBookings }                    from "./manager/get-bookings.tool";
import { updateBookingStatus }            from "./manager/update-booking-status.tool";
import { deleteBooking }                  from "./manager/delete-booking.tool";
import { changeBookingRoom }              from "./manager/change-booking-room.tool";
import { replyToGuest }                   from "./manager/reply-to-guest.tool";
import { discoverSemarangContent }        from "./content/discover-semarang-content.tool";
import { upsertExploreItem }              from "./content/upsert-explore-item.tool";
import { listExploreItems }               from "./content/list-explore-items.tool";
import { publishExploreItem, publishExploreItemsByCategory } from "./content/publish-explore-item.tool";
import { generateExploreImage }            from "./content/generate-explore-image.tool";
import { discoverPropertyReviews }         from "./content/discover-property-reviews.tool";
import { saveCustomGoogleReviews }         from "./content/save-custom-google-reviews.tool";
import { restoreCustomGoogleReviews }      from "./content/restore-custom-google-reviews.tool";
import { checkKeywordRanking }             from "./content/check-keyword-ranking.tool";
import { listTrackedKeywords }             from "./content/list-tracked-keywords.tool";
import { auditPageSeo }                    from "./content/audit-page-seo.tool";
import { scrapeCompetitorPrices }         from "./pricing/scrape-competitor-prices.tool";
import { updateRoomRate }                 from "./pricing/update-room-rate.tool";
import { setDailyRoomRate }               from "./pricing/set-daily-room-rate.tool";
import { getDailyRoomRates }              from "./pricing/get-daily-room-rates.tool";
import { deleteDailyRoomRate }            from "./pricing/delete-daily-room-rate.tool";
import { getRoomSpecifications }          from "./room-specifications.tool";
import type { ToolContext, ToolHandler }  from "./types";

// ─── Handler registry ─────────────────────────────────────────────────────────

const HANDLERS: Record<string, ToolHandler> = {
  check_room_availability:       checkRoomAvailability,
  start_booking_details:         startBookingDetails,
  create_booking:                createBooking,
  request_housekeeping_service:  requestHousekeepingService,
  report_maintenance_issue:      reportMaintenanceIssue,
  get_payment_info:              getPaymentInfo,
  get_payment_proof_result:      getPaymentProofResult,
  send_invoice:                  sendInvoice,
  update_payment_status:         updatePaymentStatus,
  cc_payment_proof_to_admin:     ccPaymentProofToAdmin,
  get_bookings:                  getBookings,
  update_booking_status:         updateBookingStatus,
  delete_booking:                deleteBooking,
  change_booking_room:           changeBookingRoom,
  reply_to_guest:                replyToGuest,
  discover_semarang_content:     discoverSemarangContent,
  upsert_explore_item:           upsertExploreItem,
  list_explore_items:            listExploreItems,
  publish_explore_item:          publishExploreItem,
  publish_explore_items_by_category: publishExploreItemsByCategory,
  generate_explore_image:        generateExploreImage,
  discover_property_reviews:     discoverPropertyReviews,
  save_custom_google_reviews:    saveCustomGoogleReviews,
  restore_custom_google_reviews: restoreCustomGoogleReviews,
  check_keyword_ranking:         checkKeywordRanking,
  list_tracked_keywords:         listTrackedKeywords,
  audit_page_seo:                auditPageSeo,
  scrape_competitor_prices:      scrapeCompetitorPrices,
  update_room_rate:              updateRoomRate,
  set_daily_room_rate:           setDailyRoomRate,
  get_daily_room_rates:          getDailyRoomRates,
  delete_daily_room_rate:        deleteDailyRoomRate,
  get_room_specifications:       getRoomSpecifications,
};

// ─── Executor ─────────────────────────────────────────────────────────────────

export interface ToolExecutionResult {
  /** JSON-stringified result to push back into the message thread */
  output:    string;
  /** Human-readable label for the tool that ran (for analytics) */
  toolLabel: string | null;
}

/**
 * Execute a tool by name with the given arguments.
 *
 * Never throws — errors are returned as JSON payloads so the LLM can
 * surface them gracefully to the guest.
 */
export async function executeTool(
  toolName: string,
  rawArgs:  string,
  ctx:      ToolContext,
): Promise<ToolExecutionResult> {
  const handler = HANDLERS[toolName];
  const label   = TOOL_LABELS[toolName] ?? null;

  if (!handler) {
    return {
      output:    JSON.stringify({ error: `Unknown tool: ${toolName}` }),
      toolLabel: label,
    };
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    args = {};
  }

  try {
    const output = await handler(args, ctx);
    return { output, toolLabel: label };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ToolExecutor] ${toolName} threw:`, msg);
    return {
      output:    JSON.stringify({ error: `Tool execution failed: ${msg}` }),
      toolLabel: label,
    };
  }
}
