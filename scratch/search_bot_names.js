import fs from 'fs';
import path from 'path';
import readline from 'readline';

const brainDir = "C:\\Users\\LENOVO\\.gemini\\antigravity\\brain";

function getTranscriptPaths(dir) {
  const paths = [];
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const transFile = path.join(fullPath, ".system_generated", "logs", "transcript.jsonl");
        if (fs.existsSync(transFile)) {
          paths.push(transFile);
        }
      }
    }
  } catch (e) {
    console.error("Error reading brain dir:", e.message);
  }
  return paths;
}

async function searchInTranscript(transPath) {
  const fileStream = fs.createReadStream(transPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const folderName = path.basename(path.dirname(path.dirname(path.dirname(transPath))));

  for await (const line of rl) {
    const botMatches = line.match(/[a-zA-Z0-9_]+_bot\b/gi);
    if (botMatches) {
      for (const bot of botMatches) {
        console.log(`[${folderName}] Found bot mention:`, bot);
      }
    }
  }
}

async function main() {
  console.log("Searching for bot mentions in transcripts...");
  const paths = getTranscriptPaths(brainDir);
  for (const p of paths) {
    await searchInTranscript(p);
  }
  console.log("Search completed.");
}

main().catch(console.error);
