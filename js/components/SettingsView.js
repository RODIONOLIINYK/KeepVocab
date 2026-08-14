import { driveSync } from '../services/driveSync.js?v=63';
import { clearGeminiSettings, getGeminiSettings, saveGeminiSettings, testGeminiSettings } from '../services/geminiSettings.js?v=63';
import { escapeHtml } from '../utils/html.js';

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

export function renderSettingsView(container, onNavigate) {
  const gemini = getGeminiSettings();
  const drive = driveSync.getDriveStatus();
  container.innerHTML = `<section class="settings-view" aria-labelledby="settings-heading"><div class="settings-title-row"><button class="status-pill offline" id="settings-back"><i class="fa-solid fa-arrow-left"></i> Today</button><div><span class="eyebrow">KeepVocab settings</span><h1 id="settings-heading">Learning, AI, and backup</h1><p>Configure services once. Your learning remains available without them.</p></div></div>
    <div class="settings-grid"><section class="settings-card"><div class="settings-card-heading"><span class="settings-icon ai"><i class="fa-solid fa-wand-magic-sparkles"></i></span><div><h2>Google AI Studio</h2><p>One key powers Use It feedback, meaning-aware images, Context sentences, and AI Speaking.</p></div><span class="settings-state ${gemini.enabled ? 'connected' : ''}">${gemini.enabled ? 'Ready' : 'Optional'}</span></div>
      <form id="gemini-settings-form" class="settings-form"><label>API key<div class="key-input-row"><input type="password" id="settings-gemini-key" value="${escapeHtml(gemini.apiKey)}" placeholder="AIza…" autocomplete="off"><button type="button" id="settings-toggle-key" aria-label="Show or hide API key"><i class="fa-solid fa-eye"></i></button></div></label><label>Everyday AI model<select id="settings-text-model"><option value="gemini-3.1-flash-lite" ${gemini.textModel === 'gemini-3.1-flash-lite' ? 'selected' : ''}>Gemini 3.1 Flash-Lite</option><option value="gemini-3.5-flash-lite" ${gemini.textModel === 'gemini-3.5-flash-lite' ? 'selected' : ''}>Gemini 3.5 Flash-Lite</option><option value="gemini-2.5-flash-lite" ${gemini.textModel === 'gemini-2.5-flash-lite' ? 'selected' : ''}>Gemini 2.5 Flash-Lite</option></select></label><p class="settings-privacy"><i class="fa-solid fa-cloud-arrow-up"></i> Saved on this device and included in your private KeepVocab Google Drive backup when Drive is connected.</p><p id="gemini-settings-status" role="status" aria-live="polite"></p><div class="settings-actions"><button class="btn-green-solid" id="save-gemini-settings">Save and test</button>${gemini.enabled ? '<button type="button" class="status-pill offline" id="remove-gemini-settings">Remove key</button>' : ''}</div></form>
    </section>
    <section class="settings-card"><div class="settings-card-heading"><span class="settings-icon drive"><i class="fa-brands fa-google-drive"></i></span><div><h2>Google Drive backup</h2><p>Library, mastery, mistakes, stats, speaking progress, and your AI Studio setup sync together.</p></div><span class="settings-state ${drive.isConnected ? 'connected' : drive.lastError ? 'error' : ''}">${drive.isConnected ? 'Connected' : drive.lastError ? 'Attention' : 'Off'}</span></div><div class="settings-detail-list"><div><span>Account</span><strong>${escapeHtml(drive.email || 'Not connected')}</strong></div><div><span>Last sync</span><strong>${drive.lastSynced ? new Date(drive.lastSynced).toLocaleString() : 'Not backed up'}</strong></div></div><button class="btn-green-solid" id="settings-drive-action"><i class="fa-brands fa-google-drive"></i> ${drive.isConnected ? 'Manage backup' : 'Set up Drive'}</button>${drive.lastError ? `<p class="settings-error" role="alert">${escapeHtml(drive.lastError)}</p>` : ''}</section>
    <section class="settings-card compact"><div class="settings-card-heading"><span class="settings-icon routine"><i class="fa-solid fa-bell"></i></span><div><h2>Routine & sound</h2><p>Daily goal, smart reminders, and interaction sounds.</p></div></div><button class="status-pill offline" id="settings-routine">Open routine settings</button></section></div>
  </section>`;

  container.querySelector('#settings-back').addEventListener('click', () => go('dashboard', onNavigate));
  container.querySelector('#settings-toggle-key').addEventListener('click', () => { const input = container.querySelector('#settings-gemini-key'); input.type = input.type === 'password' ? 'text' : 'password'; });
  container.querySelector('#gemini-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = container.querySelector('#save-gemini-settings');
    const status = container.querySelector('#gemini-settings-status');
    button.disabled = true;
    button.textContent = 'Testing…';
    try {
      const settings = saveGeminiSettings({ apiKey: container.querySelector('#settings-gemini-key').value, textModel: container.querySelector('#settings-text-model').value });
      const ready = await testGeminiSettings(settings);
      status.textContent = ready ? 'Connected. AI-assisted learning is ready.' : 'Saved, but the test response was unexpected.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Save and test';
    }
  });
  container.querySelector('#remove-gemini-settings')?.addEventListener('click', () => { clearGeminiSettings(); renderSettingsView(container, onNavigate); });
  container.querySelector('#settings-drive-action').addEventListener('click', () => document.getElementById('btn-open-drive-auth')?.click());
  // The shared document handler in app.js opens the persistent routine modal.
  // Keeping this as a real button lets the original click bubble from any route.
}
