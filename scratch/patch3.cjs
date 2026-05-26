const fs = require('fs');
const file = 'src/services/wa-autoreply.service.ts';
let text = fs.readFileSync(file, 'utf8');

text = text.replace(/\\\\\./g, '\\.');

fs.writeFileSync(file, text);
console.log("Fixed backslashes");
