// Contact sheets of a recorded video (one frame every `step` seconds), drawn in Chromium so no ffmpeg is needed.
// Usage: node frames.mjs [video] [step] [from] [to]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

const file = resolve(process.argv[2] ?? 'out/xogrid-promo.webm');
const step = Number(process.argv[3] ?? 1), from = Number(process.argv[4] ?? 0), to = Number(process.argv[5] ?? 61);
const cols = 4, tw = 640, th = 360, per = 16;

const html = resolve(dirname(file), 'frames.html');
writeFileSync(html, `<body style="margin:0;background:#000"><video id=v muted preload=auto src="${basename(file)}"></video><canvas id=c></canvas></body>`);

const b = await chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
const p = await b.newPage({ viewport: { width: cols * tw, height: 400 } });
p.setDefaultTimeout(15000);
await p.goto(pathToFileURL(html).href);
const state = await p.evaluate(() => new Promise((r) => {
    const v = document.getElementById('v');
    const done = () => r({ ready: v.readyState, dur: v.duration, err: v.error && v.error.code });
    if (v.readyState >= 2) done(); else { v.onloadeddata = done; v.onerror = done; setTimeout(done, 8000); }
}));
console.log('video', state);

const times = [];
for (let t = from; t <= to + 1e-9; t += step) times.push(+t.toFixed(2));

for (let s = 0; s < times.length; s += per) {
    const chunk = times.slice(s, s + per);
    const rows = Math.ceil(chunk.length / cols);
    await p.setViewportSize({ width: cols * tw, height: rows * th });
    const got = await p.evaluate(async ([chunk, cols, tw, th]) => {
        const v = document.getElementById('v'), c = document.getElementById('c');
        v.style.display = 'none';
        c.width = cols * tw; c.height = Math.ceil(chunk.length / cols) * th;
        const g = c.getContext('2d');
        let n = 0;
        for (let i = 0; i < chunk.length; i++) {
            const ok = await new Promise((r) => { const t = setTimeout(() => r(false), 3000); v.onseeked = () => { clearTimeout(t); r(true); }; v.currentTime = chunk[i]; });
            if (!ok) break;
            const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
            g.drawImage(v, x, y, tw, th);
            g.fillStyle = '#ff0'; g.font = 'bold 28px sans-serif'; g.fillText(chunk[i].toFixed(1) + 's', x + 8, y + 32);
            n++;
        }
        return n;
    }, [chunk, cols, tw, th]);
    if (!got) break;
    const out = resolve(dirname(file), `../shots/sheet-${String(s / per).padStart(2, '0')}.png`);
    await p.locator('#c').screenshot({ path: out });
    console.log(out, chunk[0], '-', chunk[got - 1]);
    if (got < chunk.length) break;
}
await b.close();
