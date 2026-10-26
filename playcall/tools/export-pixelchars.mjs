// 匯出 HD-2D 點陣角色 sprite sheet：node playcall/tools/export-pixelchars.mjs
// 輸出 art/hd2d/{id}.png（12 列 × 6 欄）與 art/hd2d/sheets.json（格子尺寸、動作順序、持球手座標）
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { renderSheet, CELL_W, CELL_H, FRAMES, ANIMS, DIRS } from '../src/render/pixelchar.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'art', 'hd2d');

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json')));
fs.mkdirSync(outDir, { recursive: true });
const meta = { cellW: CELL_W, cellH: CELL_H, frames: FRAMES, anims: ANIMS, dirs: DIRS, hands: {} };
// 有照片頭（art/portraits/{id}_head.json，由 photo2pixel.py 產生）就另外輸出一份照片頭版本到
// art/portraits/hd2d/（照片有肖像權，該資料夾不提交）；遊戲會優先讀照片頭版本。
const photoDir = path.join(root, 'art', 'portraits');
const photoOut = path.join(photoDir, 'hd2d');
for (const team of data.teams)
  for (const p of team.players) {
    const s = renderSheet(p, team.colors);
    fs.writeFileSync(path.join(outDir, `${p.id}.png`), png(s.width, s.height, s.data));
    meta.hands[p.id] = s.hands;
    const headFile = path.join(photoDir, `${p.id}_head.json`);
    if (fs.existsSync(headFile)) {
      const h = JSON.parse(fs.readFileSync(headFile));
      const head = { ...h, data: new Uint8Array(Buffer.from(h.data, 'base64')) };
      const ps = renderSheet(p, team.colors, head);
      fs.mkdirSync(photoOut, { recursive: true });
      fs.writeFileSync(path.join(photoOut, `${p.id}.png`), png(ps.width, ps.height, ps.data));
      console.log(`  ${p.id}: photo head version`);
    }
  }
fs.writeFileSync(path.join(outDir, 'sheets.json'), JSON.stringify(meta) + '\n');
console.log(`exported ${Object.keys(meta.hands).length} sheets to ${path.relative(process.cwd(), outDir)}`);
