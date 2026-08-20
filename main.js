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
const CAN_AUTOSTART = process.platform === 'win32' || process.platform === 'darwin'
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

// Window floor, derived from the renderer's zoom curve rather than guessed. The
// renderer zooms type by (window/native)^ZOOM_CURVE x textScale, so the layout
// box it lays out against is native^C x window^(1-C) / textScale. Requiring that
// box to stay at least MIN_BOX of native and solving for window gives
// window >= native x (MIN_BOX x textScale)^(1/(1-C)). Bigger type therefore needs
// a bigger window to show the same rows — at 150% and the old flat 0.75 floor the
// account rows overlapped the footer.
const ZOOM_CURVE = 0.6   // keep in sync with renderer/renderer.js
const MIN_BOX = 0.88     // how far the layout may compress before rows collide

function minFactor() {
  const scale = (settings && settings.textScale) || 1
  return Math.pow(MIN_BOX * scale, 1 / (1 - ZOOM_CURVE))
}

function applyMinimumSize() {
  if (!win || win.isDestroyed()) return
  const sz = widgetSize()
  const f = minFactor()
  // Never demand more than the screen can give, or the window becomes
  // unmovable off the bottom of a small display.
  const area = screen.getDisplayMatching(win.getBounds()).workAreaSize
  const minW = Math.min(Math.round(sz.width * f), area.width)
  const minH = Math.min(Math.round(sz.height * f), area.height)
  win.setMinimumSize(minW, minH)
  // setMinimumSize does not grow a window that is already smaller, so raising
  // the text size on a small window would leave the rows clipped until the
  // user nudged an edge.
  const [w, h] = win.getSize()
  if (w < minW || h < minH) win.setSize(Math.max(w, minW), Math.max(h, minH))
}

