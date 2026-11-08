#!/usr/bin/env node
// Composites the layered icon into one image, the way the system would: the background
// square with the foreground on top, then a rounded-rectangle mask.
//
// Usage: node tools/preview-icon.mjs <outDir> [previewFile]

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const DIR = path.resolve(process.argv[2] || 'out')
const OUT = path.resolve(process.argv[3] || 'preview.png')
const SIZE = 1024
const VIEW = 256

function readPng(file) {
  const d = fs.readFileSync(file)
  let pos = 8
  let w = 0, h = 0
  const idat = []
  while (pos < d.length) {
    const len = d.readUInt32BE(pos)
    const type = d.toString('ascii', pos + 4, pos + 8)
    const data = d.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const px = Buffer.alloc(stride * h)
  let prev = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]
    const line = Buffer.from(raw.subarray(p, p + stride))
    p += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0
      const b = prev[i]
      const c = i >= 4 ? prev[i - 4] : 0
      if (filter === 1) line[i] = (line[i] + a) & 255
      else if (filter === 2) line[i] = (line[i] + b) & 255
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p0 = a + b - c
        const pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    line.copy(px, y * stride)
    prev = line
  }
  return { w, h, px }
}

function writePng(file, w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

const bg = readPng(path.join(DIR, 'background.png'))
const fg = readPng(path.join(DIR, 'foreground.png'))

// Composite, then mask with a rounded square (the shape HarmonyOS uses for a layered icon).
const comp = Buffer.from(bg.px)
for (let i = 0; i < comp.length; i += 4) {
  const a = fg.px[i + 3] / 255
  for (let k = 0; k < 3; k++) comp[i + k] = Math.round(comp[i + k] * (1 - a) + fg.px[i + k] * a)
}

const radius = SIZE * 0.22
const inside = (x, y) => {
  const cx = Math.min(Math.max(x, radius), SIZE - radius)
  const cy = Math.min(Math.max(y, radius), SIZE - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

// Scale down for viewing.
const out = Buffer.alloc(VIEW * VIEW * 4)
for (let y = 0; y < VIEW; y++) {
  for (let x = 0; x < VIEW; x++) {
    const sx = Math.floor(x * SIZE / VIEW)
    const sy = Math.floor(y * SIZE / VIEW)
    const si = (sy * SIZE + sx) * 4
    const di = (y * VIEW + x) * 4
    out[di] = comp[si]; out[di + 1] = comp[si + 1]; out[di + 2] = comp[si + 2]
    out[di + 3] = inside(sx, sy) ? 255 : 0
  }
}
writePng(OUT, VIEW, VIEW, out)
console.log('预览已生成:', OUT)
