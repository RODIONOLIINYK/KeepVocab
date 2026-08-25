const { app, BrowserWindow, dialog, Menu, nativeImage, net, protocol, screen, session, shell, Tray } = require('electron');
const { access, readFile, stat } = require('node:fs/promises');
const path = require('node:path');

const APP_HOST = '127.0.0.1';
const APP_PORT = 8085;
const APP_ORIGIN = `http://${APP_HOST}:${APP_PORT}`;
const ALLOWED_POPUP_HOSTS = new Set(['accounts.google.com']);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

let mainWindow;
let quickAddWindow;
let menuBarTray;
let isQuitting = false;

function isAppUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function isAllowedPopup(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && ALLOWED_POPUP_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

async function resolveAsset(webRoot, rawPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(webRoot, relativePath);
  const rootPrefix = `${path.resolve(webRoot)}${path.sep}`;
  if (!candidate.startsWith(rootPrefix)) return null;

  try {
    const assetStat = await stat(candidate);
    if (assetStat.isFile()) return candidate;
  } catch {
    // The route fallback below lets hash/history navigation reopen the app shell.
  }

  if (!path.extname(relativePath)) return path.join(webRoot, 'index.html');
  return null;
}

async function handleAssetRequest(webRoot, request) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const requestUrl = new URL(request.url);
  const assetPath = await resolveAsset(webRoot, requestUrl.pathname);
  if (!assetPath) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const assetStat = await stat(assetPath);
  const body = request.method === 'HEAD' ? null : await readFile(assetPath);
  return new Response(body, { headers: {
    'Cache-Control': 'no-cache',
    'Content-Length': String(assetStat.size),
    'Content-Type': contentTypeFor(assetPath),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Content-Type-Options': 'nosniff',
  } });
}

async function configureAppProtocol() {
  const webRoot = path.join(app.getAppPath(), 'www');
  await access(path.join(webRoot, 'index.html'));

  protocol.handle('http', request => {
    if (!isAppUrl(request.url)) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    return handleAssetRequest(webRoot, request).catch(error => {
      console.error('Failed to serve a KeepVocab asset.', error);
      return new Response('KeepVocab could not load this asset.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    });
  });
}

function configurePermissions() {
  const allowedPermissions = new Set(['media', 'notifications']);
  const isAllowed = (webContents, permission, requestingOrigin) => {
    const origin = requestingOrigin || webContents?.getURL();
    return allowedPermissions.has(permission) && isAppUrl(origin);
  };

  session.defaultSession.setPermissionCheckHandler(isAllowed);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAllowed(webContents, permission, details.requestingUrl));
  });
}

function configureNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedPopup(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }

    if (url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (url.startsWith('https:')) void shell.openExternal(url);
  });
}

function configureSmokeTest(window) {
  if (!process.argv.includes('--keepvocab-smoke-test')) return;

  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise(resolve => {
        setTimeout(() => resolve({
          title: document.title,
          origin: location.origin,
          hasAppShell: Boolean(document.querySelector('.app-container')),
          serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
        }), 1000);
      })`);
      console.log(`KEEPVOCAB_SMOKE_TEST ${JSON.stringify(result)}`);
      app.exit(result.hasAppShell && result.origin === APP_ORIGIN ? 0 : 1);
    } catch (error) {
      console.error('KEEPVOCAB_SMOKE_TEST failed', error);
      app.exit(1);
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 390,
    minHeight: 640,
    show: false,
    title: 'KeepVocab',
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureNavigation(mainWindow);
  configureSmokeTest(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(APP_ORIGIN);
}

function positionQuickAddWindow(trayBounds = menuBarTray?.getBounds()) {
  if (!quickAddWindow) return;
  const windowBounds = quickAddWindow.getBounds();
  const anchor = trayBounds || { x: 0, y: 0, width: 0, height: 0 };
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
  const workArea = display.workArea;
  const x = Math.max(workArea.x + 8, Math.min(
    Math.round(anchor.x + anchor.width / 2 - windowBounds.width / 2),
    workArea.x + workArea.width - windowBounds.width - 8,
  ));
  const y = Math.max(workArea.y + 8, anchor.y + anchor.height + 6);
  quickAddWindow.setPosition(x, y, false);
}

function createQuickAddWindow() {
  quickAddWindow = new BrowserWindow({
    width: 430,
    height: 520,
    minWidth: 380,
    minHeight: 440,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  quickAddWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quickAddWindow.on('blur', () => quickAddWindow?.hide());
  quickAddWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    quickAddWindow.hide();
  });
  void quickAddWindow.loadURL(`${APP_ORIGIN}/quick-add.html`);
}

function showQuickAddWindow(trayBounds) {
  if (!quickAddWindow || quickAddWindow.isDestroyed()) createQuickAddWindow();
  positionQuickAddWindow(trayBounds);
  quickAddWindow.show();
  quickAddWindow.focus();
}

function configureMenuBarQuickAdd() {
  const iconName = process.platform === 'darwin'
    ? 'keepvocab-menubarTemplate.png'
    : 'keepvocab-mark-v2-192.png';
  const iconPath = path.join(app.getAppPath(), 'www', 'icons', iconName);
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  if (icon.isEmpty()) throw new Error(`The menu-bar icon could not be loaded from ${iconPath}.`);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  menuBarTray = new Tray(icon);
  menuBarTray.setToolTip('KeepVocab quick add');
  menuBarTray.on('click', (_event, bounds) => showQuickAddWindow(bounds));
  menuBarTray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Add a word…', click: () => showQuickAddWindow() },
    { label: 'Open KeepVocab', click: () => {
      if (!mainWindow) createMainWindow();
      else { mainWindow.show(); mainWindow.focus(); }
    } },
    { type: 'separator' },
    { label: 'Quit KeepVocab', click: () => app.quit() },
  ]));
  createQuickAddWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await configureAppProtocol();
      configurePermissions();
      createMainWindow();
      configureMenuBarQuickAdd();
    } catch (error) {
      dialog.showErrorBox(
        'KeepVocab could not start',
        `The packaged app assets could not be loaded.\n\n${error?.message || error}`,
      );
      app.quit();
    }
  });

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    else { mainWindow.show(); mainWindow.focus(); }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});
