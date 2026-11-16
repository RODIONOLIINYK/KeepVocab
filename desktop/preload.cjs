const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keepVocabDesktop', Object.freeze({
  modelStorage: args => ipcRenderer.invoke('keepvocab:model-storage', args),
  checkForUpdates: () => ipcRenderer.invoke('keepvocab:check-update'),
  installUpdate: () => ipcRenderer.invoke('keepvocab:install-update'),
  onUpdateProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('keepvocab:update-progress', listener);
    return () => ipcRenderer.removeListener('keepvocab:update-progress', listener);
  },
  requestMicrophoneAccess: () => ipcRenderer.invoke('keepvocab:request-microphone-access'),
}));
