import { driveSync } from '../services/driveSync.js?v=86';
import { findRelevantImages } from '../services/imageSearch.js?v=86';
import { recordExerciseResult } from '../services/exerciseResult.js?v=86';
import { playInteractionSound } from '../services/interactionSound.js?v=86';
import { escapeHtml } from '../utils/html.js';
import { evaluateChoiceAnswer } from '../services/exerciseEvaluation.js?v=86';
import { stableWordChoices } from './PracticeModes.js?v=86';
import { selectPracticeWords } from '../services/dailySession.js?v=86';

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

function savedImage(word) {
  if (!/^https:\/\//i.test(word.imageUrl || '')) return null;
  return {
    url: word.imageUrl,
    sourceUrl: /^https:\/\//i.test(word.imageSourceUrl || '') ? word.imageSourceUrl : word.imageUrl,
    title: 'Saved visual cue',
    attribution: word.imageAttribution || 'Selected in KeepVocab',
    license: word.imageLicense || ''
  };
}

async function findAutomaticImages(word, excludeUrls) {
  return findRelevantImages(word, { excludeUrls });
}

export async function renderVisualMatchMode(container, onNavigate) {
  const notebook = driveSync.getActiveNotebook();
  const allWords = driveSync.getWords().filter(word => word.notebook === notebook);
  const words = selectPracticeWords(allWords);
  if (words.length < 2) {
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-images"></i><h2>Add at least two words</h2><p>Visual Match needs multiple choices from the active month.</p><button class="btn-green-solid" id="visual-back">Back to dashboard</button></div></section>`;
    container.querySelector('#visual-back').addEventListener('click', () => go('dashboard', onNavigate));
    return;
  }

  const prepared = words.map(word => ({ word, image: savedImage(word) })).filter(item => item.image);
  const missing = words.filter(word => !savedImage(word));
  const reservedImageUrls = new Set(prepared.flatMap(item => [item.image.url, item.image.sourceUrl]).filter(Boolean));

  async function prepareImagesAutomatically() {
    if (!missing.length) {
      startGame();
      return;
    }

    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state visual-auto-loader"><i class="fa-solid fa-images fa-beat-fade"></i><h2>Preparing visual cues automatically</h2><p id="visual-auto-status">Matching images to the exact meanings in ${escapeHtml(notebook)}…</p><div class="review-progress visual-auto-progress"><span id="visual-auto-progress" style="width:0%"></span></div><span class="muted-label">You can replace any suggestion during the exercise.</span><button class="status-pill offline" id="visual-auto-exit">Back to dashboard</button></div></section>`;
    container.querySelector('#visual-auto-exit').addEventListener('click', () => go('dashboard', onNavigate));

    let nextIndex = 0;
    let completed = 0;
    const worker = async () => {
      while (nextIndex < missing.length) {
        const word = missing[nextIndex];
        nextIndex += 1;
        const candidates = await findAutomaticImages(word, reservedImageUrls);
        if (window.location.hash !== '#visual') return;
        const image = candidates.find(candidate => !reservedImageUrls.has(candidate.url) && !reservedImageUrls.has(candidate.sourceUrl));
        if (image) {
          reservedImageUrls.add(image.url);
          reservedImageUrls.add(image.sourceUrl);
          const updated = driveSync.updateWord(word.id, {
            imageUrl: image.url,
            imageSourceUrl: image.sourceUrl,
            imageAttribution: image.attribution,
            imageLicense: image.license,
            imageSearchQuery: image.searchQuery || ''
          });
          prepared.push({ word: updated, image });
        }
        completed += 1;
        const status = container.querySelector('#visual-auto-status');
        const progress = container.querySelector('#visual-auto-progress');
        if (status) status.textContent = `Prepared ${completed} of ${missing.length}: ${word.word}`;
        if (progress) progress.style.width = `${Math.round(completed / missing.length * 100)}%`;
      }
    };

    await Promise.all(Array.from({ length: Math.min(3, missing.length) }, () => worker()));
    if (window.location.hash !== '#visual') return;
    if (prepared.length >= 2) {
      startGame();
      return;
    }

    const firstMissing = missing.find(word => !prepared.some(item => item.word.id === word.id));
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-image"></i><h2>Not enough automatic suggestions</h2><p>Visual Match found ${prepared.length} usable cue${prepared.length === 1 ? '' : 's'}. Choose another app-proposed image in Library or refine the search for one more word.</p><div class="inline-actions">${firstMissing ? '<button class="btn-green-solid" id="visual-manual-search">Refine suggestions</button>' : ''}<button class="status-pill offline" id="visual-library">Open library</button><button class="status-pill offline" id="visual-dashboard">Dashboard</button></div></div></section>`;
    container.querySelector('#visual-manual-search')?.addEventListener('click', () => renderImageChooser(missing.indexOf(firstMissing), firstMissing));
    container.querySelector('#visual-library').addEventListener('click', () => go('library', onNavigate));
    container.querySelector('#visual-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
  }

  async function renderImageChooser(position = 0, forcedWord = null, searchOverride = '') {
    if (!forcedWord && (prepared.length >= 2 || position >= missing.length)) {
      if (prepared.length >= 2) startGame();
      else {
        container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-image"></i><h2>Choose two visual cues</h2><p>No suitable public images were selected. Open Library and choose from KeepVocab's proposed images.</p><div class="inline-actions"><button class="btn-green-solid" id="visual-library">Open library</button><button class="status-pill offline" id="visual-dashboard">Dashboard</button></div></div></section>`;
        container.querySelector('#visual-library').addEventListener('click', () => go('library', onNavigate));
        container.querySelector('#visual-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
      }
      return;
    }
    const word = forcedWord || missing[position];
    const query = searchOverride || word.imageSearchQuery || '';
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-images fa-beat-fade"></i><h2>Finding images for “${escapeHtml(word.word)}”</h2><p>${escapeHtml(word.partOfSpeech || 'unknown')}: ${escapeHtml(word.definition)}</p></div></section>`;
    const excludeUrls = new Set(driveSync.getWords().flatMap(item => [item.imageUrl, item.imageSourceUrl]).filter(Boolean));
    const candidates = await findRelevantImages(word, { extraQueries: query ? [query] : [], excludeUrls });
    if (window.location.hash !== '#visual') return;
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card image-picker-shell">
      <div class="practice-topline"><button class="status-pill offline" id="visual-setup-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${forcedWord ? 'Replace visual cue' : `Visual setup ${position + 1} of ${missing.length}`}</span><strong>${prepared.length} selected</strong></div>
      <div class="image-picker-intro"><div class="card-tag"><i class="fa-solid fa-wand-magic-sparkles"></i> Build a personal visual mnemonic</div><h2>Choose an image for “${escapeHtml(word.word)}” <small>(${escapeHtml(word.partOfSpeech || 'unknown')})</small></h2><p>${escapeHtml(word.definition)}</p></div>
      <form class="visual-search-form" id="visual-search-form"><input id="visual-search-input" value="${escapeHtml(query)}" placeholder="Optional extra visual clue" aria-label="Image search terms"><button class="btn-green-solid">Search this meaning</button></form>
      ${candidates.length ? `<div class="image-candidate-grid">${candidates.map((image, index) => `<button data-image-candidate="${index}"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.title)}"><span>${escapeHtml(image.title)}</span></button>`).join('')}</div>` : `<div class="status-list-empty"><i class="fa-solid fa-image"></i><span>No suitable app-proposed images were found for this meaning.</span></div>`}
      <div class="inline-actions"><button class="status-pill offline" id="visual-skip-image">${forcedWord ? 'Keep current image' : 'Skip this word'}</button>${!forcedWord && prepared.length >= 2 ? `<button class="btn-green-solid" id="visual-start-ready">Start with ${prepared.length} images</button>` : ''}</div>
      <p class="image-license-note">Search combines the spelling with its selected definition. Refine the terms until the picture represents this exact meaning.</p>
    </div></section>`;
    container.querySelector('#visual-setup-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#visual-search-form').addEventListener('submit', event => {
      event.preventDefault();
      const nextQuery = container.querySelector('#visual-search-input').value.trim();
      if (nextQuery) renderImageChooser(position, forcedWord, nextQuery);
    });
    container.querySelector('#visual-skip-image').addEventListener('click', () => forcedWord ? startGame() : renderImageChooser(position + 1));
    container.querySelector('#visual-start-ready')?.addEventListener('click', startGame);
    container.querySelectorAll('[data-image-candidate]').forEach(button => button.addEventListener('click', () => {
      const image = candidates[Number(button.dataset.imageCandidate)];
      driveSync.updateWord(word.id, { imageUrl: image.url, imageSourceUrl: image.sourceUrl, imageAttribution: image.attribution, imageLicense: image.license, imageSearchQuery: image.searchQuery || query });
      if (forcedWord) {
        renderVisualMatchMode(container, onNavigate);
        return;
      }
      prepared.push({ word: { ...word, imageUrl: image.url }, image });
      renderImageChooser(position + 1);
    }));
  }

  function startGame() {
    const queue = shuffle(prepared);
    const originalCount = queue.length;
    let index = 0;
    let score = 0;
    let selectedId = null;
    const choiceState = { targetId: null, options: [] };

    function render() {
      if (index >= queue.length) {
        container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-images"></i><h2>Visual session complete</h2><p>You matched ${score} of ${originalCount} image–word pairs. Missed meanings will be prioritized next time.</p><div class="inline-actions"><button class="btn-green-solid" id="visual-again">Practice again</button><button class="status-pill offline" id="visual-done">Dashboard</button></div></div></section>`;
        container.querySelector('#visual-again').addEventListener('click', () => renderVisualMatchMode(container, onNavigate));
        container.querySelector('#visual-done').addEventListener('click', () => go('dashboard', onNavigate));
        return;
      }
      const target = queue[index];
      const options = stableWordChoices(choiceState, target.word, allWords);
      const answered = selectedId !== null;
      const correct = evaluateChoiceAnswer(target.word.id, selectedId);
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card practice-shell visual-shell">
        <div class="practice-topline"><button class="status-pill offline" id="visual-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${index + 1} of ${queue.length}</span><strong>Score ${score}</strong></div>
        <div class="review-progress"><span style="width:${Math.round(index / queue.length * 100)}%"></span></div>
        <div class="visual-prompt"><p>Which word best matches this image?</p><figure><img src="${escapeHtml(target.image.url)}" alt="Visual clue"><figcaption><a href="${escapeHtml(target.image.sourceUrl)}" target="_blank" rel="noopener noreferrer">Image source</a>${target.image.attribution ? ` · ${escapeHtml(target.image.attribution)}` : ''}${target.image.license ? ` · ${escapeHtml(target.image.license)}` : ''}</figcaption></figure><button class="status-pill offline" id="visual-change-cue"><i class="fa-solid fa-rotate"></i> Change automatic suggestion</button>
          <div class="choice-grid">${options.map(option => { const state = answered ? option.id === target.word.id ? ' correct' : option.id === selectedId ? ' incorrect' : '' : ''; const icon = answered && option.id === target.word.id ? '<i class="fa-solid fa-check choice-result-icon" aria-hidden="true"></i>' : answered && option.id === selectedId ? '<i class="fa-solid fa-xmark choice-result-icon" aria-hidden="true"></i>' : ''; return `<button class="choice-button${state}" data-visual-choice="${escapeHtml(option.id)}" data-sound="none" ${answered ? 'disabled' : ''}><span>${escapeHtml(option.word)}</span>${icon}</button>`; }).join('')}</div>
          <div class="answer-feedback-slot" aria-live="polite">${answered ? `${correct ? '<span class="success-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}<div class="answer-feedback-card ${correct ? 'correct' : 'incorrect'}"><i class="fa-solid ${correct ? 'fa-check' : 'fa-xmark'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${correct ? 'Excellent!' : 'Not quite'}</strong><span>${correct ? escapeHtml(target.word.definition) : `The correct answer is <b>${escapeHtml(target.word.word)}</b>. ${escapeHtml(target.word.definition)}`}</span></div></div>` : ''}</div>
          <div class="answer-action-slot">${answered ? `<button class="btn-green-solid" id="visual-next">${index + 1 === queue.length ? 'See result' : 'Next image'}</button>` : ''}</div>
        </div>
      </div></section>`;
      container.querySelector('#visual-exit').addEventListener('click', () => go('dashboard', onNavigate));
      container.querySelector('#visual-change-cue').addEventListener('click', () => renderImageChooser(0, target.word));
      container.querySelectorAll('[data-visual-choice]').forEach(button => button.addEventListener('click', () => {
        selectedId = button.dataset.visualChoice;
        const isCorrect = evaluateChoiceAnswer(target.word.id, selectedId);
        playInteractionSound(isCorrect ? 'correct' : 'wrong');
        if (isCorrect) score += 1;
        recordExerciseResult({ wordId: target.word.id, exerciseType: 'visual-match', correct: isCorrect, hintsUsed: 0, recallType: 'recognition', producedUnaided: false, confusedWithWordId: isCorrect ? '' : selectedId });
        window.dispatchEvent(new CustomEvent('keepvocab:progress'));
        render();
      }));
      container.querySelector('#visual-next')?.addEventListener('click', () => { index += 1; selectedId = null; choiceState.targetId = null; render(); });
    }
    render();
  }

  if (missing.length) prepareImagesAutomatically(); else startGame();
}
