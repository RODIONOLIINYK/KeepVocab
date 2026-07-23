// Visual 3D Flip Flashcards Component

import { driveSync } from '../services/driveSync.js?v=42';
import { speakWord } from '../services/speechService.js';
import { updateWordRepetition } from '../services/srsEngine.js?v=42';

export function renderFlashcardsMode(container, onNavigate) {
  const activeNotebook = driveSync.getActiveNotebook();
  const words = driveSync.getWords().filter(w => w.notebook === activeNotebook);

  if (words.length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 48px;">
        <i class="fa-solid fa-folder-open" style="font-size: 3rem; color: var(--text-dim); margin-bottom: 16px;"></i>
        <h2>No Words in "${activeNotebook}"</h2>
        <p style="color: var(--text-muted); margin: 12px 0 24px;">Add a word to start learning with visual 3D flashcards!</p>
        <button class="btn btn-primary" id="btn-add-first-flashcard"><i class="fa-solid fa-plus"></i> Quick Add Word</button>
      </div>
    `;
    container.querySelector('#btn-add-first-flashcard').addEventListener('click', () => {
      document.getElementById('quick-add-modal').classList.add('active');
    });
    return;
  }

  let currentIndex = 0;
  let isFlipped = false;

  function renderCard() {
    const word = words[currentIndex];

    container.innerHTML = `
      <div style="max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button class="btn btn-outline" id="btn-back-dashboard"><i class="fa-solid fa-arrow-left"></i> Exit Gym</button>
          <span style="font-size: 0.9rem; color: var(--text-muted);">
            Card <strong>${currentIndex + 1}</strong> of <strong>${words.length}</strong>
          </span>
          <button class="btn-icon" id="btn-speak-word" title="Speak Word"><i class="fa-solid fa-volume-high"></i></button>
        </div>

        <!-- 3D Flip Card Container -->
        <div class="flashcard-wrapper ${isFlipped ? 'flipped' : ''}" id="flashcard-card">
          <div class="flashcard-inner">
            <!-- Front of Flashcard -->
            <div class="flashcard-front">
              <img src="${word.imageUrl}" alt="${word.word}" class="flashcard-img" onerror="this.src='https://picsum.photos/seed/${encodeURIComponent(word.word)}/600/400'">
              <div class="flashcard-word">${word.word}</div>
              <div class="flashcard-phonetic">${word.phonetic}</div>
              <div style="margin-top: 14px; font-size: 0.8rem; color: var(--text-dim);">
                <i class="fa-solid fa-hand-pointer"></i> Click card or press <kbd>Space</kbd> to flip
              </div>
            </div>

            <!-- Back of Flashcard -->
            <div class="flashcard-back">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span class="badge" style="background: var(--primary); color: #000;">${word.partOfSpeech}</span>
                <span style="font-size: 0.85rem; color: var(--text-muted);">${word.notebook}</span>
              </div>
              <div class="flashcard-def">"${word.definition}"</div>
              ${word.example ? `<div class="flashcard-example">"${word.example}"</div>` : ''}

              <div style="margin-top: 20px; font-size: 0.8rem; color: var(--text-dim);">
                Leitner Box: <strong>Box ${word.box || 1}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Controls & Grading Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
          <button class="btn btn-secondary" id="btn-prev-card" ${currentIndex === 0 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-left"></i> Previous
          </button>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-outline" style="border-color: var(--accent-danger);" id="btn-grade-again">
              <i class="fa-solid fa-rotate-left"></i> Again
            </button>
            <button class="btn btn-primary" id="btn-grade-good">
              <i class="fa-solid fa-circle-check"></i> Good
            </button>
          </div>

          <button class="btn btn-secondary" id="btn-next-card" ${currentIndex === words.length - 1 ? 'disabled' : ''}>
            Next <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;

    // Event Bindings
    const cardEl = container.querySelector('#flashcard-card');
    cardEl.addEventListener('click', () => {
      isFlipped = !isFlipped;
      cardEl.classList.toggle('flipped', isFlipped);
    });

    container.querySelector('#btn-speak-word').addEventListener('click', (e) => {
      e.stopPropagation();
      speakWord(word.word);
    });

    container.querySelector('#btn-back-dashboard').addEventListener('click', () => onNavigate('dashboard'));

    container.querySelector('#btn-prev-card').addEventListener('click', () => {
      if (currentIndex > 0) {
        currentIndex--;
        isFlipped = false;
        renderCard();
      }
    });

    container.querySelector('#btn-next-card').addEventListener('click', () => {
      if (currentIndex < words.length - 1) {
        currentIndex++;
        isFlipped = false;
        renderCard();
      }
    });

    container.querySelector('#btn-grade-again').addEventListener('click', () => {
      updateWordRepetition(word.id, 'again');
      if (currentIndex < words.length - 1) currentIndex++;
      isFlipped = false;
      renderCard();
    });

    container.querySelector('#btn-grade-good').addEventListener('click', () => {
      updateWordRepetition(word.id, 'good');
      if (currentIndex < words.length - 1) currentIndex++;
      isFlipped = false;
      renderCard();
    });

    // Auto-speak on first show
    speakWord(word.word);
  }

  renderCard();
}
