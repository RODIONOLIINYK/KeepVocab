package com.keepvocab.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DriveAuthPlugin.class);
        registerPlugin(NativeSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
