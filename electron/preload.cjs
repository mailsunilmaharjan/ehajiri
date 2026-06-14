// electron/preload.cjs
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, narrow API to the renderer (React app)
contextBridge.exposeInMainWorld('electronAPI', {
  checkForUpdates: ()         => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus:  (callback) => ipcRenderer.on('update-status', (_e, data) => callback(data)),
  removeUpdateListeners: ()   => ipcRenderer.removeAllListeners('update-status'),
});
