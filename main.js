/* ============================================
   ContribTracker — Desktop Widget (Fixed to Desktop)
   ============================================
   - Sits ON the desktop (below all other windows)
   - Working system tray with controls
   - No taskbar icon
   - Auto-starts with Windows
   ============================================ */

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Suppress GPU cache warnings
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    process.exit(0);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let _sendingToBottom = false;

// ---- Paths ----
const POSITION_FILE = path.join(app.getPath('userData'), 'window-position.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

// ---- Settings ----
const DEFAULT_SETTINGS = {
    alwaysOnTop: false,  // OFF by default — widget sits on desktop
    opacity: 0.95,
    autoStart: true,
    width: 340,
    height: 420
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
        }
    } catch { }
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch { }
}

function loadPosition() {
    try {
        if (fs.existsSync(POSITION_FILE)) {
            return JSON.parse(fs.readFileSync(POSITION_FILE, 'utf8'));
        }
    } catch { }
    return null;
}

function savePosition() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try { fs.writeFileSync(POSITION_FILE, JSON.stringify(mainWindow.getBounds())); } catch { }
}

// ---- Create Window ----
function createWindow() {
    const saved = loadPosition();
    const settings = loadSettings();
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

    const defaultX = sw - 360;
    const defaultY = sh - 440;

    mainWindow = new BrowserWindow({
        width: saved?.width || settings.width,
        height: saved?.height || settings.height,
        x: saved?.x ?? defaultX,
        y: saved?.y ?? defaultY,
        frame: false,
        transparent: true,
        resizable: true,
        alwaysOnTop: settings.alwaysOnTop,
        skipTaskbar: true,
        hasShadow: false,
        focusable: true,
        backgroundColor: '#00000000',
        minWidth: 280,
        minHeight: 280,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('widget.html');
    mainWindow.setOpacity(settings.opacity);

    mainWindow.webContents.once('did-finish-load', () => {
        // Inform renderer of initial pin state so the UI matches settings
        mainWindow.webContents.send('pin-changed', settings.alwaysOnTop);

        // If not always-on-top, send widget behind all other windows once it's ready
        if (!settings.alwaysOnTop) {
            sendWindowToBottom();
        }
    });

    // Save position when moved/resized
    mainWindow.on('moved', savePosition);
    mainWindow.on('resized', savePosition);

    // Hide instead of close
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    // When widget loses focus and alwaysOnTop is off,
    // actively push it behind all other windows
    mainWindow.on('blur', () => {
        if (_sendingToBottom) return; // prevent recursive calls
        const currentSettings = loadSettings();
        if (!currentSettings.alwaysOnTop && mainWindow && !mainWindow.isDestroyed()) {
            sendWindowToBottom();
        }
    });

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// ---- Create Tray Icon ----
function createTray() {
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('ContribTracker — Right-click for options');

    buildTrayMenu();

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
            }
        }
    });

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createIconBase64() {
    // Create a 16x16 green circle as a PNG-compatible data URL
    // Using a canvas-like approach with raw RGBA buffer
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    const cx = size / 2, cy = size / 2, r = 6;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

            if (dist <= r) {
                buffer[idx] = 57;   // R
                buffer[idx + 1] = 211;  // G
                buffer[idx + 2] = 83;   // B
                buffer[idx + 3] = 255;  // A
            } else if (dist <= r + 1) {
                const alpha = Math.max(0, Math.round((r + 1 - dist) * 255));
                buffer[idx] = 57;
                buffer[idx + 1] = 211;
                buffer[idx + 2] = 83;
                buffer[idx + 3] = alpha;
            } else {
                buffer[idx + 3] = 0;
            }
        }
    }

    const img = nativeImage.createFromBuffer(buffer, { width: size, height: size });
    return img.toDataURL();
}

