import { FRONT_OFFICE_AGENT } from "./src/ai/agents/front-office.agent";
import { AGENT_REGISTRY } from "./src/ai/agents/registry";

const ctx: any = {
  propertyName: "Pomah Guesthouse",
  today: "2026-08-26",
  roomTypes: [
    { name: "Deluxe", base_price: 350000, capacity: 2 },
    { name: "Superior", base_price: 300000, capacity: 2 },
    { name: "Standard", base_price: 250000, capacity: 2 },
  ],
  property: { name: "Pomah Guesthouse", address: "Jl. Dewi Sartika", check_in_time: "14:00", check_out_time: "12:00" },
  guestName: "Budi",
};

for (const [key, agent] of Object.entries<any>(AGENT_REGISTRY)) {
  let sys = "";
  try { sys = agent.buildSystemPrompt(ctx) ?? ""; } catch (e) { sys = "ERR: " + (e as Error).message; }
  const tools = (agent.getTools?.(ctx) ?? agent.tools ?? []);
  const toolsJson = JSON.stringify(tools);
  console.log(`${key}\tprompt_chars=${sys.length}\t~tokens=${Math.round(sys.length/3.5)}\ttools=${tools.length}\ttools_chars=${toolsJson.length}\t~tool_tokens=${Math.round(toolsJson.length/3.5)}`);
}
