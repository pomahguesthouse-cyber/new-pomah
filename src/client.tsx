import { oauthReturnLocation } from "@/public/components/staff-oauth-return";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { installChunkReloadGuard } from "@/lib/chunk-reload";

// Evaluated before the router (and supabase-js) so the OAuth hash is still in the URL.
void oauthReturnLocation;

installChunkReloadGuard();

// Android app (Capacitor WebView) only: Capacitor injects window.androidBridge
// before page scripts run. The class lets src/styles.css lighten effects that are
// costly in a WebView (backdrop blur, long sheet animations) and remove the
// double-tap wait, without touching the website or desktop.
if ((window as Window & { androidBridge?: unknown }).androidBridge) {
  document.documentElement.classList.add("native-app");
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
