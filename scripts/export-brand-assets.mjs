#!/usr/bin/env node
// Optional asset maintenance tool. Application builds use checked-in exports.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  'tv-res': { type: 'string' },
  'mobile-res': { type: 'string' },
} })
const require = createRequire(import.meta.url)
const sharp = require('sharp')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const branding = path.join(root, 'assets/branding')
const publicBranding = path.join(root, 'public/assets/brand')
const mark = await readFile(path.join(branding, 'singverse-logo-mark.svg'), 'utf8')
const wordmark = await readFile(path.join(branding, 'singverse-wordmark.svg'), 'utf8')
const defs = mark.match(/<defs>([\s\S]*?)<\/defs>/)?.[1]
const markPaths = mark.match(/<\/defs>([\s\S]*?)<\/svg>/)?.[1].replace(/<!--[\s\S]*?-->/g, '').trim()
const wordPaths = [...wordmark.matchAll(/<path\b[^>]*\/>/g)].map(match => match[0]).join('\n')
if (!defs || !markPaths || !wordPaths) throw new Error('Expected self-contained SVG paths and linear gradients')

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <title>SingVerse</title>\n  <defs>${defs}</defs>\n${body}\n</svg>\n`
}

// Keep the existing horizontal lockup and outlined lettering proportions.
const horizontalBody = `<g transform="translate(-45 -40) scale(0.62)">${markPaths}</g>\n${wordPaths}`
const horizontal = svg(2172, 724, horizontalBody)
const appIcon = svg(1254, 1254, `<path fill="#0F172A" d="M0 0 H1254 V1254 H0 Z"/>\n<g transform="translate(132 122) scale(0.77)">${markPaths}</g>`)
const bannerScale = 288 / 2172
const banner = svg(320, 180, `<path fill="#FFFFFF" d="M0 0 H320 V180 H0 Z"/>\n<g transform="translate(16 42) scale(${bannerScale})">${horizontalBody}</g>`)

async function write(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
}

async function raster(source, width, height, file) {
  const sourceWidth = Number(source.match(/<svg\b[^>]*\bwidth="([\d.]+)"/)[1])
  const oversampling = width <= 512 ? 4 : 2
  const png = await sharp(Buffer.from(source), { density: 72 * width / sourceWidth * oversampling })
    .resize(width, height, { kernel: 'lanczos3' }).png().toBuffer()
  await write(file, png)
  return png
}

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
}

const gradients = new Map([...defs.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)].map(match => {
  const gradient = attributes(match[1])
  if (gradient.gradientUnits !== 'userSpaceOnUse') throw new Error('Android export requires userSpaceOnUse gradients')
  const stops = [...match[2].matchAll(/<stop\b([^>]*)\/>/g)].map(stop => attributes(stop[1]))
  return [gradient.id, { ...gradient, stops }]
}))

// The outlined letters use absolute M/L/Q/Z commands. Relative coordinates keep
// Android paths small; 0.1 source pixel is under 0.02 pixel in the 320px banner.
function compactWordPath(data) {
  const tokens = data.match(/[MLQZ]|-?(?:\d*\.)?\d+/g)
  const number = value => String(Number(value.toFixed(1))).replace(/^(-?)0\./, '$1.')
  const point = () => [Number(Number(tokens.shift()).toFixed(1)), Number(Number(tokens.shift()).toFixed(1))]
  let current = [0, 0]
  let start = current
  let output = ''
  while (tokens.length) {
    const command = tokens.shift()
    if (command === 'Z') { output += 'z'; current = start; continue }
    if (!['M', 'L', 'Q'].includes(command)) throw new Error(`Unsupported wordmark command ${command}`)
    const first = point()
    const delta = target => target.map((value, index) => number(value - current[index])).join(' ')
    if (command === 'Q') {
      const end = point()
      output += `q${delta(first)} ${delta(end)}`
      current = end
    } else {
      if (command === 'L' && first[0] === current[0] && first[1] === current[1]) continue
      if (command === 'L' && first[0] === current[0]) output += `v${number(first[1] - current[1])}`
      else if (command === 'L' && first[1] === current[1]) output += `h${number(first[0] - current[0])}`
      else output += `${command.toLowerCase()}${delta(first)}`
      current = first
      if (command === 'M') start = first
    }
  }
  return output.replace(/ -/g, '-')
}

function vectorPaths(source, compact = false) {
  return [...source.matchAll(/<path\b([^>]*)\/>/g)].map(match => {
    const item = attributes(match[1])
    if (!item.d || !item.fill) throw new Error('Android export requires explicit path data and fill')
    if (compact) item.d = compactWordPath(item.d)
    const fillType = item['fill-rule'] === 'evenodd' ? ' android:fillType="evenOdd"' : ''
    const gradientId = item.fill.match(/^url\(#(.+)\)$/)?.[1]
    if (!gradientId) return `<path android:fillColor="${item.fill}"${fillType} android:pathData="${item.d}"/>`
    const gradient = gradients.get(gradientId)
    if (!gradient) throw new Error(`Unknown gradient ${gradientId}`)
    return `<path${fillType} android:pathData="${item.d}">
  <aapt:attr name="android:fillColor">
    <gradient android:type="linear" android:startX="${gradient.x1}" android:startY="${gradient.y1}" android:endX="${gradient.x2}" android:endY="${gradient.y2}">
${gradient.stops.map(stop => `      <item android:offset="${stop.offset}" android:color="${stop['stop-color']}"/>`).join('\n')}
    </gradient>
  </aapt:attr>
