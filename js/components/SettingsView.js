import { getFsrsLearningStatus, subscribeFsrsLearning, saveFsrsPreferences, trainPersonalScheduler } from '../services/fsrsLearning.js';
import { elapsedFsrsDays } from '../services/fsrsConfig.js';
import { getImageLearningStatus, getImageLearningTrainingData, subscribeImageLearning, enableImageLearning, disableImageLearning, clearImageModelDownloads, resetImagePreferences } from '../services/imageLearning.js?v=18900';
import { APP_VERSION, checkAppUpdate, installAppUpdate } from '../services/appUpdates.js?v=18900';
import { driveSync } from '../services/driveSync.js?v=18900';
import { clearGeminiSettings, getGeminiSettings, saveGeminiSettings, testGeminiSettings } from '../services/geminiSettings.js?v=18900';
import { getImageProviderSettings, saveImageProviderSettings } from '../services/imageSearch.js?v=18900';
import { getReminderStatus, supportsReminders } from '../services/reminderService.js?v=18900';
import { completedExercisesToday } from '../services/learningStats.js?v=18900';
import { escapeHtml } from '../utils/html.js';
import { navigateTo as go } from '../utils/navigation.js';

function heading(icon, title, description, state = '', configured = false, expandable = false, stateId = '') {
  return `<span class="settings-icon"><i class="${icon}" aria-hidden="true"></i></span><div><h2>${title}</h2><p>${description}</p></div>${state || expandable ? `<span class="settings-heading-meta">${state ? `<span ${stateId ? `id="${stateId}"` : ''} class="settings-state ${configured ? 'connected' : ''}">${state}</span>` : ''}${expandable ? '<i class="fa-solid fa-chevron-down settings-chevron" aria-hidden="true"></i>' : ''}</span>` : ''}`;
}

function translationDescription(language) {
  return language === 'uk' ? 'English definitions with Ukrainian translation hints.' : 'English definitions and exercise prompts.';
}

function modelOptions(current) {
  const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];
  if (!models.includes(current)) models.unshift(current);
  return models.map(model => `<option value="${escapeHtml(model)}" ${model === current ? 'selected' : ''}>${escapeHtml(model.replace('gemini-', 'Gemini ').replace('flash-lite', 'Flash-Lite'))}</option>`).join('');
}

