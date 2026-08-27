// Renderer — paints Claude plan usage. Two views over one layout:
//   single-account: readings from the OAuth token or claude.ai cookie session
//   multi-account:  one meter block per cswap account (takes precedence)
'use strict'

const bezel = document.getElementById('bezel')

// ── Fit ────────────────────────────────────────────────────────────
// The widget fills the window in both axes and reflows: a wider window gives
// longer bars, a taller one more room between rows, and the two are
// independent. Only the type scale is uniform — text is zoomed by a single
// factor rather than stretched per axis, since a non-uniform scale is exactly
// what wrecks glyph proportions. `zoom` is used rather than `transform: scale`
// because zoom changes the layout box, so the flex rows below still lay out
// against the real window size; a transform would paint over a box that never
// reflowed.
const BASE_SIZE = { width: 360, height: 230 }

// Type-scale bounds. Below the floor the labels stop being legible; above the
// ceiling a stretched window turns into billboard text with empty gutters.
const MIN_ZOOM = 0.75
const MAX_ZOOM = 2.5

// Type follows the window sub-linearly. Straight proportional scaling made the
// text collapse the moment the window came off its native size — half the
// window meant half the type — which is unreadable long before the layout
// actually needs the room. At 0.6, half the window still leaves the text at
// ~66%, so shrinking mostly costs whitespace and bar length instead.
const ZOOM_CURVE = 0.6

// Settings → Text Size. Multiplies the fitted zoom, so it raises the whole
// curve rather than pinning one size.
let textScale = 1

// Latest cswap all-account payload — null until the first poll.
let lastSwap = null

// Mirrors widgetSize() in main.js — keep the formula in sync.
function nativeSize() {
  const n = lastSwap && lastSwap.ok ? lastSwap.accounts.length : 0
  if (n >= 2) return { width: 400, height: 96 + 96 * n }
  return BASE_SIZE
}

function fitBezel() {
  const { width: nw, height: nh } = nativeSize()
  const ww = window.innerWidth
  const wh = window.innerHeight
  if (!ww || !wh) return
  // The smaller ratio drives the type scale, so stretching one axis lengthens
  // the bars instead of inflating the text off the other edge.
  const ratio = Math.min(ww / nw, wh / nh)
  const fitted = Math.pow(ratio, ZOOM_CURVE)
  const z = Math.min(Math.max(fitted, MIN_ZOOM), MAX_ZOOM) * textScale
  // Sizes are set in the zoomed coordinate space, which is the window divided
  // by the factor — the bezel then covers the window exactly at any shape.
  bezel.style.zoom = z
  bezel.style.width = `${ww / z}px`
  bezel.style.height = `${wh / z}px`
}
window.addEventListener('resize', fitBezel)
fitBezel()

// ── Window controls ────────────────────────────────────────────────
document.getElementById('btn-minimize').addEventListener('click', () => window.claudeOMeter?.minimize())
document.getElementById('btn-close').addEventListener('click', () => window.claudeOMeter?.close())

// The header buttons carry every command the right-click menu used to. Each
// menu is popped under its own button, at coordinates in window space.
function openMenu(kind, btn) {
  const r = btn.getBoundingClientRect()
  // getBoundingClientRect is in the bezel's zoomed space; the menu is placed in
  // real window pixels, so undo the zoom before sending.
  const z = Number(bezel.style.zoom) || 1
  window.claudeOMeter?.showMenu?.(kind, Math.round(r.left * z), Math.round(r.bottom * z))
}
const btnSettings = document.getElementById('btn-settings')
const btnHelp = document.getElementById('btn-help')
btnSettings.addEventListener('click', () => openMenu('settings', btnSettings))
btnHelp.addEventListener('click', () => openMenu('help', btnHelp))
document.addEventListener('contextmenu', (e) => e.preventDefault())

