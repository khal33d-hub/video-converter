'use strict';

// `vc` is the bridge defined in preload.js.

const $ = (sel) => document.querySelector(sel);

// ---------- static data ----------

const ICONS = {
  play: '<path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  globe: '<path fill="none" stroke="currentColor" stroke-width="2" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-9 9h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z"/>',
  box: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9"/>',
  clapper: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10l1-4.5 15.5-3 1 4.5L3 10zM8.5 5l2 4M14 4l2 4"/>',
  tv: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 7h18v11H3zM8 3l4 4 4-4M8 21h8"/>',
  spark: '<path fill="currentColor" d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/>',
  close: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>',
  check: '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/>',
};

const FORMATS = [
  { id: 'mp4', label: 'MP4', sub: 'Plays everywhere', color: '#3b82f6', icon: 'play' },
  { id: 'webm', label: 'WebM', sub: 'Small, for the web', color: '#10b981', icon: 'globe' },
  { id: 'mkv', label: 'MKV', sub: 'For archiving', color: '#8b5cf6', icon: 'box' },
  { id: 'mov', label: 'MOV', sub: 'Apple & editing', color: '#f59e0b', icon: 'clapper' },
  { id: 'avi', label: 'AVI', sub: 'Older players', color: '#64748b', icon: 'tv' },
  { id: 'gif', label: 'GIF', sub: 'Silent loop', color: '#ec4899', icon: 'spark' },
];

const SIZES = {
  video: [['0', 'Original'], ['1920', '1920'], ['1280', '1280'], ['640', '640'], ['custom', 'Custom']],
  gif: [['320', '320'], ['480', '480'], ['640', '640'], ['800', '800'], ['custom', 'Custom']],
};

// Formats Chromium can play inside the preview window.
const PLAYABLE = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];

// ---------- settings (remembered between launches) ----------

const DEFAULTS = {
  format: 'mp4', quality: 'medium', size: '0', gifSize: '480', customWidth: '',
  start: '', length: '', audio: true, fps: 12, loop: true, dest: 'same', outDir: '',
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch { /* not fatal */ }
}

// ---------- helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c);
  }
  return node;
}

function svg(name, cls = '') {
  return `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICONS[name]}</svg>`;
}

