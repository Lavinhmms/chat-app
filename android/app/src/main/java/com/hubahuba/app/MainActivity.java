package com.hubahuba.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onPause() {
        super.onPause();
        if (BackgroundAudioPlugin.isEnabled()) {
            keepWebViewAlive();
        }
    }

    private void keepWebViewAlive() {
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
                bridge.getWebView().onResume();
            }
        } catch (Exception e) {
            // Silently handle
        }
    }
}
