const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../src/ffmpeg');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-test-'));
const sample = path.join(tmp, 'sample clip.mov');

test.before(() => {
  // Six seconds of test pattern with a tone.
  execFileSync(ff.findFfmpeg(), [
    '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-shortest',
    '-c:v', 'libx264', '-c:a', 'aac', sample,
  ]);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('parseTime reads seconds, m:ss and h:mm:ss', () => {
  assert.strictEqual(ff.parseTime(''), null);
  assert.strictEqual(ff.parseTime('90'), 90);
  assert.strictEqual(ff.parseTime('1:30'), 90);
  assert.strictEqual(ff.parseTime('1:00:01.5'), 3601.5);
  assert.throws(() => ff.parseTime('abc'));
  assert.throws(() => ff.parseTime('1::2'));
});

test('outputPathFor never overwrites', () => {
  const first = ff.outputPathFor(sample, 'mp4');
  assert.strictEqual(path.basename(first), 'sample clip.mp4');
  fs.writeFileSync(first, '');
  assert.strictEqual(path.basename(ff.outputPathFor(sample, 'mp4')), 'sample clip (1).mp4');
  fs.rmSync(first);
  // Same format as the source gets a new name rather than replacing it.
  assert.strictEqual(path.basename(ff.outputPathFor(sample, 'mov')), 'sample clip (1).mov');
});

test('buildArgs picks the right codecs', () => {
  const a = (format, extra = {}) => ff.buildArgs('in.mov', 'out', { format, ...extra }).join(' ');
  assert.match(a('mp4'), /libx264.*-crf 23.*\+faststart.*-c:a aac/);
  assert.match(a('webm', { quality: 'high' }), /libvpx-vp9 -crf 24.*libopus/);
  assert.match(a('avi'), /mpeg4.*libmp3lame/);
  assert.match(a('mkv', { keepAudio: false }), /-an/);
  assert.match(a('gif', { width: 320, gifFps: 15 }), /fps=15,scale=320:-1.*palettegen.*-loop 0/);
  assert.match(a('mp4', { start: 2, duration: 3, width: 1280 }), /-ss 2 -i in\.mov -t 3 -vf scale=1280:-2/);
  assert.throws(() => ff.buildArgs('a', 'b', { format: 'exe' }));
});

test('probe and thumbnail read a real file', async () => {
  const info = await ff.probe(sample);
  assert.strictEqual(info.width, 640);
  assert.strictEqual(info.audioCodec, 'aac');
  assert.ok(Math.abs(info.duration - 6) < 0.2);
  const thumb = await ff.thumbnail(sample, info.duration);
  assert.match(thumb, /^data:image\/jpeg;base64,/);
});

for (const format of ff.FORMATS) {
  test(`converts to ${format} with progress`, async () => {
    const dst = ff.outputPathFor(sample, format, path.join(tmp, 'out'));
    const seen = [];
    const job = ff.convert(sample, dst, {
      format, width: 320, start: 1, duration: 2, sourceDuration: 6,
    }, (p) => seen.push(p));
    await job.done;
    const info = await ff.probe(dst);
    assert.strictEqual(info.width, 320);
    assert.ok(Math.abs(info.duration - 2) < 0.2, `duration ${info.duration}`);
    assert.strictEqual(seen.at(-1), 1);
  });
}

test('cancelling stops and removes the partial file', async () => {
  const dst = path.join(tmp, 'cancelled.webm');
  const job = ff.convert(sample, dst, { format: 'webm', quality: 'high', sourceDuration: 6 });
  setTimeout(() => job.cancel(), 150);
  await assert.rejects(job.done, (err) => err.cancelled === true);
  assert.ok(!fs.existsSync(dst));
});

test('a missing file fails with a message', async () => {
  const job = ff.convert(path.join(tmp, 'nope.mp4'), path.join(tmp, 'x.mp4'), { format: 'mp4' });
  await assert.rejects(job.done, /No such file|does not exist/i);
});
