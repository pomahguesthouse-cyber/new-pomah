import fs from 'fs';
import path from 'path';

function findLovableApp(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.tanstack' || file === 'scratch') continue;
    
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }
    
    if (stat.isDirectory()) {
      findLovableApp(fullPath);
    } else if (stat.isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('lovable.app')) {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('lovable.app')) {
            console.log(`${fullPath}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

findLovableApp('.');
