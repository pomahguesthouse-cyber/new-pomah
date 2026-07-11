import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listRoomTypesTool from "./tools/list-room-types";
import checkAvailabilityTool from "./tools/check-availability";

// Isuer OAuth WAJIB berupa host Supabase langsung. Setelah publish,
// SUPABASE_URL diproxy ke `.lovable.cloud` — mcp-js akan menolaknya (RFC 8414).
// VITE_SUPABASE_PROJECT_ID di-inline oleh Vite pada saat build sehingga
// selalu tersedia di Worker runtime.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "pomah-guesthouse-mcp",
  title: "Pomah Guesthouse",
  version: "0.1.0",
  instructions:
    "Tools resmi Pomah Guesthouse. Klien wajib login terlebih dahulu. Gunakan `list_room_types` untuk daftar kamar dan `check_availability` untuk cek ketersediaan pada rentang tanggal.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listRoomTypesTool, checkAvailabilityTool],
});
