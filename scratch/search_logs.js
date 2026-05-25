import fs from 'fs';

const logPath = 'C:\\Users\\LENOVO\\.gemini\\antigravity\\brain\\0c4ab46e-74d8-4116-a0c3-a337cf174796\\.system_generated\\logs\\transcript.jsonl';

if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    if (line.includes('"type":"RUN_COMMAND"')) {
      // parse JSON
      try {
        const obj = JSON.parse(line);
        if (obj.step_index < 900) {
          console.log(`[Step ${obj.step_index}] Cmd: ${obj.tool_calls?.[0]?.args?.CommandLine || obj.content?.slice(0, 150)}`);
        }
      } catch (e) {
        // ignore
      }
    }
  });
} else {
  console.log("Not found");
}
