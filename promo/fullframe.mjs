import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const t = Number(process.argv[2]);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(pathToFileURL(resolve('out/frames.html')).href);
await p.evaluate(async (t) => { const v = document.getElementById('v'); v.style.cssText='display:block;width:1920px;height:1080px'; await new Promise(r => { v.onseeked = r; v.currentTime = t; }); }, t);
await p.screenshot({ path: `shots/full-${t}.png` }); await b.close();
