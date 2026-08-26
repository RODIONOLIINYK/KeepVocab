const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keepVocabDesktop', Object.freeze({
  requestMicrophoneAccess: () => ipcRenderer.invoke('keepvocab:request-microphone-access'),
}));
