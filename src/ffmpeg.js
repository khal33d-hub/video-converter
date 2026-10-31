// Conversion engine: finds ffmpeg, reads file info, makes thumbnails and runs
// conversions with progress. Used by the main process only.

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FORMATS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];

// CRF for x264/VP9 (lower = better and bigger) and qscale for AVI's mpeg4.
const QUALITY = {
  high: { x264: 18, vp9: 24, mpeg4: 2 },
  medium: { x264: 23, vp9: 32, mpeg4: 4 },
  small: { x264: 28, vp9: 40, mpeg4: 8 },
};

const INPUT_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg',
  'ts', 'mts', 'm2ts', '3gp', 'ogv', 'gif',
];

// The bundled ffmpeg lives inside app.asar when packaged, but executables
// can't run from inside an archive, so electron-builder unpacks it.
function bundledFfmpeg() {
  try {
    const p = require('ffmpeg-static');
    return p && p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  } catch {
    return null;
  }
}

function findFfmpeg() {
  const fromEnv = process.env.VC_FFMPEG;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const b = bundledFfmpeg();
  if (b && fs.existsSync(b)) return b;
  return 'ffmpeg'; // fall back to whatever is on PATH
}

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(findFfmpeg(), args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
}

// Reads a file's details from ffmpeg's own description of it. ffmpeg exits
// with an error here because no output is given; that's expected.
async function probe(file) {
  let text;
  try {
    text = (await run(['-hide_banner', '-i', file], { encoding: 'utf8' })).stderr;
  } catch (err) {
    text = String(err.stderr || '');
    if (err.code === 'ENOENT') throw new Error('ffmpeg could not be found.');
  }
  if (/No such file or directory/.test(text)) throw new Error('File not found.');

  const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = text.match(/Stream #\d+:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})/);
  const audio = text.match(/Stream #\d+:\d+.*?: Audio: (\w+)/);
  const fps = text.match(/, (\d+(?:\.\d+)?) fps/) || text.match(/, (\d+(?:\.\d+)?) tbr/);
  if (!video) throw new Error("This file doesn't contain any video.");

  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    width: Number(video[2]),
    height: Number(video[3]),
    fps: fps ? Number(fps[1]) : null,
    videoCodec: video[1],
    audioCodec: audio ? audio[1] : null,
    size: fs.statSync(file).size,
  };
}

// A JPEG frame from about a tenth of the way in, as a data: URL.
async function thumbnail(file, duration, width = 360) {
  const at = duration ? Math.min(duration * 0.1, 5) : 0;
  const { stdout: buf } = await run([
    '-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', file,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2', '-c:v', 'mjpeg',
    '-q:v', '4', 'pipe:1',
  ], { encoding: 'buffer' });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function parseTime(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) {
    throw new Error(`Can't read the time "${t}". Use seconds (90) or minutes:seconds (1:30).`);
  }
  const secs = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  if (secs < 0) throw new Error(`Time can't be negative: "${t}"`);
  return secs;
}

function outputPathFor(src, fmt, outDir) {
  const { dir, name } = path.parse(src);
  const folder = outDir || dir;
  let candidate = path.join(folder, `${name}.${fmt}`);
  for (let n = 1; fs.existsSync(candidate) || path.resolve(candidate) === path.resolve(src); n++) {
    candidate = path.join(folder, `${name} (${n}).${fmt}`);
  }
  return candidate;
}

function buildArgs(src, dst, opts) {
  const fmt = String(opts.format || 'mp4').toLowerCase();
  if (!FORMATS.includes(fmt)) throw new Error(`Unsupported output format: ${fmt}`);
  const q = QUALITY[opts.quality] || QUALITY.medium;
  const args = ['-hide_banner', '-y', '-nostdin'];
  if (opts.start) args.push('-ss', String(opts.start));
  args.push('-i', src);
  if (opts.duration) args.push('-t', String(opts.duration));

  if (fmt === 'gif') {
    const width = opts.width || 480;
    const fps = Math.max(1, Math.min(50, Math.round(opts.gifFps || 12)));
    // Build a palette for this clip and dither with it: much better colour
    // than ffmpeg's generic 256-colour GIF.
    args.push(
      '-filter_complex',
      `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
        '[a]palettegen=stats_mode=diff[p];' +
        '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      '-loop', opts.gifLoop === false ? '-1' : '0',
    );
  } else {
    // -2 keeps the aspect ratio with an even height, which H.264 needs.
    if (opts.width) args.push('-vf', `scale=${opts.width}:-2:flags=lanczos`);
    let audio;
    if (fmt === 'webm') {
      args.push('-c:v', 'libvpx-vp9', '-crf', String(q.vp9), '-b:v', '0',
        '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');
      audio = ['-c:a', 'libopus', '-b:a', '128k'];
    } else if (fmt === 'avi') {
      args.push('-c:v', 'mpeg4', '-q:v', String(q.mpeg4), '-tag:v', 'XVID');
      audio = ['-c:a', 'libmp3lame', '-q:a', '3'];
    } else {
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(q.x264),
        '-pix_fmt', 'yuv420p');
      if (fmt !== 'mkv') args.push('-movflags', '+faststart');
      audio = ['-c:a', 'aac', '-b:a', '160k'];
    }
    args.push('-map', '0:v:0');
    if (opts.keepAudio === false) args.push('-an');
    else args.push('-map', '0:a:0?', ...audio);
  }

  args.push('-progress', 'pipe:1', '-nostats', dst);
  return args;
}

// Starts a conversion. Returns { done: Promise<dst>, cancel() }.
function convert(src, dst, opts, onProgress = () => {}) {
  let total = opts.sourceDuration || null;
  if (total) {
    if (opts.start) total = Math.max(0, total - opts.start);
    if (opts.duration) total = Math.min(total, opts.duration);
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const child = spawn(findFfmpeg(), buildArgs(src, dst, opts), { windowsHide: true });
  let cancelled = false;
  let stderr = '';
  let buf = '';

  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const [key, val] = line.split('=');
      // out_time_us and (despite its name) out_time_ms are both microseconds.
      if ((key === 'out_time_us' || key === 'out_time_ms') && total) {
        const secs = Number(val) / 1e6;
        if (Number.isFinite(secs)) onProgress(Math.min(1, Math.max(0, secs / total)));
      } else if (key === 'progress' && val === 'end') {
        onProgress(1);
      }
    }
  });

  const done = new Promise((resolve, reject) => {
    child.on('error', (err) => reject(new Error(
      err.code === 'ENOENT' ? 'ffmpeg could not be found.' : err.message)));
    child.on('close', (code) => {
      if (cancelled || code !== 0) fs.rmSync(dst, { force: true });
      if (cancelled) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      if (code !== 0) {
        const lines = stderr.trim().split('\n').slice(-6).join('\n');
        return reject(new Error(lines || `ffmpeg exited with code ${code}`));
      }
      resolve(dst);
    });
  });

  return {
    done,
    cancel() {
      cancelled = true;
      if (child.exitCode === null) child.kill();
    },
  };
}

module.exports = {
  FORMATS, QUALITY, INPUT_EXTENSIONS,
  findFfmpeg, probe, thumbnail, parseTime, outputPathFor, buildArgs, convert,
};
