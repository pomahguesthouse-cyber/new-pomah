import { oauthReturnLocation } from "@/public/components/staff-oauth-return";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { installChunkReloadGuard } from "@/lib/chunk-reload";

// Evaluated before the router (and supabase-js) so the OAuth hash is still in the URL.
void oauthReturnLocation;

installChunkReloadGuard();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
