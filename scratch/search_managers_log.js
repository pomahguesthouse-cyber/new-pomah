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
    if (line.includes('property_managers') && line.includes('[{')) {
      console.log(line.slice(0, 1000));
    }
  }
}

main().catch(console.error);
