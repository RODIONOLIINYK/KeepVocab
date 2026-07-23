// Speed Active Spelling & Recall Challenge Component

import { driveSync } from '../services/driveSync.js?v=20';
import { speakWord } from '../services/speechService.js';
import { updateWordRepetition } from '../services/srsEngine.js?v=20';

export function renderSpeedSpellingMode(container, onNavigate) {
  const activeNotebook = driveSync.getActiveNotebook();
  const allWords = driveSync.getWords().filter(w => w.notebook === activeNotebook);

  if (allWords.length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 48px;">
        <i class="fa-solid fa-keyboard" style="font-size: 3rem; color: var(--accent-success); margin-bottom: 16px;"></i>
        <h2>No words in "${activeNotebook}"</h2>
        <p style="color: var(--text-muted); margin: 12px 0 24px;">Add words to practice speed spelling active recall!</p>
        <button class="btn btn-primary" id="btn-add-spelling"><i class="fa-solid fa-plus"></i> Quick Add Word</button>
      </div>
    `;
    container.querySelector('#btn-add-spelling').addEventListener('click', () => {
      document.getElementById('quick-add-modal').classList.add('active');
    });
    return;
  }

  let wordQueue = [...allWords].sort(() => Math.random() - 0.5);
  let currentIndex = 0;
  let score = 0;
  let timeLeft = 45;
  let timerInterval = null;

  function startTimer() {
    timerInterval = setInterval(() => {
      timeLeft--;
      const timerEl = container.querySelector('#spelling-timer');
      if (timerEl) timerEl.textContent = `${timeLeft}s`;
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        endChallenge();
      }
    }, 1000);
  }

  function endChallenge() {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 48px; max-width: 500px; margin: 40px auto;">
        <div style="font-size: 4rem; color: var(--accent-success); margin-bottom: 16px;">
          <i class="fa-solid fa-bolt"></i>
        </div>
        <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.8rem;">Speed Challenge Done!</h2>
        <div style="font-size: 2.8rem; font-weight: 800; color: var(--accent-success); margin: 12px 0;">
          ${score} Words Spelled
        </div>
        <button class="btn btn-primary" id="btn-restart-spelling"><i class="fa-solid fa-rotate-right"></i> Play Again</button>
      </div>
    `;
    container.querySelector('#btn-restart-spelling').addEventListener('click', () => renderSpeedSpellingMode(container, onNavigate));
  }

  function renderWord() {
    if (currentIndex >= wordQueue.length) {
      clearInterval(timerInterval);
      endChallenge();
      return;
    }

    const currentWord = wordQueue[currentIndex];

    container.innerHTML = `
      <div style="max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button class="btn btn-outline" id="btn-back-dash"><i class="fa-solid fa-arrow-left"></i> Exit</button>
          <div style="font-size: 1.2rem; font-weight: 800; color: var(--accent-orange);" id="spelling-timer">
            ${timeLeft}s
          </div>
          <span class="badge" style="background: var(--accent-success);">Score: ${score}</span>
        </div>

        <div class="glass-card" style="text-align: center; padding: 32px;">
          <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-success); font-weight: 700; margin-bottom: 16px;">
            <i class="fa-solid fa-spell-check"></i> Type the correct spelling
          </div>

          <div style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-bottom: 16px;">
            <span style="font-size: 1.2rem; color: var(--primary); font-weight: 600;">${currentWord.phonetic}</span>
            <button class="btn-icon-sm" id="btn-listen-spelling" title="Listen sound"><i class="fa-solid fa-volume-high"></i></button>
          </div>

          <p style="font-size: 1.1rem; line-height: 1.5; color: var(--text-main); margin-bottom: 24px;">
            "${currentWord.definition}"
          </p>

          <form id="spelling-form" style="display: flex; gap: 10px;">
            <input type="text" id="spelling-input" placeholder="Type word here..." autocomplete="off" autofocus style="font-size: 1.1rem; text-align: center;">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i></button>
          </form>
        </div>
      </div>
    `;

    container.querySelector('#btn-back-dash').addEventListener('click', () => {
      clearInterval(timerInterval);
      onNavigate('dashboard');
    });

    container.querySelector('#btn-listen-spelling').addEventListener('click', () => speakWord(currentWord.word));

    const inputEl = container.querySelector('#spelling-input');
    inputEl.focus();

    container.querySelector('#spelling-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = inputEl.value.trim().toLowerCase();
      if (val === currentWord.word.toLowerCase()) {
        score++;
        updateWordRepetition(currentWord.id, 'easy');
        speakWord('Correct!');
      } else {
        updateWordRepetition(currentWord.id, 'again');
      }
      currentIndex++;
      renderWord();
    });

    speakWord(currentWord.word);
  }

  renderWord();
  startTimer();
}
