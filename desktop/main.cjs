'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session, clipboard, contentTracing } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { mkdirSync, existsSync } = require('node:fs');
const { startDesktopHost } = require('./web-host.cjs');
const { applyGpuSwitches, relaunchOnX11 } = require('./gpu-switches.cjs');
const { RecoveryStore, atomicWrite } = require('./recovery.cjs');
const { FileStreams } = require('./file-streams.cjs');
const { SharedClipboard } = require('./shared-clipboard.cjs');
const { workspaceDirectory } = require('./workspace-instance.cjs');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { WorkspacePreferences } = require('./preferences.cjs');
const { SupportService } = require('./support.cjs');
const { ProjectFiles } = require('./project-files.cjs');
const { FontService } = require('./font-service.cjs');
const { VideoExportService } = require('./video-export-service.cjs');
const { AudioService } = require('./audio-service.cjs');
const { VfwExportService } = require('./vfw-export-service.cjs');
const { RecentFiles } = require('./recent-files.cjs');
const { LibraryStore } = require('./library-store.cjs');
const { PublicLibrary, DownloadLedger, isPublicId } = require('./public-library.cjs');
const { TelemetryService } = require('./telemetry.cjs');
const { UpdateService, updateAvailability } = require('./updates.cjs');
const releaseInfo = require('./release-info.json');
const getReleaseHistory = require('./release-history.cjs').createReleaseHistory();
let telemetryBuild = {};
try { telemetryBuild = require('./telemetry-build.json'); } catch { /* Unpackaged/older source has unknown build metadata. */ }
const { RELEASES_URL, DONATE_URL } = require('./release-links.cjs');

// On Wayland the window cannot show WebGPU content, and Chromium picks its display
// backend before this file runs, so start again under XWayland (gpu-switches.cjs).
if (relaunchOnX11(app)) return;

const APP_ROOT = path.resolve(__dirname, '..');
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const FILE_FILTERS = [
  { name: 'Animation and stick figures', extensions: ['styk', 'stykmov', 'stkz', 'piv', 'stk', 'json', 'nodes', 'nodemc', 'stknds', 'zip'] },
  { name: 'StykAnimate movieclip', extensions: ['stykmov'] },
  { name: 'StykAnimate figure', extensions: ['stkz'] },
  { name: 'Pivot animation', extensions: ['piv'] },
  { name: 'Pivot stick figure', extensions: ['stk'] },
  { name: 'StykAnimate project', extensions: ['styk', 'json'] },
];
let window;
let backend;
// Per-launch secret required by the loopback codec API; never persisted.
const apiToken = randomBytes(32).toString('hex');
let fileStreams;
let videoExports;
let audioImports;
let vfwExports;
let recentFiles;
let library;
let telemetry;
let telemetryReady;
let telemetryClosed = false;
let updates;
let startupShown = false;
let traceRunning = false;
let pageLoaded = false;
let pendingProtocol = process.argv.find(value => /^stykanimate:\/\//i.test(value));
// A public library link (stykanimate://library/<id>) waits here until the
// workspace takes it, so a link that starts the app is not lost during startup.
let publicLibraryLink = null;
function handleProtocol(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'stykanimate:' || url.username || url.password || url.search || url.hash || url.port) return false;
    const root = ['', '/'].includes(url.pathname), asset = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (!(root && ['open', 'privacy', 'library'].includes(url.hostname)) && !(url.hostname === 'library' && isPublicId(asset))) return false;
    if (!window || !pageLoaded) { pendingProtocol = value; return true; }
    if (window.isMinimized()) window.restore(); window.show(); window.focus();
    if (url.hostname === 'privacy') sendAction('privacy');
    if (url.hostname === 'library') { publicLibraryLink = asset ?? ''; window.webContents.send('styk:public-library-link'); }
    return true;
  } catch { return false; }
}
const projectFiles = new ProjectFiles();
let documentState = { name: 'Untitled', dirty: false };
let quitting = false;
let pendingFiles = process.argv.slice(app.isPackaged ? 1 : 2).filter((arg) => /\.(piv|stk|styk|stkz|stykmov|json|nodes|nodemc|stknds|zip)$/i.test(arg));

// Windows and macOS use Chromium's normal driver allowlist. Linux needs the
// Vulkan WebGPU opt-in to reach the GPU; see gpu-switches.cjs.
applyGpuSwitches(app.commandLine);

app.setName('StykAnimate');
const profileDirectory = process.env.STYK_USER_DATA_DIR || (!app.isPackaged ? path.join(APP_ROOT, '.desktop-data') : null);
if (profileDirectory) {
  mkdirSync(profileDirectory, { recursive: true });
  app.setPath('userData', profileDirectory);
  app.setPath('sessionData', profileDirectory);
  app.setPath('crashDumps', path.join(profileDirectory, 'crashes'));
}
const primaryInstance = app.requestSingleInstanceLock();
const instanceDirectory = primaryInstance ? app.getPath('userData') : workspaceDirectory(app.getPath('userData'));
if (!primaryInstance) {
  mkdirSync(instanceDirectory, {recursive: true});
  app.setPath('sessionData', instanceDirectory);
  app.setPath('crashDumps', path.join(instanceDirectory, 'crashes'));
}
if (!primaryInstance && pendingProtocol) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    // Each ordinary launch owns its project. Protocol links still target the
    // primary workspace without opening an extra editor.
    for (const value of argv.filter(arg => /^stykanimate:\/\//i.test(arg))) handleProtocol(value);
  });
  app.on('open-url', (event, url) => { event.preventDefault(); handleProtocol(url); });
  app.on('open-file', (event, file) => { event.preventDefault(); queueOpenFile(file); });
  app.whenReady().then(start).catch(async (error) => {
    dialog.showErrorBox('StykAnimate could not start', error.message);
    app.quit();
  });
}

