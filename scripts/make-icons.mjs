#!/usr/bin/env node
//
// Generates the app icons: node scripts/make-icons.mjs
//
// A record on the app's background colour, matching the card. Written by hand
// as PNG rather than pulled from a design tool so the icons can be regenerated
// from source and the repo stays free of binary assets nobody can edit.
//
// Only run when the icon design changes. The output is committed.

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- minimal PNG writer ------------------------------------------------------

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  // Each scanline is prefixed with a filter byte; 0 means no filtering.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the icon itself ---------------------------------------------------------

const BACKGROUND = [0x0d, 0x0f, 0x14];
const DISC = [0x14, 0x16, 0x1d];
const GROOVE = [0x19, 0x1c, 0x25];
const LABEL = [0x1d, 0xb9, 0x54];

// Maskable icons can be cropped to a circle of 80% of the width, so the record
// has to stay inside that. 0.38 of the size as a radius leaves a little room.
const DISC_RADIUS = 0.38;
const LABEL_RADIUS = 0.15;
const HOLE_RADIUS = 0.022;
const SAMPLES = 3;   // per axis, to keep the circle edges smooth

function render(size) {
  const centre = size / 2;
  const rDisc = size * DISC_RADIUS;
  const rLabel = size * LABEL_RADIUS;
  const rHole = size * HOLE_RADIUS;
  const grooveWidth = size * 0.012;

  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const dx = x + (sx + 0.5) / SAMPLES - centre;
          const dy = y + (sy + 0.5) / SAMPLES - centre;
          const distance = Math.hypot(dx, dy);

          let colour;
          if (distance > rDisc) colour = BACKGROUND;
          else if (distance < rHole) colour = BACKGROUND;
          else if (distance < rLabel) colour = LABEL;
          else colour = Math.floor(distance / grooveWidth) % 2 ? GROOVE : DISC;

          r += colour[0]; g += colour[1]; b += colour[2];
        }
      }

      const n = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = 255;
    }
  }

  return encodePng(size, pixels);
}

await mkdir(path.join(ROOT, 'icons'), { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(ROOT, 'icons', `icon-${size}.png`);
  const png = render(size);
  await writeFile(file, png);
  console.log(`icons/icon-${size}.png  ${png.length} bytes`);
}
