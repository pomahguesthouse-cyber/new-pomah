package com.pomahguesthouse.admin;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "PomahAdmin";
    private static final String ADMIN_URL = "https://pomahguesthouse.com/admin";
    private int webViewReloadAttempts = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Theme.SplashScreen is not an AppCompat theme until this runs. Without it,
        // BridgeActivity crashes on launch on some Android 12+ / One UI devices.
        SplashScreen.installSplashScreen(this);
        registerPlugin(PomahFirebasePlugin.class);
        super.onCreate(savedInstanceState);
        keepWebViewAlive();
    }

    /**
     * A renderer crash otherwise becomes a fatal Chromium abort
     * ("crash wasn't handled by all associated webviews") and the shell closes.
     * Tell Android the crash was handled and load the admin page again.
     */
    private void keepWebViewAlive() {
        if (getBridge() == null) return;
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, android.webkit.RenderProcessGoneDetail detail) {
                Log.e(TAG, "WebView renderer exited. Reloading the admin page.");
                if (webViewReloadAttempts < 3) {
                    webViewReloadAttempts++;
                    final String url = adminUrl();
                    webView.post(() -> {
                        try {
                            webView.loadUrl(url);
                        } catch (Throwable error) {
                            Log.e(TAG, "Could not reload admin after the renderer exited", error);
                        }
                    });
                }
                return true;
            }
        });
    }

    private String adminUrl() {
        try {
            String configured = getBridge().getConfig().getServerUrl();
            if (configured != null && !configured.isEmpty()) return configured;
        } catch (Throwable ignored) {
            // Fall back to the live admin URL.
        }
        return ADMIN_URL;
    }
}
