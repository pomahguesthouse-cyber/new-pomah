import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\65a0a014-1fa4-4bef-bc18-911e1eeabde7\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  console.log("Searching for pomahai_bot in past transcript...");
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (line.toLowerCase().includes("pomahai_bot")) {
      count++;
      console.log(`Match ${count}: ${line.slice(0, 1000)}`);
      if (count >= 10) break;
    }
  }
}

main().catch(console.error);
