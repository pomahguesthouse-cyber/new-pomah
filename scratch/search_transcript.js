import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\1fad89af-acca-4ec7-8ac5-9c5c65a67e23\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  const query = process.argv[2] || "";
  console.log(`Searching for "${query}" in conversation history...`);
  
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (line.toLowerCase().includes(query.toLowerCase())) {
      count++;
      // Print first 500 chars of matching line to keep it concise
      console.log(`Match ${count}: ${line.slice(0, 500)}...`);
      if (count >= 50) {
        console.log("Too many matches, truncating...");
        break;
      }
    }
  }
  console.log(`Search completed. Found ${count} matches.`);
}

main().catch(console.error);
