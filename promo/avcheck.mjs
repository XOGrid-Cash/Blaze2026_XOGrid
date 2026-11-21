// Compares the audio decoded from the MP4 with out/music.wav: offset (cross-correlation) and similarity.
import { readFileSync } from 'node:fs';
function mono(path) { const b = readFileSync(path); let o = 12; let fmt, data; while (o < b.length) { const id = b.toString('latin1', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12) }; if (id === 'data') { data = b.subarray(o + 8, o + 8 + Math.min(sz, b.length - o - 8)); break; } o += 8 + sz + (sz & 1); }
  const n = data.length / 2 / fmt.ch; const m = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2); m[i] = s / fmt.ch / 32768; } return { m, sr: fmt.sr }; }
const a = mono('out/music.wav'), b = mono(process.argv[2] ?? 'out/check/back.wav');
console.log('lengths', (a.m.length / a.sr).toFixed(2), (b.m.length / b.sr).toFixed(2));
// envelope at 1 kHz for a cheap correlation over +-500 ms
const env = (m) => { const out = []; for (let i = 0; i + 48 <= m.length; i += 48) { let s = 0; for (let j = 0; j < 48; j++) s += Math.abs(m[i + j]); out.push(s / 48); } return out; };
const ea = env(a.m), eb = env(b.m);
let best = { lag: 0, c: -1 };
for (let lag = -500; lag <= 500; lag++) { let s = 0, na = 0, nb = 0; for (let i = 1000; i < ea.length - 1000; i++) { const x = ea[i], y = eb[i + lag] ?? 0; s += x * y; na += x * x; nb += y * y; } const c = s / Math.sqrt(na * nb); if (c > best.c) best = { lag, c }; }
console.log(`best offset ${best.lag} ms, envelope correlation ${best.c.toFixed(4)}`);
