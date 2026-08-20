// Claude-O-Meter — main process. Owns the widget window, the settings window,
// the tray, the usage collectors, and all persistence. Extracted from the
// 'claude' skin of tempsLCD-web with the hardware-monitor half removed.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')
const usage = require('./src/sensors/service')
const { startClaudeSwap } = require('./src/sensors/claude-swap')
const { cswapCmd } = require('./src/sensors/cswap-cmd')

// One instance only. A second launch (installer auto-run + shortcut,
// double-click while already in the tray) surfaces the existing widget
// instead of racing the first instance for the profile dir.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

const isDev = process.argv.includes('--dev')
const PRELOAD = path.join(__dirname, 'preload.js')
const APP_ICON = path.join(__dirname, 'assets', 'images', 'app-icon.ico')

let win = null
let settingsWin = null
let tray = null
let usageService = null
let settings = null           // app settings — loaded in whenReady
let settingsFile = null       // userData/settings.json
let lastReadings = []         // latest usage readings, replayed on reload
let claudeSwapHandle = null   // cswap account-usage collector (all accounts)
let lastClaudeSwap = null     // latest swap payload — replayed to a fresh widget
let swapCacheFile = null      // userData/swap-cache.json — last payload, painted at launch

// Single-account size. Multi-account grows one block per account.
const BASE_SIZE = { width: 360, height: 230 }

// Mirrors nativeSize() in renderer/renderer.js — keep the formula in sync.
function widgetSize() {
  const n = lastClaudeSwap && lastClaudeSwap.ok ? lastClaudeSwap.accounts.length : 0
  if (n < 2) return BASE_SIZE
  return { width: 400, height: 96 + 96 * n }
}

// Resize the widget window to fit the account count, keeping its center fixed.
function fitWidget() {
  if (!win || win.isDestroyed()) return
  const sz = widgetSize()
  const [w, h] = win.getSize()
  if (w === sz.width && h === sz.height) return
  const [x, y] = win.getPosition()
  const nx = Math.round(x + (w - sz.width) / 2)
  const ny = Math.round(y + (h - sz.height) / 2)
  win.setBounds({ x: nx, y: ny, width: sz.width, height: sz.height })
}

// ── Claude swap collector (cswap CLI — all connected accounts) ─────

// Last good payload from the previous run, painted immediately at launch so the
// widget doesn't sit empty while cswap + auto-detect spin up. Reset timestamps
// are absolute epoch ms, so the countdowns stay accurate; only the pcts are
// stale, and the first live poll replaces them within seconds.
function loadSwapCache() {
  try {
    const p = JSON.parse(fs.readFileSync(swapCacheFile, 'utf8'))
    if (p && p.ok === true && Array.isArray(p.accounts)) lastClaudeSwap = { ...p, cached: true }
  } catch { /* no cache yet */ }
}

function sendClaudeSwap(payload) {
  const prev = lastClaudeSwap && lastClaudeSwap.ok ? lastClaudeSwap.accounts.length : 0
  const next = payload && payload.ok ? payload.accounts.length : 0
  lastClaudeSwap = payload
  // Persist live data for next launch — never mock data, it would poison the
  // cache real launches paint from.
  if (payload && payload.ok && swapCacheFile && process.env.CLAUDEOMETER_SWAP_MOCK !== '1') {
    try { fs.writeFileSync(swapCacheFile, JSON.stringify(payload)) } catch { /* non-fatal */ }
  }
  if (next !== prev) fitWidget()
  if (win && !win.isDestroyed()) win.webContents.send('claude-swap', payload)
}

function startSwapCollector() {
  if (claudeSwapHandle || !(settings && settings.claudeUsage)) return
  claudeSwapHandle = startClaudeSwap(sendClaudeSwap)
}

function stopSwapCollector() {
  if (!claudeSwapHandle) return
  claudeSwapHandle.stop()
  claudeSwapHandle = null
  sendClaudeSwap({ ok: false, ts: Date.now(), accounts: [] })
}

