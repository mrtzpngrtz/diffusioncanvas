// Electron shell for Diffusion Canvas.
//
// The app is the unchanged Express server plus a window pointed at it. The
// server runs as a child process rather than in the Electron main process so a
// backend crash cannot take the window down with it, and so `server.js` needs
// no knowledge that Electron exists.

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { fork } = require('child_process');
const path = require('path');

// Only one instance: two servers would fight over the same data directory.
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

const APP_ROOT = app.getAppPath();
const DATA_DIR = path.join(app.getPath('userData'), 'data');

let serverProcess = null;
let mainWindow = null;
let shuttingDown = false;
let serverPort = null;

// Resolves once the server prints the port it settled on.
function startServer() {
    return new Promise((resolve, reject) => {
        serverProcess = fork(path.join(APP_ROOT, 'server.js'), [], {
            cwd: APP_ROOT,
            silent: true,
            env: {
                ...process.env,
                DC_DESKTOP: '1',
                DC_DATA_DIR: DATA_DIR,
                NODE_ENV: 'production',
                // fork() re-runs the Electron binary; this makes it behave as node.
                ELECTRON_RUN_AS_NODE: '1'
            }
        });

        const timer = setTimeout(
            () => reject(new Error('The backend did not start within 30 seconds.')),
            30000
        );

        let buffer = '';
        serverProcess.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            process.stdout.write(text);
            buffer += text;
            const match = buffer.match(/DC_PORT (\d+)/);
            if (match) {
                clearTimeout(timer);
                resolve(Number(match[1]));
            }
        });

        serverProcess.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));

        serverProcess.on('exit', (code) => {
            clearTimeout(timer);
            serverProcess = null;
            if (shuttingDown) return;
            reject(new Error(`The backend exited unexpectedly (code ${code}).`));
        });
    });
}

function createWindow(port) {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#111111',
        show: false,
        title: 'Diffusion Canvas',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.loadURL(`http://127.0.0.1:${port}/`);

    // Anything not served by the local backend belongs in the real browser:
    // OAuth help pages, provider dashboards, docs.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    buildMenu(port);
}

function buildMenu(port) {
    const isMac = process.platform === 'darwin';
    const template = [
        ...(isMac ? [{ role: 'appMenu' }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'Settings & API Keys',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => mainWindow && mainWindow.loadURL(`http://127.0.0.1:${port}/admin`)
                },
                {
                    label: 'Back to Canvas',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow && mainWindow.loadURL(`http://127.0.0.1:${port}/`)
                },
                { type: 'separator' },
                {
                    label: 'Open Data Folder',
                    click: () => shell.openPath(DATA_DIR)
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

app.whenReady().then(async () => {
    try {
        serverPort = await startServer();
        createWindow(serverPort);
    } catch (err) {
        dialog.showErrorBox('Diffusion Canvas could not start', err.message);
        app.quit();
    }

    app.on('activate', () => {
        // macOS dock relaunch; the server is still up on its original port.
        if (BrowserWindow.getAllWindows().length === 0 && serverProcess && serverPort) {
            createWindow(serverPort);
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    shuttingDown = true;
    if (serverProcess) serverProcess.kill();
});
