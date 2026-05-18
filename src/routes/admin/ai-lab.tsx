/**
 * /admin/ai-lab — AI LAB.
 *
 * A full-screen reference page (sidebar hidden, like the Page Builder)
 * showing the AI chatbot conversation-flow diagrams for Pomah Guesthouse.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowDown, MessageSquare, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/ai-lab")({
  component: AiLab,
});

/* ------------------------------------------------------------------ */
/* Flow primitives                                                     */
/* ------------------------------------------------------------------ */

const TONES: Record<string, string> = {
  default: "border-stone-200 bg-white",
  guest: "border-stone-300 bg-stone-100",
  accent: "border-teal-300 bg-teal-50",
  agent: "border-amber-300 bg-amber-50",
  tool: "border-sky-300 bg-sky-50",
};

function Node({
  title,
  lines,
  tone = "default",
  className,
}: {
  title: string;
  lines?: string[];
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-md rounded-xl border px-5 py-3 text-center shadow-sm",
        TONES[tone],
        className,
      )}
    >
      <p className="text-sm font-semibold text-stone-800">{title}</p>
      {lines && lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-stone-500">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Down() {
  return (
    <div className="flex justify-center py-1.5">
      <ArrowDown className="h-5 w-5 text-stone-300" />
    </div>
  );
}

function Bubble({ who, text }: { who: "guest" | "ai"; text: string }) {
  const guest = who === "guest";
  return (
    <div className={cn("flex", guest ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-sm rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          guest ? "bg-stone-200 text-stone-800" : "bg-teal-600 text-white",
        )}
      >
        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {guest ? <MessageSquare className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          {guest ? "Guest" : "AI"}
        </p>
        <p className="whitespace-pre-line">{text}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight text-stone-900">{children}</h2>
      {sub && <p className="mt-1 text-sm text-stone-500">{sub}</p>}
    </div>
  );
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

function AiLab() {
  return (
    <div className="flex h-full flex-col bg-stone-100">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Keluar
          </Link>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Pomah Guesthouse
            </p>
            <h1 className="text-lg font-semibold tracking-tight">AI LAB</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="mb-10 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">
              Diagram Alur Percakapan AI Chatbot Hotel
            </h1>
            <p className="mt-1 text-sm text-stone-500">Pomah Guesthouse</p>
          </div>

          {/* ── High-Level Conversation Flow ── */}
          <section className="mb-14">
            <SectionTitle>High-Level Conversation Flow</SectionTitle>

            <Node title="Guest Sends Message" lines={["WhatsApp / Web / OTA"]} tone="guest" />
            <Down />
            <Node
              title="AI Orchestrator"
              lines={["Intent Detection", "Context Analysis"]}
              tone="accent"
            />
            <Down />

            {/* Three intents */}
            <div className="grid grid-cols-3 gap-3">
              <Node title="Booking Intent" />
              <Node title="Support Intent" />
              <Node title="Information Intent" />
            </div>
            <Down />

            <Node title="Route to Appropriate AI Agent" tone="accent" />
            <Down />
            <Node
              title="Specialized AI Agent"
              lines={[
                "Front Office Agent",
                "Pricing Agent",
                "Housekeeping Agent",
                "Maintenance Agent",
                "Finance Agent",
              ]}
              tone="agent"
            />
            <Down />
            <Node
              title="Access Knowledge / Tools"
              lines={[
                "PMS Database",
                "Room Availability",
                "SOP Knowledge Base",
                "Pricing Engine",
                "FAQ Memory",
              ]}
              tone="tool"
            />
            <Down />
            <Node
              title="AI Response Composer"
              lines={["Human-like Response", "Tone Adjustment", "Language Adaptation"]}
              tone="accent"
            />
            <Down />
            <Node title="Human Approval Needed?" />
            <Down />

            {/* Yes / No branch */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Yes
                </p>
                <Node title="Human Admin Review" tone="agent" />
                <Down />
                <Node title="Send Reply" tone="accent" />
              </div>
              <div>
                <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-teal-600">
                  No
                </p>
                <Node title="Send Reply to Guest" tone="accent" />
              </div>
            </div>
          </section>

          {/* ── Detailed Booking Conversation Flow ── */}
          <section>
            <SectionTitle>Detailed Booking Conversation Flow</SectionTitle>

            <div className="space-y-2">
              <Bubble who="guest" text="Mas masih ada kamar untuk malam ini?" />
              <Down />
              <Node title="Intent Detection" lines={["→ Booking Inquiry"]} tone="accent" />
              <Down />
              <Node
                title="Extract Entities"
                lines={["Date", "Guest Count", "Room Type"]}
                tone="tool"
              />
              <Down />
              <Node title="Missing Information Detection" tone="accent" />
              <Down />
              <Bubble who="ai" text="Untuk berapa orang kak?" />
              <Down />
              <Bubble who="guest" text="2 orang" />
              <Down />
              <Node title="Availability Check" lines={["PMS / Database"]} tone="tool" />
              <Down />
              <Node title="Pricing Agent" lines={["Dynamic Pricing"]} tone="agent" />
              <Down />
              <Bubble who="ai" text={"Masih tersedia kak 😊\nDeluxe Room Rp450.000/malam"} />
              <Down />
              <Bubble who="guest" text="boleh lihat foto?" />
              <Down />
              <Node title="Media Retrieval" lines={["Room Gallery"]} tone="tool" />
              <Down />
              <Bubble who="ai" text={"AI sends:\n- room photos\n- facilities\n- booking CTA"} />
              <Down />
              <Bubble who="guest" text="oke saya booking" />
              <Down />
              <Node title="Reservation Flow" tone="accent" />
              <Down />
              <Node
                title="Collect"
                lines={["name", "phone", "payment", "arrival time"]}
                tone="tool"
              />
              <Down />
              <Node title="Booking Confirmation" tone="agent" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
