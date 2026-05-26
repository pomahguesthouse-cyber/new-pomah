const fs = require('fs');
const file = 'src/services/wa-autoreply.service.ts';
let text = fs.readFileSync(file, 'utf8');

const search = `    }
  }

  // Strip any bare image URLs the model included so WhatsApp doesn't render a photo.`;

const replace = `    }
  }

  // If no brochure was attached, check if the LLM provided a PDF URL directly (e.g. invoice)
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

const updatedText = text.replace(search, replace);

if (text === updatedText) {
  console.log("No changes made. Search string not found.");
} else {
  fs.writeFileSync(file, updatedText);
  console.log("Successfully patched wa-autoreply.service.ts");
}
