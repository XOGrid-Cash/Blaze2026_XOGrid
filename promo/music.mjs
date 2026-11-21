// Synthesizes an original 60-second background track for the promo (no samples, no licensing).
// 120 BPM, so every scene cut (5, 14, 21, 28, 37, 42, 55 s) lands on a beat. The drop hits at 50 s, when the
// mainnet transaction fades in (the explorer page loads behind black from about 48 s in the recorded take).
// Output: out/music.wav (48 kHz, 16-bit stereo).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SR = 48000, DUR = 60, N = SR * DUR;
const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4;
const L = new Float32Array(N), R = new Float32Array(N);
const padBus = [new Float32Array(N), new Float32Array(N)];   // ducked by the kick
const verbSend = new Float32Array(N);
const delaySend = new Float32Array(N);

// ---------- helpers ----------
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const add = (buf, i, v) => { if (i >= 0 && i < N) buf[i] += v; };
const pan = (i, v, p = 0, bufs = [L, R]) => { add(bufs[0], i, v * Math.cos((p + 1) * Math.PI / 4)); add(bufs[1], i, v * Math.sin((p + 1) * Math.PI / 4)); };

/** Section energy over time: which parts play and how loud. */
const sec = (t) =>
    t < 5 ? 'intro' : t < 14 ? 'a' : t < 37 ? 'b' : t < 42 ? 'break' : t < 50 ? 'build' : t < 55 ? 'drop' : 'outro';

// IV - V - iii - vi in C (Fmaj7, G6, Em7, Am7), one bar each, looping every 8 s.
const CHORDS = [
    { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
    { root: 43, notes: [55, 59, 62, 64] }, // G6
    { root: 40, notes: [52, 55, 59, 62] }, // Em7
    { root: 45, notes: [57, 60, 64, 67] }, // Am7
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % 4];

// ---------- instruments ----------
function pad(t0, dur, notes, gain) {
    const a = 0.6, r = 0.8;
    const n0 = Math.floor(t0 * SR), n1 = Math.floor((t0 + dur + r) * SR);
    for (const m of notes) for (const det of [-0.08, 0.08]) {
        const f = mtof(m + det);
        let ph = Math.random(), lp = 0;
        const p = det < 0 ? -0.5 : 0.5;
        for (let i = n0; i < n1; i++) {
            const t = (i - n0) / SR;
            const env = t < a ? t / a : t < dur ? 1 : Math.max(0, 1 - (t - dur) / r);
            ph += f / SR; ph -= Math.floor(ph);
            const saw = 2 * ph - 1;
            lp += 0.06 * (saw - lp); // soft lowpass
            const v = lp * env * gain;
            pan(i, v, p, padBus);
            verbSend[i] += v * 0.5;
        }
    }
}

function pluck(t0, m, gain, p = 0) {
    const f = mtof(m), len = 0.32;
    const n0 = Math.floor(t0 * SR), n1 = n0 + Math.floor(len * SR);
    let ph = 0, lp = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        ph += f / SR; ph -= Math.floor(ph);
        const sq = ph < 0.5 ? 1 : -1;
        const cut = 0.05 + 0.5 * Math.exp(-t * 22);
        lp += cut * (sq - lp);
        const v = lp * Math.exp(-t * 11) * gain;
        pan(i, v, p);
        delaySend[i] += v * 0.35;
        verbSend[i] += v * 0.25;
    }
}

function bass(t0, m, len, gain) {
    const f = mtof(m);
    const n0 = Math.floor(t0 * SR), n1 = n0 + Math.floor(len * SR);
    let ph = 0, lp = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        ph += f / SR; ph -= Math.floor(ph);
        const raw = Math.sin(2 * Math.PI * ph) * 0.8 + (2 * ph - 1) * 0.35;
        lp += 0.12 * (raw - lp);
        const env = Math.min(1, t / 0.005) * Math.min(1, (len - t) / 0.03) * (0.75 + 0.25 * Math.exp(-t * 8));
        const v = lp * env * gain;
        add(padBus[0], i, v); add(padBus[1], i, v);
    }
}

