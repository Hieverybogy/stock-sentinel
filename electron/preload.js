import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  
  // Platform info
  platform: process.platform,
  
  // Check if running in Electron
  isElectron: true
});

console.log('Preload script loaded');
