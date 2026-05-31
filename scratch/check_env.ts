console.log("Keys in process.env:", Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("KEY")));
import * as dotenv from "dotenv";
dotenv.config();
console.log("After dotenv.config():", Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("KEY")));