function trusted(event) {
  const url = event.senderFrame?.url || '';
  if (!window || event.sender !== window.webContents || !backend || new URL(url).origin !== backend.origin) {
    throw new Error('This operation is restricted to the StykAnimate workspace.');
  }
}

function sendAction(action) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('styk:menu-action', action);
}

function windowState() {
  return { maximized: window?.isMaximized() || false, fullscreen: window?.isFullScreen() || false, focused: window?.isFocused() || false };
}

function nativeMenu() {
  // Editor shortcuts belong to the renderer's customizable, focus-aware dispatcher.
  // Native accelerators would intercept disabled/reassigned keys and text editing.
  const item = (label, action) => ({ label, click: () => sendAction(action) });
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      item('New animation', 'new'),
      item('New window', 'new-window'),
      item('Open…', 'open'),
      { type: 'separator' },
      item('Save', 'save'),
      item('Save as…', 'save-as'),
      item('Save figure…', 'export-stkz'),
      item('Export…', 'export'),
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      item('Undo', 'undo'), item('Redo', 'redo'),
      { type: 'separator' },
      item('Cut', 'cut'), item('Copy', 'copy'), item('Paste', 'paste'),
      item('Duplicate', 'duplicate'), item('Delete', 'delete'),
      { type: 'separator' }, item('Select all', 'select-all'),
    ] },
    { label: 'Animation', submenu: [
      item('Play / pause', 'play'), item('Add frame', 'add-frame'),
      item('Previous frame', 'previous-frame'), item('Next frame', 'next-frame'),
      { type: 'separator' }, item('Onion skin', 'toggle-onion'),
    ] },
    { label: 'View', submenu: [
      item('Zoom in', 'zoom-in'), item('Zoom out', 'zoom-out'),
      item('Fit canvas', 'zoom-reset'), { type: 'separator' }, { role: 'togglefullscreen', accelerator: '' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools', accelerator: '' }] : []),
    ] },
    { label: 'Help', submenu: [item('Keyboard shortcuts', 'help'), item('Check for updates…', 'check-updates'), item('What’s new', 'release-notes'), item('Support development', 'donate'), item('About StykAnimate', 'about')] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readImportFile(file) {
  const started = performance.now();
  const extension = path.extname(file).toLowerCase();
  if (!['.piv', '.stk', '.styk', '.stkz', '.stykmov', '.json', '.nodes', '.nodemc', '.stknds', '.zip'].includes(extension)) throw new Error('Choose a StykAnimate, Pivot or Stick Nodes file.');
  const limit = ['.styk', '.stkz', '.stykmov', '.json'].includes(extension) ? MAX_FILE_BYTES : 128 * 1024 * 1024;
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Choose an animation or stick figure file.');
  if (stat.size > limit) throw new Error(`This file exceeds the ${limit / 1024 / 1024} MB import limit.`);
  const bytes = await fs.readFile(file);
  if (bytes.length > limit) throw new Error('This file grew past the import limit while being read.');
  app.addRecentDocument(file);
  await rememberRecent(file);
  // The renderer transfers these compact source bytes to its import worker.
  // Expanded JSON is never parsed or transported through Electron main.
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    filename: path.basename(file),
    nativePath: file,
    openToken: projectFiles.rememberOpen(path.resolve(file)),
    kind: extension === '.stykmov' ? 'stykmov' : extension === '.stkz' ? 'stkz' : extension === '.stk' ? 'stk' : extension === '.piv' ? 'piv' : 'styk',
    sourceBytes: bytes.length,
    timings: { native_read_ms: +(performance.now() - started).toFixed(3) },
  };
}

async function rememberRecent(file) {
  if (!recentFiles || !/\.(piv|stk|styk|stkz|stykmov|json|nodes|nodemc|stknds|zip)$/i.test(file)) return;
  // A damaged preferences directory must not turn a completed save into failure.
  try { await recentFiles.remember(path.resolve(file)); }
  catch (error) { console.warn('Recent files could not be updated:', error.message); }
}

async function queueOpenFile(file) {
  if (!window || !backend || !pageLoaded) { pendingFiles.push(file); return; }
  try { window.webContents.send('styk:file-opened', await readImportFile(file)); }
  catch (error) { dialog.showErrorBox('Unable to open file', error.message); }
}

// loadURL resolves around did-finish-load while webContents.isLoading() may
// still report true, so opens queued here must be flushed by the load events
// rather than a one-shot drain. did-finish-load also guarantees the renderer's
// module scripts ran, so its onOpenFile/menu-action listeners are registered.
async function flushPendingOpens() {
  if (pendingProtocol) { const value = pendingProtocol; pendingProtocol = null; handleProtocol(value); }
  const files = pendingFiles.splice(0);
  for (const file of files) await queueOpenFile(file);
}

function registerIpc() {
  ipcMain.handle('styk:update-state', event => { trusted(event); return updates.snapshot(); });
  ipcMain.handle('styk:update-check', event => { trusted(event); void updates.check(); return updates.snapshot(); });
  ipcMain.handle('styk:update-releases', event => { trusted(event); return shell.openExternal(RELEASES_URL); });
  ipcMain.handle('styk:donate', event => { trusted(event); return shell.openExternal(DONATE_URL); });
  ipcMain.handle('styk:release-history', event => { trusted(event); return getReleaseHistory(); });
  ipcMain.handle('styk:release-info', (event, startup = false) => {
    trusted(event);
    if (startup && startupShown) return null;
    if (startup) startupShown = true;
    return { ...releaseInfo, version: app.getVersion() };
  });
  ipcMain.handle('styk:update-restart', event => {
    trusted(event);
    return updates.restart(async () => {
      const revision = documentState.revision;
      if (documentState.dirty) {
        const answer = await dialog.showMessageBox(window, {
          type: 'question', title: 'Restart to update', message: `Save changes to ${documentState.name}?`,
          detail: 'StykAnimate will close, install the downloaded update, and reopen.',
          buttons: ['Save and restart', 'Cancel', 'Discard and restart'], defaultId: 0, cancelId: 1,
        });
        if (answer.response === 0) { sendAction('save-and-update'); return false; }
        if (answer.response !== 2) return false;
      }
      if (telemetry && !telemetryClosed) { await telemetry.close().catch(() => {}); telemetryClosed = true; }
      if (documentState.revision !== revision) return false;
      quitting = true;
      return true;
    }, () => { quitting = false; });
  });
  const withTelemetry = handler => async (event, value) => { trusted(event); await telemetryReady; if (!telemetry) throw new Error('Privacy settings are unavailable. Please restart StykAnimate.'); return handler(value); };
  const support = new SupportService({ directory: app.getPath('userData'), version: app.getVersion(), development: !app.isPackaged });
  ipcMain.handle('styk:support-context', event => { trusted(event); return support.context(); });
  ipcMain.handle('styk:support-live', (event, id) => { trusted(event); return support.connectLive(id, value => { if (!event.sender.isDestroyed()) event.sender.send('styk:support-live-event', value); }); });
  ipcMain.handle('styk:support-live-close', (event, connection) => { trusted(event); if (Number.isSafeInteger(connection)) support.closeLive(connection); });
  app.on('browser-window-created', (_event, createdWindow) => createdWindow.on('closed', () => support.closeLive()));
  ipcMain.handle('styk:support-save-state', (event, value) => { trusted(event); return support.saveState(value); });
  ipcMain.handle('styk:support-request', (event, value) => { trusted(event); return support.request(value); });
  ipcMain.handle('styk:support-copy-access', async event => { trusted(event); clipboard.writeText(await support.accessLink()); return { copied: true }; });
  ipcMain.handle('styk:support-restore', (event, key) => { trusted(event); return support.restore(key); });
  ipcMain.handle('styk:support-download', async (event, value) => {
    trusted(event);
    if (!/^[a-f0-9]{32}$/.test(value?.threadId || '') || !/^[a-f0-9]{32}$/.test(value?.fileId || '')) throw new Error('Invalid attachment.');
    const result = await support.request({ path: `/threads/${value.threadId}/files/${value.fileId}` });
    if (!result.ok) throw new Error('Attachment could not be downloaded.');
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(result.disposition)?.[1];
    let name = 'attachment'; try { if (encoded) name = path.basename(decodeURIComponent(encoded)); } catch { /* Safe fallback. */ }
    const destination = await dialog.showSaveDialog(window, { title: 'Save report attachment', defaultPath: name });
    if (destination.canceled || !destination.filePath) return { saved: false };
    await atomicWrite(destination.filePath, Buffer.from(result.bytes)); return { saved: true };
  });
  ipcMain.handle('styk:telemetry-state', withTelemetry(() => telemetry.getState()));
  ipcMain.handle('styk:telemetry-consent', withTelemetry(value => telemetry.setConsent(value)));
  ipcMain.handle('styk:telemetry-record', withTelemetry(value => telemetry.record(value)));
  ipcMain.handle('styk:telemetry-preview', withTelemetry(() => telemetry.preview()));
  ipcMain.handle('styk:telemetry-sync', withTelemetry(async () => { await telemetry.upload(); return telemetry.getState(); }));
  ipcMain.handle('styk:telemetry-delete', withTelemetry(() => telemetry.deleteData()));
  ipcMain.handle('styk:telemetry-feedback', withTelemetry(value => telemetry.feedback(value)));
  ipcMain.handle('styk:telemetry-export', withTelemetry(async () => {
    const result = await dialog.showSaveDialog(window, { title: 'Save optional telemetry report', defaultPath: 'StykAnimate-telemetry.json', filters: [{ name: 'JSON report', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, JSON.stringify(telemetry.preview(), null, 2), 'utf8'); return { saved: true };
  }));
  ipcMain.handle('styk:service-page', withTelemetry(page => {
    const route = { home: '/', download: '/download/' }[page];
    if (!route) throw new Error('Unknown StykAnimate page.');
    if (!telemetry.siteUrl) throw new Error('The public website is not configured yet. Contact ale.ripreso@gmail.com.');
    return shell.openExternal(telemetry.siteUrl + route);
  }));
  ipcMain.handle('styk:performance-trace', async event => {
    trusted(event);
    if (traceRunning) throw new Error('A performance recording is already running.');
    traceRunning = true;
    let temporary;
    try {
      await contentTracing.startRecording({ included_categories: ['v8.execute', 'disabled-by-default-v8.cpu_profiler', 'devtools.timeline'], recording_mode: 'record-until-full', trace_buffer_size_in_kb: 16384 });
      await new Promise(resolve => setTimeout(resolve, !app.isPackaged && process.env.STYK_TRACE_TEST === '1' ? 2000 : 30000));
      temporary = await contentTracing.stopRecording();
      const result = await dialog.showSaveDialog(window, { title: 'Save local performance trace — review before sharing', defaultPath: 'StykAnimate-performance-trace.json', filters: [{ name: 'Chrome / Perfetto trace', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { saved: false };
      await fs.copyFile(temporary, result.filePath); return { saved: true };
    } finally { traceRunning = false; if (temporary) await fs.unlink(temporary).catch(() => {}); }
  });
  for (const [channel, method] of [['list','list'], ['mkdir','createFolder'], ['thumbnail','thumbnail'], ['save-begin','beginSave'], ['write','write'], ['finish','finish'], ['cancel','cancel'], ['read-begin','beginRead'], ['read','read'], ['change','change']])
    ipcMain.handle(`styk:library-${channel}`, (event, ...args) => { trusted(event); return library[method](...args); });
  ipcMain.handle('styk:library-reveal', async (event, folder = '') => { trusted(event); const error = await shell.openPath(await library.folder(folder)); if (error) throw new Error(error); });
  ipcMain.handle('styk:library-trash', (event, relative) => { trusted(event); return library.trash(relative, target => shell.trashItem(target)); });
  ipcMain.handle('styk:library-thumbnail-cache', (event, options) => { trusted(event); return library.cacheThumbnail(options); });
  // The community library (desktop/public-library.cjs): what people share on the website, read through its API.
  // Which assets were already downloaded once (public ids only): the site counts each person's first download of an asset, no more.
  const communityDownloads = new DownloadLedger(new WorkspacePreferences(app.getPath('userData'), { filename: 'community-downloads.json', maxBytes: 128 * 1024 }));
  const publicLibrary = new PublicLibrary({site: process.env.STYK_PUBLIC_LIBRARY_URL, downloads: communityDownloads});
  ipcMain.handle('styk:public-library-list', (event, refresh = false) => { trusted(event); return publicLibrary.catalog({refresh: refresh === true}); });
  ipcMain.handle('styk:public-library-preview', (event, id) => { trusted(event); return publicLibrary.preview(id); });
  ipcMain.handle('styk:public-library-read', async (event, id) => {
    trusted(event); const {name, bytes} = await publicLibrary.asset(id);
    return {name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
  });
  ipcMain.handle('styk:public-library-save', async (event, options) => {
    trusted(event);
    // The panel converts the website's poster to the PNG preview the library keeps; the store validates it.
    const {item, extension, bytes} = await publicLibrary.asset(options?.id);
    return library.saveBytes({folder: typeof options?.folder === 'string' ? options.folder : '', name: item.name, extension, kind: item.kind, thumbnail: options?.thumbnail, bytes});
  });
  ipcMain.handle('styk:public-library-page', (event, id) => { trusted(event); return shell.openExternal(publicLibrary.pageFor(id)); });
  ipcMain.handle('styk:public-library-link', event => { trusted(event); const id = publicLibraryLink; publicLibraryLink = null; return id; });
  recentFiles = new RecentFiles({directory: app.getPath('userData'), limit: 20});
  ipcMain.handle('styk:recent-list', event => { trusted(event); return recentFiles.list(); });
  ipcMain.handle('styk:recent-open', async (event, id) => { trusted(event); return readImportFile(await recentFiles.resolve(id)); });
  ipcMain.handle('styk:recent-clear', event => { trusted(event); return recentFiles.clear(); });
  ipcMain.handle('styk:clipboard-text-read', event => {
    trusted(event); const text = clipboard.readText();
    if (text.length > 100) throw new Error('The clipboard does not contain a short segment value.');
    return text;
  });
  ipcMain.handle('styk:clipboard-text-write', (event, text) => {
    trusted(event);
    if (typeof text !== 'string' || text.length > 100) throw new Error('Segment clipboard text must contain at most 100 characters.');
    clipboard.writeText(text); return true;
  });
  const encoderRoot = app.isPackaged ? process.resourcesPath : path.join(APP_ROOT, 'build');
  audioImports = new AudioService({encoderPath: path.join(encoderRoot, 'video-encoder', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), tempRoot: app.getPath('temp')});
  for (const [channel, method] of [['audio-begin','begin'],['audio-write','write'],['audio-finish','finish'],['audio-read','read'],['audio-cancel','cancel']])
    ipcMain.handle(`styk:${channel}`, (event, ...args) => { trusted(event); return audioImports[method](...args); });
  videoExports = new VideoExportService({encoderPath: path.join(encoderRoot, 'video-encoder', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), tempRoot: app.getPath('temp')});
  for (const [channel, method] of [
    ['video-capabilities', 'capabilities'], ['video-begin', 'begin'], ['video-frame-begin', 'beginFrame'], ['video-frame-chunk', 'writeFrameChunk'],
    ['video-frame-end', 'endFrame'], ['video-finish', 'finish'], ['video-read', 'read'], ['video-cancel', 'cancel'], ['video-audio-chunk', 'writeAudioChunk'],
  ]) ipcMain.handle(`styk:${channel}`, (event, ...args) => { trusted(event); return videoExports[method](...args); });
  ipcMain.handle('styk:video-save', async (event, token, options) => {
    trusted(event);
    const filters = saveFilters(options, 'webm');
    const result = await dialog.showSaveDialog(window, {
      title: 'Save video', defaultPath: path.basename(String(options?.defaultPath || 'video.webm')), filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) { await videoExports.cancel(token).catch(() => {}); return { saved: false }; }
    return videoExports.save(token, result.filePath);
  });
  const vfwRoot = app.isPackaged ? path.join(process.resourcesPath, 'vfw') : path.join(APP_ROOT, 'native', 'bin');
  vfwExports = new VfwExportService({helperPaths: {x86: path.join(vfwRoot, 'x86', 'styk-vfw.exe'), x64: path.join(vfwRoot, 'x64', 'styk-vfw.exe')}, tempRoot: app.getPath('temp')});
  for (const [channel, method] of [
    ['vfw-capabilities', 'capabilities'], ['vfw-begin', 'begin'], ['vfw-frame-begin', 'beginFrame'], ['vfw-frame-chunk', 'writeFrameChunk'],
    ['vfw-frame-end', 'endFrame'], ['vfw-finish', 'finish'], ['vfw-read', 'read'], ['vfw-cancel', 'cancel'],
  ]) ipcMain.handle(`styk:${channel}`, (event, ...args) => { trusted(event); return vfwExports[method](...args); });
  ipcMain.handle('styk:vfw-save', async (event, token, options) => {
    trusted(event);
    const filters = saveFilters(options, 'avi');
    const result = await dialog.showSaveDialog(window, {
      title: 'Save video', defaultPath: path.basename(String(options?.defaultPath || 'video.avi')), filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) { await vfwExports.cancel(token).catch(() => {}); return { saved: false }; }
    return vfwExports.save(token, result.filePath);
  });
  ipcMain.handle('styk:vfw-configure', async (event, options) => {
    trusted(event); const owner = window;
    const handle = owner.getNativeWindowHandle();
    const hwnd = (handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
    try { return await vfwExports.configure(options, hwnd); }
    finally { if (!owner.isDestroyed()) { owner.setEnabled(true); owner.focus(); } }
  });
  const recovery = new RecoveryStore(instanceDirectory);
  const sharedClipboard = new SharedClipboard(clipboard);
  for (const [channel, method] of [['write-begin', 'beginWrite'], ['write', 'write'], ['finish', 'finish'], ['read-begin', 'beginRead'], ['read', 'read'], ['cancel', 'cancel']])
    ipcMain.handle(`styk:shared-clipboard-${channel}`, (event, ...args) => { trusted(event); return sharedClipboard[method](...args); });
  app.on('will-quit', () => sharedClipboard.dispose());
  ipcMain.handle('styk:new-window', event => {
    trusted(event);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, app.isPackaged ? [] : [APP_ROOT], {detached: true, stdio: 'ignore', windowsHide: true, env: process.env});
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(true); });
    });
  });
  const preferences = new WorkspacePreferences(app.getPath('userData'));
  const editorSettings = new WorkspacePreferences(app.getPath('userData'), { filename: 'editor-settings.json' });
  // The person's effect presets (src/vfx-user-presets.mjs): their own file, so they never crowd the 16 KB settings.
  const vfxPresets = new WorkspacePreferences(app.getPath('userData'), { filename: 'vfx-presets.json', maxBytes: 1024 * 1024 });
  const fonts = new FontService();
  ipcMain.handle('styk:fonts-list', event => { trusted(event); return fonts.listFonts(); });
  ipcMain.handle('styk:fonts-read', async (event, id) => {
    trusted(event); const bytes = await fonts.readFont(id);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
  ipcMain.handle('styk:workspace-preferences-get', (event) => { trusted(event); return preferences.get(); });
  ipcMain.handle('styk:workspace-preferences-set', (event, value) => { trusted(event); return preferences.set(value); });
  ipcMain.handle('styk:editor-settings-get', (event) => { trusted(event); return editorSettings.get(); });
  ipcMain.handle('styk:editor-settings-set', (event, value) => { trusted(event); return editorSettings.set(value); });
  ipcMain.handle('styk:vfx-presets-get', (event) => { trusted(event); return vfxPresets.get(); });
  ipcMain.handle('styk:vfx-presets-set', (event, value) => { trusted(event); return vfxPresets.set(value); });
  fileStreams = new FileStreams({onCommitError:error=>telemetry?.error(error?.name||'Error','app',null,{code:error?.code||'write_failed',stage:'write'})});
  const clipboardFile = path.join(app.getPath('userData'), 'frame-clipboard.styk');
  let clipboardWriteToken = null, clipboardControl = Promise.resolve();
  ipcMain.handle('styk:clipboard-write-begin', (event, options) => {
    trusted(event); fileStreams.validateSize(options?.size);
    if (!options.size) throw new Error('The frame clipboard is empty.');
    const pending = clipboardControl.then(async () => {
      if (clipboardWriteToken) await fileStreams.cancel(clipboardWriteToken);
      const transfer = await fileStreams.beginWrite({destination: clipboardFile, size: options.size});
      clipboardWriteToken = transfer.token; return transfer;
    });
    clipboardControl = pending.catch(() => {}); return pending;
  });
  ipcMain.handle('styk:clipboard-read-begin', async event => {
    trusted(event); const transfer = await fileStreams.beginRead(clipboardFile);
    return transfer ? {...transfer, name: 'Copied keyframes'} : null;
  });
  const projectTransfers = new Map();
  let projectRequestPending = false;
  ipcMain.handle('styk:document-activate', async (event, options) => {
    trusted(event);
    const document = projectFiles.activate(options || {});
    const stale = [...projectTransfers.keys()];
    projectTransfers.clear();
    await Promise.all(stale.map((token) => fileStreams.cancel(token)));
    return document;
  });
  ipcMain.handle('styk:project-write-begin', async (event, options) => {
    trusted(event);
    fileStreams.validateSize(options?.size);
    const document = projectFiles.requireCurrent(options?.documentToken);
    for (const token of projectTransfers.keys()) if (!fileStreams.jobs.has(token)) projectTransfers.delete(token);
    if (projectRequestPending || projectTransfers.size) throw new Error('A project save is already in progress.');
    projectRequestPending = true;
    try {
      let destination = document.filename;
      if (options.saveAs || !destination) {
        const result = await dialog.showSaveDialog(window, {
          title: options.saveAs ? 'Save animation as' : 'Save animation',
          defaultPath: destination || path.basename(String(options.defaultPath || 'Untitled.styk')),
          filters: [{ name: 'StykAnimate project', extensions: ['styk'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (result.canceled || !result.filePath) return null;
        destination = projectFiles.validateDestination(result.filePath);
      }
      projectFiles.requireCurrent(document.documentToken);
      const transfer = await fileStreams.beginWrite({ destination, size: options.size, onCommit: async () => {
        // A document switch invalidates old capabilities, including pending dialogs.
        if (projectFiles.current?.documentToken === document.documentToken) projectFiles.commit(document.documentToken, destination);
        app.addRecentDocument(destination);
        await rememberRecent(destination);
      } });
      try { projectFiles.requireCurrent(document.documentToken); }
      catch (error) { await fileStreams.cancel(transfer.token); throw error; }
      projectTransfers.set(transfer.token, document.documentToken);
      return { ...transfer, filename: path.basename(destination), documentToken: document.documentToken };
    } finally { projectRequestPending = false; }
  });
  let recoveryWriteToken = null;
  let recoveryControl = Promise.resolve();
  function controlRecovery(operation) {
    const result = recoveryControl.then(operation);
    recoveryControl = result.catch(() => {});
    return result;
  }
  const saveFilters = (options, fallback = 'styk') => (Array.isArray(options?.filters) ? options.filters.slice(0, 8).map((filter) => ({
    name: String(filter.name || 'File').slice(0, 80),
    extensions: Array.isArray(filter.extensions) ? filter.extensions.filter((ext) => /^[a-z0-9*]{1,12}$/i.test(ext)) : [],
  })).filter((filter) => filter.extensions.length) : [{ name: 'StykAnimate project', extensions: [fallback] }]);
  ipcMain.handle('styk:file-write-begin', async (event, options) => {
    trusted(event);
    const stream = options?.stream === true;
    if (stream) fileStreams.validateStreamSize(options?.size); else fileStreams.validateSize(options?.size);
    const filters = saveFilters(options);
    const result = await dialog.showSaveDialog(window, {
      title: 'Save animation', defaultPath: path.basename(String(options.defaultPath || 'Untitled.styk')), filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    return fileStreams.beginWrite({ destination: result.filePath, size: stream ? (options.size ?? null) : options.size, stream, onCommit: async () => {
      app.addRecentDocument(result.filePath);
      await rememberRecent(result.filePath);
    } });
  });
  ipcMain.handle('styk:recovery-write-begin', async (event, options) => {
    trusted(event);
    fileStreams.validateSize(options?.size);
    if (!options.size) throw new Error('Recovery data is empty.');
    return controlRecovery(async () => {
      if (recoveryWriteToken) await fileStreams.cancel(recoveryWriteToken);
      const result = await fileStreams.beginWrite({ destination: recovery.file, size: options.size, onCommit: () => recovery.updateMetadata(options.name) });
      recoveryWriteToken = result.token;
      return result;
    });
  });
  ipcMain.handle('styk:file-write-chunk', (event, token, bytes) => { trusted(event); return fileStreams.write(token, bytes); });
  ipcMain.handle('styk:file-write-patch', (event, token, offset, bytes) => { trusted(event); return fileStreams.patch(token, offset, bytes); });
  ipcMain.handle('styk:file-write-finish', async (event, token) => {
    trusted(event);
    const documentToken = projectTransfers.get(token);
    if (documentToken) projectFiles.requireCurrent(documentToken);
    try {
      const result = await fileStreams.finish(token);
      if (token === recoveryWriteToken) recoveryWriteToken = null;
      return documentToken ? { ...result, documentToken, filename: path.basename(result.path) } : result;
    } finally { if (!fileStreams.jobs.has(token)) projectTransfers.delete(token); }
  });
  ipcMain.handle('styk:file-write-cancel', async (event, token) => {
    trusted(event);
    const result = await fileStreams.cancel(token);
    projectTransfers.delete(token);
    if (token === recoveryWriteToken) recoveryWriteToken = null;
    return result;
  });
  ipcMain.handle('styk:recovery-info', (event) => { trusted(event); return recovery.info(); });
  ipcMain.handle('styk:recovery-read-begin', async (event) => {
    trusted(event);
    const info = await recovery.info();
    if (!info) return null;
    const transfer = await fileStreams.beginRead(recovery.file);
    return transfer ? { ...info, ...transfer } : null;
  });
  ipcMain.handle('styk:file-read-chunk', (event, token) => { trusted(event); return fileStreams.read(token); });
  ipcMain.handle('styk:file-read-close', (event, token) => { trusted(event); return fileStreams.closeRead(token); });
  ipcMain.handle('styk:recovery-save', (event, options) => {
    trusted(event);
    return controlRecovery(async () => {
      if (recoveryWriteToken) { await fileStreams.cancel(recoveryWriteToken); recoveryWriteToken = null; }
      return recovery.save(options);
    });
  });
  ipcMain.handle('styk:recovery-get', (event) => { trusted(event); return recovery.get(); });
  ipcMain.handle('styk:recovery-delete', async (event) => {
    trusted(event);
    return controlRecovery(async () => {
      if (recoveryWriteToken) { await fileStreams.cancel(recoveryWriteToken); recoveryWriteToken = null; }
      return recovery.delete();
    });
  });
  ipcMain.handle('styk:open-file', async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window, { title: 'Open animation or stick figure', properties: ['openFile'], filters: FILE_FILTERS });
    return result.canceled ? null : readImportFile(result.filePaths[0]);
  });
  ipcMain.handle('styk:save-file', async (event, options) => {
    trusted(event);
    if (!options || typeof options !== 'object') throw new Error('Save options are required.');
    let data;
    if (typeof options.data === 'string') {
      if (!['base64', 'utf8', undefined].includes(options.encoding)) throw new Error('Unsupported file encoding.');
      data = Buffer.from(options.data, options.encoding || 'utf8');
    } else if (options.data instanceof Uint8Array || Array.isArray(options.data)) data = Buffer.from(options.data);
    else throw new Error('The file must contain text or bytes.');
    if (data.byteLength > MAX_FILE_BYTES) throw new Error('This export exceeds the 256 MB limit.');
    const filters = Array.isArray(options.filters) ? options.filters.slice(0, 8).map((filter) => ({
      name: String(filter.name || 'File').slice(0, 80),
      extensions: Array.isArray(filter.extensions) ? filter.extensions.filter((ext) => /^[a-z0-9*]{1,12}$/i.test(ext)) : [],
    })).filter((filter) => filter.extensions.length) : [{ name: 'StykAnimate project', extensions: ['styk'] }];
    const result = await dialog.showSaveDialog(window, {
      title: 'Save animation',
      defaultPath: path.basename(String(options.defaultPath || 'Untitled.styk')),
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    // Only the path selected by the native dialog is writable through this API.
    await atomicWrite(result.filePath, data);
    app.addRecentDocument(result.filePath);
    await rememberRecent(result.filePath);
    return { saved: true, path: result.filePath };
  });
  ipcMain.handle('styk:window', (event, action) => {
    trusted(event);
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
    else throw new Error('Unknown window action.');
    return windowState();
  });
  ipcMain.handle('styk:window-state', (event) => { trusted(event); return windowState(); });
  // Only the trusted workspace frame receives the codec session token.
  ipcMain.on('styk:api-token', (event) => {
    try { trusted(event); event.returnValue = apiToken; }
    catch { event.returnValue = ''; }
  });
  ipcMain.on('styk:memory-bytes', (event) => {
    try { trusted(event); event.returnValue = os.totalmem(); }
    catch { event.returnValue = 0; }
  });
  ipcMain.handle('styk:document-state', (event, state) => {
    trusted(event);
    documentState = { name: String(state?.name || 'Untitled').slice(0, 180), dirty: Boolean(state?.dirty), revision: String(state?.revision || '').slice(0, 160) };
    window.setTitle(`${documentState.dirty ? '• ' : ''}${documentState.name} — StykAnimate`);
    window.setDocumentEdited(documentState.dirty);
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1560, height: 1000, minWidth: 1000, minHeight: 680,
    backgroundColor: '#0a0b0f', show: false,
    title: 'StykAnimate',
    icon: path.join(__dirname, 'assets', 'stykanimate.png'),
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 16 } } : {}),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      backgroundThrottling: true, spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:github\.com|pivotanimator\.net)\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== backend.origin) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const editorWindow = window;
  let rendererFailed = false, crashDialogPending = false;
  async function offerRendererRecovery() {
    if (crashDialogPending || editorWindow.isDestroyed()) return;
    crashDialogPending = true;
    try {
      const answer = await dialog.showMessageBox(editorWindow, {
        type: 'error', title: 'Editor stopped', message: 'The animation editor stopped unexpectedly.',
        detail: 'Saved files and any recovery snapshot remain on disk. Reopen the editor to use the recovery option or open your saved project. Changes made after the last saved snapshot may be lost.',
        buttons: ['Reopen editor', 'Keep window open', 'Close window'], defaultId: 0, cancelId: 1,
      });
      if (editorWindow.isDestroyed() || !rendererFailed) return;
      if (answer.response === 0) {
        documentState = { name: 'Untitled', dirty: false };
        await editorWindow.loadURL(backend.origin);
      } else if (answer.response === 2) {
        // The dead renderer cannot save. Closing this window must retain the
        // existing recovery file and must not wait for a save acknowledgement.
        documentState.dirty = false;
        rendererFailed = false;
        editorWindow.close();
      }
    } catch (error) {
      console.error('Could not reopen the editor:', error.message);
    } finally { crashDialogPending = false; }
  }
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || quitting) return;
    rendererFailed = true; pageLoaded = false;
    telemetry?.error('RendererCrash', 'renderer', 'renderer_crashes');
    // One bounded, local diagnostic survives even when optional telemetry is
    // disabled. It contains no document contents or user identifiers.
    void atomicWrite(path.join(instanceDirectory, 'last-renderer-crash.json'), Buffer.from(JSON.stringify({
      version: app.getVersion(), occurredAt: new Date().toISOString(), reason: details.reason, exitCode: details.exitCode,
    }))).catch(() => {});
    void offerRendererRecovery();
  });
  window.on('unresponsive', () => telemetry?.error('RendererHang', 'renderer', 'renderer_hangs'));
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) {
    window.on(event, () => window.webContents.send('styk:window-state', windowState()));
  }
  window.on('close', async (event) => {
    if (!quitting && rendererFailed) { event.preventDefault(); void offerRendererRecovery(); return; }
    if (!quitting && documentState.dirty) {
      event.preventDefault();
      const answer = await dialog.showMessageBox(window, {
        type: 'question', title: 'Unsaved animation', message: `Save changes to ${documentState.name}?`,
        detail: 'Your animation has changes that have not been saved.',
        buttons: ['Save', 'Cancel', 'Discard'], defaultId: 0, cancelId: 1,
      });
      if (answer.response === 0) sendAction('save-and-close');
      else if (answer.response === 2) { documentState.dirty = false; window.close(); }
    }
  });
  window.on('closed', () => { window = null; });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('did-start-loading', () => { pageLoaded = false; });
  window.webContents.on('did-finish-load', () => { rendererFailed = false; pageLoaded = true; void flushPendingOpens(); });
  await window.loadURL(backend.origin);
  if (process.env.STYK_DEVTOOLS === '1') window.webContents.openDevTools({ mode: 'detach' });
  await flushPendingOpens();
}

async function start() {
  const unavailable = updateAvailability({ packaged: app.isPackaged, platform: process.platform,
    appImage: process.env.APPIMAGE,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR), installed: existsSync(path.join(path.dirname(process.execPath), 'Uninstall StykAnimate.exe')) });
  const updater = unavailable ? null : process.platform === 'linux'
    ? new (require('./appimage-updater.cjs').LinuxAppImageUpdater)()
    : require('electron-updater').autoUpdater;
  if (updater && process.platform === 'win32') updater.installDirectory = path.dirname(process.execPath);
  updates = new UpdateService({ updater,
    currentVersion: app.getVersion(), unavailable,
    onState: value => { if (value.status === 'error') quitting = false; if (window && !window.isDestroyed()) window.webContents.send('styk:update-state-changed', value); },
  });
  if (app.isPackaged) app.setAsDefaultProtocolClient('stykanimate');
  telemetryReady = new TelemetryService({ directory: app.getPath('userData'), schemaPath: path.join(app.isPackaged ? path.join(process.resourcesPath, 'web') : APP_ROOT, 'src', 'telemetry-schema.mjs'), version: app.getVersion(), development: !app.isPackaged,
    build: telemetryBuild.build, internal: telemetryBuild.internal === true,
    onState: value => { if (window && !window.isDestroyed()) window.webContents.send('styk:telemetry-state-changed', value); },
  }).init().then(service => { telemetry = service; return service; }).catch(() => { /* Optional reporting cannot prevent startup. */ });
  const memoryTimer = setInterval(() => {
    if (telemetry?.state.consent.diagnostics && window?.isFocused()) {
      const metrics = app.getAppMetrics();
      const phase=telemetry.resourcePhase||'unknown',epoch=telemetry.epoch;
      telemetry.sampleResources({memory_process:metrics.reduce((sum,item)=>sum+(item.memory?.workingSetSize||0),0)/1024},phase);
      if(backend?.origin)void fetch(backend.origin+'/api/health',{signal:AbortSignal.timeout(1500)}).then(response=>response.json()).then(value=>{
        if(telemetry.epoch===epoch&&window?.isFocused()&&Number.isFinite(value.processMemoryMiB))telemetry.sampleResources({memory_backend:value.processMemoryMiB},phase);
      }).catch(()=>{});
      telemetry.sampleMemory(metrics.reduce((sum, item) => sum + (item.memory?.workingSetSize || 0), 0) / 1024);
      telemetry.record({ epoch: telemetry.epoch, data: { gauges: { process_cpu_percent: metrics.reduce((sum, item) => sum + (item.cpu?.percentCPUUsage || 0), 0) } } });
    }
  }, 60000); memoryTimer.unref();
  library = new LibraryStore(process.env.STYK_LIBRARY_DIR || path.join(app.getPath('documents'), 'StykAnimate', 'library'));
  // A temporarily unavailable Documents volume should not prevent animation work.
  void library.init().catch(error => console.warn('Library initialization:', error.message));
  backend = await startDesktopHost({
    appRoot: APP_ROOT, resourcesPath: process.resourcesPath, packaged: app.isPackaged, token: apiToken,
    log: (message) => { if (process.env.STYK_DEBUG === '1') process.stderr.write(message); },
    onError: (message) => { telemetry?.error('BackendError', 'backend', 'backend_errors'); if (window && !window.isDestroyed()) window.webContents.send('styk:backend-error', message); },
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Each workspace owns a separate Chromium session directory, and each
  // launch gets a new loopback origin. IndexedDB here is temporary worker
  // storage only; native recovery, preferences and library data live in files.
  // Reclaim old-origin undo caches before any editor/worker can use the session.
  await session.defaultSession.clearStorageData({storages:['indexdb']}).catch(error=>console.warn('Temporary drawing cache cleanup:',error.message));
  nativeMenu();
  registerIpc();
  await createWindow();
  updates.start();
  app.on('activate', () => { if (!window) createWindow(); });
}

app.on('before-quit', (event) => {
  if (window && documentState.dirty && !quitting) { event.preventDefault(); window.close(); }
  else {
    quitting = true;
    if (telemetry && !telemetryClosed) { event.preventDefault(); telemetryClosed = true; void telemetry.close().catch(() => {}).finally(() => app.quit()); }
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => updates?.dispose());
app.on('will-quit', () => { backend?.stop(); library?.dispose().catch(() => {}); fileStreams?.dispose().catch(() => {}); videoExports?.dispose().catch(() => {}); vfwExports?.dispose().catch(() => {}); audioImports?.dispose().catch(() => {}); });
process.on('exit', () => backend?.stop());
