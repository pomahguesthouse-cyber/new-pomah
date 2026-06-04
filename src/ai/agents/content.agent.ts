/**
 * Content Manager Agent
 *
 * Handles:
 *   - City Guide (explore_items): discovery, drafting, publishing, cover images
 *   - Custom Google Reviews (properties.custom_google_*): scrape + save + restore
 *   - SEO monitoring (keyword ranking + on-page audit)
 *
 * Not exposed to guest WA traffic directly — invoked via:
 *   - Manager Agent's `ask_agent("content", ...)` delegation
 *   - The /admin/content-manager dashboard's "Run discovery" button
 *
 * This file is intentionally thin. Tool definitions live in
 * `content.tools.ts`; system-prompt construction lives in
 * `content.prompt.ts`. Keep the agent definition itself small so adding
 * future routing / mode logic stays obvious.
 */

import type { AgentDefinition } from "./types";
import { CONTENT_TOOLS } from "./content.tools";
import { buildContentSystemPrompt } from "./content.prompt";

export const contentAgent: AgentDefinition = {
  key:         "content",
  name:        "Content Manager Agent",
  description: "Finds Semarang events + tourism content and maintains the public city guide.",
  // Tidak menangani intent tamu — hanya diundang via Manager.ask_agent
  // atau dashboard admin.
  handles:     [],
  tools:       CONTENT_TOOLS,
  buildSystemPrompt: buildContentSystemPrompt,
};
