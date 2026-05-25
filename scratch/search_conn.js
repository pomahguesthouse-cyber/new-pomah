import fs from 'fs';
import path from 'path';

function search(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.tanstack') continue;
    
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }
    
    if (stat.isDirectory()) {
      search(fullPath);
    } else if (stat.isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('postgres://') || content.includes('postgresql://') || content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        // print matched lines
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('postgres://') || line.includes('postgresql://') || line.includes('SUPABASE_SERVICE_ROLE_KEY')) {
            console.log(`${fullPath}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

search('.');