export function renderSettingsView(container, onNavigate) {
  container.releaseImageLearning?.();
  container.releaseFsrsLearning?.();
  const memory = getFsrsLearningStatus();
  const gemini = getGeminiSettings();
  const imageProvider = getImageProviderSettings();
  const drive = driveSync.getDriveStatus();
  const settings = driveSync.getSettings();
  const completedToday = completedExercisesToday(settings);
  const streak = Math.max(0, Number(settings.dailyStreak || 0));
  const streakAtRisk = streak > 0 && completedToday === 0;
  const remindersAvailable = supportsReminders();
  const pexelsReady = imageProvider.provider === 'pexels' && Boolean(imageProvider.pexelsApiKey);
  const lastSync = drive.lastSynced ? new Date(drive.lastSynced) : null;

  container.innerHTML = `<section class="settings-view" aria-labelledby="settings-heading">
    <div class="settings-title-row"><button class="status-pill offline" id="settings-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Today</button><div><h1 id="settings-heading">Settings</h1><p>Make KeepVocab work for you.</p></div></div>
    <div class="settings-grid">
      <section class="settings-card" data-language-settings><div class="settings-card-heading">${heading('fa-solid fa-language', 'Language', translationDescription(settings.translationLanguage))}</div>
        <form id="translation-settings-form" class="settings-form"><label>Learning language<input value="English" readonly aria-readonly="true"></label><label>Translation language<select id="settings-translation-language"><option value="en" ${settings.translationLanguage !== 'uk' ? 'selected' : ''}>English (default)</option><option value="uk" ${settings.translationLanguage === 'uk' ? 'selected' : ''}>Ukrainian · Українська</option></select></label><div class="settings-actions"><button class="btn-green-solid">Save language</button></div><p id="translation-settings-status" class="settings-service-status" role="status" aria-live="polite"></p></form>
      </section>
      <section class="settings-card"><div class="settings-card-heading">${heading('fa-solid fa-arrow-rotate-right', 'Routine & sound', `${Math.max(1, Number(settings.dailyGoal) || 20)} exercises a day · interaction sounds ${settings.soundEnabled === false ? 'off' : 'on'}`)}</div>
        <div class="settings-streak-status ${streakAtRisk ? 'is-at-risk' : ''}"><strong>${streakAtRisk ? `Keep your ${streak}-day streak alive` : completedToday > 0 ? 'Your streak is safe today' : 'Build your streak'}</strong><p>${streakAtRisk ? 'Complete one exercise before midnight.' : completedToday > 0 ? 'Come back tomorrow to keep it growing.' : 'One exercise today is a good start.'}</p></div>
        <div class="settings-actions"><button class="status-pill offline" id="settings-routine">Edit routine</button>${remindersAvailable ? `<button class="status-pill offline" id="settings-notifications"><i class="fa-solid fa-bell" aria-hidden="true"></i> ${settings.reminderEnabled ? 'Manage reminders' : 'Set up reminders'}</button>` : ''}</div>${remindersAvailable ? '<p id="settings-notification-status" class="settings-notification-status" role="status" aria-live="polite">Checking notification access…</p>' : ''}
      </section>
      <details class="settings-card settings-disclosure"><summary class="settings-card-heading">${heading('fa-solid fa-clock', 'Review timing', 'FSRS-6 learns when each meaning needs another review.', '', false, true)}</summary><div class="settings-disclosure-body">
        <form id="memory-settings-form" class="settings-form"><label>Recall target<select id="memory-retention">${[0.8, 0.85, 0.9, 0.92, 0.95, 0.97].map(value => `<option value="${value}" ${Math.abs(memory.config.retention - value) < 0.001 ? 'selected' : ''}>${Math.round(value * 100)}%${value === 0.9 ? ' · recommended starting point' : ''}</option>`).join('')}</select></label><label class="settings-checkbox"><input id="memory-auto-training" type="checkbox" ${memory.config.automaticTraining ? 'checked' : ''}> Learn timing from my review history</label><p class="settings-privacy">Higher targets mean more frequent reviews. Recall, recognition and answers with hints have separate memory states. Your daily goal never blocks useful practice.</p><div class="settings-actions"><button class="btn-green-solid">Save review preferences</button><button type="button" class="status-pill offline" id="train-memory-model">Fit from review history</button></div></form>
        <p id="memory-training-status" role="status" aria-live="polite"></p><details class="settings-advanced"><summary>Memory model details</summary><p id="memory-review-counts"></p><div id="memory-training-diagnostics"></div><p>Standard parameters work immediately. Personal fitting requires 400 spaced reviews across 50 meanings in a stream, including forgotten answers. A candidate becomes active only after it improves predictions on later reviews kept out of training. Response history, hints, confidence, confusion patterns and word features also support grading and a bounded calibration of word priority.</p></details>
      </div></details>
      <section class="settings-card"><div class="settings-card-heading">${heading('fa-brands fa-google-drive', 'Google Drive backup', 'Sync your Library, progress, and settings.', drive.isConnected ? 'Connected' : drive.lastError ? 'Attention' : 'Off', drive.isConnected)}</div>
        <div class="settings-detail-list"><div><span>Account</span><strong>${escapeHtml(drive.isConnected ? (drive.email || 'Connected Google account') : 'Not connected')}</strong></div><div><span>Last sync</span><strong>${lastSync && Number.isFinite(lastSync.getTime()) ? escapeHtml(lastSync.toLocaleString()) : 'Not backed up'}</strong></div></div><button class="btn-green-solid" id="settings-drive-action">${drive.isConnected ? 'Manage backup' : 'Connect Google Drive'}</button>${drive.lastError ? `<p class="settings-error" role="alert">${escapeHtml(drive.lastError)}</p>` : ''}
      </section>
      <details class="settings-card settings-disclosure"><summary class="settings-card-heading">${heading('fa-solid fa-wand-magic-sparkles', 'AI features', 'Optional feedback, context sentences, and AI Speaking.', gemini.enabled ? 'Configured' : 'Optional', gemini.enabled, true, 'settings-ai-state')}</summary>
        <form id="gemini-settings-form" class="settings-form"><label class="settings-full-width">Google AI Studio API key<div class="key-input-row"><input type="password" id="settings-gemini-key" value="${escapeHtml(gemini.apiKey)}" placeholder="AIza…" autocomplete="off" spellcheck="false"><button type="button" id="settings-toggle-key" aria-label="Show API key" aria-pressed="false"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div></label><details class="settings-advanced settings-full-width"><summary>Advanced options</summary><label>Everyday AI model<select id="settings-text-model">${modelOptions(gemini.textModel)}</select></label></details><p class="settings-privacy">Your key is saved on this device and included in your private Drive backup when connected.</p><p class="settings-service-status" id="gemini-settings-status" role="status" aria-live="polite"></p><div class="settings-actions"><button class="btn-green-solid" id="save-gemini-settings">Save and test</button><button type="button" class="status-pill offline" id="remove-gemini-settings" ${gemini.enabled ? '' : 'hidden'}>Remove key</button></div></form>
      </details>
      <details class="settings-card settings-disclosure"><summary class="settings-card-heading">${heading('fa-solid fa-images', 'Vocabulary images', 'Choose where Library photos come from.', pexelsReady ? 'Pexels' : imageProvider.provider === 'openverse' ? 'No key needed' : 'Set up', pexelsReady, true, 'settings-images-state')}</summary>
        <form id="image-provider-settings-form" class="settings-form"><label class="settings-full-width">Photo source<select id="settings-image-provider"><option value="pexels" ${imageProvider.provider === 'pexels' ? 'selected' : ''}>Pexels</option><option value="openverse" ${imageProvider.provider === 'openverse' ? 'selected' : ''}>Public catalogs · no key</option></select></label><label class="settings-full-width" id="settings-pexels-field" ${imageProvider.provider === 'openverse' ? 'hidden' : ''}>Pexels API key<div class="key-input-row"><input type="password" id="settings-pexels-key" value="${escapeHtml(imageProvider.pexelsApiKey)}" placeholder="Personal Pexels API key" autocomplete="off" spellcheck="false"><button type="button" id="settings-toggle-pexels-key" aria-label="Show Pexels API key" aria-pressed="false"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div><span class="settings-privacy"><a href="https://www.pexels.com/api/new/" target="_blank" rel="noopener noreferrer">Get a free Pexels key</a></span></label><p class="settings-privacy">Your image settings are saved on this device and included in your private Drive backup when connected.</p><p id="image-provider-settings-status" class="settings-service-status" role="status" aria-live="polite"></p><div class="settings-actions"><button class="btn-green-solid">Save photo source</button><button type="button" class="status-pill offline" id="remove-pexels-settings" ${imageProvider.pexelsApiKey ? '' : 'hidden'}>Remove Pexels key</button></div></form>
      </details>
      <details class="settings-card settings-disclosure"><summary class="settings-card-heading">${heading('fa-solid fa-brain', 'Local image learning', 'Match photos to meanings and learn from your choices.', '', false, true)}</summary><div class="settings-disclosure-body"><p>While enabled, Good image and keeping a replacement teach the preference model what you like. Wrong meaning is a negative example. More like this refines the search; it does not train the model. Skipping and automatic image choices do not create training labels.</p><p class="settings-privacy">Downloads about ${getImageLearningStatus().downloadMB} MB only with your permission, then caches it on this device. A complete installed model is enabled by default. Scoring and training run locally without Gemini tokens. Learning records sync in your private Drive backup; model files stay on this device. <a href="https://huggingface.co/Xenova/mobileclip_s0/blob/757d59c9c6870a76a4b0306f05f5061bca15c39f/LICENSE" target="_blank" rel="noopener noreferrer">Model license</a></p><p id="image-learning-status" role="status" aria-live="polite"></p><div class="settings-actions"><button class="btn-green-solid" id="enable-image-learning">Download and enable</button><button class="status-pill offline" id="disable-image-learning">Turn off</button></div><details class="settings-advanced"><summary>Learning details and storage</summary><p id="image-learning-diagnostics"></p><p>Each explicit label is saved immediately. Training starts with 8 labels, including at least two Good and two Wrong examples, then uses batches of 4 changed labels. Repeated identical clicks do not add extra training weight. The encoders remain frozen; a small logistic regression model learns your preferences. Raw records contain a hashed image/meaning identity and numeric features, not the original word or image URL.</p><details class="settings-advanced" id="image-training-inspector"><summary>View all labels and training data</summary><p id="image-training-summary"></p><div class="settings-actions"><button type="button" class="status-pill offline" id="download-image-training-data">Download complete data (JSON)</button></div><div class="image-training-table-wrap"><table class="image-training-table"><thead><tr><th>Label</th><th>Saved</th><th>Training status</th><th>Record</th></tr></thead><tbody id="image-training-rows"></tbody></table></div><details class="settings-advanced"><summary>Current model weights</summary><pre id="image-training-weights"></pre></details></details><div class="settings-actions"><button class="status-pill offline" id="clear-image-model">Remove downloaded model</button><button class="status-pill offline" id="reset-image-preferences">Reset learned preferences</button></div></details></div></details>
      <details class="settings-card settings-disclosure"><summary class="settings-card-heading">${heading('fa-solid fa-download', 'App updates', `KeepVocab ${APP_VERSION}`, '', false, true)}</summary><div class="settings-disclosure-body"><p data-update-status class="settings-service-status" role="status" aria-live="polite">The app checks automatically. Updates keep your Library and progress.</p><div class="settings-actions"><button class="status-pill offline" data-check-update>Check for updates</button><button class="btn-green-solid" data-install-update hidden>Update app</button><a class="status-pill offline" data-update-downloads href="https://github.com/RODIONOLIINYK/KeepVocab/releases/latest" target="_blank" rel="noopener noreferrer" hidden>Open downloads</a></div></div></details>
    </div>
  </section>`;

  const query = selector => container.querySelector(selector);
  const paintImageTrainingData = () => {
    const data = getImageLearningTrainingData();
    const summary = query('#image-training-summary');
    if (!summary) return;
    const included = data.records.filter(record => record.trainingStatus === 'included in latest fit').length;
    summary.textContent = `${data.records.length} saved labels · ${included} included in the latest fit · ${data.records.length - included} queued or not in the current fit. Each record has 515 input features; the model has 516 weights including its intercept.`;
    query('#image-training-rows').innerHTML = data.records.map((record, index) => `<tr><td>${record.label === 'fits meaning' ? 'Fits meaning (+1)' : 'Wrong meaning (0)'}</td><td>${escapeHtml(new Date(record.updatedAt).toLocaleString())}</td><td>${record.trainingStatus === 'included in latest fit' ? 'Used' : 'Queued / not used'}</td><td><details class="settings-advanced" data-training-record="${index}"><summary>${escapeHtml(record.id.slice(0, 12))}… · show features</summary><pre></pre></details></td></tr>`).join('');
    const weights = query('#image-training-weights');
    if (weights) weights.textContent = data.model ? JSON.stringify(data.model.weights, null, 2) : 'No fitted model yet. Labels are saved until the minimum training set is reached.';
  };
  const paintLearning = state => {
    const output = query('#image-learning-status');
    if (!output) { container.releaseImageLearning?.(); return; }
    output.textContent = `${state.enabled ? 'Enabled' : 'Off'}. ${state.message || (state.enabled ? 'The model will load when you next search for images.' : state.installed ? 'The model is installed. Enable to use local image learning.' : 'Download and enable to use local image learning.')}${state.progress != null ? ` ${Math.round(state.progress)}%` : ''}`;
    query('#image-learning-diagnostics').textContent = `${state.labels} labels · ${state.queued} queued · training revision ${state.revision} · ${state.changedParameters} parameters changed in last training · ΔL2 ${state.deltaL2.toFixed(6)} · weights ${state.beforeFingerprint || 'initial'} → ${state.fingerprint || 'initial'}`;
    query('#disable-image-learning').hidden = !state.enabled;
    query('#enable-image-learning').hidden = state.enabled && ['ready', 'idle', 'scoring'].includes(state.phase);
    query('#enable-image-learning').textContent = state.installed ? 'Enable' : state.enabled ? 'Retry download' : 'Download and enable';
    query('#clear-image-model').hidden = !state.installed;
    paintImageTrainingData();
  };
  paintLearning(getImageLearningStatus());
  container.releaseImageLearning = subscribeImageLearning(paintLearning);
  const learningAction = (selector, action) => query(selector).addEventListener('click', async () => {
    const button = query(selector); button.disabled = true;
    try { await action(); paintLearning(getImageLearningStatus()); }
    catch (error) { query('#image-learning-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  learningAction('#enable-image-learning', () => enableImageLearning({ allowMetered: true, download: !getImageLearningStatus().installed }));
  learningAction('#disable-image-learning', disableImageLearning);
  learningAction('#clear-image-model', clearImageModelDownloads);
  learningAction('#reset-image-preferences', resetImagePreferences);
  query('#image-training-rows').addEventListener('toggle', event => {
    const details = event.target.closest('details[data-training-record]');
    if (!details?.open || details.dataset.loaded) return;
    const record = getImageLearningTrainingData().records[Number(details.dataset.trainingRecord)];
    const output = details.querySelector('pre');
    if (record && output) {
      output.textContent = JSON.stringify({ id: record.id, label: record.label, updatedAt: record.updatedAt, trainingStatus: record.trainingStatus, features: record.features }, null, 2);
      details.dataset.loaded = 'true';
    }
  }, true);
  query('#download-image-training-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(getImageLearningTrainingData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'keepvocab-image-training-data.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  query('#image-training-inspector > summary').addEventListener('click', () => paintImageTrainingData());
  const paintMemory = state => {
    const output = query('#memory-training-status');
    if (!output) { container.releaseFsrsLearning?.(); return; }
    output.textContent = state.message || 'FSRS-6 is active with standard parameters. Dated reviews build your personal history.';
    if (state.historyWarning) output.textContent += ` ${state.historyWarning}`;
    query('#train-memory-model').disabled = state.phase === 'training';
    query('#memory-training-diagnostics').innerHTML = ['recall', 'recognition', 'assisted'].map(channel => {
      const model = state.config.models[channel];
      const result = state.lastAttempt.results?.[channel];
      return `<p><strong>${channel[0].toUpperCase() + channel.slice(1)}</strong>: ${model ? `personal revision ${model.revision} · ${model.changedParameters} of 21 parameters changed · ΔL2 ${Number(model.deltaL2).toFixed(6)} · held-out loss ${Number(model.before.logLoss).toFixed(4)} → ${Number(model.after.logLoss).toFixed(4)}${model.calibration ? ' · context calibration active' : ''}` : 'standard FSRS-6 parameters'}${result?.reason ? `<br>${escapeHtml(result.reason)}` : ''}</p>`;
    }).join('');
  };
  paintMemory(memory);
  container.releaseFsrsLearning = subscribeFsrsLearning(paintMemory);
  void driveSync.getReviewEvents().then(events => {
    const output = query('#memory-review-counts');if (!output) return;
    const counts = ['recall', 'recognition', 'assisted'].map(channel => `${channel}: ${events.filter(event => event.channel === channel && event.memory.scheduled && event.memory.before.last_review && elapsedFsrsDays(event.memory.before.last_review, event.occurredAt) > 0).length} spaced reviews`);
    output.textContent = `${events.length} dated events · ${counts.join(' · ')}`;
  }).catch(error => { const output = query('#memory-review-counts');if (output) output.textContent = error.message; });
  query('#memory-settings-form').addEventListener('submit', event => {
    event.preventDefault();saveFsrsPreferences({ retention: Number(query('#memory-retention').value), automaticTraining: query('#memory-auto-training').checked });
    query('#memory-training-status').textContent = 'Review preferences saved. The target applies to future scheduling.';
  });
  query('#train-memory-model').addEventListener('click', async () => {
    try { await trainPersonalScheduler(driveSync, { force: true }); }
    catch (error) { query('#memory-training-status').textContent = error.message; }
  });
  query('#settings-back').addEventListener('click', () => go('dashboard', onNavigate));
  query('#translation-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const status = query('#translation-settings-status');
    try {
      const language = query('#settings-translation-language').value;
      driveSync.updateSettings({ translationLanguage: language });
      query('[data-language-settings] .settings-card-heading p').textContent = translationDescription(language);
      status.textContent = language === 'uk' ? 'Saved. Ukrainian translation hints are on.' : 'Saved. English definitions are selected.';
    } catch (error) { status.textContent = error.message || 'Cannot save the translation language.'; }
  });

  if (remindersAvailable) {
    const status = query('#settings-notification-status');
    getReminderStatus().then(result => {
      if (!status.isConnected) return;
      const latestSettings = driveSync.getSettings();
      if (latestSettings.reminderEnabled && result.status === 'ready' && !result.pendingCount) {
        globalThis.dispatchEvent?.(new CustomEvent('keepvocab:data-changed', { detail: { kind: 'reminders' } }));
      }
      status.textContent = result.status === 'permission-required' ? 'Allow notifications in reminder setup.'
        : result.status === 'channel-blocked' ? 'Practice reminders are blocked in Android settings.'
        : result.status === 'unavailable' ? 'Update the Android app to enable reminders.'
        : !latestSettings.reminderEnabled ? 'Reminders are off.'
        : `${result.pendingCount || 0} reminders scheduled.${result.exactAlarm === 'granted' ? '' : ' Android may delay delivery.'}`;
    }).catch(error => { if (status.isConnected) status.textContent = error.message || 'Cannot check notification access.'; });
  }

  for (const [buttonId, inputId, label] of [
    ['#settings-toggle-key', '#settings-gemini-key', 'API key'],
    ['#settings-toggle-pexels-key', '#settings-pexels-key', 'Pexels API key']
  ]) {
    query(buttonId).addEventListener('click', event => {
      const input = query(inputId);
      const shown = input.type === 'password';
      input.type = shown ? 'text' : 'password';
      event.currentTarget.setAttribute('aria-pressed', String(shown));
      event.currentTarget.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${label}`);
    });
  }

  query('#gemini-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = query('#save-gemini-settings');
    const status = query('#gemini-settings-status');
    button.disabled = true;
    button.textContent = 'Testing…';
    let saved = false;
    try {
      const ai = saveGeminiSettings({ apiKey: query('#settings-gemini-key').value, textModel: query('#settings-text-model').value });
      saved = true;
      const state = query('#settings-ai-state');
      state.textContent = ai.enabled ? 'Configured' : 'Optional';
      state.classList.toggle('connected', ai.enabled);
      query('#remove-gemini-settings').hidden = !ai.enabled;
      status.textContent = !ai.enabled ? 'Saved. AI features are off until you add a key.' : await testGeminiSettings(ai) ? 'Connected. Your AI key is working.' : 'Saved, but the AI test returned an unexpected response.';
    } catch (error) { status.textContent = `${saved ? 'Saved. Test failed: ' : ''}${error.message || 'Cannot save AI settings.'}`; }
    finally { button.disabled = false; button.textContent = 'Save and test'; }
  });
  query('#remove-gemini-settings').addEventListener('click', () => {
    try { clearGeminiSettings(); renderSettingsView(container, onNavigate); }
    catch (error) { query('#gemini-settings-status').textContent = error.message || 'Cannot remove the key.'; }
  });

  const providerInput = query('#settings-image-provider');
  const updatePexelsField = () => {
    const active = providerInput.value === 'pexels';
    query('#settings-pexels-field').hidden = !active;
    query('#settings-pexels-key').disabled = !active;
  };
  providerInput.addEventListener('change', updatePexelsField);
  updatePexelsField();
  query('#image-provider-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const provider = providerInput.value;
    const pexelsApiKey = query('#settings-pexels-key').value.trim();
    const status = query('#image-provider-settings-status');
    if (provider === 'pexels' && pexelsApiKey.length < 10) {
      status.textContent = 'Paste your complete Pexels API key.';
      return;
    }
    try {
      saveImageProviderSettings({ provider, pexelsApiKey });
      const state = query('#settings-images-state');
      state.textContent = provider === 'pexels' ? 'Pexels' : 'No key needed';
      state.classList.toggle('connected', provider === 'pexels');
      query('#remove-pexels-settings').hidden = !pexelsApiKey;
      status.textContent = provider === 'pexels' ? 'Saved. Library photos will use Pexels.' : 'Saved. Library photos will use public catalogs.';
    } catch (error) { status.textContent = error.message || 'Cannot save image settings.'; }
  });
  query('#remove-pexels-settings').addEventListener('click', () => {
    try { saveImageProviderSettings({ provider: 'openverse', pexelsApiKey: '' }); renderSettingsView(container, onNavigate); }
    catch (error) { query('#image-provider-settings-status').textContent = error.message || 'Cannot remove the key.'; }
  });
  query('#settings-drive-action').addEventListener('click', () => document.getElementById('btn-open-drive-auth')?.click());
  // Routine and reminder buttons use the shared app.js handler.

  let availableUpdate = null;
  const updateStatus = query('[data-update-status]');
  const checkButton = query('[data-check-update]');
  const installButton = query('[data-install-update]');
  const downloadsLink = query('[data-update-downloads]');
  checkButton.onclick = async () => {
    checkButton.disabled = true;
    installButton.hidden = true;
    downloadsLink.hidden = true;
    availableUpdate = null;
    updateStatus.textContent = 'Checking for updates…';
    try {
      const result = await checkAppUpdate();
      availableUpdate = result.update;
      downloadsLink.hidden = result.status !== 'unavailable';
      installButton.hidden = !['available', 'downloaded', 'web-ready'].includes(result.status);
      installButton.textContent = result.status === 'web-ready' ? 'Reload to update' : 'Update app';
      updateStatus.textContent = availableUpdate ? `Version ${availableUpdate.version} is ready to install.`
        : result.status === 'web-ready' ? 'An update is ready. Reload when you finish your lesson.'
        : result.status === 'development' ? 'Development build. Installed apps check for releases automatically.'
        : result.status === 'unavailable' ? result.message || 'Updates are unavailable for this installation.'
        : `You are up to date (${result.currentVersion || APP_VERSION}).`;
    } catch (error) { updateStatus.textContent = error.message || 'Cannot check for updates.'; }
    finally { checkButton.disabled = false; }
  };
  installButton.onclick = async () => {
    installButton.disabled = true;
    checkButton.disabled = true;
    updateStatus.textContent = 'Downloading and verifying the update…';
    const unsubscribe = globalThis.keepVocabDesktop?.onUpdateProgress?.(progress => {
      if (!updateStatus.isConnected) return;
      updateStatus.textContent = progress.status === 'downloading' && progress.total > 0
        ? `Downloading update… ${Math.min(100, Math.round(progress.received / progress.total * 100))}%`
        : progress.message || 'Preparing the update…';
    });
    try { const result = await installAppUpdate(availableUpdate); updateStatus.textContent = result.message || 'Reloading the updated app…'; }
    catch (error) { updateStatus.textContent = error.message || 'Cannot install the update.'; }
    finally { unsubscribe?.(); installButton.disabled = false; checkButton.disabled = false; }
  };
}
