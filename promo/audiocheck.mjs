// Visual and numeric check of out/music.wav: waveform, spectrogram, scene-cut markers, click scan.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const buf = readFileSync('out/music.wav'); const SR = buf.readUInt32LE(24); const N = (buf.length - 44) / 4;
const m = new Float32Array(N);
for (let i = 0; i < N; i++) m[i] = (buf.readInt16LE(44 + i * 4) + buf.readInt16LE(46 + i * 4)) / 65536;
// clicks: sample-to-sample jumps far above the local level
let clicks = []; for (let i = 1; i < N; i++) { const d = Math.abs(m[i] - m[i - 1]); if (d > 0.35) clicks.push((i / SR).toFixed(3)); }
console.log('large jumps:', clicks.length, clicks.slice(0, 12).join(' '));
let clip = 0; for (let i = 0; i < N; i++) if (Math.abs(m[i]) > 0.985) clip++; console.log('near-clip samples:', clip);
// spectrogram: 2048-pt FFT, hop 1024, 100 log-spaced bands 40 Hz - 16 kHz
const F = 2048, H = 1024, frames = Math.floor((N - F) / H), bands = 100;
const win = Float32Array.from({ length: F }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / F));
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k); const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c; re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } } }
const edges = Array.from({ length: bands + 1 }, (_, b) => Math.floor(40 * Math.pow(16000 / 40, b / bands) / SR * F));
const spec = [];
for (let f = 0; f < frames; f++) { const re = new Float64Array(F), im = new Float64Array(F); for (let i = 0; i < F; i++) re[i] = m[f * H + i] * win[i]; fft(re, im);
  const row = []; for (let b = 0; b < bands; b++) { let s = 0, c = 0; for (let k = edges[b]; k <= Math.max(edges[b], edges[b + 1] - 1); k++) { s += re[k] * re[k] + im[k] * im[k]; c++; } row.push(10 * Math.log10(s / c + 1e-12)); } spec.push(row); }
const env = []; const step = Math.floor(N / 1800); for (let x = 0; x < 1800; x++) { let mx = 0; for (let i = x * step; i < (x + 1) * step; i++) mx = Math.max(mx, Math.abs(m[i])); env.push(mx); }
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1900, height: 620 } });
await p.setContent('<body style="margin:0;background:#111"><canvas id=c width=1900 height=620></canvas></body>');
await p.evaluate(([spec, env, dur]) => {
  const g = document.getElementById('c').getContext('2d'); const X0 = 50, W = 1800;
  g.fillStyle = '#111'; g.fillRect(0, 0, 1900, 620);
  // waveform
  g.fillStyle = '#f97316'; env.forEach((v, x) => { const h = v * 90; g.fillRect(X0 + x, 110 - h, 1, 2 * h); });
  // spectrogram
  const fr = spec.length, bands = spec[0].length; const max = spec.reduce((a, r) => r.reduce((x, y) => Math.max(x, y), a), -1e9);
  for (let f = 0; f < fr; f++) for (let k = 0; k < bands; k++) { const v = Math.max(0, Math.min(1, (spec[f][k] - (max - 80)) / 80)); g.fillStyle = `hsl(${260 - v * 230},90%,${v * 60}%)`; g.fillRect(X0 + Math.floor(f / fr * W), 600 - (k + 1) * 4, Math.ceil(W / fr) + 1, 4); }
  // scene cuts
  g.strokeStyle = '#fff8'; g.fillStyle = '#fff'; g.font = '14px sans-serif';
  for (const t of [5, 14, 21, 28, 37, 42, 50, 55]) { const x = X0 + t / dur * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 620); g.stroke(); g.fillText(t + 's', x + 3, 14); }
}, [spec, env, N / SR]);
await p.screenshot({ path: 'shots/audio.png' }); await b.close();
