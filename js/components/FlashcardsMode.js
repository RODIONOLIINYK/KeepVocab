import { driveSync } from '../services/driveSync.js?v=79';
import { speakWord } from '../services/speechService.js?v=79';
import { recordExerciseResult } from '../services/exerciseResult.js?v=79';
import { getRatingPreviews } from '../services/srsEngine.js?v=79';
import { escapeHtml } from '../utils/html.js';
import { selectPracticeWords } from '../services/dailySession.js?v=79';

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view);
  else window.location.hash = view;
}

export function renderFlashcardsMode(container, onNavigate) {
  const words = selectPracticeWords(driveSync.getWords());
  if (!words.length) {
    container.innerHTML = `<section class="mode-empty-state"><img src="assets/keepvocab-sprig-thinking.webp" alt="Sprig thinking"><span class="eyebrow">Flashcards</span><h1>Your first card is waiting</h1><p>Add a word and KeepVocab will preserve its exact meaning, example, and visual cue.</p><button class="btn-green-solid" id="flashcard-add">Add vocabulary</button></section>`;
    container.querySelector('#flashcard-add').addEventListener('click', () => document.getElementById('quick-add-modal')?.classList.add('active'));
    return;
  }

  let currentIndex = 0;
  let revealed = false;
  let completed = false;

  function move(delta) {
    currentIndex = Math.min(words.length - 1, Math.max(0, currentIndex + delta));
    revealed = false;
    render();
  }

  function render() {
    if (completed) {
      container.innerHTML = `<section class="mode-completion-card"><img src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><span class="eyebrow">Flashcards complete</span><h1>${words.length} cards reviewed</h1><p>Your ratings were saved after every card, and difficult meanings will appear earlier next time.</p><div class="mode-completion-actions"><button class="btn-green-solid" id="flashcards-again">Review another set</button><button class="status-pill offline" id="flashcards-home">Today</button></div></section>`;
      container.querySelector('#flashcards-again').addEventListener('click', () => renderFlashcardsMode(container, onNavigate));
      container.querySelector('#flashcards-home').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }
    const word = driveSync.getWords().find(item => item.id === words[currentIndex].id) || words[currentIndex];
    const previews = getRatingPreviews(word);
    const earlyStage = !word.mastery || Number(word.mastery.recall || 0) < .55;
    const showImageOnPrompt = Boolean(word.imageUrl && earlyStage);
    container.innerHTML = `<section class="flashcard-mode" aria-labelledby="flashcard-word"><header class="exercise-topbar"><button class="status-pill offline" id="flashcard-exit"><i class="fa-solid fa-arrow-left"></i> Exit</button><div class="exercise-progress"><span>${currentIndex + 1} of ${words.length}</span><i><b style="width:${Math.round((currentIndex + 1) / words.length * 100)}%"></b></i></div><button class="audio-btn-circle" id="flashcard-speak" aria-label="Hear ${escapeHtml(word.word)}"><i class="fa-solid fa-volume-high"></i></button></header>
      <button class="smart-flashcard ${revealed ? 'revealed' : ''}" id="flashcard-reveal" aria-expanded="${revealed}">
        <div class="smart-flashcard-prompt">${showImageOnPrompt ? `<img src="${escapeHtml(word.imageUrl)}" alt="Visual cue for ${escapeHtml(word.word)}">` : ''}<span class="eyebrow">${showImageOnPrompt ? 'Image-supported review' : 'Recall the meaning'}</span><h1 id="flashcard-word">${escapeHtml(word.word)}</h1><p>${escapeHtml(word.phonetic || '')}</p><small><i class="fa-solid fa-hand-pointer"></i> Tap or press Space to reveal</small></div>
        <div class="smart-flashcard-answer"><span class="eyebrow">${escapeHtml(word.partOfSpeech || 'word')}</span><h2>${escapeHtml(word.definition)}</h2>${word.example ? `<blockquote>“${escapeHtml(word.example)}”</blockquote>` : ''}${word.imageUrl && !showImageOnPrompt ? `<img src="${escapeHtml(word.imageUrl)}" alt="Memory image for ${escapeHtml(word.word)}">` : ''}</div>
      </button>
      ${revealed ? `<div class="flashcard-rating" aria-label="How well did you remember?"><p>How well did you remember?</p><div>${['again','hard','good','easy'].map(rating => `<button class="flashcard-grade ${rating}" data-flashcard-rating="${rating}"><strong>${rating[0].toUpperCase() + rating.slice(1)}</strong><span>${escapeHtml(previews[rating].label)}</span></button>`).join('')}</div></div>` : '<p class="flashcard-guidance">Think of the exact meaning before revealing the card.</p>'}
      <div class="flashcard-nav"><button class="status-pill offline" id="flashcard-prev" ${currentIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Previous</button><button class="status-pill offline" id="flashcard-next" ${currentIndex === words.length - 1 ? 'disabled' : ''}>Next <i class="fa-solid fa-chevron-right"></i></button></div></section>`;
    container.querySelector('#flashcard-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#flashcard-speak').addEventListener('click', () => speakWord(word.word, 'en-US', .9, word.audioUrl));
    container.querySelector('#flashcard-reveal').addEventListener('click', () => { revealed = !revealed; render(); });
    container.querySelector('#flashcard-prev').addEventListener('click', () => move(-1));
    container.querySelector('#flashcard-next').addEventListener('click', () => move(1));
    container.querySelectorAll('[data-flashcard-rating]').forEach(button => button.addEventListener('click', () => {
      const rating = button.dataset.flashcardRating;
      recordExerciseResult({ wordId: word.id, exerciseType: 'flashcards', correct: rating !== 'again', hintsUsed: showImageOnPrompt ? 1 : 0, recallType: 'recognition', learnerRating: rating });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      if (currentIndex < words.length - 1) move(1); else { completed = true; render(); }
    }));
    const keyHandler = event => {
      if (!container.querySelector('.flashcard-mode')) return;
      if (event.target.matches('input,textarea,select')) return;
      if (event.code === 'Space') { event.preventDefault(); revealed = !revealed; render(); }
      if (event.key === 'ArrowLeft' && currentIndex > 0) move(-1);
      if (event.key === 'ArrowRight' && currentIndex < words.length - 1) move(1);
    };
    container.onkeydown = keyHandler;
  }
  render();
}
