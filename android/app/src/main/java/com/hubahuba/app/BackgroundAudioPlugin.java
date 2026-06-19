package com.hubahuba.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {

    public static boolean isBackgroundModeEnabled = false;

    @PluginMethod
    public void start(PluginCall call) {
        isBackgroundModeEnabled = true;
        Intent intent = new Intent(getContext(), BackgroundAudioService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        isBackgroundModeEnabled = false;
        Intent intent = new Intent(getContext(), BackgroundAudioService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        JSObject data = call.getData();
        isBackgroundModeEnabled = data.optBoolean("enabled", false);
        call.resolve();
    }

    public static boolean isEnabled() {
        return isBackgroundModeEnabled;
    }

    @PluginMethod
    public void openInYouTubeApp(PluginCall call) {
        JSObject data = call.getData();
        String videoId = data.getString("videoId");
        if (videoId == null || videoId.isEmpty()) {
            call.reject("Missing videoId");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://www.youtube.com/watch?v=" + videoId));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open YouTube: " + e.getMessage());
        }
    }
}
