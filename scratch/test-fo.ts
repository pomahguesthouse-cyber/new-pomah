import { frontOfficeAgent } from "@/ai/agents/front-office.agent";

const today = "2026-06-09";
const ctx: any = {
  property: { name: "Pomah Guesthouse" },
  rooms: [
    { id: "1", name: "Single", base_rate: 180000 },
    { id: "2", name: "Deluxe", base_rate: 250000 },
    { id: "3", name: "Grand Deluxe", base_rate: 350000 },
  ],
  sopText: "",
  brosurFiles: [],
  today,
  mode: "guest",
  managerName: "Rani",
  agreedDates: { checkIn: "2026-06-09", checkOut: "2026-06-10" },
};

const sys = frontOfficeAgent.buildSystemPrompt(ctx);
const tools = frontOfficeAgent.getTools?.(ctx) ?? frontOfficeAgent.tools;
const messages = [
  { role: "system", content: sys },
  { role: "user", content: "pagi" },
  { role: "assistant", content: "Selamat pagi Kak! Dengan Rani dari Pomah Guesthouse. Ada yang bisa Rani bantu?" },
  { role: "user", content: "mau tanya kamar" },
];

const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LOVABLE_API_KEY}` },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash",
    temperature: 0.6,
    max_tokens: 600,
    messages,
    tools,
    tool_choice: "auto",
  }),
});
const j: any = await r.json();
console.log("REPLY:", j.choices?.[0]?.message?.content);
console.log("TOOL_CALLS:", JSON.stringify(j.choices?.[0]?.message?.tool_calls ?? null, null, 2));