// ── About dialog ───────────────────────────────────────────────────
function buildReport() {
  const src = lastClaudeSwap && lastClaudeSwap.ok && lastClaudeSwap.accounts.length
    ? `cswap (${lastClaudeSwap.accounts.length} accounts)`
    : (lastReadings.length ? 'OAuth / claude.ai session' : 'no usage data yet')
  return [
    `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    `OS: ${os.version()} (${os.release()}, ${process.arch})`,
    `Usage source: ${src}`,
    `Readings: ${lastReadings.length}`,
  ].join('\n')
}

async function showAbout(parent) {
  const report = buildReport()
  const opts = {
    type: 'info',
    title: 'About Claude-O-Meter',
    message: `Claude-O-Meter ${app.getVersion()}`,
    detail: report,
    buttons: ['OK', 'Copy Report'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const { response } = parent && !parent.isDestroyed()
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts)
  if (response === 1) clipboard.writeText(`Claude-O-Meter ${app.getVersion()}\n${report}`)
}

// ── Widget window ──────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    ...BASE_SIZE,
    icon: APP_ICON,
    frame: false,
    transparent: true,
    alwaysOnTop: !!(settings && settings.alwaysOnTop),
    resizable: true,
    minWidth: 240,
    minHeight: 120,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile('renderer/index.html')
  win.on('closed', () => { win = null })
  if (isDev) win.webContents.openDevTools({ mode: 'detach' })

  win.webContents.once('did-finish-load', () => {
    usageService = usage.start((payload) => {
      lastReadings = (payload && payload.readings) || []
      if (win && !win.isDestroyed()) win.webContents.send('usage-data', payload)
    }, { claudeUsage: !!(settings && settings.claudeUsage) })
    startSwapCollector()
    fitWidget()
  })

  // Replay the last swap payload on every load (incl. reloads) — the next poll
  // is up to 45s away and the renderer starts with no account data.
  win.webContents.on('did-finish-load', () => {
    if (lastClaudeSwap && win && !win.isDestroyed()) win.webContents.send('claude-swap', lastClaudeSwap)
  })
}

// ── Settings window ────────────────────────────────────────────────
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 380,
    height: 430,
    icon: APP_ICON,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWin.loadFile('settings/index.html')
  if (isDev) settingsWin.webContents.openDevTools({ mode: 'detach' })
  settingsWin.on('closed', () => { settingsWin = null })
}

// ── Tray ───────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'images', 'tray-icon.ico'))
  tray.setToolTip('Claude-O-Meter')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Widget', click: () => { if (!win) createWindow(); else win.show() } },
    { label: 'Hide Widget', click: () => { if (win) win.hide() } },
    { label: 'Refresh Now', click: () => { if (claudeSwapHandle) claudeSwapHandle.refresh() } },
    { label: 'Settings',    click: () => openSettings() },
    { label: 'About',       click: () => showAbout(win) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.on('double-click', () => {
    if (!win) { createWindow(); return }
    win.isVisible() ? win.hide() : win.show()
  })
}

// ── IPC: window controls ───────────────────────────────────────────
ipcMain.on('widget:minimize', () => {
  if (!win || win.isDestroyed()) return
  settings && settings.minimizeToTray ? win.hide() : win.minimize()
})

ipcMain.on('widget:close', () => {
  if (!win || win.isDestroyed()) return
  settings && settings.minimizeToTray ? win.hide() : win.close()
})

// Bounds frozen at drag start because re-reading size each move accumulates
// DPI rounding and grows the window.
let dragBase = null

ipcMain.on('widget:drag-start', () => {
  if (!win || win.isDestroyed()) return
  dragBase = { ...win.getBounds(), dx: 0, dy: 0 }
})

ipcMain.on('widget:drag-end', () => { dragBase = null })

ipcMain.on('widget:move', (_e, { dx, dy }) => {
  if (!win || win.isDestroyed()) return
  dx = Number(dx); dy = Number(dy)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return

  if (!dragBase) dragBase = { ...win.getBounds(), dx: 0, dy: 0 }
  dragBase.dx += dx
  dragBase.dy += dy

  let nx = dragBase.x + dragBase.dx
  let ny = dragBase.y + dragBase.dy
  const w = dragBase.width
  const h = dragBase.height

  // Keep at least a grabbable strip of the window on a display so it can't be
  // dragged (or IPC-pushed) fully off-screen and become unrecoverable.
  const area = screen.getDisplayNearestPoint({ x: nx + Math.round(w / 2), y: ny + Math.round(h / 2) }).workArea
  nx = Math.max(area.x - w + 40, Math.min(area.x + area.width - 40, nx))
  ny = Math.max(area.y - h + 40, Math.min(area.y + area.height - 40, ny))
  win.setBounds({ x: nx, y: ny, width: w, height: h })
})

// ── Settings: persistence + IPC ────────────────────────────────────
const DEFAULT_SETTINGS = {
  autostart: false,
  minimizeToTray: false,
  alwaysOnTop: false,
  claudeUsage: true,
  theme: 'cream',
}

const THEMES = [
  ['cream', 'Cream'], ['dark', 'Dark'], ['midnight', 'Midnight'], ['phosphor', 'Phosphor'],
  ['outrun', "OutRun '83"], ['cinch', 'Cinch I.T.'], ['porsche', 'Porsche'],
  ['temple', 'St. George Temple'],
]

// Sanitize untrusted settings into a complete, well-typed object.
function validateSettings(obj) {
  const s = { ...DEFAULT_SETTINGS }
  if (obj && typeof obj === 'object') {
    if (typeof obj.autostart === 'boolean') s.autostart = obj.autostart
    if (typeof obj.minimizeToTray === 'boolean') s.minimizeToTray = obj.minimizeToTray
    if (typeof obj.alwaysOnTop === 'boolean') s.alwaysOnTop = obj.alwaysOnTop
    if (typeof obj.claudeUsage === 'boolean') s.claudeUsage = obj.claudeUsage
    if (THEMES.some(([v]) => v === obj.theme)) s.theme = obj.theme
  }
  return s
}

function loadSettings() {
  try {
    settings = validateSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8')))
  } catch { settings = validateSettings(null) }
}

function saveSettings() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8') }
  catch (err) { console.error('[settings] save failed:', err.message) }
}

// Autostart only registers when packaged — in dev it would register the bare
// electron.exe binary.
function applySettings() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.autostart })
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!settings.alwaysOnTop)
}

function broadcastSettings() {
  for (const w of [win, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('settings-change', settings)
  }
}

ipcMain.handle('settings:get', () => ({ ...settings, isPackaged: app.isPackaged }))

ipcMain.on('settings:set', (_e, incoming) => {
  settings = validateSettings({ ...settings, ...incoming })
  saveSettings()
  applySettings()
  if (usageService) usageService.setClaudeUsage(settings.claudeUsage)
  if (settings.claudeUsage) startSwapCollector()
  else stopSwapCollector()
  broadcastSettings()
})

ipcMain.on('settings:close', () => { if (settingsWin) settingsWin.close() })

// ── Right-click menu ───────────────────────────────────────────────
ipcMain.on('widget:context-menu', () => {
  if (!win || win.isDestroyed()) return
  const themeItems = THEMES.map(([value, label]) => ({
    label,
    type: 'radio',
    checked: value === ((settings && settings.theme) || 'cream'),
    click: () => { settings.theme = value; saveSettings(); broadcastSettings() },
  }))
  Menu.buildFromTemplate([
    { label: 'Refresh Now', click: () => { if (claudeSwapHandle) claudeSwapHandle.refresh() } },
    { label: 'Settings',    click: () => openSettings() },
    { label: 'Colors',      submenu: themeItems },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: !!(settings && settings.alwaysOnTop),
      click: () => {
        settings.alwaysOnTop = !settings.alwaysOnTop
        saveSettings()
        applySettings()
        broadcastSettings()
      },
    },
    { type: 'separator' },
    { label: 'About',    click: () => showAbout(win) },
    { label: 'Minimize', click: () => win.minimize() },
    { label: 'Close',    click: () => win.close() },
  ]).popup({ window: win })
})

// ── Claude web login ───────────────────────────────────────────────
// Required lazily so a broken/missing claude-web module can't kill startup.
let claudeWeb = null
function getClaudeWeb() {
  if (!claudeWeb) {
    claudeWeb = require('./src/sensors/claude-web')
    claudeWeb.onSessionExpired(() => sendClaudeStatus({ loggedIn: false }))
  }
  return claudeWeb
}

function sendClaudeStatus(status) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('claude:status-change', status)
  }
}

ipcMain.handle('claude:login', async () => {
  try {
    const result = await getClaudeWeb().login()
    if (result && result.success) sendClaudeStatus(getClaudeWeb().status())
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('claude:logout', async () => {
  try { await getClaudeWeb().logout() }
  catch (err) { console.error('[claude-web] logout failed:', err.message) }
  sendClaudeStatus({ loggedIn: false })
})

ipcMain.handle('claude:status', () => {
  try { return getClaudeWeb().status() }
  catch { return { loggedIn: false } }
})

// ── Claude swap IPC: switch the active cswap account ───────────────
// Fixed argv arrays only, never shell-interpolated; the number is validated
// against the same rule cswap itself enforces.
const CSWAP_NUM_RE = /^[0-9]+$/
ipcMain.handle('claude:swap-switch', (_e, number) => new Promise((resolve) => {
  if (!CSWAP_NUM_RE.test(String(number))) return resolve({ ok: false, error: 'invalid account number' })
  const { file, args } = cswapCmd(['switch', String(number)])
  execFile(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
    if (claudeSwapHandle) claudeSwapHandle.refresh()
    resolve(err ? { ok: false, error: String(stderr || err.message).slice(0, 300) } : { ok: true })
  })
}))

ipcMain.handle('claude:swap-refresh', () => {
  if (claudeSwapHandle) claudeSwapHandle.refresh()
})

// ── App lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  settingsFile = path.join(app.getPath('userData'), 'settings.json')
  swapCacheFile = path.join(app.getPath('userData'), 'swap-cache.json')
  loadSettings()
  if (settings.claudeUsage) loadSwapCache()
  applySettings()
  createWindow()
  createTray()
})

// Tray keeps the app alive — don't quit on last window close
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (usageService) usageService.stop()
  if (claudeSwapHandle) claudeSwapHandle.stop()
})
