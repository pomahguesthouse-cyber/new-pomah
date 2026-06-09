import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\17b9097a-740d-48be-a2e5-6be043974390\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const allSteps = [];
  for await (const line of rl) {
    try {
      allSteps.push(JSON.parse(line));
    } catch (e) {
      // ignore
    }
  }

  // Slice the last 15 steps
  const lastSteps = allSteps.slice(-25);
  console.log(`=== LAST ${lastSteps.length} TRANSCRIPT STEPS ===`);
  for (const step of lastSteps) {
    if (step.type === "USER_INPUT") {
      console.log(`\n--- [STEP ${step.step_index}] USER INPUT ---`);
      console.log(step.content.trim());
    } else if (step.type === "PLANNER_RESPONSE" || step.type === "MODEL_RESPONSE" || (step.source === "MODEL" && step.content)) {
      console.log(`\n--- [STEP ${step.step_index}] ASSISTANT RESPONSE ---`);
      console.log(step.content.trim());
    }
  }
}

main().catch(console.error);
