'use strict';

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x7e, 0xc3, 0xef, 255];
const BODY = [0xf5, 0xcf, 0x3b, 255];
const EYE = [255, 255, 255, 255];
const PUPIL = [0x33, 0x33, 0x33, 255];
const BEAK = [0xf0, 0x7f, 0x2e, 255];

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function renderPNG(size) {
  const cx = size / 2;
  const cy = size * 0.48;
  const r = size * 0.30;
  const shapes = [
    { type: 'circle', x: cx, y: cy, r: r, c: BODY },
    { type: 'circle', x: cx + r * 0.5, y: cy - r * 0.2, r: r * 0.55, c: BODY },
    { type: 'circle', x: cx + r * 0.9, y: cy - r * 0.4, r: r * 0.3, c: BODY },
    { type: 'circle', x: cx + r * 0.55, y: cy - r * 0.55, r: r * 0.22, c: EYE },
    { type: 'circle', x: cx + r * 0.62, y: cy - r * 0.52, r: r * 0.10, c: PUPIL },
    { type: 'tri', pts: [
      [cx + r * 0.62, cy - r * 0.38],
      [cx + r * 1.15, cy - r * 0.42],
      [cx + r * 0.62, cy - r * 0.22]
    ], c: BEAK }
  ];

  function inCircle(px, py, s) {
    const dx = px - s.x;
    const dy = py - s.y;
    return dx * dx + dy * dy <= s.r * s.r;
  }

  function sign(ax, ay, bx, by, cx, cy) {
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  }

  function inTri(px, py, s) {
    const a = s.pts[0], b = s.pts[1], c = s.pts[2];
    const d1 = sign(px, py, a[0], a[1], b[0], b[1]);
    const d2 = sign(px, py, b[0], b[1], c[0], c[1]);
    const d3 = sign(px, py, c[0], c[1], a[0], a[1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      let col = BG;
      for (const s of shapes) {
        const hit = s.type === 'circle' ? inCircle(x, y, s) : inTri(x, y, s);
        if (hit) col = s.c;
      }
      const o = 1 + x * 4;
      row[o] = col[0];
      row[o + 1] = col[1];
      row[o + 2] = col[2];
      row[o + 3] = col[3];
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return png;
}

for (const size of [192, 512]) {
  writeFileSync(process.cwd() + '/icon-' + size + '.png', renderPNG(size));
  console.log('wrote icon-' + size + '.png');
}