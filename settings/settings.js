// Settings window — loads current settings, pushes every change live to main
// (no OK button). Main validates and echoes 'settings-change' back, which
// re-fills the controls with the sanitized values.
'use strict'

const el = {
  autostart: document.getElementById('autostart'),
  autostartRow: document.getElementById('autostart-row'),
  autostartHint: document.getElementById('autostart-hint'),
  tray: document.getElementById('tray'),
  ontop: document.getElementById('ontop'),
  usage: document.getElementById('usage'),
  textscale: document.getElementById('textscale'),
  close: document.getElementById('btn-close'),
  themePick: document.getElementById('theme-pick'),
  acctStatus: document.getElementById('acct-status'),
  acctBtn: document.getElementById('acct-btn'),
  acctErr: document.getElementById('acct-err'),
}

// Swatch colors mirror the [data-theme] blocks in renderer/index.html.
const THEMES = [
  { id: 'cream',    bg: '#F0EEE6', accent: '#D97757', fg: '#191919', label: 'Crm' },
  { id: 'dark',     bg: '#1F1E1B', accent: '#D97757', fg: '#F0EEE6', label: 'Drk' },
  { id: 'midnight', bg: '#0F1115', accent: '#5B8DEF', fg: '#E8EAF0', label: 'Mid' },
  { id: 'phosphor', bg: '#050805', accent: '#33FF33', fg: '#33FF33', label: 'Phs' },
  { id: 'outrun',   bg: '#160030', accent: '#FF2D95', fg: '#22D3FF', label: 'Out' },
  { id: 'cinch',    bg: '#101112', accent: '#17d42a', fg: '#FFFFFF', label: 'Cin' },
  { id: 'porsche',  bg: '#2E3238', accent: '#D5001C', fg: '#F5F5F3', label: 'Por' },
  { id: 'temple',   bg: '#0D0F14', accent: '#D97757', fg: '#FFFFFF', label: 'Tml' },
]

function buildThemes() {
  el.themePick.innerHTML = ''
  THEMES.forEach(t => {
    const s = document.createElement('div')
    s.className = 'theme-swatch'
    s.dataset.theme = t.id
    s.title = t.id.charAt(0).toUpperCase() + t.id.slice(1)
    s.style.background = `linear-gradient(135deg, ${t.bg}, ${t.accent})`
    s.style.color = t.fg
    s.innerHTML = `<span>${t.label}</span>`
    s.addEventListener('click', () => {
      el.themePick.querySelectorAll('.theme-swatch').forEach(x => x.classList.remove('active'))
      s.classList.add('active')
      window.claudeOMeter.setSettings({ theme: t.id })
    })
    el.themePick.appendChild(s)
  })
}
buildThemes()

function fill(s) {
  el.autostart.checked = !!s.autostart
  el.tray.checked = !!s.minimizeToTray
  el.ontop.checked = !!s.alwaysOnTop
  el.usage.checked = !!s.claudeUsage
  // Main is the authority on the allowed values; an unknown one falls back to
  // 100% rather than leaving the dropdown showing something it will not honour.
  const scale = String(s.textScale ?? 1)
  el.textscale.value = [...el.textscale.options].some(o => o.value === scale) ? scale : '1'
  const tid = s.theme || 'cream'
  el.themePick.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === tid)
  })
}

function push() {
  window.claudeOMeter.setSettings({
    autostart: el.autostart.checked,
    minimizeToTray: el.tray.checked,
    alwaysOnTop: el.ontop.checked,
    claudeUsage: el.usage.checked,
    textScale: Number(el.textscale.value),
  })
}

window.claudeOMeter.getSettings().then((s) => {
  fill(s)
  if (!s.isPackaged || s.canAutostart === false) {
    el.autostart.disabled = true
    el.autostartRow.classList.add('disabled')
    el.autostartHint.textContent = s.canAutostart === false
      ? ' (not supported on this platform)'
      : ' (installed builds only)'
    el.autostartHint.style.display = 'inline'
  }
})

// Main echoes sanitized settings back (also fires when the widget's right-click
// menu changes a value).
window.claudeOMeter.onSettingsChange(fill)

el.autostart.addEventListener('change', push)
el.tray.addEventListener('change', push)
el.ontop.addEventListener('change', push)
el.usage.addEventListener('change', push)
el.textscale.addEventListener('change', push)

// ── claude.ai account login ────────────────────────────────────────
let loggedIn = false

function fillStatus(s) {
  loggedIn = !!(s && s.loggedIn)
  el.acctStatus.textContent = loggedIn
    ? 'Claude account: Connected ✓'
    : 'Not connected — using Claude Code credentials if installed'
  el.acctStatus.classList.toggle('ok', loggedIn)
  el.acctBtn.textContent = loggedIn ? 'Log out' : 'Log in with Claude account'
  el.acctBtn.disabled = false

  if (loggedIn && s.lastError) {
    let msg
    if (s.lastError === 'CloudflareBlocked' || s.lastError === 'CloudflareChallenge') {
      msg = 'Cloudflare is blocking usage checks — stats may be delayed'
    } else if (s.lastError === 'SchemaMismatch') {
      msg = 'Claude changed its usage API — update the app'
    } else {
      msg = 'Usage fetch failing: ' + s.lastError
    }
    showError(msg)
  } else {
    showError('')
  }
}

function showError(msg) {
  el.acctErr.textContent = msg
  el.acctErr.style.display = msg ? 'block' : 'none'
}

window.claudeOMeter.claudeStatus().then(fillStatus)
window.claudeOMeter.onClaudeStatusChange(fillStatus)

el.acctBtn.addEventListener('click', async () => {
  el.acctBtn.disabled = true
  showError('')
  if (loggedIn) {
    await window.claudeOMeter.claudeLogout()
    fillStatus({ loggedIn: false })
  } else {
    const r = await window.claudeOMeter.claudeLogin()
    if (r && r.success) {
      fillStatus({ loggedIn: true })
    } else {
      fillStatus({ loggedIn: false })
      showError(r && r.error ? r.error : 'Login failed')
    }
  }
})

el.close.addEventListener('click', () => window.claudeOMeter.closeSettings())

if (window.lucide) lucide.createIcons()
