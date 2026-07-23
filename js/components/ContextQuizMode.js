// Context Sentence Cloze & Multiple-Choice Quiz Engine Component

import { driveSync } from '../services/driveSync.js?v=20';
import { speakWord } from '../services/speechService.js';
import { updateWordRepetition } from '../services/srsEngine.js?v=20';

export function renderContextQuizMode(container, onNavigate) {
  const activeNotebook = driveSync.getActiveNotebook();
  const allWords = driveSync.getWords().filter(w => w.notebook === activeNotebook);

  if (allWords.length < 3) {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 48px;">
        <i class="fa-solid fa-puzzle-piece" style="font-size: 3rem; color: var(--accent-orange); margin-bottom: 16px;"></i>
        <h2>Need at least 3 words in "${activeNotebook}"</h2>
        <p style="color: var(--text-muted); margin: 12px 0 24px;">Add more words to unlock contextual multiple-choice & cloze quizzes!</p>
        <button class="btn btn-primary" id="btn-add-for-quiz"><i class="fa-solid fa-plus"></i> Quick Add Word</button>
      </div>
    `;
    container.querySelector('#btn-add-for-quiz').addEventListener('click', () => {
      document.getElementById('quick-add-modal').classList.add('active');
    });
    return;
  }

  let currentQuestion = 0;
  let score = 0;
  const totalQuestions = Math.min(10, allWords.length);

  // Shuffle words for quiz session
  const quizWords = [...allWords].sort(() => Math.random() - 0.5).slice(0, totalQuestions);

  function renderQuestion() {
    if (currentQuestion >= totalQuestions) {
      container.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 48px; max-width: 520px; margin: 40px auto;">
          <div style="font-size: 4rem; color: var(--accent-orange); margin-bottom: 16px;">
            <i class="fa-solid fa-trophy"></i>
          </div>
          <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.8rem;">Quiz Finished!</h2>
          <div style="font-size: 2.5rem; font-weight: 800; color: var(--primary); margin: 16px 0;">
            ${score} / ${totalQuestions}
          </div>
          <p style="color: var(--text-muted); margin-bottom: 24px;">Great work practicing word contexts and definitions!</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn btn-secondary" id="btn-retry-quiz"><i class="fa-solid fa-rotate-right"></i> Retry Quiz</button>
            <button class="btn btn-primary" id="btn-exit-quiz"><i class="fa-solid fa-house"></i> Dashboard</button>
          </div>
        </div>
      `;
      container.querySelector('#btn-retry-quiz').addEventListener('click', () => renderContextQuizMode(container, onNavigate));
      container.querySelector('#btn-exit-quiz').addEventListener('click', () => onNavigate('dashboard'));
      return;
    }

    const targetWord = quizWords[currentQuestion];

    // Build 4 multiple choice options (1 correct, 3 distractors)
    const distractors = allWords.filter(w => w.id !== targetWord.id).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [targetWord, ...distractors].sort(() => Math.random() - 0.5);

    // Create cloze sentence by masking target word
    const clozeSentence = targetWord.example
      ? targetWord.example.replace(new RegExp(targetWord.word, 'gi'), '__________')
      : `Complete the sentence with the word that means: "${targetWord.definition}".`;

    container.innerHTML = `
      <div style="max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button class="btn btn-outline" id="btn-back-dash"><i class="fa-solid fa-arrow-left"></i> Exit Quiz</button>
          <span style="font-size: 0.9rem; color: var(--text-muted);">
            Question <strong>${currentQuestion + 1}</strong> of <strong>${totalQuestions}</strong>
          </span>
          <span class="badge" style="background: var(--accent-orange);">Score: ${score}</span>
        </div>

        <div class="glass-card">
          <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-orange); font-weight: 700; margin-bottom: 12px;">
            <i class="fa-solid fa-align-left"></i> Contextual Cloze Quiz
          </div>

          <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.3rem; line-height: 1.5; color: #fff; margin-bottom: 16px;">
            "${clozeSentence}"
          </h2>

          <div style="font-size: 0.9rem; color: var(--text-muted); padding: 12px; background: rgba(255,255,255,0.03); border-radius: var(--radius-md); border-left: 3px solid var(--primary);">
            <strong>Definition clue:</strong> ${targetWord.definition}
          </div>

          <div class="options-grid" id="options-container">
            ${options.map((opt, i) => `
              <button class="option-btn" data-word="${opt.word}">
                <strong>${String.fromCharCode(65 + i)}.</strong> ${opt.word}
              </button>
            `).join('')}
          </div>
        </div>

        <div id="quiz-feedback-box" style="display: none; padding: 16px; border-radius: var(--radius-md); text-align: center; font-weight: 600;"></div>
      </div>
    `;

    container.querySelector('#btn-back-dash').addEventListener('click', () => onNavigate('dashboard'));

    const optionBtns = container.querySelectorAll('.option-btn');
    optionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedWord = btn.getAttribute('data-word');
        const isCorrect = selectedWord.toLowerCase() === targetWord.word.toLowerCase();

        optionBtns.forEach(b => b.disabled = true);

        if (isCorrect) {
          btn.classList.add('correct');
          score++;
          updateWordRepetition(targetWord.id, 'good');
          speakWord(targetWord.word);
        } else {
          btn.classList.add('incorrect');
          // Highlight correct option
          optionBtns.forEach(b => {
            if (b.getAttribute('data-word').toLowerCase() === targetWord.word.toLowerCase()) {
              b.classList.add('correct');
            }
          });
          updateWordRepetition(targetWord.id, 'again');
        }

        setTimeout(() => {
          currentQuestion++;
          renderQuestion();
        }, 1400);
      });
    });
  }

  renderQuestion();
}
