const fs = require('fs');
const file = 'src/services/wa-autoreply.service.ts';
let text = fs.readFileSync(file, 'utf8');

const regex = /  \/\/ Strip any bare image URLs the model included so WhatsApp doesn't render a photo\./;
const replacement = `  // If no brochure was attached, check if the LLM provided a PDF URL directly (e.g. invoice)
  if (!attachUrl) {
    const pdfMatch = finalReply.match(/(https?:\\/\\/[^\\s]+?\\\\.pdf)/i);
    if (pdfMatch) {
      attachUrl = pdfMatch[1];
      attachName = "Invoice.pdf";
      // Remove the raw URL from the text body to keep the message clean
      finalReply = finalReply.replace(pdfMatch[1], "").trim();
    }
  }

  // Strip any bare image URLs the model included so WhatsApp doesn't render a photo.`;

if (regex.test(text)) {
  text = text.replace(regex, replacement);
  fs.writeFileSync(file, text);
  console.log("Successfully patched wa-autoreply.service.ts");
} else {
  console.log("Pattern not found!");
}
