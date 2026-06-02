import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\1fad89af-acca-4ec7-8ac5-9c5c65a67e23\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const data = JSON.parse(line);
      if (data.type === 'RUN_COMMAND' || (data.type === 'ACTION_RESPONSE' && data.content.includes('=== PROPERTIES ==='))) {
        console.log(data.content);
      }
      if (data.type === 'ACTION_RESPONSE' && data.content.includes('fetch_db.mjs')) {
        console.log(data.content);
      }
    } catch(e) {}
  }
}

main().catch(console.error);