const kicks = [];
function kick(t0, gain = 1) {
    kicks.push(t0);
    const n0 = Math.floor(t0 * SR), n1 = n0 + Math.floor(0.45 * SR);
    let ph = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        const f = 45 + 110 * Math.exp(-t * 30);
        ph += f / SR;
        const v = (Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) + (t < 0.004 ? rnd() * 0.3 : 0)) * gain * 0.95;
        add(L, i, v); add(R, i, v);
    }
}

function clap(t0, gain = 1) {
    const n0 = Math.floor(t0 * SR), n1 = n0 + Math.floor(0.3 * SR);
    let bp1 = 0, bp2 = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        // three quick bursts then a tail, band-passed around 1.5 kHz
        const bursts = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.4) : 1;
        const x = rnd();
        bp1 += 0.25 * (x - bp1); bp2 += 0.25 * (bp1 - bp2);
        const band = bp1 - bp2;
        const v = band * bursts * Math.exp(-t * 18) * gain * 1.8;
        pan(i, v, 0.05);
        verbSend[i] += v * 0.35;
    }
}

function hat(t0, gain = 1, open = false) {
    const len = open ? 0.18 : 0.05;
    const n0 = Math.floor(t0 * SR), n1 = n0 + Math.floor(len * SR);
    let prev = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        const x = rnd(); const hp = x - prev; prev = x;
        const v = hp * Math.exp(-t * (open ? 22 : 80)) * gain * 0.22;
        pan(i, v, 0.3);
    }
}

function riser(t0, t1, gain) {
    const n0 = Math.floor(t0 * SR), n1 = Math.floor(t1 * SR);
    let lp = 0, ph = 0;
    for (let i = n0; i < n1; i++) {
        const k = (i - n0) / (n1 - n0);
        const cut = 0.01 + 0.35 * k * k;
        lp += cut * (rnd() - lp);
        ph += (200 + 1400 * k * k) / SR;
        const v = (lp * 0.9 + Math.sin(2 * Math.PI * ph) * 0.08) * k * k * gain;
        pan(i, v, Math.sin(k * 12) * 0.4);
        verbSend[i] += v * 0.3;
    }
}

function crash(t0, gain) {
    const n0 = Math.floor(t0 * SR), n1 = n0 + Math.floor(2.4 * SR);
    let prev = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        const x = rnd(); const hp = x - prev; prev = x;
        const v = hp * Math.exp(-t * 2.2) * gain * 0.3;
        add(L, i, v * (0.9 + 0.1 * rnd())); add(R, i, v * (0.9 + 0.1 * rnd()));
        verbSend[i] += v * 0.2;
    }
}

function impact(t0, gain) { kick(t0, gain); crash(t0, gain * 0.9); }

// ---------- arrangement ----------
const bars = Math.ceil(DUR / BAR);
for (let b = 0; b < bars; b++) {
    const tb = b * BAR;
    const ch = CHORDS[b % 4];
    const s = sec(tb + 0.01);
    // pads everywhere, quieter in the intro and outro
    const padGain = { intro: 0.05, a: 0.045, b: 0.045, break: 0.06, build: 0.05, drop: 0.05, outro: 0.06 }[s];
    pad(tb, BAR, ch.notes, padGain);
}

// beat-level parts
for (let k = 0; k * BEAT < DUR; k++) {
    const t = k * BEAT, s = sec(t + 0.001);
    const beatInBar = k % 4;
    const ch = chordAt(t);

    // kick: four on the floor in the groove, half-time in "a", absent in intro/break
    if (s === 'b' || s === 'drop') kick(t, s === 'drop' ? 1 : 0.9);
    if (s === 'a' && beatInBar % 2 === 0) kick(t, 0.85);
    if (s === 'build' && beatInBar === 0) kick(t, 0.85);

    // clap on 2 and 4
    if ((s === 'b' || s === 'drop') && beatInBar % 2 === 1) clap(t, s === 'drop' ? 1 : 0.85);
    if (s === 'a' && beatInBar === 3 && Math.floor(k / 4) % 2 === 1) clap(t, 0.7);

    // hats: off-beat 8ths, plus 16ths in the drop
    if (s === 'b' || s === 'drop' || s === 'build') hat(t + BEAT / 2, 0.9, s === 'drop');
    if (s === 'drop') { hat(t + S16, 0.45); hat(t + 3 * S16, 0.45); }
    if (s === 'a' || s === 'break') hat(t + BEAT / 2, 0.6);

    // bass: driving 8ths on the root
    if (s === 'b' || s === 'drop' || s === 'build' || s === 'a') {
        const g = s === 'a' ? 0.28 : 0.34;
        bass(t, ch.root - 12 + 12, BEAT / 2 * 0.9, g);
        bass(t + BEAT / 2, ch.root + (beatInBar === 3 ? 7 : 0), BEAT / 2 * 0.9, g * 0.9);
    }
}

