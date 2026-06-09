import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\17b9097a-740d-48be-a2e5-6be043974390\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let index = 0;
  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      if (step.type === "USER_INPUT") {
        index++;
        console.log(`User Message #${index}: ${step.content.trim()}`);
      }
    } catch (e) {
      // ignore
    }
  }
}

main().catch(console.error);
