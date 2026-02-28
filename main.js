/* ============================================
   GitHub Widget — Electron Main Process
   ============================================
   Features:
   - Frameless, transparent window
   - Always-on-top
   - Draggable
   - System tray with context menu
   - Auto-start with Windows
============================================ */

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ---- Window position persistence ----
const POSITION_FILE = path.join(app.getPath('userData'), 'window-position.json');

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
    try {
        const bounds = mainWindow.getBounds();
        fs.writeFileSync(POSITION_FILE, JSON.stringify(bounds));
    } catch { }
}

// ---- Settings persistence ----
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch { }
    return { alwaysOnTop: true, opacity: 1.0, autoStart: false };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch { }
}

// ---- Create Main Window ----
function createWindow() {
    const saved = loadPosition();
    const settings = loadSettings();
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Default: bottom-right corner
    const defaultX = screenWidth - 520;
    const defaultY = screenHeight - 640;

    mainWindow = new BrowserWindow({
        width: saved?.width || 500,
        height: saved?.height || 620,
        x: saved?.x ?? defaultX,
        y: saved?.y ?? defaultY,
        frame: false,
        transparent: true,
        resizable: true,
        alwaysOnTop: settings.alwaysOnTop,
        skipTaskbar: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        minWidth: 400,
        minHeight: 400,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('widget.html');
    mainWindow.setOpacity(settings.opacity || 1.0);

    // Save position on move/resize
    mainWindow.on('moved', savePosition);
    mainWindow.on('resized', savePosition);

    // Minimize to tray instead of closing
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Dev tools in dev mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// ---- Create Tray Icon ----
function createTray() {
    // Create a simple tray icon programmatically
    const iconSize = 16;
    const canvas = nativeImage.createEmpty();

    // Use a simple green square as tray icon (or load from file)
    const iconPath = path.join(__dirname, 'tray-icon.png');
    let trayIcon;

    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        // Generate a simple 16x16 green icon
        trayIcon = createTrayIcon();
    }

    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
    tray.setToolTip('GitHub Widget');

    updateTrayMenu();

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createTrayIcon() {
    // Create a simple 32x32 green circle icon as a raw bitmap
    const size = 32;
    const buffer = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const cx = size / 2, cy = size / 2, r = size / 2 - 2;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

            if (dist < r) {
                buffer[idx] = 57;     // R
                buffer[idx + 1] = 211; // G
                buffer[idx + 2] = 83;  // B
                buffer[idx + 3] = 255; // A
            } else if (dist < r + 1) {
                // Anti-alias edge
                const alpha = Math.max(0, Math.min(255, (r + 1 - dist) * 255));
                buffer[idx] = 57;
                buffer[idx + 1] = 211;
                buffer[idx + 2] = 83;
                buffer[idx + 3] = alpha;
            } else {
                buffer[idx + 3] = 0; // Transparent
            }
        }
    }

    return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function updateTrayMenu() {
    const settings = loadSettings();

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Widget',
            click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            }
        },
        { type: 'separator' },
        {
            label: 'Always on Top',
            type: 'checkbox',
            checked: settings.alwaysOnTop,
            click: (menuItem) => {
                settings.alwaysOnTop = menuItem.checked;
                mainWindow?.setAlwaysOnTop(menuItem.checked);
                saveSettings(settings);
            }
        },
        {
            label: 'Opacity',
            submenu: [
                { label: '100%', click: () => setOpacity(1.0) },
                { label: '90%', click: () => setOpacity(0.9) },
                { label: '80%', click: () => setOpacity(0.8) },
                { label: '70%', click: () => setOpacity(0.7) },
                { label: '60%', click: () => setOpacity(0.6) },
                { label: '50%', click: () => setOpacity(0.5) },
            ]
        },
        {
            label: 'Start with Windows',
            type: 'checkbox',
            checked: settings.autoStart,
            click: (menuItem) => {
                settings.autoStart = menuItem.checked;
                app.setLoginItemSettings({
                    openAtLogin: menuItem.checked
                });
                saveSettings(settings);
            }
        },
        { type: 'separator' },
        {
            label: 'Reset Position',
            click: () => {
                const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
                mainWindow?.setBounds({ x: sw - 520, y: sh - 640, width: 500, height: 620 });
                mainWindow?.show();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

function setOpacity(value) {
    const settings = loadSettings();
    settings.opacity = value;
    mainWindow?.setOpacity(value);
    saveSettings(settings);
}

// ---- IPC Handlers ----
ipcMain.on('window-minimize', () => mainWindow?.hide());
ipcMain.on('window-close', () => {
    mainWindow?.hide();
});
ipcMain.on('window-toggle-top', () => {
    if (!mainWindow) return;
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current);
    const settings = loadSettings();
    settings.alwaysOnTop = !current;
    saveSettings(settings);
    updateTrayMenu();
});

// ---- App Events ----
app.whenReady().then(() => {
    createWindow();
    createTray();

    // Apply auto-start setting
    const settings = loadSettings();
    app.setLoginItemSettings({
        openAtLogin: settings.autoStart
    });
});

app.on('second-instance', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Don't quit, keep in tray
    }
});

app.on('before-quit', () => {
    isQuitting = true;
    savePosition();
});

app.on('activate', () => {
    if (!mainWindow) {
        createWindow();
    }
});
