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

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1];
    const decoded = Buffer.from(payloadBase64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

async function searchInTranscript(transPath) {
  const fileStream = fs.createReadStream(transPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const folderName = path.basename(path.dirname(path.dirname(path.dirname(transPath))));

  for await (const line of rl) {
    const jwtMatch = line.match(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g);
    if (jwtMatch) {
      for (const token of jwtMatch) {
        const payload = decodeJwtPayload(token);
        if (payload && payload.ref === "gofvxeiulaljwyfyhnww") {
          console.log(`[${folderName}] Found matching JWT for gofvxeiulaljwyfyhnww with role: ${payload.role}`);
          console.log("Token:", token);
        }
      }
    }
  }
}

async function main() {
  console.log("Listing brain directories...");
  const paths = getTranscriptPaths(brainDir);
  console.log(`Found ${paths.length} transcript files. Searching...`);
  for (const p of paths) {
    await searchInTranscript(p);
  }
  console.log("Search completed.");
}

main().catch(console.error);
