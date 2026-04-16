const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  // macOS Dock badge + title
  updateDock: (stockData) => ipcRenderer.invoke('update-dock', stockData),
  clearDock: () => ipcRenderer.invoke('clear-dock'),

  // Platform info
  platform: process.platform,

  // Check if running in Electron
  isElectron: true
});

console.log('Preload script loaded');