function fmtDuration(s) {
  if (!Number.isFinite(s)) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(bytes >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseTime(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)) || Number(p) < 0)) {
    throw new Error(`"${t}" isn't a time. Use seconds (90) or minutes:seconds (1:30).`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- settings panel ----------

function setChecked(group, value) {
  for (const b of group.querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
    b.setAttribute('role', 'radio');
  }
}

function buildFormats() {
  const box = $('#formats');
  for (const f of FORMATS) {
    const tile = el('button', {
      class: 'fmt', role: 'radio', 'data-v': f.id, title: `${f.label}: ${f.sub}`,
      onclick: () => { settings.format = f.id; saveSettings(); refreshPanel(); },
    },
    el('span', { class: 'glyph', html: svg(f.icon) }),
    el('span', { class: 'label' }, f.label),
    el('span', { class: 'sub' }, f.sub));
    tile.style.setProperty('--c', f.color);
    box.append(tile);
  }
}

function refreshPanel() {
  const isGif = settings.format === 'gif';
  for (const t of document.querySelectorAll('.fmt')) {
    t.setAttribute('aria-checked', String(t.dataset.v === settings.format));
  }

  setChecked($('#quality'), settings.quality);
  $('#quality-field').classList.toggle('disabled', isGif);
  $('#audio-field').classList.toggle('hidden', isGif);
  $('#gif-field').classList.toggle('hidden', !isGif);

  // Size choices differ for GIFs, which must be small.
  const sizeBox = $('#size');
  sizeBox.replaceChildren(...SIZES[isGif ? 'gif' : 'video'].map(([v, l]) =>
    el('button', { 'data-v': v, title: v === '0' ? 'Keep the original size' : v === 'custom' ? 'Type a width' : `${v} pixels wide` }, l)));
  const sizeVal = isGif ? settings.gifSize : settings.size;
  setChecked(sizeBox, sizeVal);
  $('#custom-width-row').classList.toggle('hidden', sizeVal !== 'custom');
  $('#custom-width').value = settings.customWidth;

  $('#start').value = settings.start;
  $('#length').value = settings.length;
  $('#audio').checked = settings.audio;
  $('#fps').value = settings.fps;
  $('#fps-label').textContent = `${settings.fps} frames a second`;
  $('#loop').checked = settings.loop;

  setChecked($('#dest'), settings.dest);
  const destBtn = $('#dest-folder');
  destBtn.classList.toggle('hidden', settings.dest !== 'folder');
  destBtn.textContent = settings.outDir || 'Choose a folder…';

  refreshFooter();
}

function wirePanel() {
  $('#quality').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { settings.quality = v; saveSettings(); refreshPanel(); }
  });
  $('#size').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    if (settings.format === 'gif') settings.gifSize = v; else settings.size = v;
    saveSettings();
    refreshPanel();
    if (v === 'custom') $('#custom-width').focus();
  });
  $('#custom-width').addEventListener('input', (e) => { settings.customWidth = e.target.value; saveSettings(); });
  for (const id of ['start', 'length']) {
    $(`#${id}`).addEventListener('input', (e) => {
      settings[id] = e.target.value;
      saveSettings();
      try { parseTime(e.target.value); e.target.classList.remove('invalid'); } catch { e.target.classList.add('invalid'); }
    });
  }
  $('#audio').addEventListener('change', (e) => { settings.audio = e.target.checked; saveSettings(); });
  $('#loop').addEventListener('change', (e) => { settings.loop = e.target.checked; saveSettings(); });
  $('#fps').addEventListener('input', (e) => {
    settings.fps = Number(e.target.value);
    $('#fps-label').textContent = `${settings.fps} frames a second`;
    saveSettings();
  });
  $('#dest').addEventListener('click', async (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    if (v === 'folder' && !settings.outDir) {
      const dir = await vc.pickFolder('output');
      if (!dir) return;
      settings.outDir = dir;
    }
    settings.dest = v;
    saveSettings();
    refreshPanel();
  });
  $('#dest-folder').addEventListener('click', async () => {
    const dir = await vc.pickFolder('output');
    if (dir) { settings.outDir = dir; saveSettings(); refreshPanel(); }
  });
}

function readOptions() {
  const isGif = settings.format === 'gif';
  const sizeVal = isGif ? settings.gifSize : settings.size;
  let width = null;
  if (sizeVal === 'custom') {
    const w = Number(settings.customWidth);
    if (!Number.isInteger(w) || w < 16 || w > 7680) throw new Error('Type a width between 16 and 7680 pixels.');
    width = w % 2 ? w + 1 : w;
  } else if (sizeVal !== '0') {
    width = Number(sizeVal);
  }
  const start = parseTime(settings.start);
  const duration = parseTime(settings.length);
  if (duration !== null && duration <= 0) throw new Error('Length must be more than zero.');
  if (settings.dest === 'folder' && !settings.outDir) throw new Error('Choose a folder to save to.');
  return {
    format: settings.format, quality: settings.quality, width, start, duration,
    keepAudio: settings.audio, gifFps: settings.fps, gifLoop: settings.loop,
  };
}

// ---------- file list ----------

const items = [];
let nextId = 1;
let running = false;
let cancelAll = false;
let current = null;

