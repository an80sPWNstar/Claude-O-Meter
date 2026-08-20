// Renderer — paints Claude plan usage. Two views over one layout:
//   single-account: readings from the OAuth token or claude.ai cookie session
//   multi-account:  one meter block per cswap account (takes precedence)
'use strict'

const bezel = document.getElementById('bezel')

// ── Scale-to-fit ───────────────────────────────────────────────────
// The bezel is pinned to its native pixel size; when the OS window differs
// (user resize) the whole widget is zoomed with a translate+scale and centered
// — no reflow, no clipping. At the native size the factor is exactly 1.
const BASE_SIZE = { width: 360, height: 230 }

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
  bezel.style.width = `${nw}px`
  bezel.style.height = `${nh}px`
  const s = Math.min(ww / nw, wh / nh)
  const tx = (ww - nw * s) / 2
  const ty = (wh - nh * s) / 2
  bezel.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
}
window.addEventListener('resize', fitBezel)
fitBezel()

// ── Window controls ────────────────────────────────────────────────
document.getElementById('btn-minimize').addEventListener('click', () => window.claudeOMeter?.minimize())
document.getElementById('btn-close').addEventListener('click', () => window.claudeOMeter?.close())

document.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.claudeOMeter?.showContextMenu()
})

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
  if (e.target.closest('.win-controls, .acct-name, button, input, select')) return
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

function applySettings(s) {
  if (!s) return
  if (typeof s.theme === 'string') bezel.setAttribute('data-theme', s.theme)
  if (typeof s.claudeUsage === 'boolean') {
    usageEnabled = s.claudeUsage
    render()
  }
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
  return `<div class="acct"><span class="acct-name"></span>` +
    row('Session', 's5') + row('Weekly', 's7') + row('Scoped', 'sf') + `</div>`
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

    // The account name doubles as the cswap switch control.
    const name = block.querySelector('.acct-name')
    name.textContent = (a.active ? '▸ ' : '') + a.number + ' · ' + a.alias
    const switchable = !a.active
    name.classList.toggle('switchable', switchable)
    name.title = switchable ? 'Switch to this account' : ''
    name.onclick = switchable ? () => window.claudeOMeter?.claudeSwapSwitch?.(a.number) : null

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
  el.hint.textContent = usageEnabled
    ? 'Waiting for Claude usage — log in via Settings if not connected'
    : 'Usage polling is off — enable it in Settings'
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
