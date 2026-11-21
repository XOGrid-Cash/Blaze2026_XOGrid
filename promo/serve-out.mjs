// Serves promo/out on http://localhost:5191 (with byte ranges) so a browser can play and check the exports.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, normalize } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
const types = { '.html': 'text/html', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav' };
createServer((req, res) => {
  const file = normalize(resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  let st; try { st = statSync(file); } catch { return res.writeHead(404).end(); }
  if (!st.isFile()) return res.writeHead(404).end();
  const type = types[extname(file)] ?? 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) { const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
    return createReadStream(file, { start: a, end: b }).pipe(res); }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
  createReadStream(file).pipe(res);
}).listen(5191, () => console.log('promo/out on http://localhost:5191'));
