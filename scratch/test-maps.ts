import fs from "fs";

async function testMapsLink(shortUrl: string) {
  try {
    const res = await fetch(shortUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      }
    });
    
    const finalUrl = res.url;
    console.log("Final URL:", finalUrl);
    
    const parsed = new URL(finalUrl);
    let extractedQuery = parsed.searchParams.get("q");

    if (!extractedQuery) {
      const pathMatch = finalUrl.match(/\/maps\/place\/([^/]+)/i);
      if (pathMatch) extractedQuery = decodeURIComponent(pathMatch[1].replace(/\+/g, " "));
    }
    
    console.log("Extracted Query:", extractedQuery);
    
    const html = await res.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1] : "";
    
    console.log("Title from HTML:", title);
    
    if (title) {
        title = title.replace(/\s*-\s*Google Maps/i, "").trim();
        console.log("Clean Title:", title);
    }
    
  } catch (err) {
    console.error(err);
  }
}

// Test with a known maps shortlink if you have one, or just test the logic
testMapsLink("https://maps.app.goo.gl/rY1dC1Z1M2VvB1z9A"); // Lawang Sewu example (replace if needed)
