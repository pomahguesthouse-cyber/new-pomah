import { supabase } from "@/integrations/supabase/client";
import { canRegisterStaffPush } from "@/lib/native-push";
import { loginDestination } from "@/lib/auth-return";
import {
  NATIVE_OAUTH_STATE_KEY,
  buildNativeOAuthRedirectUri,
  buildOAuthBrokerUrl,
  parseNativeOAuthCallback,
} from "@/lib/native-oauth";

const FCM_TOKEN_KEY = "pomah.fcm-token";

type Stop = () => void;

function rememberState(state: string): void {
  try {
    sessionStorage.setItem(NATIVE_OAUTH_STATE_KEY, JSON.stringify({ state, at: Date.now() }));
  } catch {
    // Session storage can be blocked. The callback then refuses the login.
  }
}

function takeExpectedState(): { state: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(NATIVE_OAUTH_STATE_KEY);
    sessionStorage.removeItem(NATIVE_OAUTH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: unknown; at?: unknown };
    if (typeof parsed.state !== "string" || typeof parsed.at !== "number") return null;
    return { state: parsed.state, at: parsed.at };
  } catch {
    return null;
  }
}

export async function isNativeAdminApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform();
}

/** Open Google OAuth in Chrome Custom Tabs. No-op outside the native shell. */
export async function startNativeGoogleSignIn(nextPath: string): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  const state =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  rememberState(state);
  const redirectUri = buildNativeOAuthRedirectUri(window.location.origin);
  const url = buildOAuthBrokerUrl({
    origin: window.location.origin,
    state,
    redirectUri,
  });
  try {
    sessionStorage.setItem("pomah.auth-next", loginDestination(nextPath));
  } catch {
    // The callback falls back to /admin.
  }
  await Browser.open({ url, presentationStyle: "popover" });
}

async function finishNativeOAuth(rawUrl: string): Promise<void> {
  const parsed = parseNativeOAuthCallback(rawUrl);
  if (!parsed) return;
  const { Browser } = await import("@capacitor/browser");
  try {
    await Browser.close();
  } catch {
    // The custom tab may already be gone.
  }
  if (!parsed.ok) {
    const { toast } = await import("sonner");
    toast.error(parsed.error);
    return;
  }
  const expected = takeExpectedState();
  const fresh = !!expected && Date.now() - expected.at < 5 * 60 * 1000;
  const stateMatches = !parsed.tokens.state || parsed.tokens.state === expected?.state;
  if (!fresh || !stateMatches) {
    const { toast } = await import("sonner");
    toast.error("Sign-in could not be verified. Try Continue with Google again.");
    return;
  }
  const { error } = await supabase.auth.setSession({
    access_token: parsed.tokens.accessToken,
    refresh_token: parsed.tokens.refreshToken,
  });
  if (error) {
    const { toast } = await import("sonner");
    toast.error(error.message);
    return;
  }
  let next = "/admin";
  try {
    const stored = sessionStorage.getItem("pomah.auth-next");
    if (stored) next = loginDestination(stored);
  } catch {
    next = "/admin";
  }
  window.location.assign(next);
}

function openNotificationTarget(data: Record<string, unknown> | undefined): void {
  const url = typeof data?.url === "string" ? data.url : "";
  if (!url.startsWith("/admin")) return;
  window.location.assign(url);
}

async function registerPushToken(token: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const { error } = await supabase.rpc("register_device_token", {
    p_token: token,
    p_platform: "android",
  });
  if (error) {
    console.info("[push] token register failed", error.message);
    return;
  }
  try {
    localStorage.setItem(FCM_TOKEN_KEY, token);
  } catch {
    // The token can be registered again on the next launch.
  }
}

export async function unregisterStaffPush(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(FCM_TOKEN_KEY);
  } catch {
    token = null;
  }
  if (!token) return;
  const { error } = await supabase.rpc("unregister_device_token", { p_token: token });
  if (error) console.info("[push] token unregister failed", error.message);
  try {
    localStorage.removeItem(FCM_TOKEN_KEY);
  } catch {
    // Ignore storage failures on the way out.
  }
}

function scrollableAncestor(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el) {
    const style = window.getComputedStyle(el);
    const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
    if (scrolls && el.scrollHeight > el.clientHeight + 2) return el;
    el = el.parentElement;
  }
  return null;
}

