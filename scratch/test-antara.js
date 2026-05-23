import Parser from "rss-parser";

async function main() {
  const parser = new Parser();
  console.log("=== Antara Jateng Terkini RSS ===");
  try {
    const feed = await parser.parseURL("https://jateng.antaranews.com/rss/terkini.xml");
    console.log("Feed Title:", feed.title);
    console.log("Number of items:", feed.items.length);
    feed.items.slice(0, 5).forEach((item, idx) => {
      console.log(`[${idx}] Title: ${item.title}`);
      console.log(`    Date: ${item.pubDate}`);
    });
  } catch (e) {
    console.error("Failed to parse Antara Jateng:", e.message);
  }
}

main();
