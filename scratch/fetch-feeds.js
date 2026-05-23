import Parser from "rss-parser";

async function main() {
  const parser = new Parser();
  
  console.log("=== Detik Jateng RSS ===");
  try {
    const feed = await parser.parseURL("https://www.detik.com/jateng/rss");
    feed.items.slice(0, 15).forEach((item, idx) => {
      console.log(`[${idx}] Title: ${item.title}`);
      console.log(`    Link: ${item.link}`);
      console.log(`    Snippet: ${item.contentSnippet}`);
    });
  } catch (e) {
    console.error("Failed to parse Detik Jateng:", e.message);
  }

  console.log("\n=== Suara Merdeka Semarang Raya RSS ===");
  try {
    const feed = await parser.parseURL("https://www.suaramerdeka.com/rss/semarang-raya");
    feed.items.slice(0, 15).forEach((item, idx) => {
      console.log(`[${idx}] Title: ${item.title}`);
      console.log(`    Link: ${item.link}`);
      console.log(`    Snippet: ${item.contentSnippet}`);
    });
  } catch (e) {
    console.error("Failed to parse Suara Merdeka:", e.message);
  }
}

main();
