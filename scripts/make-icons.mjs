// Generates extension/icons/icon-{16,32,48,128}.png with no dependencies.
// The icon is a rounded square with three list rows; the middle one is indented
// (an environment nested under its production app).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../extension/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [24, 24, 27];
const ROW = [250, 250, 250];
const ACCENT = [96, 165, 250];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in a 0..1 unit square.
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const rows = [
  { x0: 0.22, x1: 0.78, y: 0.30, color: ROW },
  { x0: 0.36, x1: 0.78, y: 0.50, color: ACCENT },
  { x0: 0.22, x1: 0.78, y: 0.70, color: ROW },
];

function shade(u, v) {
  if (!inRoundRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) return null;
  for (const r of rows) {
    if (inRoundRect(u, v, r.x0, r.y - 0.06, r.x1, r.y + 0.06, 0.06)) return r.color;
  }
  return BG;
}

for (const size of [16, 32, 48, 128]) {
  const S = 4; // supersampling for anti-aliasing
  const buf = png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const c = shade((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    if (!a) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (S * S)) * 255)];
  });
  writeFileSync(new URL(`icon-${size}.png`, OUT), buf);
}
console.log('icons written to extension/icons/');
