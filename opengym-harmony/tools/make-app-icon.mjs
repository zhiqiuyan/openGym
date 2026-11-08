#!/usr/bin/env node
// Draws the HarmonyOS app icon: the layered foreground and the background.
//
// The layered icon has two parts. The background is the full 1024×1024 square the system
// masks. The foreground is drawn inside the 288×288 safe circle in the middle — anything
// outside it can be cropped away by the system's mask.
//
// The glyph is the project's barbell, the same one the web app uses as its icon
// (frontend/resources/icon.svg), so the phone, the PWA and the website show one mark.
//
// Usage: node tools/make-app-icon.mjs [outDir]
//        outDir defaults to AppScope/resources/base/media

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MEDIA = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'AppScope/resources/base/media')

const SIZE = 1024
const DARK = [0x0c, 0x0e, 0x12]
const LIME = [0xa3, 0xe6, 0x35]

// The glyph's rectangles, in the 512 grid of frontend/resources/icon.svg.
const GLYPH = [
  { x: 80, y: 242, w: 352, h: 28 },   // the bar
  { x: 80, y: 199, w: 36, h: 114 },   // the outer plate, left
  { x: 131, y: 169, w: 47, h: 174 },  // the inner plate, left
  { x: 334, y: 169, w: 47, h: 174 },  // the inner plate, right
  { x: 396, y: 199, w: 36, h: 114 },  // the outer plate, right
]

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

/** A PNG: 8-bit RGBA, no interlacing. */
function writePng(file, width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0          // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
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
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // colour type: RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

/** The background: a deep gradient, so the icon does not read as a flat square. */
function drawBackground() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // A soft light from the top left, the way the app's dark surfaces are lit.
      const d = Math.hypot(x - SIZE * 0.32, y - SIZE * 0.28) / (SIZE * 0.95)
      const lift = Math.max(0, 1 - d) * 0.16
      const i = (y * SIZE + x) * 4
      px[i] = Math.round(DARK[0] + lift * 44)
      px[i + 1] = Math.round(DARK[1] + lift * 52)
      px[i + 2] = Math.round(DARK[2] + lift * 62)
      px[i + 3] = 255
    }
  }
  return px
}

/** The foreground: the barbell glyph, transparent everywhere else, inside the safe area. */
function drawForeground() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  // The glyph is drawn in the 512 grid and scaled up. It is centred and scaled to fill
  // the 288×288 safe circle with a little room around it.
  const safe = 288
  // The glyph fills most of the safe circle: the system's mask crops to it, and a small
  // glyph reads as a speck on a home screen.
  const scale = (safe / 512) * 2.0
  const glyphSize = 512 * scale
  const offset = (SIZE - glyphSize) / 2

  const inGlyph = (gx, gy) => {
    for (const r of GLYPH) {
      if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h) return r
    }
    return null
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      const gx = (x - offset) / scale
      const gy = (y - offset) / scale
      const r = inGlyph(gx, gy)
      if (!r) continue
      // The bar is a shade darker than the plates, so the shape reads as a barbell and
      // not as a row of blocks.
      const onBar = r.y === 242 && r.h === 28
      const c = onBar ? LIME : [0xbe, 0xf0, 0x5e]
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]
      px[i + 3] = 255
    }
  }
  return px
}

fs.mkdirSync(MEDIA, { recursive: true })
const bg = drawBackground()
const fg = drawForeground()
writePng(path.join(MEDIA, 'background.png'), SIZE, SIZE, bg)
writePng(path.join(MEDIA, 'foreground.png'), SIZE, SIZE, fg)

// The ability's own icon is a single image, and that is the one the launcher shows.
// The layered pair is what the system masks into the app's own shape, so the plain
// icon is the same mark with the background already behind it.
const merged = Buffer.from(bg)
for (let i = 0; i < merged.length; i += 4) {
  const a = fg[i + 3] / 255
  for (let k = 0; k < 3; k++) merged[i + k] = Math.round(merged[i + k] * (1 - a) + fg[i + k] * a)
  merged[i + 3] = 255
}
writePng(path.join(MEDIA, 'app_icon.png'), SIZE, SIZE, merged)

console.log(`已生成 ${path.relative(process.cwd(), MEDIA)}/{background,foreground,app_icon}.png`)
console.log(`  尺寸 ${SIZE}×${SIZE}，前景图形在中央 ${288}×${288} 安全区内`)
