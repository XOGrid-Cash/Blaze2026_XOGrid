// Combines out/xogrid-promo.webm with out/music.wav into out/xogrid-promo.mp4 (H.264 + AAC), using Microsoft Edge's
// own decoder and MediaRecorder. VLC drops the first seconds of Playwright's WebM, Chromium decodes it correctly.
// Runs in real time (about 65 s).
import { chromium } from 'playwright';
import { writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'out');
const page = resolve(outDir, 'mux.html');
writeFileSync(page, `<!doctype html><body style="margin:0;background:#000">
<video id=v src="xogrid-promo.webm" muted playsinline preload=auto style="width:480px"></video>
<script>
window.mux = async () => {
  const v = document.getElementById('v');
  await new Promise((r) => (v.readyState >= 3 ? r() : v.addEventListener('canplaythrough', r, { once: true })));
  const ctx = new AudioContext({ sampleRate: 48000 });
  const music = await ctx.decodeAudioData(await (await fetch('music.wav')).arrayBuffer());
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource(); src.buffer = music; src.connect(dest);
  const vstream = v.captureStream();
  const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = 'video/mp4;codecs=avc1.640028,mp4a.40.2';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  await ctx.resume();
  // Start the recorder, the video and the music together; the music is offset by wherever the video actually is.
  rec.start(1000);
  await v.play();
  src.start(ctx.currentTime, v.currentTime);
  const startedAt = v.currentTime;
  await new Promise((r) => v.addEventListener('ended', r, { once: true }));
  await new Promise((r) => setTimeout(r, 300));
  rec.stop(); src.stop(); await stopped;
  const blob = new Blob(chunks, { type: 'video/mp4' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'xogrid-promo.mp4'; document.body.appendChild(a); a.click();
  return { startedAt, size: blob.size, videoDur: v.duration, musicDur: music.duration };
};
</script>`);

// Serve out/ over http (serve-out.mjs, port 5191) so the page may fetch the music.
const server = spawn(process.execPath, [resolve(here, 'serve-out.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ acceptDownloads: true });
const p = await context.newPage();
await p.goto('http://localhost:5191/mux.html');
const download = p.waitForEvent('download', { timeout: 180000 });
const info = await p.evaluate(() => window.mux());
const raw = resolve(outDir, 'edge-raw.mp4');
const target = resolve(outDir, 'xogrid-promo.mp4');
rmSync(raw, { force: true });
await (await download).saveAs(raw);
await browser.close();
server.kill();
rmSync(page, { force: true });

// MediaRecorder writes a fragmented MP4; VLC copies the streams (no re-encode) into a standard, indexed MP4.
const VLC = process.env.VLC ?? 'C:/Program Files/VideoLAN/VLC/vlc.exe';
rmSync(target, { force: true });
const remux = spawnSync(VLC, ['-I', 'dummy', '--no-repeat', '--no-loop', '--play-and-exit', raw,
    `--sout=#std{access=file,mux=mp4,dst='${target}'}`, 'vlc://quit'], { encoding: 'utf8', timeout: 120000 });
if (!existsSync(target) || statSync(target).size < 1_000_000) {
    console.error(remux.error ?? remux.stderr?.slice(-2000));
    throw new Error(`VLC remux failed; the unindexed recording is kept at ${raw}`);
}
rmSync(raw, { force: true });
console.log(info, '->', target);
