package com.hubahuba.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import me.leolin.shortcutbadger.ShortcutBadger;

@CapacitorPlugin(name = "Badge")
public class BadgePlugin extends Plugin {

    @PluginMethod
    public void setCount(PluginCall call) {
        int count = call.getInt("count", 0);
        try {
            ShortcutBadger.applyCount(getContext(), count);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set badge: " + e.getMessage());
        }
    }
}
