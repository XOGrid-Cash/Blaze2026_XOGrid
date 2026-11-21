// Prints each track's type, codec and duration from an MP4's boxes.
import { readFileSync } from 'node:fs';
const b = readFileSync(process.argv[2]);
const out = [];
function walk(s, e, path) {
  for (let i = s; i + 8 <= e;) {
    let size = b.readUInt32BE(i); const type = b.toString('latin1', i + 4, i + 8); let hdr = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(i + 8)); hdr = 16; } if (size === 0) size = e - i;
    const p = path + '/' + type;
    if (type === 'mvhd') { const v = b[i + hdr]; const ts = b.readUInt32BE(i + hdr + (v ? 20 : 12)); const d = v ? Number(b.readBigUInt64BE(i + hdr + 24)) : b.readUInt32BE(i + hdr + 16); out.push(`movie ${(d / ts).toFixed(2)}s`); }
    if (type === 'mdhd') { const v = b[i + hdr]; const ts = b.readUInt32BE(i + hdr + (v ? 20 : 12)); const d = v ? Number(b.readBigUInt64BE(i + hdr + 24)) : b.readUInt32BE(i + hdr + 16); out.push(`  track ${(d / ts).toFixed(2)}s @${ts}`); }
    if (type === 'hdlr') out.push(`  handler ${b.toString('latin1', i + hdr + 8, i + hdr + 12)}`);
    if (type === 'stsd') out.push(`  codec ${b.toString('latin1', i + hdr + 12, i + hdr + 16)}`);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(i + hdr, i + size, p);
    i += size;
  }
}
walk(0, b.length, '');
console.log(out.join('\n'));
