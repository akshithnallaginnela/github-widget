// Creates desktop and startup shortcuts for GitHub Widget
const { exec } = require('child_process');
const path = require('path');
const os = require('os');

const exePath = path.join(__dirname, 'dist', 'win-unpacked', 'GitHub Widget.exe');
const desktopPath = path.join(os.homedir(), 'Desktop', 'GitHub Widget.lnk');
const startupPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'GitHub Widget.lnk');

function createShortcut(shortcutPath, label) {
    const ps = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$s.TargetPath = '${exePath.replace(/'/g, "''")}' 
$s.WorkingDirectory = '${path.dirname(exePath).replace(/'/g, "''")}'
$s.Description = 'GitHub Contributions Widget'
$s.Save()
Write-Host '${label} shortcut created at: ${shortcutPath}'
`;

    return new Promise((resolve, reject) => {
        exec(`powershell -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(`Failed to create ${label} shortcut:`, stderr || err.message);
                reject(err);
            } else {
                console.log(stdout.trim());
                resolve();
            }
        });
    });
}

async function main() {
    console.log('Creating shortcuts for GitHub Widget...\n');
    console.log(`EXE: ${exePath}\n`);

    try {
        await createShortcut(desktopPath, 'Desktop');
        console.log('✅ Desktop shortcut created!\n');
    } catch (e) {
        console.log('❌ Desktop shortcut failed\n');
    }

    try {
        await createShortcut(startupPath, 'Startup');
        console.log('✅ Startup shortcut created (auto-starts with Windows)!\n');
    } catch (e) {
        console.log('❌ Startup shortcut failed\n');
    }

    console.log('Done! You can now:');
    console.log('  1. Double-click "GitHub Widget" on your Desktop');
    console.log('  2. It will auto-start every time Windows boots');
    console.log('  3. Right-click the green tray icon to configure');
}

main();