async function addPaths(paths) {
  const files = await vc.expandPaths(paths);
  const known = new Set(items.map((i) => i.path));
  const fresh = files.filter((p) => !known.has(p));
  if (!fresh.length) {
    if (paths.length) toast(files.length ? 'Those files are already in the list.' : 'No videos found there.');
    return;
  }
  for (const p of fresh) {
    const item = {
      id: nextId++, path: p, name: p.split(/[\\/]/).pop(), status: 'loading', progress: 0,
    };
    items.push(item);
    item.el = el('li', { class: 'item' });
    $('#list').append(item.el);
    renderItem(item);
  }
  refreshLayout();
  // Read details one at a time so a big folder doesn't swamp the disk.
  for (const p of fresh) {
    const item = items.find((i) => i.path === p);
    if (!item) continue;
    try {
      const info = await vc.inspect(p);
      Object.assign(item, { info, status: item.status === 'loading' ? 'ready' : item.status });
    } catch {
      Object.assign(item, { status: 'unreadable' });
    }
    renderItem(item);
    refreshFooter();
  }
}

function removeItem(item) {
  if (item === current) return;
  items.splice(items.indexOf(item), 1);
  item.el.remove();
  refreshLayout();
}

function renderItem(item) {
  const info = item.info || {};
  const ext = (item.name.split('.').pop() || '').toUpperCase();

  const thumb = el('button', {
    class: 'thumb', title: 'Preview',
    onclick: () => openPreview(item, item.result ? 'result' : 'source'),
  });
  if (info.thumb) thumb.append(el('img', { src: info.thumb, alt: '' }));
  else if (item.status === 'loading') thumb.append(el('div', { class: 'shimmer' }));
  if (info.thumb) thumb.append(el('div', { class: 'play', html: svg('play') }));
  if (info.duration) thumb.append(el('span', { class: 'badge' }, fmtDuration(info.duration)));

  const details = [];
  if (info.width) details.push(`${info.width}×${info.height}`);
  if (info.size) details.push(fmtSize(info.size));
  if (info.fps) details.push(`${Math.round(info.fps)} fps`);

  const chips = el('div', { class: 'chips' },
    el('span', { class: 'chip' }, ext),
    info.videoCodec && el('span', { class: 'chip' }, info.videoCodec.toUpperCase()),
    info.audioCodec ? el('span', { class: 'chip' }, `♪ ${info.audioCodec.toUpperCase()}`)
      : info.videoCodec && el('span', { class: 'chip' }, 'No sound'));

  const status = el('div', { class: 'status' });
  switch (item.status) {
    case 'loading': status.append('Reading file…'); break;
    case 'ready': status.append('Ready'); break;
    case 'queued': status.append('Waiting…'); break;
    case 'converting': status.append(`Converting to ${(item.target || settings.format).toUpperCase()}…`); break;
    case 'cancelled': status.append('Cancelled'); break;
    case 'unreadable': status.append(el('span', { class: 'err' }, "Can't read this file. It may not be a video.")); break;
    case 'failed': status.append(
      el('span', { class: 'err' }, 'Couldn’t convert this one. '),
      el('button', { class: 'link', onclick: () => alertDetails(item) }, 'Details'));
      break;
    case 'done': {
      const r = item.result;
      status.append(
        el('span', { class: 'ok', html: `${svg('check', 'check')}` }, r.name),
        el('span', { class: 'muted' }, fmtSize(r.size)),
        el('button', { class: 'link', onclick: () => openPreview(item, 'result') }, 'Preview'),
        el('button', { class: 'link', onclick: () => vc.showInFolder(r.dst) }, 'Show in folder'));
      break;
    }
    default: break;
  }

  const progress = el('div', { class: 'progress' }, el('div', { class: 'fill' }));
  const pct = el('div', { class: 'percent' },
    item.status === 'converting' ? `${Math.round(item.progress * 100)}%` : '');
  const removeBtn = item.status === 'converting' ? null
    : el('button', { class: 'icon-btn', title: 'Remove from list', html: svg('close'), onclick: () => removeItem(item) });

  item.el.className = `item ${item.status}`;
  item.el.replaceChildren(
    thumb,
    el('div', { class: 'meta' },
      el('div', { class: 'name', title: item.path }, item.name),
      el('div', { class: 'details' }, details.join('  ·  ')),
      chips, progress, status),
    el('div', { class: 'side' }, removeBtn, pct));
  setItemProgress(item);
}

