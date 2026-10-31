const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ff = require('./src/ffmpeg');

let win;
const jobs = new Map(); // job id -> { cancel }

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: 'Video Converter',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1117' : '#f4f5f9',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links in the UI open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const j of jobs.values()) j.cancel();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC ----------

ipcMain.handle('pick-files', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose videos',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ff.INPUT_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('pick-folder', async (_e, purpose) => {
  const res = await dialog.showOpenDialog(win, {
    title: purpose === 'output' ? 'Save converted files to' : 'Choose a folder of videos',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// Expands folders into the video files inside them.
ipcMain.handle('expand-paths', async (_e, paths) => {
  const out = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        for (const name of fs.readdirSync(p).sort()) {
          const full = path.join(p, name);
          const ext = path.extname(name).slice(1).toLowerCase();
          if (ff.INPUT_EXTENSIONS.includes(ext) && fs.statSync(full).isFile()) out.push(full);
        }
      } else if (st.isFile()) {
        out.push(p);
      }
    } catch { /* unreadable: skip */ }
  }
  return out;
});

ipcMain.handle('inspect', async (_e, file) => {
  const info = await ff.probe(file);
  let thumb = null;
  try {
    thumb = await ff.thumbnail(file, info.duration);
  } catch { /* audio-only or unreadable frame: no thumbnail */ }
  return { ...info, thumb, name: path.basename(file), dir: path.dirname(file) };
});

ipcMain.handle('convert', async (_e, { id, src, opts, outDir, sourceDuration }) => {
  const dst = ff.outputPathFor(src, opts.format, outDir || null);
  const job = ff.convert(src, dst, { ...opts, sourceDuration }, (p) => {
    if (!win.isDestroyed()) win.webContents.send('progress', { id, progress: p });
  });
  jobs.set(id, job);
  try {
    await job.done;
    const size = fs.statSync(dst).size;
    let thumb = null;
    try {
      thumb = opts.format === 'gif' ? null : await ff.thumbnail(dst, null);
    } catch { /* not fatal */ }
    return { ok: true, dst, size, thumb, name: path.basename(dst) };
  } catch (err) {
    return { ok: false, cancelled: !!err.cancelled, error: err.message };
  } finally {
    jobs.delete(id);
  }
});

ipcMain.handle('cancel', (_e, id) => {
  if (id) jobs.get(id)?.cancel();
  else for (const j of jobs.values()) j.cancel();
});

ipcMain.handle('show-in-folder', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('open-file', (_e, file) => shell.openPath(file));
ipcMain.handle('file-url', (_e, file) => require('node:url').pathToFileURL(file).href);

ipcMain.handle('check-ffmpeg', async () => {
  try {
    const out = await new Promise((resolve, reject) => {
      require('node:child_process').execFile(ff.findFfmpeg(), ['-version'],
        { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    return { ok: true, version: (out.match(/ffmpeg version (\S+)/) || [])[1] || '' };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('default-output-dir', () => app.getPath('videos'));
