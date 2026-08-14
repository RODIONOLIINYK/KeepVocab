import { driveSync, getCurrentMonthNotebookTitle } from '../services/driveSync.js?v=42';
import { speakWord } from '../services/speechService.js?v=43';
import { getDueWords, updateWordRepetition } from '../services/srsEngine.js?v=42';
import { playInteractionSound } from '../services/interactionSound.js?v=49';
import { escapeHtml } from '../utils/html.js';

function normalizeAnswer(value) {
  return String(value || '').trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ');
}

export function renderReviewView(container, onNavigate) {
  const activeNotebook = driveSync.getActiveNotebook() || getCurrentMonthNotebookTitle();
  const queue = [...getDueWords().filter(word => word.notebook === activeNotebook)];
  const originalCount = queue.length;
  const retried = new Set();
  let index = 0;
  let score = 0;
  let answered = false;
  let correct = false;

  const goTo = view => {
    if (window.location.hash === `#${view}`) onNavigate(view);
    else window.location.hash = view;
  };

  function render() {
    const current = queue[index];
    const complete = originalCount > 0 && index >= queue.length;
    container.innerHTML = `
      <section class="full-view-stack" aria-labelledby="review-heading">
        <div class="spec-card practice-shell review-recall-shell">
          <div class="card-header-bar">
            <div class="card-tag" id="review-heading"><i class="fa-solid fa-keyboard"></i> Typed review</div>
            <span class="muted-label">${escapeHtml(activeNotebook)}</span>
          </div>

          ${originalCount === 0 ? `
            <div class="useful-empty-state">
              <img class="mascot-result" src="assets/keepvocab-sprig-celebrate.png" alt="Sprig celebrating">
              <h2>All caught up</h2>
              <p>No words are due in this notebook. Choose a learning mode from the dashboard if you want extra practice.</p>
              <div class="inline-actions"><button class="btn-green-solid" id="review-go-dashboard">Open learning modes</button><button class="status-pill offline" id="review-go-library">Open library</button></div>
            </div>` : complete ? `
            <div class="useful-empty-state mode-complete">
              <img class="mascot-result" src="assets/keepvocab-sprig-celebrate.png" alt="Sprig celebrating">
              <h2>Review complete</h2>
              <p>You typed ${score} of ${originalCount} due words correctly. Missed words were repeated once.</p>
              <div class="review-score-orb"><strong>${score}</strong><span>correct</span></div>
              <div class="inline-actions"><button class="btn-green-solid" id="review-go-dashboard">Back to dashboard</button><button class="status-pill offline" id="review-go-stats">View stats</button></div>
            </div>` : `
            <div class="practice-topline"><button class="status-pill offline" id="review-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${index + 1} of ${queue.length}</span><strong>Score ${score}</strong></div>
            <div class="review-progress" aria-label="Review progress"><span style="width:${Math.round(index / queue.length * 100)}%"></span></div>
            <div class="practice-prompt typed-review-prompt">
              <div class="practice-icon"><i class="fa-solid fa-keyboard"></i></div>
              <p>Type the word that matches this definition.</p>
              <blockquote>${escapeHtml(current.definition)}</blockquote>
              <span class="review-pos-hint">${escapeHtml(current.partOfSpeech || 'word')}</span>
              ${answered ? `
                ${correct ? '<span class="success-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}
                <div class="practice-feedback ${correct ? 'correct' : 'incorrect'}">
                  <strong>${correct ? `Correct: ${escapeHtml(current.word)}` : `Answer: ${escapeHtml(current.word)}`}</strong>
                  <span>${escapeHtml(current.example || 'The review schedule has been updated.')}</span>
                </div>
                <div class="inline-actions"><button class="status-pill offline" id="review-speak"><i class="fa-solid fa-volume-high"></i> Hear answer</button><button class="btn-green-solid" id="review-next">${index + 1 === queue.length ? 'See result' : 'Next word'}</button></div>` : `
                <form class="practice-answer-form" id="review-form">
                  <input id="review-answer" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type the word" aria-label="Review answer">
                  <button class="btn-green-solid" data-sound="none">Check</button>
                </form>`}
            </div>`}
        </div>
      </section>`;

    container.querySelector('#review-go-library')?.addEventListener('click', () => goTo('library'));
    container.querySelector('#review-go-dashboard')?.addEventListener('click', () => goTo('dashboard'));
    container.querySelector('#review-go-stats')?.addEventListener('click', () => goTo('stats'));
    container.querySelector('#review-exit')?.addEventListener('click', () => goTo('dashboard'));
    container.querySelector('#review-speak')?.addEventListener('click', () => speakWord(current.word, 'en-US', 0.9, current.audioUrl));
    container.querySelector('#review-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const answer = container.querySelector('#review-answer').value;
      if (!answer.trim()) return;
      correct = normalizeAnswer(answer) === normalizeAnswer(current.word);
      playInteractionSound(correct ? 'correct' : 'wrong');
      if (correct) score += 1;
      if (!correct && !retried.has(current.id)) {
        retried.add(current.id);
        queue.push(current);
      }
      updateWordRepetition(current.id, correct ? 'good' : 'again');
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      answered = true;
      render();
    });
    container.querySelector('#review-next')?.addEventListener('click', () => {
      index += 1;
      answered = false;
      correct = false;
      render();
    });
    container.querySelector('#review-answer')?.focus();
  }

  render();
}
