/* ============================================
   Preload Script — Bridge between main & renderer
   ============================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => ipcRenderer.send('window-minimize'),
    close: () => ipcRenderer.send('window-close'),
    toggleAlwaysOnTop: () => ipcRenderer.send('window-toggle-top'),
    isElectron: true
});
