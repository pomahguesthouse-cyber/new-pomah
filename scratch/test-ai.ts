import { executeAutoreplyForPhone } from "./src/services/wa-autoreply.service";

async function main() {
  console.log("Starting test...");
  try {
    const outcome = await executeAutoreplyForPhone("6282226749990", "https://pomahguesthouse.com");
    console.log("Outcome:", outcome);
  } catch (e) {
    console.error("Fatal error:", e);
  }
}

main();