function attachPullToRefresh(): Stop {
  let startY = 0;
  let tracking = false;
  let scroller: HTMLElement | null = null;
  const onStart = (event: TouchEvent) => {
    scroller = scrollableAncestor(event.target);
    if (scroller && scroller.scrollTop > 2) return;
    if (!scroller && window.scrollY > 2) return;
    startY = event.touches[0]?.clientY ?? 0;
    tracking = true;
  };
  const onEnd = (event: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    const endY = event.changedTouches[0]?.clientY ?? startY;
    if (endY - startY < 90) return;
    if (scroller && scroller.scrollTop > 2) return;
    if (!scroller && window.scrollY > 2) return;
    window.location.reload();
  };
  window.addEventListener("touchstart", onStart, { passive: true });
  window.addEventListener("touchend", onEnd, { passive: true });
  return () => {
    window.removeEventListener("touchstart", onStart);
    window.removeEventListener("touchend", onEnd);
  };
}

/** Native-only listeners. Safe to call on the website: it returns immediately. */
export async function startNativeAdmin(): Promise<{ stop: Stop }> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return { stop: () => {} };

  const { App } = await import("@capacitor/app");
  const { SplashScreen } = await import("@capacitor/splash-screen");
  const { StatusBar, Style } = await import("@capacitor/status-bar");

  const handles: Array<{ remove: () => Promise<void> }> = [];

  handles.push(
    await App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.exitApp();
    }),
  );
  handles.push(await App.addListener("appUrlOpen", ({ url }) => void finishNativeOAuth(url)));

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) void finishNativeOAuth(launch.url);
  } catch {
    // No launch URL.
  }

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#fafaf9" });
  } catch {
    // Status bar styling is optional.
  }
  try {
    await SplashScreen.hide();
  } catch {
    // Splash may already be hidden.
  }

  const stopPull = attachPullToRefresh();
  const stopPush = await startStaffPush();

  return {
    stop: () => {
      stopPull();
      stopPush();
      for (const handle of handles) void handle.remove();
    },
  };
}

async function isFirebasePushConfigured(): Promise<boolean> {
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const pomahFirebase = registerPlugin<{
      isConfigured: () => Promise<{ configured?: boolean }>;
    }>("PomahFirebase");
    const result = await pomahFirebase.isConfigured();
    return result?.configured === true;
  } catch (error) {
    console.info("[push] could not read Firebase configuration", error);
    return false;
  }
}

/** Listeners and register() run only when Firebase is packaged. Failures are logged. */
async function startStaffPush(): Promise<Stop> {
  try {
    const configured = await isFirebasePushConfigured();
    if (!configured) {
      console.info("[push] Firebase is not configured; skipping registration");
      return () => {};
    }
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const handles: Array<{ remove: () => Promise<void> }> = [];
    try {
      await PushNotifications.createChannel({
        id: "pomah-staff",
        name: "Pesan & booking",
        importance: 4,
        sound: "default",
        vibration: true,
      });
    } catch (error) {
      console.info("[push] notification channel skipped", error);
    }
    const syncPush = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!canRegisterStaffPush(true, !!data.session)) return;
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted") return;
        await PushNotifications.register();
      } catch (error) {
        console.info("[push] registration skipped", error);
      }
    };
    handles.push(
      await PushNotifications.addListener("registration", (token) => {
        void registerPushToken(token.value);
      }),
    );
    handles.push(
      await PushNotifications.addListener("registrationError", (error) => {
        console.info("[push] registration error", error.error);
      }),
    );
    handles.push(
      await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        openNotificationTarget(action.notification.data as Record<string, unknown> | undefined);
      }),
    );
    handles.push(
      await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        const title = notification.title?.trim() || "Pomah Admin";
        const body = notification.body?.trim() || "";
        void import("sonner").then(({ toast }) => {
          toast(title, body ? { description: body } : undefined);
        });
      }),
    );
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) void syncPush();
    });
    void syncPush();
    return () => {
      authSub.subscription.unsubscribe();
      for (const handle of handles) void handle.remove();
    };
  } catch (error) {
    console.info("[push] disabled", error);
    return () => {};
  }
}