function setItemProgress(item) {
  const fill = item.el.querySelector('.progress .fill');
  const show = ['converting', 'done', 'failed'].includes(item.status);
  item.el.querySelector('.progress').classList.toggle('hidden', !show);
  if (fill) fill.style.width = `${(item.status === 'done' ? 1 : item.progress) * 100}%`;
  const pct = item.el.querySelector('.percent');
  if (pct && item.status === 'converting') pct.textContent = `${Math.round(item.progress * 100)}%`;
}

function alertDetails(item) {
  openModal({
    title: `Couldn’t convert ${item.name}`,
    sub: 'This is what the converter reported:',
    body: el('pre', { class: 'fallback errlog' }, item.error || 'Unknown error'),
    file: item.path,
  });
}

function refreshLayout() {
  const has = items.length > 0;
  $('#dropzone').classList.toggle('empty', !has);
  $('#list-head').classList.toggle('hidden', !has);
  refreshFooter();
}

function convertible() {
  const ok = items.filter((i) => !['loading', 'unreadable'].includes(i.status));
  const pending = ok.filter((i) => i.status !== 'done');
  return pending.length ? pending : ok;
}

function refreshFooter() {
  const n = items.length;
  const total = items.reduce((s, i) => s + (i.info?.duration || 0), 0);
  $('#list-summary').textContent = n
    ? `${n} video${n === 1 ? '' : 's'}${total ? ` · ${fmtDuration(total)} in total` : ''}` : '';
  if (running) return;
  const todo = convertible();
  const fmt = settings.format.toUpperCase();
  $('#convert').disabled = todo.length === 0;
  $('#convert-text').textContent = todo.length > 1 ? `Convert ${todo.length} to ${fmt}` : `Convert to ${fmt}`;
  if (!n) $('#overall-text').textContent = 'Add some videos to get started.';
  else if (!$('#overall-text').dataset.finished) {
    $('#overall-text').textContent = `Ready to convert to ${fmt}.`;
  }
}

// ---------- converting ----------

async function startConversion() {
  if (running) return;
  let opts;
  try {
    opts = readOptions();
  } catch (err) {
    toast(err.message);
    return;
  }
  const queue = convertible();
  if (!queue.length) return;

  running = true;
  cancelAll = false;
  delete $('#overall-text').dataset.finished;
  $('#convert').disabled = true;
  $('#convert-text').textContent = 'Converting…';
  $('#cancel').classList.remove('hidden');
  for (const it of queue) {
    Object.assign(it, { status: 'queued', progress: 0, result: null, error: null, target: opts.format });
    renderItem(it);
  }

  let done = 0;
  let failed = 0;
  for (let i = 0; i < queue.length; i++) {
    const it = queue[i];
    if (!items.includes(it)) continue;
    if (cancelAll) { it.status = 'cancelled'; renderItem(it); continue; }
    current = it;
    it.status = 'converting';
    renderItem(it);
    $('#overall-text').textContent = `Converting ${i + 1} of ${queue.length}: ${it.name}`;
    updateOverall(queue, i, 0);

    const res = await vc.convert({
      id: it.id, src: it.path, opts,
      outDir: settings.dest === 'folder' ? settings.outDir : null,
      sourceDuration: it.info?.duration || null,
    });
    if (res.ok) {
      done++;
      Object.assign(it, { status: 'done', progress: 1, result: res });
    } else if (res.cancelled) {
      Object.assign(it, { status: 'cancelled', progress: 0 });
    } else {
      failed++;
      Object.assign(it, { status: 'failed', error: res.error });
    }
    renderItem(it);
    updateOverall(queue, i + 1, 0);
  }

  current = null;
  running = false;
  $('#cancel').classList.add('hidden');
  let msg = `${done} converted`;
  if (failed) msg += `, ${failed} failed`;
  if (cancelAll) msg += ' (stopped)';
  $('#overall-text').textContent = `Finished: ${msg}.`;
  $('#overall-text').dataset.finished = '1';
  if (done) toast(done === 1 ? '✨ Your video is ready' : `✨ ${done} videos are ready`);
  refreshFooter();
}