// ── JS window drag ─────────────────────────────────────────────────
// -webkit-app-region:drag is deliberately not used: it makes Windows treat the
// body as a title bar, which swallows our right-click menu and grows the window
// while dragging.
let dragging = false
let dragX = 0
let dragY = 0
const RESIZE_BORDER = 8

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (e.target.closest('.win-controls, .mbtn, button, input, select')) return
  // Skip the frameless resize border zone, or native resize and JS drag both fire.
  const cx = e.clientX, cy = e.clientY
  const ww = window.innerWidth, wh = window.innerHeight
  if (cx < RESIZE_BORDER || cy < RESIZE_BORDER ||
      cx >= ww - RESIZE_BORDER || cy >= wh - RESIZE_BORDER) return
  window.claudeOMeter?.dragStart?.()
  dragging = true
  dragX = e.screenX
  dragY = e.screenY
})

document.addEventListener('mousemove', (e) => {
  if (!dragging) return
  // If the button was released outside the window, mouseup never fired — self-heal.
  if (!(e.buttons & 1)) { window.claudeOMeter?.dragEnd?.(); dragging = false; return }
  const dx = e.screenX - dragX
  const dy = e.screenY - dragY
  if (dx !== 0 || dy !== 0) {
    window.claudeOMeter?.moveWindow(dx, dy)
    dragX = e.screenX
    dragY = e.screenY
  }
})

document.addEventListener('mouseup', () => {
  if (dragging) window.claudeOMeter?.dragEnd?.()
  dragging = false
})
document.documentElement.addEventListener('mouseleave', () => {
  if (dragging) window.claudeOMeter?.dragEnd?.()
  dragging = false
})

// ── Settings ───────────────────────────────────────────────────────
let usageEnabled = true
let accessMode = 'auto'

function applySettings(s) {
  if (!s) return
  if (typeof s.theme === 'string') bezel.setAttribute('data-theme', s.theme)
  if (Number.isFinite(s.textScale) && s.textScale !== textScale) {
    textScale = s.textScale
    fitBezel()
  }
  if (typeof s.accessMode === 'string') accessMode = s.accessMode
  if (typeof s.claudeUsage === 'boolean') usageEnabled = s.claudeUsage
  render()
}
window.claudeOMeter?.onSettingsChange?.(applySettings)
window.claudeOMeter?.getSettings?.()?.then?.(applySettings)