// arpeggio: 16ths over chord tones, two octaves; sparse in the intro, full in groove and drop
const ARP = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
for (let k = 0; k * S16 < DUR; k++) {
    const t = k * S16, s = sec(t + 0.001);
    const ch = chordAt(t);
    const step = k % 16;
    const note = ch.notes[ARP[step]] + (step >= 8 ? 12 : 0) + 12;
    const p = step % 2 ? 0.35 : -0.35;
    if (s === 'intro' && k % 2 === 0 && t > 0.5) pluck(t, note, 0.10 * Math.min(1, t / 3), p);
    else if (s === 'a' && k % 2 === 0) pluck(t, note, 0.11, p);
    else if (s === 'b' || s === 'drop') pluck(t, note, s === 'drop' ? 0.13 : 0.11, p);
    else if (s === 'break' && k % 2 === 0) pluck(t, note, 0.1, p);
    else if (s === 'build') pluck(t, note, 0.07 + 0.06 * ((t - 42) / 8), p);
}

// melody hook in the drop: a simple rising motif, one note per beat
const HOOK = [76, 79, 81, 79, 76, 74, 72, 74, 76, 79, 84, 83, 81, 79, 76, 79];
for (let k = 0; k < 10; k++) {
    const t = 50 + k * BEAT;
    if (t < 55) pluck(t, HOOK[k % HOOK.length], 0.12, 0);
}

// build-up: snare roll accelerating into the drop
for (let i = 0; i < 24; i++) {
    const k = i / 24;
    const t = 47 + 3 * (1 - Math.pow(1 - k, 1.6));
    clap(t, 0.25 + 0.6 * k);
}
riser(2.5, 5, 0.35);
riser(46, 50, 0.45);
riser(12.5, 14, 0.12);
riser(35.5, 37, 0.12);
impact(5, 0.9);
impact(14, 0.5);
impact(28, 0.45);
impact(50, 1);
impact(55, 0.9);

// outro: final chord sustains under the end card
pad(55, 4.2, [53, 57, 60, 64, 69], 0.05);
bass(55, 41, 3.5, 0.3);
for (let i = 0; i < 8; i++) pluck(55 + i * BEAT / 2, [72, 76, 79, 84][i % 4] + (i >= 4 ? 12 : 0), 0.09 * (1 - i / 9), i % 2 ? 0.4 : -0.4);

// ---------- mixing ----------
// sidechain: duck the pad/bass bus after each kick
kicks.sort((a, b) => a - b);
let ki = 0;
for (let i = 0; i < N; i++) {
    const t = i / SR;
    while (ki + 1 < kicks.length && kicks[ki + 1] <= t) ki++;
    const since = kicks.length && kicks[ki] <= t ? t - kicks[ki] : 9;
    const duck = 1 - 0.55 * Math.exp(-since * 9);
    L[i] += padBus[0][i] * duck;
    R[i] += padBus[1][i] * duck;
}

// stereo ping-pong delay (dotted 8th)
const dly = Math.floor(BEAT * 0.75 * SR);
const dl = new Float32Array(N), dr = new Float32Array(N);
for (let i = 0; i < N; i++) {
    const inp = delaySend[i];
    dl[i] = inp + (i >= dly ? dr[i - dly] * 0.45 : 0);
    dr[i] = (i >= dly ? dl[i - dly] : 0);
    L[i] += dl[i] * 0.5; R[i] += dr[i] * 0.5;
}

