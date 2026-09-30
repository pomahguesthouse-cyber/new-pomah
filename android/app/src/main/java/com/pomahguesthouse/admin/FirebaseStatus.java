package com.pomahguesthouse.admin;

import android.content.Context;
import android.util.Log;

/**
 * True only when this build was produced with android/app/google-services.json.
 * The Gradle build writes {@code pomah_firebase_configured}; the Google Services
 * plugin also emits {@code google_app_id}. Either missing means push must stay off.
 */
public final class FirebaseStatus {
    private static final String TAG = "PomahAdmin";

    private FirebaseStatus() {}

    public static boolean isConfigured(Context context) {
        if (context == null) return false;
        try {
            int flag = context.getResources().getIdentifier(
                "pomah_firebase_configured",
                "bool",
                context.getPackageName()
            );
            if (flag != 0 && !context.getResources().getBoolean(flag)) {
                return false;
            }
            int appId = context.getResources().getIdentifier(
                "google_app_id",
                "string",
                context.getPackageName()
            );
            if (appId == 0) return false;
            String value = context.getString(appId);
            return value != null && !value.trim().isEmpty();
        } catch (Throwable error) {
            Log.w(TAG, "Could not read Firebase configuration", error);
            return false;
        }
    }

    public static boolean isPushFailure(Throwable error) {
        Throwable current = error;
        while (current != null) {
            String type = current.getClass().getName();
            String message = current.getMessage() == null ? "" : current.getMessage();
            if (type.startsWith("com.google.firebase.")
                || type.contains("Firebase")
                || message.contains("FirebaseApp")
                || message.contains("Firebase")
                || message.contains("google-services")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
