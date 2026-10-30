// 生成应用图标与托盘图标（纯 Node 手写 PNG 编码，无需额外依赖）
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4)
  const r = size * 0.235
  const s = size / 256
  const set = (x, y, col, a) => {
    const i = (y * size + x) * 4
    buf[i] = col[0]
    buf[i + 1] = col[1]
    buf[i + 2] = col[2]
    buf[i + 3] = Math.round(a * 255)
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角矩形遮罩
      const cx = Math.min(Math.max(x + 0.5, r), size - r)
      const cy = Math.min(Math.max(y + 0.5, r), size - r)
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const mask = d <= r ? 1 : 0
      if (!mask) continue

      // 斜向渐变：#4F7BFF -> #A855F7 -> #22D3EE
      const t = (x / size) * 0.55 + (y / size) * 0.45
      let col
      if (t < 0.5) {
        const k = t / 0.5
        col = [79 + (168 - 79) * k, 123 + (85 - 123) * k, 255 + (247 - 255) * k]
      } else {
        const k = (t - 0.5) / 0.5
        col = [168 + (34 - 168) * k, 85 + (211 - 85) * k, 247 + (238 - 247) * k]
      }
      set(x, y, col, 1)
    }
  }

  // 白色文档卡片（右上角折角）+ 三条内容线
  const white = [255, 255, 255]
  const bx0 = 70 * s
  const bx1 = 186 * s
  const by0 = 54 * s
  const by1 = 202 * s
  const fold = 40 * s
  for (let y = Math.floor(by0); y < by1; y++) {
    for (let x = Math.floor(bx0); x < bx1; x++) {
      const ly = y - by0
      // 折角：右上三角切掉
      if (bx1 - x + ly < fold) continue
      // 内部三条横线镂空
      const lx = x - bx0
      const inner = lx > 26 * s && lx < bx1 - bx0 - 40 * s
      const line = (ly > 46 * s && ly < 57 * s) || (ly > 80 * s && ly < 91 * s) || (ly > 114 * s && ly < 125 * s)
      if (inner && line) continue
      const i = (y * size + x) * 4
      const a = 0.96
      buf[i] = buf[i] * (1 - a) + white[0] * a
      buf[i + 1] = buf[i + 1] * (1 - a) + white[1] * a
      buf[i + 2] = buf[i + 2] * (1 - a) + white[2] * a
      buf[i + 3] = 255
    }
  }
  return encodePNG(size, size, buf)
}

const outDir = path.join(__dirname, '..', 'resources')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.png'), drawIcon(256))
fs.writeFileSync(path.join(outDir, 'tray.png'), drawIcon(32))
fs.writeFileSync(path.join(outDir, 'tray@2x.png'), drawIcon(64))
console.log('icons generated ->', outDir)
