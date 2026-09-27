package com.pomahguesthouse.admin;

import android.app.Application;
import com.google.firebase.FirebaseApp;

/**
 * Starts Firebase only when google-services.json was packaged into the build.
 * Without that file, initializeApp returns null and the admin shell still opens.
 */
public class PomahAdminApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        try {
            FirebaseApp.initializeApp(this);
        } catch (Exception ignored) {
            // Push stays disabled until Firebase is configured.
        }
    }
}
