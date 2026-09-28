package com.pomahguesthouse.admin;

import android.app.Application;
import android.os.Looper;
import android.util.Log;
import com.google.firebase.FirebaseApp;

/**
 * Starts Firebase only when google-services.json was packaged into the build.
 * Push failures are logged. They must not take the admin shell down.
 */
public class PomahAdminApplication extends Application {
    private static final String TAG = "PomahAdmin";

    @Override
    public void onCreate() {
        super.onCreate();
        installPushSafetyNet();
        if (!FirebaseStatus.isConfigured(this)) {
            Log.i(TAG, "Firebase is not configured; push stays off");
            return;
        }
        try {
            if (FirebaseApp.initializeApp(this) == null) {
                Log.w(TAG, "FirebaseApp.initializeApp returned null; push stays off");
            }
        } catch (Throwable error) {
            Log.e(TAG, "Firebase init failed; push stays off", error);
        }
    }

    private void installPushSafetyNet() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            if (FirebaseStatus.isPushFailure(throwable)) {
                Log.e(TAG, "Push failure on " + thread.getName() + "; keeping the app open", throwable);
                if (thread != Looper.getMainLooper().getThread()) {
                    return;
                }
            }
            if (previous != null) {
                previous.uncaughtException(thread, throwable);
            }
        });
    }
}
