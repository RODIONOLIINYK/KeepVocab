const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keepVocabDesktop', Object.freeze({
  checkForUpdates: () => ipcRenderer.invoke('keepvocab:check-update'),
  installUpdate: () => ipcRenderer.invoke('keepvocab:install-update'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('keepvocab:request-microphone-access'),
}));
