import { driveSync } from '../services/driveSync.js?v=86';
import { getDueWords } from '../services/srsEngine.js?v=86';
import { masteryStage, normalizeMastery } from '../services/exerciseResult.js?v=86';
import { normalizeLearningStats } from '../services/learningStats.js?v=86';
import { weaknessScore } from '../services/dailySession.js?v=86';
import { escapeHtml } from '../utils/html.js';

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

export function renderStatsView(container, onNavigate) {
  const words = driveSync.getWords();
  const settings = driveSync.getSettings();
  const stats = normalizeLearningStats(settings);
  const dueWords = getDueWords(words);
  const mastery = words.map(word => ({ word, data: normalizeMastery(word) }));
  const recognized = mastery.filter(item => ['recognized', 'recalled', 'context', 'productive'].includes(masteryStage(item.data))).length;
  const recalled = mastery.filter(item => ['recalled', 'context', 'productive'].includes(masteryStage(item.data))).length;
  const context = mastery.filter(item => ['context', 'productive'].includes(masteryStage(item.data))).length;
  const productive = mastery.filter(item => item.data.productive >= .65).length;
  const spoken = mastery.filter(item => item.data.speaking >= .65).length;
  const weak = words.filter(word => weaknessScore(word) > 0).length;
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const reviewsToday = settings.reviewsDate === dateKey(new Date()) ? Number(settings.reviewsToday || 0) : 0;
  const activity = settings.reviewActivity || {};
  const weekly = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - offset));
    return { label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), count: Number(activity[dateKey(date)] || 0) };
  });
  const maxActivity = Math.max(1, ...weekly.map(day => day.count));
  const boxCounts = [1,2,3,4,5].map(box => words.filter(word => Number(word.box || 1) === box).length);
  const auth = driveSync.getDriveStatus();

  container.innerHTML = `<section class="full-view-stack progress-view" aria-labelledby="progress-heading"><div class="progress-hero"><div><span class="eyebrow">Real learning, not just box counts</span><h1 id="progress-heading">Your vocabulary is becoming usable</h1><p>Recognition is the start. Recall, context, and speaking show what you can actively use.</p></div><button class="btn-green-solid" id="progress-workout">${dueWords.length ? `Review ${dueWords.length} due` : 'Start a workout'}</button></div>
    <div class="progress-mastery-grid"><article><span>Saved</span><strong>${words.length}</strong><small>vocabulary cards</small></article><article><span>Recognized</span><strong>${recognized}</strong><small>meaning identified</small></article><article><span>Reliably recalled</span><strong>${recalled}</strong><small>produced from memory</small></article><article><span>Used in context</span><strong>${context}</strong><small>understood in a situation</small></article><article><span>Used productively</span><strong>${productive}</strong><small>own sentences</small></article><article><span>Used while speaking</span><strong>${spoken}</strong><small>activated with Mira</small></article></div>
    <div class="progress-detail-grid"><article class="spec-card"><div class="today-section-heading"><div><span class="eyebrow">Last 7 days</span><h2>${weekly.reduce((sum, day) => sum + day.count, 0)} exercises</h2></div><span>${reviewsToday}/${dailyGoal} today</span></div><div class="activity-chart">${weekly.map(day => `<div title="${day.count} exercises"><span>${day.count || ''}</span><i style="height:${day.count ? Math.max(18, Math.round(day.count / maxActivity * 120)) : 8}px"></i><small>${day.label}</small></div>`).join('')}</div></article>
      <article class="spec-card progress-outcomes"><span class="eyebrow">Learning outcomes</span><div><span>Sessions completed</span><strong>${stats.sessionsCompleted}</strong></div><div><span>Weak words improved</span><strong>${stats.weakWordsImproved}</strong></div><div><span>Speaking minutes</span><strong>${Math.round(stats.speakingMinutes)}</strong></div><div><span>Weak words now</span><strong>${weak}</strong></div><p><i class="fa-solid fa-cloud"></i> ${auth.isConnected ? 'These stats are included in your Drive backup.' : 'Connect Drive in Settings to restore these stats on another installation.'}</p></article></div>
    <article class="spec-card algorithm-details"><div class="today-section-heading"><div><span class="eyebrow">Scheduling detail</span><h2>Adaptive review by legacy box</h2></div><span>Mastered words still return</span></div><div class="box-distribution">${boxCounts.map((count, index) => `<div><span>Box ${index + 1}</span><i><b style="width:${Math.round(count / Math.max(1,...boxCounts) * 100)}%"></b></i><strong>${count}</strong></div>`).join('')}</div><p class="section-helper">Boxes remain for backward compatibility. Actual intervals adapt to difficulty, failures, and the strength of each answer.</p></article>
    <article class="spec-card goal-settings"><div><span class="eyebrow">Daily goal</span><h2>Keep it realistic</h2><p>Choose how many exercises you want to complete on a typical day.</p></div><form id="daily-goal-form"><input type="number" id="daily-goal-input" min="1" max="200" value="${dailyGoal}" aria-label="Daily exercise goal"><button class="btn-green-solid">Save goal</button></form><p id="goal-save-message" role="status" aria-live="polite"></p></article>
    ${dueWords.length ? `<article class="spec-card due-preview"><div class="today-section-heading"><div><span class="eyebrow">Due now</span><h2>${dueWords.length} word${dueWords.length === 1 ? '' : 's'} ready</h2></div></div><div class="status-word-list">${dueWords.slice(0,6).map(word => `<article class="status-word-row"><div><strong>${escapeHtml(word.word)}</strong><p>${escapeHtml(word.definition)}</p><span>${word.mastered ? 'Long-term review' : `Box ${word.box || 1}`}</span></div></article>`).join('')}</div></article>` : ''}</section>`;

  container.querySelector('#progress-workout').addEventListener('click', () => go('daily', onNavigate));
  container.querySelector('#daily-goal-form').addEventListener('submit', event => {
    event.preventDefault();
    const value = Math.max(1, Math.min(200, Number(container.querySelector('#daily-goal-input').value) || 20));
    driveSync.updateSettings({ dailyGoal: value });
    container.querySelector('#goal-save-message').textContent = `Daily goal saved: ${value} exercises.`;
    window.dispatchEvent(new CustomEvent('keepvocab:progress'));
  });
}
