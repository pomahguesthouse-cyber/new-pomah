package com.pomahguesthouse.admin;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the admin site ask whether this APK was built with Firebase. */
@CapacitorPlugin(name = "PomahFirebase")
public class PomahFirebasePlugin extends Plugin {
    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", FirebaseStatus.isConfigured(getContext()));
        call.resolve(result);
    }
}
