// The only bridge between the interface and the rest of the computer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vc', {
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: (purpose) => ipcRenderer.invoke('pick-folder', purpose),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  inspect: (file) => ipcRenderer.invoke('inspect', file),
  convert: (job) => ipcRenderer.invoke('convert', job),
  cancel: (id) => ipcRenderer.invoke('cancel', id),
  showInFolder: (file) => ipcRenderer.invoke('show-in-folder', file),
  openFile: (file) => ipcRenderer.invoke('open-file', file),
  fileUrl: (file) => ipcRenderer.invoke('file-url', file),
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  defaultOutputDir: () => ipcRenderer.invoke('default-output-dir'),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, data) => fn(data)),
  platform: process.platform,
});