// Resize the widget window to fit the account count, keeping its center fixed.
function fitWidget() {
  if (!win || win.isDestroyed()) return
  const sz = widgetSize()
  applyMinimumSize()
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

const acctSig = (p) => (p && p.ok && Array.isArray(p.accounts)
  ? p.accounts.map(a => a.number + ':' + a.alias + ':' + (a.active ? 1 : 0)).join('|')
  : '')

// The OAuth provider and cswap poll the SAME per-token usage endpoint, which
// budgets ~28-30 requests/hour per token and stays saturated for up to an hour
// once tripped (see claude_swap/poll_policy.py). In multi-account mode the
// renderer shows the cswap payload and discards the provider's readings, so
// that poll was spending a third of the budget on data nobody paints — and the
// 429 backoff it provoked is what pushed cswap out to 5-10 minute intervals.
// Run one or the other, never both. The decision is made before the service is
// constructed too — the provider fetches inside start(), so deciding afterwards
// still spends one request.
function wantOAuthProvider() {
  const multi = !!(lastClaudeSwap && lastClaudeSwap.ok &&
    Array.isArray(lastClaudeSwap.accounts) && lastClaudeSwap.accounts.length)
  return !!(settings && settings.claudeUsage) && !multi
}

function applyUsageSource() {
  if (usageService) usageService.setClaudeUsage(wantOAuthProvider())
}

function sendClaudeSwap(payload) {
  const prev = lastClaudeSwap && lastClaudeSwap.ok ? lastClaudeSwap.accounts.length : 0
  const next = payload && payload.ok ? payload.accounts.length : 0
  const sigChanged = acctSig(payload) !== acctSig(lastClaudeSwap)
  lastClaudeSwap = payload
  // Persist live data for next launch — never mock data, it would poison the
  // cache real launches paint from.
  if (payload && payload.ok && swapCacheFile && process.env.CLAUDEOMETER_SWAP_MOCK !== '1') {
    try { fs.writeFileSync(swapCacheFile, JSON.stringify(payload)) } catch { /* non-fatal */ }
  }
  if (next !== prev) fitWidget()
  applyUsageSource()
  if (sigChanged) buildTrayMenu()
  refreshTray()
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

// ── Tray tooltip ─────────────────────────────────────────────
// The icon is static. A gauge drawn at 16px is unreadable at low usage — a few
// percent is a stroke a couple of pixels long, which on a real taskbar reads as
// a stray dot rather than an icon. The live numbers live in the tooltip instead.
let trayTip = undefined     // the tooltip currently displayed

function fmtMins(mins) {
  const m = Math.max(0, Math.round(mins))
  if (m >= 2880) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

function trayTooltip() {
  if (!(settings && settings.claudeUsage)) return 'Claude-O-Meter — usage polling off'
  if (lastClaudeSwap && lastClaudeSwap.ok && lastClaudeSwap.accounts.length) {
    const a = lastClaudeSwap.accounts.find(x => x.active) || lastClaudeSwap.accounts[0]
    const bits = [`${a.alias} · session ${a.fiveHourPct == null ? '--' : a.fiveHourPct + '%'}`]
    if (a.sevenDayPct != null) bits.push(`weekly ${a.sevenDayPct}%`)
    if (a.fiveHourResetMs != null) bits.push(`resets ${fmtMins((a.fiveHourResetMs - Date.now()) / 60000)}`)
    return 'Claude-O-Meter — ' + bits.join(' · ')
  }
  const get = (id) => { const r = lastReadings.find(x => x.id === id); return r && Number.isFinite(r.value) ? r.value : null }
  const s5 = get('/claude/session/pct'), s7 = get('/claude/week/pct'), rs = get('/claude/session/reset')
  if (s5 == null && s7 == null) return 'Claude-O-Meter — waiting for usage'
  const bits = []
  if (s5 != null) bits.push(`session ${Math.round(s5)}%`)
  if (s7 != null) bits.push(`weekly ${Math.round(s7)}%`)
  if (rs != null) bits.push(`resets ${fmtMins(rs)}`)
  return 'Claude-O-Meter — ' + bits.join(' · ')
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return
  // Called on the 1s usage tick, so skip the call unless the text moved.
  const tip = trayTooltip()
  if (tip !== trayTip) { tray.setToolTip(tip); trayTip = tip }
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

// Plain-language guide to what the panel shows. The meters are self-evident;
// the freshness chip and the multi-account rules are not.
function showHelp(parent) {
  const detail = [
    'SESSION  your 5-hour rolling limit. WEEKLY  the 7-day limit.',
    'A third row appears only when the account has a model-scoped weekly limit,',
    'and it labels itself with that model.',
    '',
    'With the cswap CLI installed, every connected account gets its own block.',
    'ACTIVE marks the account Claude Code is currently signed in as.',
    '',
    'The chip after each account name is how old that account\'s figures are:',
    'live (under 75s), then 3m ago, 5m ago and so on. Three minutes is the',
    'floor — Claude\'s usage endpoint budgets about 28-30 requests an hour per',
    'account, so nothing can poll faster without getting the account blocked.',
    'An idle account drifts further out while its usage is not moving. The chip',
    'turns amber past 12 minutes, which usually means the account is in backoff.',
    '',
    'Switch accounts from Settings -> Switch Account. Resize freely: the bars',
    'stretch and the text scales on its own, and Settings -> Text Size sets how',
    'large that text gets.',
  ].join('\n')
  const opts = {
    type: 'info',
    title: 'How to read this',
    message: 'Claude-O-Meter',
    detail,
    buttons: ['OK'],
    noLink: true,
  }
  if (parent && !parent.isDestroyed()) dialog.showMessageBox(parent, opts)
  else dialog.showMessageBox(opts)
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
    // Replaced by applyMinimumSize() as soon as the account count is known.
    minWidth: Math.round(BASE_SIZE.width * minFactor()),
    minHeight: Math.round(BASE_SIZE.height * minFactor()),
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
      refreshTray()
    }, { claudeUsage: wantOAuthProvider() })
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
    // 400 not 380: eight 36px theme swatches with 8px gaps need 344px of
    // content width, and 380 minus the body's 20px padding leaves 340 — the
    // last swatch wrapped to its own row.
    width: 400,
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
// A tray context menu is set once, not built per popup, so it is rebuilt
// whenever the account list changes — otherwise the Switch Account submenu
// would still list whatever cswap reported at launch.
function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Widget',    click: () => { if (!win) createWindow(); else win.show() } },
    { label: 'Hide Widget',    click: () => { if (win) win.hide() } },
    { label: 'Refresh Now',    click: () => { if (claudeSwapHandle) claudeSwapHandle.refresh() } },
    { label: 'Switch Account', submenu: switchMenuItems() },
    { label: 'Settings',       click: () => openSettings() },
    { label: 'About',          click: () => showAbout(win) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
}

function createTray() {
  // GTK's tray takes a PNG; only Windows wants the .ico.
  tray = new Tray(path.join(__dirname, 'assets', 'images',
    process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png'))
  tray.setToolTip('Claude-O-Meter')
  refreshTray()
  buildTrayMenu()
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
  textScale: 1,
}

// Offered text sizes. A free-form number would let a bad value shrink the type
// to nothing, and the widget has no way back from that without editing JSON.
const TEXT_SCALES = [
  [0.9, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger'], [1.5, 'Largest'],
]

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
    if (TEXT_SCALES.some(([v]) => v === obj.textScale)) s.textScale = obj.textScale
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
  // setLoginItemSettings is a no-op outside Windows and macOS, so the setting
  // is only offered where it can actually take effect.
  if (app.isPackaged && CAN_AUTOSTART) app.setLoginItemSettings({ openAtLogin: settings.autostart })
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!settings.alwaysOnTop)
}

function broadcastSettings() {
  for (const w of [win, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('settings-change', settings)
  }
}

ipcMain.handle('settings:get', () => ({
  ...settings, isPackaged: app.isPackaged, canAutostart: CAN_AUTOSTART,
}))

ipcMain.on('settings:set', (_e, incoming) => {
  settings = validateSettings({ ...settings, ...incoming })
  saveSettings()
  applySettings()
  applyMinimumSize()
  applyUsageSource()
  if (settings.claudeUsage) startSwapCollector()
  else stopSwapCollector()
  refreshTray()
  broadcastSettings()
})

ipcMain.on('settings:close', () => { if (settingsWin) settingsWin.close() })

// ── Right-click menu ───────────────────────────────────────────────
// ── Header menus ───────────────────────────────────────────────────
// The two header buttons replace the right-click menu: everything that used to
// be behind a right-click is under Settings or Help, so nothing is reachable
// only by a gesture the widget never advertised. Popped at window-relative
// coordinates sent by the renderer, so each menu drops under its own button.
function themeMenuItems() {
  return THEMES.map(([value, label]) => ({
    label,
    type: 'radio',
    checked: value === ((settings && settings.theme) || 'cream'),
    click: () => { settings.theme = value; saveSettings(); broadcastSettings() },
  }))
}

function textScaleMenuItems() {
  const current = (settings && settings.textScale) || 1
  return TEXT_SCALES.map(([value, label]) => ({
    label: `${label}  (${Math.round(value * 100)}%)`,
    type: 'radio',
    checked: value === current,
    click: () => {
      settings.textScale = value
      saveSettings()
      applyMinimumSize()
      broadcastSettings()
    },
  }))
}

function settingsMenu() {
  return Menu.buildFromTemplate([
    { label: 'Settings…',      click: () => openSettings() },
    { label: 'Text Size',      submenu: textScaleMenuItems() },
    { label: 'Colors',         submenu: themeMenuItems() },
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
    { label: 'Refresh Now',    click: () => { if (claudeSwapHandle) claudeSwapHandle.refresh() } },
    { label: 'Switch Account', submenu: switchMenuItems() },
    { type: 'separator' },
    { label: 'Minimize',       click: () => win.minimize() },
    { label: 'Close',          click: () => win.close() },
  ])
}

function helpMenu() {
  return Menu.buildFromTemplate([
    { label: 'How to read this', click: () => showHelp(win) },
    { label: 'About',            click: () => showAbout(win) },
  ])
}

ipcMain.on('widget:menu', (_e, arg) => {
  if (!win || win.isDestroyed()) return
  const kind = arg && arg.kind
  const x = Math.round(Number(arg && arg.x) || 0)
  const y = Math.round(Number(arg && arg.y) || 0)
  const menu = kind === 'help' ? helpMenu() : settingsMenu()
  menu.popup({ window: win, x, y })
})

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

// ── Claude swap: switch the active cswap account ───────────────────
// Menu-driven only. The widget used to switch on a click of the account name,
// which put a live cswap invocation under the pointer while dragging the
// window — switching now costs a right-click and a menu pick, so it cannot
// happen by accident. Fixed argv arrays only, never shell-interpolated; the
// number is validated against the same rule cswap itself enforces.
const CSWAP_NUM_RE = /^[0-9]+$/
function swapSwitch(number, done) {
  if (!CSWAP_NUM_RE.test(String(number))) return done && done({ ok: false, error: 'invalid account number' })
  const { file, args } = cswapCmd(['switch', String(number)])
  execFile(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
    if (claudeSwapHandle) claudeSwapHandle.refresh()
    if (done) done(err ? { ok: false, error: String(stderr || err.message).slice(0, 300) } : { ok: true })
  })
}

// Built fresh on every popup so the list matches the last cswap poll.
function switchMenuItems() {
  const accounts = (lastClaudeSwap && lastClaudeSwap.ok && lastClaudeSwap.accounts) || []
  if (!accounts.length) return [{ label: 'No accounts detected', enabled: false }]
  return accounts.map(a => ({
    label: `${a.number} · ${a.alias}${a.active ? '  (active)' : ''}`,
    type: 'radio',
    checked: !!a.active,
    enabled: !a.active,
    click: () => swapSwitch(a.number),
  }))
}

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
