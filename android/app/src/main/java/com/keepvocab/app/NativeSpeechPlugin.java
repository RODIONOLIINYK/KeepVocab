package com.keepvocab.app;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

@CapacitorPlugin(name = "NativeSpeech")
public class NativeSpeechPlugin extends Plugin {

    private TextToSpeech synthesizer;
    private boolean ready = false;
    private PluginCall pendingCall;

    @PluginMethod
    public synchronized void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("Speech text cannot be empty.", "EMPTY_TEXT");
            return;
        }

        if (pendingCall != null) {
            pendingCall.reject("Speech was replaced by a newer request.", "SPEECH_REPLACED");
        }
        pendingCall = call;

        if (synthesizer == null) {
            synthesizer = new TextToSpeech(getContext(), status -> {
                synchronized (NativeSpeechPlugin.this) {
                    ready = status == TextToSpeech.SUCCESS;
                    if (!ready) {
                        rejectPending("Android text-to-speech could not start.", "TTS_INIT_FAILED");
                        return;
                    }
                    speakPending();
                }
            });
            return;
        }

        if (!ready) return;
        speakPending();
    }

    private void speakPending() {
        if (pendingCall == null || synthesizer == null || !ready) return;
        PluginCall call = pendingCall;
        pendingCall = null;
        String text = call.getString("text", "").trim();
        String languageTag = call.getString("lang", "en-US");
        float rate = Math.max(0.5f, Math.min(2f, call.getFloat("rate", 0.9f)));
        Locale locale = Locale.forLanguageTag(languageTag);
        int availability = synthesizer.setLanguage(locale);
        if (availability == TextToSpeech.LANG_MISSING_DATA || availability == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.reject("The selected speech language is not installed on this device.", "LANG_NOT_AVAILABLE");
            return;
        }
        synthesizer.setSpeechRate(rate);
        Bundle parameters = new Bundle();
        int result = synthesizer.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, "keepvocab-pronunciation");
        if (result == TextToSpeech.ERROR) {
            call.reject("Android could not synthesize this pronunciation.", "TTS_SPEAK_FAILED");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        if (synthesizer != null) synthesizer.stop();
        if (pendingCall != null) {
            pendingCall.reject("Speech was stopped.", "SPEECH_STOPPED");
            pendingCall = null;
        }
        call.resolve();
    }

    private void rejectPending(String message, String code) {
        if (pendingCall == null) return;
        pendingCall.reject(message, code);
        pendingCall = null;
    }

    @Override
    protected synchronized void handleOnDestroy() {
        rejectPending("Speech stopped because KeepVocab closed.", "SPEECH_STOPPED");
        if (synthesizer != null) {
            synthesizer.stop();
            synthesizer.shutdown();
            synthesizer = null;
        }
        ready = false;
        super.handleOnDestroy();
    }
}
