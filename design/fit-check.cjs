// Layout harness. Loads the real renderer at several window shapes and grabs
// each with capturePage, so it works with the desktop locked.
//   unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe design/fit-check.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs'); const path = require('path')
const ROOT = path.join(__dirname, '..')

const SHAPES = [
  [400, 288, 'native'], [820, 288, 'wide'], [400, 600, 'tall'],
  [860, 620, 'big'], [300, 190, 'small'], [300, 216, 'floor'],
]

const now = Date.now()
const SWAP = {
  ok: true, ts: now, autoOn: false, autoSinceMin: null,
  accounts: [
    { number: 1, alias: 'cinchit', active: true, disabled: false, usageStatus: 'ok',
      fiveHourPct: 11, sevenDayPct: 58, fiveHourResetMs: now + 225 * 60000,
      sevenDayResetMs: now + 525 * 60000, scopedName: null, scopedPct: null,
      scopedResetMs: null, usageFetchedMs: now - 40000 },
    { number: 2, alias: 'drcu', active: false, disabled: false, usageStatus: 'relogin_required',
      fiveHourPct: null, sevenDayPct: null, fiveHourResetMs: null,
      sevenDayResetMs: null, scopedName: null, scopedPct: null,
      scopedResetMs: null, usageFetchedMs: null },
  ],
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400, height: 288, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, 'fit-preload.cjs'),
      contextIsolation: false, nodeIntegration: false },
  })
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'))
  await win.webContents.executeJavaScript(
    `document.getElementById('bezel').setAttribute('data-theme','dark');` +
    `window.__cb.swap(${JSON.stringify(SWAP)}); 'ok'`)

  for (const [w, h, name] of SHAPES) {
    win.setSize(w, h)
    await new Promise(r => setTimeout(r, 450))
    const img = await win.webContents.capturePage()
    const out = path.join(__dirname, `fit-${name}.png`)
    fs.writeFileSync(out, img.toPNG())
    const zoom = await win.webContents.executeJavaScript(
      `getComputedStyle(document.getElementById('bezel')).zoom`)
    console.log(`${name} ${w}x${h} zoom=${zoom} -> ${path.basename(out)}`)
  }
  // Same small window at each offered text size, to see the curve's effect.
  for (const sc of [1, 1.3, 1.5]) {
    const f = Math.pow(0.88 * sc, 2.5)   // mirrors minFactor() in main.js
    win.setSize(Math.round(400 * f), Math.round(288 * f))
    await win.webContents.executeJavaScript(`window.__cb.settings({ theme: 'dark', textScale: ${sc} }); 'ok'`)
    await new Promise(r => setTimeout(r, 400))
    const tag = String(Math.round(sc * 100))
    fs.writeFileSync(path.join(__dirname, `fit-scale${tag}.png`), (await win.webContents.capturePage()).toPNG())
    const z = await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('bezel')).zoom`)
    console.log(`scale ${tag}% at 340x250 -> zoom ${z}`)
  }
  await win.webContents.executeJavaScript(`window.__cb.settings({ theme: 'dark', textScale: 1 }); 'ok'`)

  // Single-account view (no cswap) at the two extreme shapes.
  const READINGS = { readings: [
    { id: '/claude/session/pct', value: 11 },
    { id: '/claude/session/reset', value: 225 },
    { id: '/claude/week/pct', value: 58 },
    { id: '/claude/week/reset', value: 525 },
    { id: '/claude/scoped/pct', value: 19, model: 'Fable' },
    { id: '/claude/scoped/reset', value: 8800, model: 'Fable' },
  ] }
  await win.webContents.executeJavaScript(
    `window.__cb.swap({ ok: false, ts: Date.now(), accounts: [] });` +
    `window.__cb.usage(${JSON.stringify(READINGS)}); 'ok'`)
  for (const [w, h, name] of [[820, 288, 'single-wide'], [400, 600, 'single-tall']]) {
    win.setSize(w, h)
    await new Promise(r => setTimeout(r, 450))
    fs.writeFileSync(path.join(__dirname, `fit-${name}.png`), (await win.webContents.capturePage()).toPNG())
    console.log(`${name} ${w}x${h}`)
  }
  app.exit(0)
})
