const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => ipcRenderer.send('window-minimize'),
    close: () => ipcRenderer.send('window-close'),
    toggleAlwaysOnTop: () => ipcRenderer.send('window-toggle-top'),
    onPinChanged: (callback) => ipcRenderer.on('pin-changed', (_, val) => callback(val)),
    isElectron: true
});
