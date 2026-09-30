package com.pomahguesthouse.admin;

import android.util.Log;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Replaces the stock push plugin at build time. register() and unregister()
 * throw if Firebase was never initialized, and Capacitor rethrows that on its
 * plugin thread, which kills the process. Skip the call when this APK has no
 * google-services.json, and log any other push failure.
 */
@CapacitorPlugin(
    name = "PushNotifications",
    permissions = @Permission(strings = { android.Manifest.permission.POST_NOTIFICATIONS }, alias = "receive")
)
public class SafePushNotificationsPlugin extends PushNotificationsPlugin {
    private static final String TAG = "PomahAdmin";

    @PluginMethod
    @Override
    public void register(PluginCall call) {
        if (!FirebaseStatus.isConfigured(getContext())) {
            Log.i(TAG, "Firebase is not configured; skipping push registration");
            call.reject("Firebase is not configured");
            return;
        }
        try {
            super.register(call);
        } catch (Throwable error) {
            Log.e(TAG, "Push registration failed", error);
            call.reject("Push registration failed");
        }
    }

    @PluginMethod
    @Override
    public void unregister(PluginCall call) {
        if (!FirebaseStatus.isConfigured(getContext())) {
            Log.i(TAG, "Firebase is not configured; skipping push unregister");
            call.resolve();
            return;
        }
        try {
            super.unregister(call);
        } catch (Throwable error) {
            Log.e(TAG, "Push unregister failed", error);
            call.reject("Push unregister failed");
        }
    }
}