// ── Elements ───────────────────────────────────────────────────────
const el = {
  hint:         document.getElementById('hint'),
  meters:       document.getElementById('meters'),
  sessionVal:   document.getElementById('session-val'),
  sessionBar:   document.getElementById('session-bar'),
  sessionReset: document.getElementById('session-reset'),
  weekVal:      document.getElementById('week-val'),
  weekBar:      document.getElementById('week-bar'),
  weekReset:    document.getElementById('week-reset'),
  scopedMeter:  document.getElementById('scoped-meter'),
  scopedLabel:  document.getElementById('scoped-label'),
  scopedVal:    document.getElementById('scoped-val'),
  scopedBar:    document.getElementById('scoped-bar'),
  scopedReset:  document.getElementById('scoped-reset'),
  accounts:     document.getElementById('accounts'),
  auto:         document.getElementById('auto'),
  autoDot:      document.getElementById('auto-dot'),
  autoVal:      document.getElementById('auto-val'),
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// Countdown readings carry minutes → '3h 45m' / '42m' / '2d 4h'.
function fmtMinutes(mins) {
  const m = Math.max(0, Math.round(mins))
  if (m >= 2880) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

// resetMs is an absolute epoch-ms timestamp — recomputed against Date.now() on
// every repaint (the 1s tick) so the countdown stays live between the
// collector's 45s polls.
function fmtResetMs(ms) {
  if (ms == null) return ''
  return fmtMinutes((ms - Date.now()) / 60000)
}

// ── Multi-account view (cswap) ─────────────────────────────────────
// One block per account: name + Session/Weekly rows, plus a model-scoped
// (e.g. Fable) row when the account has one. data-roles are scoped per block.
function acctHtml() {
  const row = (label, role) =>
    `<div class="row" data-role="${role}"><span class="row-label">${label}</span>` +
    `<div class="track"><div class="fill"></div></div>` +
    `<span class="row-val">--%</span><span class="row-reset"></span></div>`
  return `<div class="acct"><span class="acct-head">` +
    `<span class="acct-name"></span><span class="acct-tag">ACTIVE</span>` +
    `<span class="acct-age"></span></span>` +
    row('Session', 's5') + row('Weekly', 's7') + row('Scoped', 'sf') + `</div>`
}

// cswap distinguishes seven states behind "no usage"; flattening them to a dim
// blank row makes a fixable problem look like a broken app. The wording is the
// user-facing fix, not the internal name — 'relogin_required' means the stored
// refresh token was rejected, and only a fresh login repairs it.
const STATUS_LABEL = {
  relogin_required: 're-login needed',
  no_credentials: 'not logged in',
  token_expired: 'refreshing…',
  keychain_unavailable: 'keychain locked',
  foreign_credential: 'switch to repair',
  api_key: 'API key — no quota',
  unavailable: 'no data',
}

// Which of those are the user's to fix, and so worth colouring.
const STATUS_ACTIONABLE = new Set([
  'relogin_required', 'no_credentials', 'keychain_unavailable', 'foreign_credential',
])

// How old the account's numbers are. Every account is polled, not just the
// active one, but cswap refetches each on its own ~5 min schedule, so the chip
// says how current each row actually is rather than implying all are equal.
const STALE_MS = 12 * 60000

function fmtAge(fetchedMs) {
  if (!Number.isFinite(fetchedMs)) return { text: '', stale: false }
  const sec = Math.max(0, (Date.now() - fetchedMs) / 1000)
  if (sec < 75) return { text: 'live', stale: false }
  const min = Math.floor(sec / 60)
  if (min < 60) return { text: min + 'm ago', stale: sec * 1000 > STALE_MS }
  return { text: Math.floor(min / 60) + 'h ago', stale: true }
}

function paintRow(acctEl, role, pct, resetMs) {
  const rowEl = acctEl.querySelector(`[data-role="${role}"]`)
  const fill = rowEl.querySelector('.fill')
  const val = rowEl.querySelector('.row-val')
  const has = Number.isFinite(pct)
  const v = has ? clamp(pct, 0, 100) : 0
  fill.style.width = `${v}%`
  val.textContent = has ? `${Math.round(v)}%` : '--%'
  fill.classList.toggle('warn', has && v >= 80)
  val.classList.toggle('warn', has && v >= 80)
  rowEl.querySelector('.row-reset').textContent = fmtResetMs(resetMs)
}

function renderAccounts(swap) {
  const accounts = swap.accounts
  // Rebuild the DOM only when the account list itself changes; repaints
  // otherwise just update the existing rows in place.
  const sig = accounts.map(a => a.number + ':' + a.alias + ':' + (a.active ? 1 : 0)).join('|')
  if (el.accounts.dataset.sig !== sig) {
    el.accounts.dataset.sig = sig
    el.accounts.innerHTML = accounts.map(() => acctHtml()).join('')
  }
  const blocks = el.accounts.children
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]
    const block = blocks[i]
    block.classList.toggle('active', !!a.active)
    // usageStatus !== 'ok' → cswap couldn't fetch usage; dim = "no data", not 0%.
    block.classList.toggle('na', a.usageStatus !== 'ok')

    // Display only. Switching accounts is a right-click menu item in the main
    // process: a click target here sat under the pointer during a drag and
    // fired cswap by accident.
    const name = block.querySelector('.acct-name')
    name.textContent = a.number + ' · ' + a.alias
    // Which account cswap is currently pointed at. Said in a word, not in a
    // colour and an arrow — nobody reads a legend that isn't there.
    block.querySelector('.acct-tag').style.display = a.active ? '' : 'none'

    const age = block.querySelector('.acct-age')
    if (a.usageStatus === 'ok') {
      const f = fmtAge(a.usageFetchedMs)
      age.textContent = f.text
      age.classList.toggle('stale', f.stale)
    } else {
      age.textContent = STATUS_LABEL[a.usageStatus] || 'no data'
      age.classList.toggle('stale', STATUS_ACTIONABLE.has(a.usageStatus))
    }

    paintRow(block, 's5', a.fiveHourPct, a.fiveHourResetMs)
    paintRow(block, 's7', a.sevenDayPct, a.sevenDayResetMs)
    const sf = block.querySelector('[data-role="sf"]')
    if (a.scopedName) {
      sf.style.display = ''
      sf.querySelector('.row-label').textContent = a.scopedName
      paintRow(block, 'sf', a.scopedPct, a.scopedResetMs)
    } else {
      sf.style.display = 'none'
    }
  }
}

