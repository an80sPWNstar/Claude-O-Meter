// Icon generator. Run with Electron, not node:
//   unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe scripts/make-icons.cjs
//
// Produces, from the geometry defined below rather than from exported artwork:
//   assets/images/app-icon.ico   the cut C on a cream tile, 7 resolutions
//   assets/images/tray-icon.ico  the same mark inverted on a terracotta tile
//   assets/images/icon.png       1024px app icon — electron-builder derives the
//                                Linux png set and the macOS .icns from it
//   assets/images/tray-icon.png  32px tray icon; GTK trays will not take an .ico
//
// Everything is drawn with Canvas 2D in a hidden window, so there is no
// dependency on ImageMagick or an SVG rasteriser. Design angles are measured
// from twelve o'clock going clockwise; Canvas measures from three o'clock, hence
// the -90 in rad().

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const IMAGES = path.join(ROOT, 'assets', 'images')

const CREAM = '#F0EEE6'
const TRACK = '#DCD8CC'
const TERRA = '#D97757'
const EMBER = '#C24E30'

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// The small-end correction. A stroke ratio that looks right at 256px goes thin
// and patchy by 16px, so the weight is raised as the canvas shrinks and the
// ring radius is pushed out to use the whole box. Both icons are the same
// geometry, so one table serves them.
function appMetrics(size) {
  if (size <= 16) return { r: 0.330, w: 0.200, radius: 0.20 }
  if (size <= 24) return { r: 0.325, w: 0.185, radius: 0.21 }
  if (size <= 32) return { r: 0.320, w: 0.175, radius: 0.22 }
  return { r: 0.3125, w: 0.156, radius: 0.22 }
}

// The page does the drawing; Node only writes bytes.
const PAGE = `<!DOCTYPE html><meta charset="utf-8"><body><script>
var CREAM='${CREAM}', TRACK='${TRACK}', TERRA='${TERRA}', EMBER='${EMBER}';
function rad(deg){ return (deg - 90) * Math.PI / 180 }
function cv(size){ var c=document.createElement('canvas'); c.width=c.height=size; return c }

// Rounded-rect tile, shared by both icons.
function tile(ctx, size, radius, fill){
  var r = size * radius
  ctx.beginPath()
  ctx.moveTo(r,0); ctx.lineTo(size-r,0); ctx.quadraticCurveTo(size,0,size,r)
  ctx.lineTo(size,size-r); ctx.quadraticCurveTo(size,size,size-r,size)
  ctx.lineTo(r,size); ctx.quadraticCurveTo(0,size,0,size-r)
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0)
  ctx.closePath(); ctx.fillStyle=fill; ctx.fill()
}

// The cut C — gap 100 degrees, butt caps. The squared terminals are the point:
// round caps eat into the gap and the C starts closing up when it shrinks.
function mark(ctx, size, m, colour, fill){
  tile(ctx, size, m.radius, fill)
  var cx = size/2
  ctx.lineWidth = size*m.w
  ctx.lineCap = 'butt'
  ctx.strokeStyle = colour
  ctx.beginPath(); ctx.arc(cx, cx, size*m.r, rad(50), rad(310)); ctx.stroke()
}

// App icon: terracotta mark on the cream tile, with the grey track behind it,
// because at 48px and up there is room for the gauge to read.
function appIcon(size, m){
  var c = cv(size), ctx = c.getContext('2d')
  tile(ctx, size, m.radius, CREAM)
  var cx = size/2, r = size*m.r
  ctx.lineWidth = size*m.w
  ctx.lineCap = 'butt'
  ctx.strokeStyle = TRACK
  ctx.beginPath(); ctx.arc(cx, cx, r, rad(50), rad(310)); ctx.stroke()
  ctx.strokeStyle = TERRA
  ctx.beginPath(); ctx.arc(cx, cx, r, rad(50), rad(50 + 260*0.67)); ctx.stroke()
  return c.toDataURL('image/png')
}

// Tray icon: the inverse — cream mark on a solid terracotta tile, and static.
// A filled tile is what makes it survive 16px next to other tray icons; the
// earlier version drew live usage as an arc and a few percent rendered as a
// two-pixel speck. No track and no value here: the numbers are in the tooltip.
function trayIcon(size, m){
  var c = cv(size), ctx = c.getContext('2d')
  mark(ctx, size, m, CREAM, TERRA)
  return c.toDataURL('image/png')
}

window.render = function (jobs) {
  return jobs.map(function (j) {
    return j.kind === 'app' ? appIcon(j.size, j.m) : trayIcon(j.size, j.m)
  })
}
</script></body>`

// ── ICO container ───────────────────────────────────────────────────
// Vista and later accept PNG-compressed entries, so each resolution goes in as
// a whole PNG. A width or height byte of 0 means 256.
function buildIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)      // reserved
  header.writeUInt16LE(1, 2)      // type 1 = icon
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  pngs.forEach((p, i) => {
    const b = i * 16
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, b + 0)
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, b + 1)
    dir.writeUInt8(0, b + 2)      // palette size
    dir.writeUInt8(0, b + 3)      // reserved
    dir.writeUInt16LE(1, b + 4)   // colour planes
    dir.writeUInt16LE(32, b + 6)  // bits per pixel
    dir.writeUInt32LE(p.buf.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += p.buf.length
  })
  return Buffer.concat([header, dir, ...pngs.map(p => p.buf)])
}

const decode = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE))

  const jobs = []
  for (const size of ICO_SIZES) jobs.push({ kind: 'app', size, m: appMetrics(size) })
  for (const size of ICO_SIZES) jobs.push({ kind: 'tray', size, m: appMetrics(size) })
  // Standalone PNGs for Linux packaging and the GTK tray.
  jobs.push({ kind: 'app', size: 1024, m: appMetrics(1024) })
  for (const size of [32, 64]) jobs.push({ kind: 'tray', size, m: appMetrics(size) })

  const urls = await win.webContents.executeJavaScript(
    'window.render(' + JSON.stringify(jobs) + ')')
  if (!Array.isArray(urls) || urls.length !== jobs.length) throw new Error('render returned ' + (urls && urls.length))

  fs.mkdirSync(IMAGES, { recursive: true })

  let i = 0
  const appPngs = ICO_SIZES.map(size => ({ size, buf: decode(urls[i++]) }))
  const trayPngs = ICO_SIZES.map(size => ({ size, buf: decode(urls[i++]) }))

  fs.writeFileSync(path.join(IMAGES, 'app-icon.ico'), buildIco(appPngs))
  fs.writeFileSync(path.join(IMAGES, 'tray-icon.ico'), buildIco(trayPngs))
  fs.writeFileSync(path.join(IMAGES, 'icon.png'), decode(urls[i++]))
  fs.writeFileSync(path.join(IMAGES, 'tray-icon.png'), decode(urls[i++]))
  fs.writeFileSync(path.join(IMAGES, 'tray-icon@2x.png'), decode(urls[i++]))

  const stat = (p) => fs.statSync(p).size
  console.log('app-icon.ico   ' + stat(path.join(IMAGES, 'app-icon.ico')) + ' bytes, ' + ICO_SIZES.length + ' sizes')
  console.log('tray-icon.ico  ' + stat(path.join(IMAGES, 'tray-icon.ico')) + ' bytes, ' + ICO_SIZES.length + ' sizes')
  console.log('icon.png       ' + stat(path.join(IMAGES, 'icon.png')) + ' bytes, 1024px')
  console.log('tray-icon.png  ' + stat(path.join(IMAGES, 'tray-icon.png')) + ' bytes, 32px (+@2x)')
  app.exit(0)
})
