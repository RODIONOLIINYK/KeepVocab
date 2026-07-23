import { driveSync } from '../services/driveSync.js?v=42';
import { getDueWords } from '../services/srsEngine.js?v=42';
import { escapeHtml } from '../utils/html.js';

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function renderStatsView(container, onNavigate) {
  const words = driveSync.getWords();
  const settings = driveSync.getSettings();
  const mastered = words.filter(word => word.mastered).length;
  const dueWords = getDueWords();
  const masteredWords = words.filter(word => word.mastered);
  const due = dueWords.length;
  const learning = words.length - mastered;
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const reviewsToday = settings.reviewsDate === dateKey(new Date()) ? Number(settings.reviewsToday || 0) : 0;
  const goalPercent = Math.min(100, Math.round(reviewsToday / dailyGoal * 100));
  const activity = settings.reviewActivity || {};
  const boxCounts = [1, 2, 3, 4, 5].map(box => words.filter(word => Number(word.box || 1) === box).length);
  const maxBox = Math.max(1, ...boxCounts);
  const weekly = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return { label: date.toLocaleDateString('en-US', { weekday: 'short' }), count: Number(activity[dateKey(date)] || 0) };
  });
  const maxActivity = Math.max(1, ...weekly.map(day => day.count));

  container.innerHTML = `
    <section class="full-view-stack" aria-labelledby="stats-heading">
      <div class="spec-card">
        <div class="card-header-bar"><div class="card-tag" id="stats-heading"><i class="fa-solid fa-chart-column"></i> Learning overview</div><span class="muted-label">Based on your saved reviews</span></div>
        <div class="stats-metric-grid">
          <div class="metric-card"><i class="fa-solid fa-fire orange"></i><strong>${Number(settings.dailyStreak || 0)}</strong><span>day streak</span></div>
          <div class="metric-card"><i class="fa-solid fa-bullseye green"></i><strong>${reviewsToday}/${dailyGoal}</strong><span>daily goal · ${goalPercent}%</span></div>
          <div class="metric-card"><i class="fa-solid fa-clock blue"></i><strong>${due}</strong><span>due now</span></div>
          <div class="metric-card"><i class="fa-solid fa-graduation-cap purple"></i><strong>${mastered}</strong><span>mastered · ${words.length ? Math.round(mastered / words.length * 100) : 0}%</span></div>
        </div>
      </div>

      <div class="stats-detail-grid">
        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag">Last 7 days</div><strong>${weekly.reduce((sum, day) => sum + day.count, 0)} reviews</strong></div>
          <div class="activity-chart">${weekly.map(day => `<div title="${day.count} reviews"><span>${day.count || ''}</span><i style="height:${day.count ? Math.max(18, Math.round(day.count / maxActivity * 120)) : 8}px"></i><small>${day.label}</small></div>`).join('')}</div>
        </div>
        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag">Leitner distribution</div><span>${learning} learning</span></div>
          <div class="box-distribution">${boxCounts.map((count, index) => `<div><span>Box ${index + 1}</span><i><b style="width:${Math.round(count / maxBox * 100)}%"></b></i><strong>${count}</strong></div>`).join('')}</div>
        </div>
      </div>

      <div class="stats-word-sections">
        <div class="spec-card word-status-section due-section">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-clock"></i> Due now</div><span class="status-count">${dueWords.length}</span></div>
          <p class="section-helper">Words whose scheduled review time has arrived.</p>
          <div class="status-word-list">
            ${dueWords.length ? dueWords.map(word => `<article class="status-word-row"><div><strong>${escapeHtml(word.word)}</strong><p>${escapeHtml(word.definition)}</p><span>${escapeHtml(word.monthYear || word.notebook || '')} · Box ${Number(word.box || 1)}</span></div><button data-review-notebook="${escapeHtml(word.notebook)}">Review</button></article>`).join('') : `<div class="status-list-empty"><i class="fa-solid fa-circle-check"></i><span>Nothing is due right now.</span></div>`}
          </div>
        </div>
        <div class="spec-card word-status-section mastered-section">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-graduation-cap"></i> Mastered</div><span class="status-count">${masteredWords.length}</span></div>
          <p class="section-helper">Words that reached Box 5 in spaced repetition.</p>
          <div class="status-word-list">
            ${masteredWords.length ? masteredWords.map(word => `<article class="status-word-row"><div><strong>${escapeHtml(word.word)}</strong><p>${escapeHtml(word.definition)}</p><span>${escapeHtml(word.monthYear || word.notebook || '')} · Box 5</span></div><button data-open-notebook="${escapeHtml(word.notebook)}">View</button></article>`).join('') : `<div class="status-list-empty"><i class="fa-solid fa-seedling"></i><span>Keep reviewing to master your first word.</span></div>`}
          </div>
        </div>
      </div>

      <div class="spec-card box-explorer" id="box-explorer">
        <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-boxes-stacked"></i> Words in each Leitner box</div><span class="muted-label">Select a box to inspect its contents</span></div>
        <div class="box-filter-tabs" role="tablist" aria-label="Leitner boxes">
          ${boxCounts.map((count, index) => `<button class="box-filter-tab ${index === 0 ? 'active' : ''}" data-box-filter="${index + 1}" role="tab" aria-selected="${index === 0}"><span>Box ${index + 1}</span><strong>${count}</strong><small>${['New / relearn', 'Learning', 'Reviewing', 'Reinforcing', 'Mastered'][index]}</small></button>`).join('')}
        </div>
        <div class="box-contents-heading"><strong id="selected-box-title">Box 1 contents</strong><span id="selected-box-count"></span></div>
        <div class="status-word-list" id="box-contents-list"></div>
      </div>

      <div class="spec-card stats-action-card">
        <div><div class="card-tag"><i class="fa-solid fa-wand-magic-sparkles"></i> Recommended next step</div><h2>${due ? `Review ${due} due ${due === 1 ? 'word' : 'words'}` : learning ? 'Keep your learning streak moving' : 'Build your first vocabulary set'}</h2><p>${due ? 'A short session now keeps the spaced-repetition schedule accurate.' : learning ? 'Nothing is overdue. Practice from the dashboard or add another word.' : 'Add vocabulary, then review it on a schedule.'}</p></div>
        <button class="btn-green-solid" id="stats-primary-action">${due ? 'Start review' : learning ? 'Open dashboard' : 'Open library'}</button>
      </div>

      <div class="spec-card goal-settings">
        <div><div class="card-tag"><i class="fa-solid fa-sliders"></i> Daily goal</div><p>Choose a realistic number of reviews for each day.</p></div>
        <form id="daily-goal-form"><input type="number" id="daily-goal-input" min="1" max="200" value="${dailyGoal}" aria-label="Daily review goal"><button class="btn-green-solid">Save goal</button></form>
        <p id="goal-save-message" role="status"></p>
      </div>
    </section>`;

  container.querySelector('#stats-primary-action').addEventListener('click', () => {
    const view = due ? 'review' : learning ? 'dashboard' : 'library';
    if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
  });
  container.querySelectorAll('[data-review-notebook]').forEach(button => button.addEventListener('click', () => {
    driveSync.setActiveNotebook(button.dataset.reviewNotebook);
    if (window.location.hash === '#review') onNavigate('review'); else window.location.hash = 'review';
  }));
  const openNotebook = notebook => {
    driveSync.setActiveNotebook(notebook);
    if (window.location.hash === '#library') onNavigate('library'); else window.location.hash = 'library';
  };
  container.querySelectorAll('[data-open-notebook]').forEach(button => button.addEventListener('click', () => openNotebook(button.dataset.openNotebook)));
  const renderBoxContents = box => {
    const boxWords = words.filter(word => Number(word.box || 1) === box);
    container.querySelector('#selected-box-title').textContent = `Box ${box} contents`;
    container.querySelector('#selected-box-count').textContent = `${boxWords.length} ${boxWords.length === 1 ? 'word' : 'words'}`;
    container.querySelector('#box-contents-list').innerHTML = boxWords.length
      ? boxWords.map(word => `<article class="status-word-row"><div><strong>${escapeHtml(word.word)}</strong><p>${escapeHtml(word.definition)}</p><span>${escapeHtml(word.monthYear || word.notebook || '')} · ${word.mastered ? 'Mastered' : 'Next: ' + new Date(word.nextReviewDate || word.createdAt).toLocaleDateString()}</span></div><button data-box-open-notebook="${escapeHtml(word.notebook)}">View</button></article>`).join('')
      : `<div class="status-list-empty"><i class="fa-solid fa-box-open"></i><span>No words are in Box ${box}.</span></div>`;
    container.querySelectorAll('[data-box-open-notebook]').forEach(button => button.addEventListener('click', () => openNotebook(button.dataset.boxOpenNotebook)));
  };
  container.querySelectorAll('[data-box-filter]').forEach(button => button.addEventListener('click', () => {
    container.querySelectorAll('[data-box-filter]').forEach(tab => { tab.classList.remove('active'); tab.setAttribute('aria-selected', 'false'); });
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    renderBoxContents(Number(button.dataset.boxFilter));
  }));
  renderBoxContents(1);
  container.querySelector('#daily-goal-form').addEventListener('submit', event => {
    event.preventDefault();
    const value = Math.max(1, Math.min(200, Number(container.querySelector('#daily-goal-input').value)));
    driveSync.updateSettings({ dailyGoal: value });
    window.dispatchEvent(new CustomEvent('keepvocab:progress'));
    container.querySelector('#goal-save-message').textContent = `Daily goal saved: ${value} reviews.`;
  });
}
