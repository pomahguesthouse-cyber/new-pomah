import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\17b9097a-740d-48be-a2e5-6be043974390\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      if (step.type === "USER_INPUT") {
        console.log(`\n[User Step ${step.step_index}]: ${step.content.trim()}`);
      } else if (step.type === "PLANNER_RESPONSE" || (step.source === "MODEL" && step.type === "MODEL_RESPONSE")) {
        // If content starts with a tool call or is empty, skip it or print a short summary
        const content = step.content || "";
        if (content.trim()) {
          console.log(`[Assistant Step ${step.step_index}]: ${content.trim()}`);
        }
      }
    } catch (e) {
      // ignore
    }
  }
}

main().catch(console.error);
