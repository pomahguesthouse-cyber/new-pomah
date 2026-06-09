import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\17b9097a-740d-48be-a2e5-6be043974390\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  console.log("Searching for pomah_manager_bot in current transcript...");
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (line.toLowerCase().includes("pomah_manager_bot")) {
      count++;
      console.log(`Match ${count}: ${line.slice(0, 1000)}`);
      if (count >= 10) break;
    }
  }
}

main().catch(console.error);