function buildTrayMenu() {
    const settings = loadSettings();

    const template = [
        {
            label: 'ContribTracker',
            enabled: false,
            icon: nativeImage.createFromBuffer(
                Buffer.alloc(0)
            ).resize({ width: 1, height: 1 })
        },
        { type: 'separator' },
        {
            label: 'Show Widget',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: 'Hide Widget',
            click: () => {
                if (mainWindow) mainWindow.hide();
            }
        },
        { type: 'separator' },
        {
            label: 'Always on Top',
            type: 'checkbox',
            checked: settings.alwaysOnTop,
            click: (item) => {
                settings.alwaysOnTop = item.checked;
                if (mainWindow) mainWindow.setAlwaysOnTop(item.checked);
                saveSettings(settings);
                buildTrayMenu();
            }
        },
        { type: 'separator' },
        {
            label: 'Opacity',
            submenu: [100, 90, 80, 70, 60, 50, 40].map(pct => ({
                label: `${pct}%`,
                type: 'radio',
                checked: Math.round((settings.opacity || 1) * 100) === pct,
                click: () => {
                    settings.opacity = pct / 100;
                    if (mainWindow) mainWindow.setOpacity(pct / 100);
                    saveSettings(settings);
                }
            }))
        },
        {
            label: 'Size',
            submenu: [
                { label: 'Tiny (300 x 360)', click: () => resizeWidget(300, 360) },
                { label: 'Small (340 x 420)', click: () => resizeWidget(340, 420) },
                { label: 'Medium (400 x 500)', click: () => resizeWidget(400, 500) },
                { label: 'Large (480 x 580)', click: () => resizeWidget(480, 580) },
            ]
        },
        { type: 'separator' },
        {
            label: 'Start with Windows',
            type: 'checkbox',
            checked: settings.autoStart,
            click: (item) => {
                settings.autoStart = item.checked;
                app.setLoginItemSettings({ openAtLogin: item.checked });
                saveSettings(settings);
            }
        },
        {
            label: 'Reset Position',
            click: () => {
                const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
                if (mainWindow) {
                    mainWindow.setBounds({ x: sw - 500, y: sh - 600, width: 480, height: 580 });
                    mainWindow.show();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Open App Folder',
            click: () => shell.openPath(path.dirname(app.getPath('exe')))
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ];

    // Remove the invalid icon entry
    template[0] = { label: 'ContribTracker', enabled: false };

    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
}

function resizeWidget(w, h) {
    if (!mainWindow) return;
    const pos = mainWindow.getBounds();
    mainWindow.setBounds({ x: pos.x, y: pos.y, width: w, height: h });
    const s = loadSettings();
    s.width = w; s.height = h;
    saveSettings(s);
}

// Send the window to the bottom of the z-order (behind all other windows)
// Uses native Windows SetWindowPos API via PowerShell helper
let _bottomTimer = null;
function sendWindowToBottom() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Debounce — avoid spawning PowerShell too frequently
    if (_bottomTimer) clearTimeout(_bottomTimer);
    _bottomTimer = setTimeout(() => {
        _bottomTimer = null;
        if (!mainWindow || mainWindow.isDestroyed()) return;

        _sendingToBottom = true;

        const hwndBuf = mainWindow.getNativeWindowHandle();
        // Read the native window handle (64-bit on 64-bit Windows)
        let hwndValue;
        if (hwndBuf.length >= 8) {
            hwndValue = hwndBuf.readBigUInt64LE(0).toString();
        } else {
            hwndValue = hwndBuf.readUInt32LE(0).toString();
        }

        const scriptPath = path.join(__dirname, 'set-bottom.ps1');
        exec(
            `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" -Hwnd "${hwndValue}"`,
            { windowsHide: true },
            (err) => {
                if (err) console.error('sendWindowToBottom error:', err.message);
                setTimeout(() => { _sendingToBottom = false; }, 100);
            }
        );
    }, 50);
}

// ---- IPC ----
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.hide();
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.hide();
});

ipcMain.on('window-toggle-top', () => {
    if (!mainWindow) return;
    const newVal = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(newVal);
    const s = loadSettings();
    s.alwaysOnTop = newVal;
    saveSettings(s);
    buildTrayMenu();
    mainWindow.webContents.send('pin-changed', newVal);
});

// ---- App Lifecycle ----
app.whenReady().then(() => {
    createWindow();
    createTray();

    const settings = loadSettings();
    if (settings.autoStart) {
        app.setLoginItemSettings({ openAtLogin: true });
    }
});

app.on('second-instance', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    // Stay alive in tray
});

app.on('before-quit', () => {
    isQuitting = true;
    savePosition();
});

app.on('activate', () => {
    if (!mainWindow) createWindow();
});
