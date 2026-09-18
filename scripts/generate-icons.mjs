/**
 * Generates the PWA icons with no image dependencies at all.
 *
 * The icon is flat geometry (a rounded square plus three bars), so rasterising it
 * by hand and writing the PNG with Node's built-in zlib is far cheaper than pulling
 * in sharp — which also drags along libvips/libheif CVEs for what amounts to four
 * static files.
 *
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [11, 13, 16, 255] // --bg
const ACCENT = [74, 222, 128, 255] // --accent
const DIM = [43, 51, 63, 255] // --border

// ---------- PNG encoding ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba: Uint8Array of size*size*4 */
function encodePNG(size, rgba) {
  const stride = size * 4
  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- geometry ----------

/** Signed coverage test for an axis-aligned rounded rect. */
function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function blend(dst, i, color, a) {
  const inv = 1 - a
  dst[i] = color[0] * a + dst[i] * inv
  dst[i + 1] = color[1] * a + dst[i + 1] * inv
  dst[i + 2] = color[2] * a + dst[i + 2] * inv
  dst[i + 3] = Math.max(dst[i + 3], color[3] * a)
}

/**
 * Draws the icon. `bleed` = true fills the whole canvas with the background
 * (for apple-touch-icon and the maskable variant, where the platform applies its
 * own mask and transparent corners would show as black);
 * `bleed` = false rounds the corners itself.
 */
function draw(size, { bleed, inset }) {
  const px = new Uint8Array(size * size * 4)
  const SS = 3 // 3x3 supersampling — enough to kill jaggies at these sizes
  const bgRadius = size * 0.22

  // Content box, shrunk for maskable safe zone.
  const pad = size * inset
  const cw = size - pad * 2

  const barH = cw * 0.155
  const gap = cw * 0.105
  const totalH = barH * 3 + gap * 2
  const top = pad + (cw - totalH) / 2
  const barR = barH / 2

  // Three bars of different widths: the "pool" of options for one slot,
  // with the chosen one highlighted.
  const bars = [
    { w: cw * 0.78, color: DIM },
    { w: cw * 1.0, color: ACCENT },
    { w: cw * 0.58, color: DIM },
  ]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4

      // background
      let bgA = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS
          const fy = y + (sy + 0.5) / SS
          if (bleed || inRoundedRect(fx, fy, 0, 0, size, size, bgRadius)) bgA++
        }
      }
      if (bgA > 0) blend(px, i, BG, bgA / (SS * SS))

      // bars
      for (let b = 0; b < bars.length; b++) {
        const bar = bars[b]
        const by = top + b * (barH + gap)
        let a = 0
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const fx = x + (sx + 0.5) / SS
            const fy = y + (sy + 0.5) / SS
            if (inRoundedRect(fx, fy, pad, by, bar.w, barH, barR)) a++
          }
        }
        if (a > 0) blend(px, i, bar.color, a / (SS * SS))
      }
    }
  }
  return px
}

// ---------- write ----------

mkdirSync(OUT, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, bleed: false, inset: 0.19 },
  { file: 'icon-512.png', size: 512, bleed: false, inset: 0.19 },
  // Maskable: platform crops to a circle, so keep content inside the safe zone
  // and let the background run edge to edge.
  { file: 'icon-maskable-512.png', size: 512, bleed: true, inset: 0.27 },
  // iOS applies its own squircle mask and does not honour transparency.
  { file: 'apple-touch-icon.png', size: 180, bleed: true, inset: 0.2 },
]

for (const t of targets) {
  const png = encodePNG(t.size, draw(t.size, t))
  writeFileSync(join(OUT, t.file), png)
  console.log(`  ${t.file}  ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} kB`)
}
console.log('icons written to public/')
