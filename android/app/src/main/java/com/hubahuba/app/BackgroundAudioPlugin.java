package com.hubahuba.app;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;

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
    public void setPiPEnabled(PluginCall call) {
        JSObject data = call.getData();
        isBackgroundModeEnabled = data.optBoolean("enabled", false);
        call.resolve();
    }

    @PluginMethod
    public void enterPiP(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getActivity() != null) {
            try {
                Rational aspectRatio = new Rational(16, 9);
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(aspectRatio)
                    .build();
                getActivity().enterPictureInPictureMode(params);
                call.resolve();
            } catch (Exception e) {
                call.reject("PiP failed: " + e.getMessage());
            }
        } else {
            call.reject("PiP not supported on this device");
        }
    }

    @PluginMethod
    public void isPipAvailable(PluginCall call) {
        JSObject result = new JSObject();
        boolean available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && getActivity() != null
            && getActivity().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        result.put("available", available);
        call.resolve(result);
    }

    public static boolean isEnabled() {
        return isBackgroundModeEnabled;
    }
}
