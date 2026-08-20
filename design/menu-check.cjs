// Verifies the header buttons call showMenu with window-space coordinates, at
// two zoom levels — the coordinates must be real window pixels, not zoomed ones.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const ROOT = path.join(__dirname, '..')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 288, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, 'fit-preload.cjs'),
      contextIsolation: false, nodeIntegration: false } })
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'))
  await win.webContents.executeJavaScript(
    `window.__menu = []; window.claudeOMeter.showMenu = (k, x, y) => window.__menu.push([k, x, y]); 'ok'`)

  for (const [w, h] of [[400, 288], [900, 640]]) {
    win.setSize(w, h)
    await new Promise(r => setTimeout(r, 350))
    const out = await win.webContents.executeJavaScript(`
      window.__menu = []
      document.getElementById('btn-settings').click()
      document.getElementById('btn-help').click()
      const b = document.getElementById('bezel')
      JSON.stringify({ zoom: getComputedStyle(b).zoom, calls: window.__menu,
        rects: ['btn-settings','btn-help'].map(id => {
          const r = document.getElementById(id).getBoundingClientRect()
          return [Math.round(r.left), Math.round(r.bottom)] }) })`)
    const d = JSON.parse(out)
    console.log(`${w}x${h} zoom=${Number(d.zoom).toFixed(2)}`)
    d.calls.forEach(([k, x, y], i) => {
      const inside = x >= 0 && x <= w && y >= 0 && y <= h
      console.log(`  ${k}: popup at ${x},${y} (css ${d.rects[i]}) ${inside ? 'inside window' : 'OUT OF BOUNDS'}`)
    })
  }
  app.exit(0)
})
