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
