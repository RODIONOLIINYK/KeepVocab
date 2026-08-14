const PROFILES = {
  tap: [
    { frequency: 520, duration: 0.045, volume: 0.026, type: 'sine' }
  ],
  success: [
    { frequency: 523.25, duration: 0.075, volume: 0.045, type: 'sine' },
    { frequency: 659.25, duration: 0.09, volume: 0.05, type: 'sine', delay: 0.065 },
    { frequency: 783.99, duration: 0.12, volume: 0.045, type: 'sine', delay: 0.14 }
  ],
  error: [
    { frequency: 311.13, duration: 0.09, volume: 0.04, type: 'triangle' },
    { frequency: 233.08, duration: 0.13, volume: 0.04, type: 'triangle', delay: 0.075 }
  ]
};

let audioContext = null;
let enabledProvider = () => true;

export function setInteractionSoundEnabledProvider(provider) {
  enabledProvider = typeof provider === 'function' ? provider : () => true;
}

export function getInteractionSoundProfile(kind = 'tap') {
  return (PROFILES[kind] || PROFILES.tap).map(tone => ({ ...tone }));
}

function getAudioContext() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

export function playInteractionSound(kind = 'tap') {
  if (!enabledProvider()) return false;
  const context = getAudioContext();
  if (!context) return false;

  const start = context.currentTime + 0.005;
  for (const tone of getInteractionSoundProfile(kind)) {
    const toneStart = start + Number(tone.delay || 0);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(tone.volume, toneStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + tone.duration + 0.02);
  }
  return true;
}

export function setupButtonSounds(root = document) {
  root.addEventListener('pointerdown', event => {
    const control = event.target.closest('button, a[href]');
    if (!control || control.matches(':disabled, [data-sound="none"]')) return;
    if (control.closest('.audio-btn-circle') || control.id === 'btn-toggle-speech-speed') return;
    playInteractionSound(control.dataset.sound || 'tap');
  });
}
