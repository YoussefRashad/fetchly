// Writes the app icon for the portable exe as a 256x256 PNG, so the project carries no binary asset
// (the tray icon is drawn in code for the same reason, see trayIconBitmap in src/main/shellText.ts).
// The shape is the tray icon's, on its 32-unit grid: a down arrow over a tray line, drawn as smooth
// shapes (4x4 samples per pixel), white on the accent colour, on a rounded square.
//   node scripts/app-icon.mjs <out.png>
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const UNIT = SIZE / 32;
const RADIUS = 48;
const SAMPLES = 4;
const ACCENT = [0x1f, 0x6f, 0xeb]; // --accent of the light theme
const WHITE = [0xff, 0xff, 0xff];

/** True when point (u, v), in units of the 32-unit grid, is on the arrow or the tray line. */
function inShape(u, v) {
  if (u >= 13 && u < 19 && v >= 3 && v < 16) return true; // shaft
  // Head: a triangle from (7, 15)-(25, 15) down to its tip at (16, 24).
  if (v >= 15 && v <= 24 && Math.abs(u - 16) <= 9 - (v - 15)) return true;
  return u >= 5 && u < 27 && v >= 26 && v < 29; // tray line
}

/** True when point (x, y), in pixels, is inside the rounded square. */
function inSquare(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

// One filter byte (0, none) per row, then RGBA pixels. Colour is mixed from the samples on the
// shape and off it; alpha is the share of samples inside the square.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (1 + SIZE * 4);
  for (let x = 0; x < SIZE; x += 1) {
    let inside = 0;
    let white = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;
        if (!inSquare(px, py)) continue;
        inside += 1;
        if (inShape(px / UNIT, py / UNIT)) white += 1;
      }
    }
    if (inside === 0) continue; // stays transparent
    const mix = (i) => Math.round((WHITE[i] * white + ACCENT[i] * (inside - white)) / inside);
    raw.set([mix(0), mix(1), mix(2), Math.round((inside / SAMPLES ** 2) * 0xff)], rowStart + 1 + x * 4);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive filtering, no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2];
if (!out) {
  process.stderr.write('usage: node scripts/app-icon.mjs <out.png>\n');
  process.exit(2);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
process.stdout.write(`wrote ${out} (${png.length} bytes)\n`);
