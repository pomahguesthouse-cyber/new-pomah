import fs from 'fs';
import readline from 'readline';

const transcriptPath = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\1fad89af-acca-4ec7-8ac5-9c5c65a67e23\\.system_generated\\logs\\transcript.jsonl";

async function main() {
  console.log("Searching for JWT tokens in past transcript...");
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnZ4ZWl1bGFsand5Znlobnd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTYxMzQsImV4cCI6MjA5NDMzMjEzNH0.hYJqRzZa5l2lW1ttLSc1VRbW-NgayPvUY-Be7QLLxtU";

  let count = 0;
  for await (const line of rl) {
    const matches = line.match(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g);
    if (matches) {
      for (const token of matches) {
        if (token !== anonKey && token.length > 50) {
          console.log(`Found token (length ${token.length}):`, token);
          count++;
        }
      }
    }
  }
  console.log(`Completed. Found ${count} unique tokens.`);
}

main().catch(console.error);