function renderAuto(swap) {
  el.autoDot.classList.toggle('on', !!swap.autoOn)
  el.autoVal.textContent = swap.autoOn
    ? (swap.autoSinceMin != null ? `ON · ${swap.autoSinceMin}m` : 'ON')
    : 'OFF'
}

// ── Render ─────────────────────────────────────────────────────────
let lastReadings = []

function paintMeter(pct, reset, valEl, barEl, resetEl) {
  const has = Number.isFinite(pct?.value)
  const v = has ? clamp(pct.value, 0, 100) : 0
  valEl.textContent = has ? `${Math.round(v)}%` : '--%'
  barEl.style.width = `${v}%`
  resetEl.textContent = reset ? `resets in ${fmtMinutes(reset.value)}` : ''
  valEl.classList.toggle('warn', has && v >= 80)
  barEl.classList.toggle('warn', has && v >= 80)
}

function render() {
  // Multi-account view when cswap reports connected accounts; otherwise fall
  // through to the single-account meters fed by the OAuth/cookie provider.
  const multi = usageEnabled && lastSwap && lastSwap.ok &&
    Array.isArray(lastSwap.accounts) && lastSwap.accounts.length > 0
  el.accounts.style.display = multi ? 'flex' : 'none'
  el.auto.style.display = multi ? 'flex' : 'none'
  if (multi) {
    el.hint.style.display = 'none'
    el.meters.style.display = 'none'
    renderAccounts(lastSwap)
    renderAuto(lastSwap)
    return
  }

  const readings = lastReadings
  const sessionPct = readings.find(r => r.id === '/claude/session/pct')
  const weekPct = readings.find(r => r.id === '/claude/week/pct')
  const sessionReset = readings.find(r => r.id === '/claude/session/reset')
  const weekReset = readings.find(r => r.id === '/claude/week/reset')
  const scopedPct = readings.find(r => r.id === '/claude/scoped/pct')
  const scopedReset = readings.find(r => r.id === '/claude/scoped/reset')

  // Any reading present → show the meters (each degrades to '--%' on its own).
  // Nothing at all → the hint says WHY: polling off vs data not fetched yet.
  const active = sessionPct || weekPct || sessionReset || weekReset || scopedPct || scopedReset
  // Three different silences, three different sentences. 'ask' is the one that
  // matters most: nothing has been read because nobody has said it may be.
  if (!usageEnabled) el.hint.textContent = 'Usage polling is off — enable it in Settings'
  else if (accessMode === 'ask') el.hint.textContent = 'Waiting on you: choose how this app may reach your Claude account'
  else if (accessMode === 'browser') el.hint.textContent = 'Not signed in — use Log in with Claude account in Settings'
  else el.hint.textContent = 'Waiting for Claude usage — check Account access in Settings'
  el.hint.style.display = active ? 'none' : 'flex'
  el.meters.style.display = active ? 'flex' : 'none'
  if (!active) return

  paintMeter(sessionPct, sessionReset, el.sessionVal, el.sessionBar, el.sessionReset)
  paintMeter(weekPct, weekReset, el.weekVal, el.weekBar, el.weekReset)

  // The scoped meter only shows when the account has a model-scoped limit.
  const scopedActive = scopedPct || scopedReset
  el.scopedMeter.style.display = scopedActive ? '' : 'none'
  if (scopedActive) {
    const model = (scopedPct && scopedPct.model) || (scopedReset && scopedReset.model)
    if (model) el.scopedLabel.textContent = `${model} (7D)`.toUpperCase()
    paintMeter(scopedPct, scopedReset, el.scopedVal, el.scopedBar, el.scopedReset)
  }
}

window.claudeOMeter?.onUsageData?.((payload) => {
  lastReadings = (payload && payload.readings) || []
  render()
})

// cswap all-account stream — repaint + re-fit (the account count sets the
// native height; main.js resizes the OS window to match).
window.claudeOMeter?.onClaudeSwap?.((swap) => {
  lastSwap = swap
  fitBezel()
  render()
})

if (typeof lucide !== 'undefined') lucide.createIcons()
