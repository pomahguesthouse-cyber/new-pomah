import fs from 'fs';

// Read .env file manually
try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  console.log("=== .env File Content keys ===");
  for (const line of envContent.split('\n')) {
    const parts = line.split('=');
    if (parts[0]) {
      console.log(parts[0].trim());
    }
  }
} catch (e) {
  console.error("Error reading .env:", e.message);
}

console.log("\n=== process.env keys ===");
console.log(Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("KEY")));
