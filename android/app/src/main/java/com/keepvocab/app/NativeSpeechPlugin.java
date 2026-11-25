package com.keepvocab.app;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "NativeSpeech")
public class NativeSpeechPlugin extends Plugin {

    private TextToSpeech synthesizer;
    private boolean ready = false;
    private PluginCall pendingCall;
    private int initializationGeneration = 0;

    protected TextToSpeech createSynthesizer(TextToSpeech.OnInitListener listener) {
        return new TextToSpeech(getContext(), listener);
    }

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
            final int generation = ++initializationGeneration;
            try {
                TextToSpeech created = createSynthesizer(status -> {
                    synchronized (NativeSpeechPlugin.this) {
                        if (generation != initializationGeneration) return;
                        ready = status == TextToSpeech.SUCCESS;
                        if (!ready) {
                            releaseSynthesizer();
                            rejectPending("Android text-to-speech could not start.", "TTS_INIT_FAILED");
                            return;
                        }
                        speakPending();
                    }
                });
                // Initialization can finish before the constructor returns.
                if (generation != initializationGeneration) {
                    created.shutdown();
                    return;
                }
                synthesizer = created;
                if (ready) speakPending();
            } catch (RuntimeException error) {
                releaseSynthesizer();
                rejectPending("Android text-to-speech could not start.", "TTS_INIT_FAILED");
            }
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
        selectNaturalVoice(locale);
        synthesizer.setSpeechRate(rate);
        Bundle parameters = new Bundle();
        int result = synthesizer.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, "keepvocab-pronunciation");
        if (result == TextToSpeech.ERROR) {
            call.reject("Android could not synthesize this pronunciation.", "TTS_SPEAK_FAILED");
            return;
        }
        call.resolve();
    }

    private void selectNaturalVoice(Locale locale) {
        if (synthesizer == null || locale == null) return;
        try {
            Set<Voice> voices = synthesizer.getVoices();
            if (voices == null || voices.isEmpty()) return;
            Voice best = null;
            int bestScore = Integer.MIN_VALUE;
            String targetLang = locale.getLanguage();
            String targetCountry = locale.getCountry();
            for (Voice voice : voices) {
                if (voice == null || voice.getLocale() == null) continue;
                Locale vLocale = voice.getLocale();
                if (!targetLang.equalsIgnoreCase(vLocale.getLanguage())) continue;
                int score = voice.getQuality();
                if (!targetCountry.isEmpty() && targetCountry.equalsIgnoreCase(vLocale.getCountry())) {
                    score += 120;
                }
                if (!voice.isNetworkConnectionRequired()) {
                    score += 40;
                }
                if (voice.getFeatures() != null && voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) {
                    score -= 500;
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = voice;
                }
            }
            if (best != null && bestScore > 0) {
                synthesizer.setVoice(best);
            }
        } catch (RuntimeException ignored) {
            // Fall back cleanly to the engine's default locale voice.
        }
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

    private void releaseSynthesizer() {
        initializationGeneration += 1;
        ready = false;
        TextToSpeech previous = synthesizer;
        synthesizer = null;
        if (previous != null) {
            try { previous.shutdown(); } catch (RuntimeException ignored) {}
        }
    }

    @Override
    protected synchronized void handleOnDestroy() {
        rejectPending("Speech stopped because KeepVocab closed.", "SPEECH_STOPPED");
        releaseSynthesizer();
        super.handleOnDestroy();
    }
}
