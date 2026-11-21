// Plays a video from the start in Edge (no seeking) and grabs a frame each time playback passes one of the given times.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';
const file = resolve(process.argv[2]); const times = process.argv[3].split(',').map(Number);
const html = resolve(dirname(file), 'play.html');
writeFileSync(html, `<body style="margin:0;background:#000"><video id=v muted playsinline src="${basename(file)}"></video><canvas id=c></canvas></body>`);
const b = await chromium.launch({ channel: 'msedge' }); const p = await b.newPage({ viewport: { width: 2560, height: 1500 } });
await p.goto(pathToFileURL(html).href);
await p.evaluate(async (times) => {
  const v = document.getElementById('v'), c = document.getElementById('c'); v.style.display = 'none';
  const cols = 4, tw = 640, th = 360; c.width = cols * tw; c.height = Math.ceil(times.length / cols) * th; const g = c.getContext('2d');
  await new Promise((r) => (v.readyState >= 2 ? r() : (v.onloadeddata = r)));
  let i = 0;
  await new Promise((done) => {
    const cb = (_, meta) => { while (i < times.length && meta.mediaTime >= times[i]) { const x = (i % cols) * tw, y = Math.floor(i / cols) * th; g.drawImage(v, x, y, tw, th); g.fillStyle = '#ff0'; g.font = 'bold 28px sans-serif'; g.fillText(meta.mediaTime.toFixed(2) + 's', x + 8, y + 32); i++; }
      if (i >= times.length || v.ended) done(); else v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb); v.play();
  });
}, times);
await p.locator('#c').screenshot({ path: 'shots/play.png' }); await b.close(); console.log('shots/play.png');
