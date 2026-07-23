// Text-To-Speech Pronunciation Service using Web Speech API

export function speakWord(text, lang = 'en-US', rate = 0.9) {
  if (!('speechSynthesis' in window)) {
    console.warn('[SpeechService] Web Speech API not supported in this browser.');
    return;
  }

  window.speechSynthesis.cancel(); // Stop active audio

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  utterance.pitch = 1.0;

  // Select natural sounding voice if available
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => (v.lang.includes('en-US') || v.lang.includes('en-GB')) && v.name.includes('Natural'))
                     || voices.find(v => v.lang.includes('en'));

  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  window.speechSynthesis.speak(utterance);
}
