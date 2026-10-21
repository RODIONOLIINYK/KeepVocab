package com.keepvocab.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeSpeechPluginTest {
    private static class RecordingCall extends PluginCall {
        String errorCode;
        int resolved;
        int rejected;

        RecordingCall() {
            super(null, "NativeSpeech", "test", "speak", new JSObject().put("text", "word"));
        }

        @Override public void resolve() { resolved += 1; }
        @Override public void reject(String message, String code) {
            errorCode = code;
            rejected += 1;
        }
    }

    private static class ControlledPlugin extends NativeSpeechPlugin {
        final List<TextToSpeech.OnInitListener> initializations = new ArrayList<>();
        boolean failInConstructor;
        boolean failSynchronously;

        @Override public Context getContext() {
            return InstrumentationRegistry.getInstrumentation().getTargetContext();
        }

        @Override protected TextToSpeech createSynthesizer(TextToSpeech.OnInitListener listener) {
            if (failInConstructor) throw new IllegalStateException("TTS service unavailable");
            initializations.add(listener);
            // Keep real Android resource handling, while controlling the plugin's callback.
            TextToSpeech engine = new TextToSpeech(getContext(), status -> {});
            if (failSynchronously) listener.onInit(TextToSpeech.ERROR);
            return engine;
        }

        void close() { handleOnDestroy(); }
    }

    @Test public void failedInitializationRetriesAndIgnoresOldCallbacks() {
        ControlledPlugin plugin = new ControlledPlugin();
        try {
            RecordingCall first = new RecordingCall();
            plugin.speak(first);
            plugin.initializations.get(0).onInit(TextToSpeech.ERROR);
            assertEquals("TTS_INIT_FAILED", first.errorCode);

            RecordingCall second = new RecordingCall();
            plugin.speak(second);
            assertEquals(2, plugin.initializations.size());
            plugin.initializations.get(0).onInit(TextToSpeech.ERROR);
            assertEquals(0, second.rejected);
            plugin.initializations.get(1).onInit(TextToSpeech.ERROR);
            assertEquals("TTS_INIT_FAILED", second.errorCode);
            assertEquals(1, first.rejected);
            assertEquals(1, second.rejected);
        } finally { plugin.close(); }
    }

    @Test public void immediateFailuresSettleTheCallAndAllowAnotherAttempt() {
        ControlledPlugin plugin = new ControlledPlugin();
        try {
            plugin.failInConstructor = true;
            RecordingCall thrown = new RecordingCall();
            plugin.speak(thrown);
            assertEquals("TTS_INIT_FAILED", thrown.errorCode);

            plugin.failInConstructor = false;
            plugin.failSynchronously = true;
            for (int attempt = 0; attempt < 2; attempt++) {
                RecordingCall failed = new RecordingCall();
                plugin.speak(failed);
                assertEquals("TTS_INIT_FAILED", failed.errorCode);
                assertEquals(1, failed.rejected);
                assertEquals(attempt + 1, plugin.initializations.size());
            }
        } finally { plugin.close(); }
    }

    @Test public void replacementAndDestructionSettlePendingRequestsOnce() {
        ControlledPlugin plugin = new ControlledPlugin();
        RecordingCall first = new RecordingCall();
        RecordingCall second = new RecordingCall();
        plugin.speak(first);
        plugin.speak(second);
        assertEquals("SPEECH_REPLACED", first.errorCode);
        assertEquals(1, plugin.initializations.size());
        plugin.close();
        plugin.initializations.get(0).onInit(TextToSpeech.SUCCESS);
        assertEquals("SPEECH_STOPPED", second.errorCode);
        assertEquals(1, first.rejected);
        assertEquals(1, second.rejected);
        assertEquals(0, second.resolved);
    }
}
