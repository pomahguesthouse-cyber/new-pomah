import { fetchWaMediaDataUri } from "../src/services/whatsapp.service";
import { runOcrAndMatch } from "../src/services/payment-proof.service";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
const rec = JSON.parse(await Bun.file("/tmp/req.json").text()).message;
const uri = await fetchWaMediaDataUri("", rec);
console.log("dataUri:", uri ? uri.slice(0, 40) + " len=" + uri.length : null);
if (uri) {
  const r = await runOcrAndMatch(supabaseAdmin as any, uri, "6289509687958");
  console.log(JSON.stringify(r, null, 2).slice(0, 1200));
}
