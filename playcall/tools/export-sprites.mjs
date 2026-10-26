// 把程式拼裝的 sprite sheet 匯出成 PNG：node playcall/tools/export-sprites.mjs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { renderSheet, CELL_W, CELL_H, ANIMS } from '../src/render/sprites.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'art', 'sprites');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json')));
fs.mkdirSync(outDir, { recursive: true });
for (const team of data.teams)
  for (const p of team.players) {
    const s = renderSheet(p, team.colors);
    fs.writeFileSync(path.join(outDir, `${p.id}.png`), encodePNG(s.width, s.height, s.data));
  }
fs.writeFileSync(
  path.join(outDir, 'sheet.json'),
  JSON.stringify({ cellW: CELL_W, cellH: CELL_H, anims: ANIMS }, null, 2) + '\n'
);
console.log(`exported to ${path.relative(process.cwd(), outDir)}`);