</path>`
  }).join('\n')
}

function vector(width, height, viewportWidth, viewportHeight, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from the checked-in SingVerse SVG masters. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${width}dp" android:height="${height}dp"
    android:viewportWidth="${viewportWidth}" android:viewportHeight="${viewportHeight}">
${body}
</vector>\n`
}

const nativeMarkPaths = vectorPaths(markPaths)
const nativeMark = vector(48, 48, 1254, 1254, nativeMarkPaths)
const nativeBanner = vector(160, 90, 320, 180, `<path android:fillColor="#FFFFFF" android:pathData="M0 0 H320 V180 H0 Z"/>
<group android:translateX="16" android:translateY="42" android:scaleX="${bannerScale}" android:scaleY="${bannerScale}">
  <group android:translateX="-45" android:translateY="-40" android:scaleX="0.62" android:scaleY="0.62">
${nativeMarkPaths}
  </group>
${vectorPaths(wordPaths, true)}
</group>`)

await write(path.join(branding, 'singverse-logo-horizontal.svg'), horizontal)
await write(path.join(branding, 'singverse-app-icon-master.svg'), appIcon)
await write(path.join(branding, 'singverse-tv-banner.svg'), banner)
await raster(mark, 2048, 2048, path.join(branding, 'singverse-logo-mark.png'))
await raster(horizontal, 4344, 1448, path.join(branding, 'singverse-logo-horizontal.png'))
await raster(appIcon, 2048, 2048, path.join(branding, 'singverse-app-icon-master.png'))
await raster(banner, 320, 180, path.join(branding, 'singverse-tv-banner.png'))

const iconSizes = [16, 32, 48, 64, 72, 96, 128, 144, 180, 192, 256, 512, 1024]
const iconBuffers = new Map()
for (const size of iconSizes) {
  iconBuffers.set(size, await raster(appIcon, size, size, path.join(branding, `icons/icon-${size}.png`)))
}
for (const size of [128, 512]) {
  await raster(mark, size, size, path.join(branding, `icons/logo-mark-${size}.png`))
}

// ICO entries contain the exact corresponding PNG exports.
const icoSizes = [16, 32, 48]
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(icoSizes.length, 4)
let offset = icoHeader.length
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16
  const png = iconBuffers.get(size)
  icoHeader[entry] = size
  icoHeader[entry + 1] = size
  icoHeader.writeUInt16LE(1, entry + 4)
  icoHeader.writeUInt16LE(32, entry + 6)
  icoHeader.writeUInt32LE(png.length, entry + 8)
  icoHeader.writeUInt32LE(offset, entry + 12)
  offset += png.length
})
const ico = Buffer.concat([icoHeader, ...icoSizes.map(size => iconBuffers.get(size))])
await write(path.join(branding, 'favicon.ico'), ico)
await write(path.join(publicBranding, 'favicon.ico'), ico)
await write(path.join(publicBranding, 'logo-mark.svg'), mark)
await raster(mark, 128, 128, path.join(publicBranding, 'logo-mark.png'))
for (const size of [180, 192]) {
  await write(path.join(publicBranding, `icon-${size}.png`), iconBuffers.get(size))
}

const preview = svg(1600, 1000, `<path fill="#F1F5F9" d="M0 0 H1600 V1000 H0 Z"/>
<path fill="#FFFFFF" d="M56 56 H1544 V422 H56 Z M56 454 H794 V944 H56 Z"/>
<path fill="#0F172A" d="M826 454 H1544 V944 H826 Z"/>
<g transform="translate(300 105) scale(0.42)">${horizontalBody}</g>
<g transform="translate(196 476) scale(0.34)">${markPaths}</g>
<g transform="translate(974 476) scale(0.34)">${markPaths}</g>
<text x="112" y="106" fill="#475569" font-family="sans-serif" font-size="22">SingVerse · vector master</text>
<text x="112" y="902" fill="#475569" font-family="sans-serif" font-size="22">Transparent mark / light surface</text>
<text x="882" y="902" fill="#CBD5E1" font-family="sans-serif" font-size="22">Transparent mark / dark surface</text>`)
await raster(preview, 1600, 1000, path.join(branding, 'singverse-brand-preview.png'))

for (const [name, directory] of [['tv', values['tv-res']], ['mobile', values['mobile-res']]]) {
  if (!directory) continue
  const resources = path.resolve(directory)
  await write(path.join(resources, 'drawable-anydpi-v24/singverse_logo_mark.xml'), nativeMark)
  // API 23 fallback; render from paths, never enlarge an existing bitmap.
  await raster(mark, 1024, 1024, path.join(resources, 'drawable-nodpi/singverse_logo_mark.png'))
  await write(path.join(resources, 'drawable/ic_launcher_foreground.xml'), `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/singverse_logo_mark" android:inset="21%" />\n`)
  for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    await write(path.join(resources, `mipmap-${density}/ic_launcher.png`), iconBuffers.get(size))
  }
  if (name === 'tv') {
    await write(path.join(resources, 'drawable-anydpi-v24/tv_banner.xml'), nativeBanner)
    await raster(banner, 320, 180, path.join(resources, 'drawable-xhdpi/tv_banner.png'))
    // Pre-render antialiasing at Orange Pi's native tile size, 142 × 84.
    const tvLauncherTile = svg(142, 84, `  <rect width="142" height="84" rx="3" fill="#FFFFFF"/>
  <g transform="translate(33 3) scale(0.06)">${markPaths}</g>`)
    await raster(tvLauncherTile, 142, 84, path.join(resources, 'mipmap-nodpi/tv_application_icon.png'))
  }
  console.log(`Updated ${name} resources: ${resources}`)
}
console.log('Exported SVG masters, antialiased PNGs, ICO and web assets')
