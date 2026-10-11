import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Pomah Admin loads the live admin site. Web UI, auth, and push-registration
 * code ship with the website deploy, so a routine admin change does not need
 * a new APK. Native pieces (icon, splash, OAuth custom scheme, FCM) do.
 *
 * A bundled WebView would still have to call the live TanStack server
 * functions, and every UI fix would need a new store build. The remote URL
 * avoids that. Google sign-in cannot run inside the WebView; see docs/android.md.
 */
const config: CapacitorConfig = {
  appId: "com.pomahguesthouse.admin",
  appName: "Pomah Admin",
  webDir: "mobile/www",
  server: {
    url: "https://pomahguesthouse.com/admin",
    androidScheme: "https",
    allowNavigation: [
      "pomahguesthouse.com",
      "*.pomahguesthouse.com",
      "*.supabase.co",
      "*.lovable.app",
      "lovable.dev",
      "accounts.google.com",
      "*.google.com",
      "*.googleapis.com",
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    backgroundColor: "#1b3f3f",
  },
  plugins: {
    // Capacitor 8 (this repo is @capacitor/core 8.5, targetSdk 36). Android 15+
    // forces edge-to-edge, and WebView builds before 140 report
    // env(safe-area-inset-*) as 0. `insetsHandling: "css"` is the robust path:
    // SystemBars reads WindowInsetsCompat (system bars + display cutout) and,
    // on WebView >= 140 with viewport-fit=cover, passes those insets through so
    // env() is correct AND sets --safe-area-inset-*. On older WebViews it pads
    // the WebView and injects 0 so CSS does not pad twice.
    // Do not set StatusBar.setOverlaysWebView({ overlay: false }) or the removed
    // Capacitor 7 `adjustMarginsForEdgeToEdge`. overlay:false is ignored on
    // targetSdk 35+ and would double-pad on older Android where it still works.
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      // Dark icons on the light admin header (#F7FBF8).
      style: "LIGHT",
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      backgroundColor: "#1b3f3f",
      androidScaleType: "CENTER_INSIDE",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