function updateOverall(queue, finished, frac) {
  $('#overall-bar').style.width = `${((finished + frac) / queue.length) * 100}%`;
}

vc.onProgress(({ id, progress }) => {
  const it = items.find((i) => i.id === id);
  if (!it || it.status !== 'converting') return;
  it.progress = progress;
  setItemProgress(it);
  const queue = items.filter((i) => ['queued', 'converting', 'done', 'failed', 'cancelled'].includes(i.status));
  const idx = queue.indexOf(it);
  if (idx >= 0) updateOverall(queue, idx, progress);
});

// ---------- preview ----------

function openModal({ title, sub, body, file }) {
  $('#modal-title').textContent = title;
  $('#modal-sub').textContent = sub || '';
  $('#modal-body').replaceChildren(body);
  $('#modal-open').onclick = () => vc.openFile(file);
  $('#modal-show').onclick = () => vc.showInFolder(file);
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  for (const v of $('#modal-body').querySelectorAll('video')) v.pause();
  $('#modal').classList.add('hidden');
  $('#modal-body').replaceChildren();
}

async function openPreview(item, which) {
  const isResult = which === 'result' && item.result;
  const file = isResult ? item.result.dst : item.path;
  const ext = file.split('.').pop().toLowerCase();
  const url = await vc.fileUrl(file);
  const info = item.info || {};
  const sub = isResult
    ? `Converted · ${fmtSize(item.result.size)} (was ${fmtSize(info.size)})`
    : [info.width && `${info.width}×${info.height}`, fmtDuration(info.duration), fmtSize(info.size)].filter(Boolean).join('  ·  ');

  const fallback = () => el('div', { class: 'fallback' },
    info.thumb ? el('img', { src: info.thumb, alt: '' }) : '',
    el('p', {}, `${ext.toUpperCase()} files can't be played inside the app. Use “Open in default app” to watch it.`));

  let body;
  if (ext === 'gif') {
    body = el('img', { src: url, alt: '' });
  } else if (PLAYABLE.includes(ext)) {
    body = el('video', { src: url, controls: '', autoplay: '' });
    body.addEventListener('error', () => body.replaceWith(fallback()));
  } else {
    body = fallback();
  }
  openModal({ title: isResult ? item.result.name : item.name, sub, body, file });
}

// ---------- drag and drop ----------

function wireDrop() {
  const zone = $('#dropzone');
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('over'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('over'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => vc.pathForFile(f)).filter(Boolean);
    if (paths.length) addPaths(paths);
  });
}

// ---------- start-up ----------

async function init() {
  buildFormats();
  wirePanel();
  wireDrop();
  refreshPanel();
  refreshLayout();

  $('#add-files').addEventListener('click', async () => addPaths(await vc.pickFiles()));
  $('#add-folder').addEventListener('click', async () => {
    const dir = await vc.pickFolder('input');
    if (dir) addPaths([dir]);
  });
  $('#clear').addEventListener('click', () => {
    for (const it of [...items]) removeItem(it);
    delete $('#overall-text').dataset.finished;
    $('#overall-bar').style.width = '0';
    refreshFooter();
  });
  $('#convert').addEventListener('click', startConversion);
  $('#cancel').addEventListener('click', () => {
    cancelAll = true;
    vc.cancel();
    $('#overall-text').textContent = 'Stopping…';
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  const engine = await vc.checkFfmpeg();
  $('#engine').classList.add(engine.ok ? 'ok' : 'bad');
  $('#engine-text').textContent = engine.ok
    ? `Engine ready${engine.version ? ` · ffmpeg ${engine.version.split('-')[0]}` : ''}`
    : 'Converter engine missing';
  if (!engine.ok) toast('The converter engine (ffmpeg) is missing. Try reinstalling the app.');
}

init();
