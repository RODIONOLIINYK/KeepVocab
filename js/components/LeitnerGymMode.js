// Leitner 5-Box Spaced Repetition System Gym View

import { driveSync } from '../services/driveSync.js?v=42';
import { getDueWords, updateWordRepetition } from '../services/srsEngine.js?v=42';
import { speakWord } from '../services/speechService.js?v=43';

export function renderLeitnerGymMode(container, onNavigate) {
  const activeNotebook = driveSync.getActiveNotebook();
  const allWords = driveSync.getWords().filter(w => w.notebook === activeNotebook);
  const dueWords = getDueWords().filter(w => w.notebook === activeNotebook);

  // Group words into Box 1 through Box 5
  const boxes = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  allWords.forEach(w => {
    const boxNum = w.box || 1;
    boxes[boxNum].push(w);
  });

  let sessionActive = false;
  let currentReviewIndex = 0;
  let sessionRevealed = false;

  function renderGymOverview() {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1 class="hero-title" style="font-size: 1.8rem;">Leitner SRS Memory Gym</h1>
            <p style="color: var(--text-muted); font-size: 0.92rem;">
              Algorithmically scheduled spaced repetition for <strong>"${activeNotebook}"</strong>.
            </p>
          </div>
          <button class="btn btn-outline" id="btn-back-dash"><i class="fa-solid fa-arrow-left"></i> Dashboard</button>
        </div>

        <!-- 5 Leitner Boxes Cards Overview -->
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px;">
          <div class="glass-card" style="text-align: center; border-top: 3px solid var(--accent-danger);">
            <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Box 1 (Daily)</div>
            <div style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: var(--text-main); margin: 8px 0;">${boxes[1].length}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">1-Day Review</div>
          </div>

          <div class="glass-card" style="text-align: center; border-top: 3px solid var(--accent-warning);">
            <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Box 2 (3 Days)</div>
            <div style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: var(--text-main); margin: 8px 0;">${boxes[2].length}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">3-Day Review</div>
          </div>

          <div class="glass-card" style="text-align: center; border-top: 3px solid var(--primary);">
            <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Box 3 (1 Week)</div>
            <div style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: var(--text-main); margin: 8px 0;">${boxes[3].length}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">7-Day Review</div>
          </div>

          <div class="glass-card" style="text-align: center; border-top: 3px solid var(--accent-purple);">
            <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Box 4 (2 Weeks)</div>
            <div style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: var(--text-main); margin: 8px 0;">${boxes[4].length}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">14-Day Review</div>
          </div>

          <div class="glass-card" style="text-align: center; border-top: 3px solid var(--accent-success);">
            <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Box 5 (Mastered)</div>
            <div style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: var(--accent-success); margin: 8px 0;">${boxes[5].length}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">30-Day Review</div>
          </div>
        </div>

        <!-- Review Session Banner -->
        <div class="glass-card" style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, rgba(22, 30, 46, 0.9), rgba(0, 229, 255, 0.1));">
          <div>
            <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.4rem;">Daily SRS Review Queue</h2>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">
              You have <strong>${dueWords.length} words</strong> scheduled for recall training.
            </p>
          </div>
          <button class="btn btn-primary" id="btn-start-leitner-session" ${dueWords.length === 0 ? 'disabled' : ''}>
            <i class="fa-solid fa-play"></i> Start ${dueWords.length} Reviews
          </button>
        </div>
      </div>
    `;

    container.querySelector('#btn-back-dash').addEventListener('click', () => onNavigate('dashboard'));
    if (dueWords.length > 0) {
      container.querySelector('#btn-start-leitner-session').addEventListener('click', () => {
        sessionActive = true;
        currentReviewIndex = 0;
        sessionRevealed = false;
        renderReviewSession();
      });
    }
  }

  function renderReviewSession() {
    if (currentReviewIndex >= dueWords.length) {
      container.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 48px; max-width: 500px; margin: 40px auto;">
          <div style="font-size: 4rem; color: var(--accent-success); margin-bottom: 16px;">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.8rem; margin-bottom: 8px;">Session Completed!</h2>
          <p style="color: var(--text-muted); margin-bottom: 24px;">You have completed all scheduled Leitner reviews for today.</p>
          <button class="btn btn-primary" id="btn-done-gym"><i class="fa-solid fa-house"></i> Return to Dashboard</button>
        </div>
      `;
      container.querySelector('#btn-done-gym').addEventListener('click', () => onNavigate('dashboard'));
      return;
    }

    const word = dueWords[currentReviewIndex];

    container.innerHTML = `
      <div style="max-width: 580px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.9rem; color: var(--text-muted);">
            Review <strong>${currentReviewIndex + 1}</strong> of <strong>${dueWords.length}</strong>
          </span>
          <span class="badge" style="background: var(--accent-purple);">Box ${word.box || 1}</span>
        </div>

        <div class="glass-card" style="text-align: center; padding: 36px;">
          <img src="${word.imageUrl}" alt="${word.word}" style="width: 100%; height: 160px; object-fit: cover; border-radius: var(--radius-md); margin-bottom: 20px;" onerror="this.src='https://picsum.photos/seed/${encodeURIComponent(word.word)}/600/400'">

          <h1 style="font-family: 'Outfit', sans-serif; font-size: 2.5rem; font-weight: 800; color: #fff; margin-bottom: 8px;">
            ${word.word}
          </h1>
          <div style="color: var(--primary); font-size: 1.1rem; margin-bottom: 16px;">${word.phonetic}</div>
          <button class="btn-icon" style="margin: 0 auto 20px;" id="btn-srs-audio"><i class="fa-solid fa-volume-high"></i></button>

          ${sessionRevealed ? `
            <div style="border-top: 1px solid var(--border-glass); padding-top: 20px; animation: fadeIn 0.3s ease;">
              <div style="display: inline-block; padding: 2px 10px; border-radius: var(--radius-full); background: rgba(0,229,255,0.15); color: var(--primary); font-size: 0.8rem; font-weight: 700; margin-bottom: 10px;">${word.partOfSpeech}</div>
              <p style="font-size: 1.15rem; line-height: 1.5; color: var(--text-main); margin-bottom: 10px;">"${word.definition}"</p>
              <div style="font-style: italic; color: var(--text-muted); font-size: 0.95rem;">"${word.example}"</div>
            </div>
          ` : `
            <button class="btn btn-secondary" id="btn-reveal-answer" style="width: 100%; padding: 14px; margin-top: 10px;">
              <i class="fa-solid fa-eye"></i> Show Definition
            </button>
          `}
        </div>

        ${sessionRevealed ? `
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
            <button class="btn btn-outline" style="border-color: var(--accent-danger); flex-direction: column; padding: 12px 6px;" id="btn-srs-again">
              <span style="color: var(--accent-danger); font-weight: 700;">Again</span>
              <span style="font-size: 0.7rem; color: var(--text-dim);">1 Day (Box 1)</span>
            </button>

            <button class="btn btn-outline" style="border-color: var(--accent-warning); flex-direction: column; padding: 12px 6px;" id="btn-srs-hard">
              <span style="color: var(--accent-warning); font-weight: 700;">Hard</span>
              <span style="font-size: 0.7rem; color: var(--text-dim);">Keep Box</span>
            </button>

            <button class="btn btn-primary" style="flex-direction: column; padding: 12px 6px;" id="btn-srs-good">
              <span style="font-weight: 700;">Good</span>
              <span style="font-size: 0.7rem; color: #000;">+1 Box</span>
            </button>

            <button class="btn btn-outline" style="border-color: var(--accent-success); flex-direction: column; padding: 12px 6px;" id="btn-srs-easy">
              <span style="color: var(--accent-success); font-weight: 700;">Easy</span>
              <span style="font-size: 0.7rem; color: var(--text-dim);">+2 Boxes</span>
            </button>
          </div>
        ` : ''}
      </div>
    `;

    container.querySelector('#btn-srs-audio').addEventListener('click', () => speakWord(word.word, 'en-US', 0.9, word.audioUrl));

    if (!sessionRevealed) {
      container.querySelector('#btn-reveal-answer').addEventListener('click', () => {
        sessionRevealed = true;
        renderReviewSession();
      });
    } else {
      const submitGrade = (grade) => {
        updateWordRepetition(word.id, grade);
        currentReviewIndex++;
        sessionRevealed = false;
        renderReviewSession();
      };

      container.querySelector('#btn-srs-again').addEventListener('click', () => submitGrade('again'));
      container.querySelector('#btn-srs-hard').addEventListener('click', () => submitGrade('hard'));
      container.querySelector('#btn-srs-good').addEventListener('click', () => submitGrade('good'));
      container.querySelector('#btn-srs-easy').addEventListener('click', () => submitGrade('easy'));
    }

    speakWord(word.word, 'en-US', 0.9, word.audioUrl);
  }

  renderGymOverview();
}