// small Schroeder reverb
const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ d: Math.floor(d * SR / 44100), buf: null, lp: 0 }));
const aps = [225, 556, 441].map((d) => Math.floor(d * SR / 44100));
const wet = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < combs.length; c++) {
    const { d } = combs[c];
    const buf = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {
        const y = i >= d ? buf[i - d] : 0;
        lp += 0.35 * (y - lp);
        buf[i] = verbSend[i] + lp * 0.8;
        wet[c % 2][i] += y;
    }
}
for (const w of wet) for (const d of aps) {
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) { const del = i >= d ? out[i - d] : 0; const xin = w[i]; const xd = i >= d ? w[i - d] : 0; out[i] = -0.5 * xin + xd + 0.5 * del; }
    w.set(out);
}
for (let i = 0; i < N; i++) { L[i] += wet[0][i] * 0.09; R[i] += wet[1][i] * 0.09; }

// master: highpass DC, gentle saturation, normalize, fades
let hl = 0, hr = 0, pl = 0, pr = 0;
for (let i = 0; i < N; i++) {
    hl = 0.9995 * (hl + L[i] - pl); pl = L[i]; L[i] = hl;
    hr = 0.9995 * (hr + R[i] - pr); pr = R[i]; R[i] = hr;
}
// Drive the saturator by the raw peak, so only transients are gently rounded (raw peak lands at tanh(1.3)).
// Lift the quiet sections (intro, breakdown, outro) so the contrast stays musical, with smooth 0.5 s ramps.
const lift = [[0, 1.7], [4.5, 1.7], [5, 1], [36.5, 1], [37, 1.8], [41.5, 1.8], [42, 1], [54.5, 1], [55, 1.3], [60, 1.3]];
const liftAt = (t) => { for (let j = 1; j < lift.length; j++) if (t <= lift[j][0]) { const [a, ga] = lift[j - 1], [b, gb] = lift[j]; return ga + (gb - ga) * ((t - a) / (b - a || 1)); } return 1; };
for (let i = 0; i < N; i++) { const g = liftAt(i / SR); L[i] *= g; R[i] *= g; }
// Drive the saturator from the 99.9th-percentile level, so only the rare loud transients get rounded off.
const mags = new Float32Array(N);
for (let i = 0; i < N; i++) mags[i] = Math.max(Math.abs(L[i]), Math.abs(R[i]));
const sorted = mags.slice().sort();
const raw = sorted[N - 1], p999 = sorted[Math.floor(N * 0.999)];
const drive = 1.1 / p999;
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * drive); R[i] = Math.tanh(R[i] * drive); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = 0.89 / peak; // about -1 dBFS
const fadeIn = 0.05 * SR, fadeOut = 2.0 * SR;
for (let i = 0; i < N; i++) {
    let g = norm;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > N - fadeOut) g *= Math.pow((N - i) / fadeOut, 1.5);
    L[i] *= g; R[i] *= g;
}

// ---------- write WAV ----------
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
    out.writeInt16LE(Math.round(clamp(L[i], -1, 1) * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(clamp(R[i], -1, 1) * 32767), 46 + i * 4);
}
mkdirSync(resolve(here, 'out'), { recursive: true });
writeFileSync(resolve(here, 'out/music.wav'), out);

// level report per section, so a take can be checked without listening
const rms = (a, b) => { let s = 0; for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / ((b - a) * SR * 2)); };
const db = (x) => (20 * Math.log10(x)).toFixed(1);
console.log('raw peak', raw.toFixed(2), 'p99.9', p999.toFixed(2), 'drive', drive.toFixed(2));
for (const [a, b, n] of [[0, 5, 'intro'], [5, 14, 'a'], [14, 37, 'b'], [37, 42, 'break'], [42, 50, 'build'], [50, 55, 'drop'], [55, 60, 'outro']]) console.log(`${n.padEnd(6)} ${a}-${b}s  RMS ${db(rms(a, b))} dBFS`);
