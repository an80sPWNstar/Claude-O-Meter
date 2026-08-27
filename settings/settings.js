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
  acctSrc: document.getElementById('acct-src'),
  accessOpts: document.querySelectorAll('input[name=accessmode]'),
  accessPathRow: document.getElementById('access-path-row'),
  accessPath: document.getElementById('access-path'),
  accessBrowse: document.getElementById('access-browse'),
  accessNote: document.getElementById('access-note'),
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
  fillAccess(s)
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

// ── account access mode ────────────────────────────────────────────
// The same three choices the installer offers, because a decision about what
// the app may read has to be revisitable without a reinstall.
const ACCESS_NOTES = {
  auto: 'Checks the .claude folder, CLAUDE_CONFIG_DIR, the app-data folders, the macOS keychain, and — only if none of those has a login — running WSL distributions.',
  manual: 'Reads the one file named above, and nothing else on disk.',
  browser: 'Reads nothing on disk. Use the button above to sign in.',
}

function currentAccessMode() {
  const picked = Array.from(el.accessOpts).find((r) => r.checked)
  return picked ? picked.value : 'auto'
}

function paintAccess() {
  const mode = currentAccessMode()
  el.accessPathRow.classList.toggle('on', mode === 'manual')
  el.accessNote.textContent = ACCESS_NOTES[mode] || ''
}

function pushAccess() {
  const mode = currentAccessMode()
  if (mode === 'manual' && !el.accessPath.value) {
    el.accessNote.textContent = 'Choose the file first — nothing is read until you do.'
    return
  }
  window.claudeOMeter.setAccessMode({ mode, credentialPath: el.accessPath.value })
}

for (const radio of el.accessOpts) {
  radio.addEventListener('change', () => { paintAccess(); pushAccess() })
}

el.accessBrowse.addEventListener('click', async () => {
  const chosen = await window.claudeOMeter.pickCredentialFile()
  if (!chosen) return
  el.accessPath.value = chosen
  // Say straight away whether that file is any good, rather than leaving the
  // widget blank and the user guessing.
  const probe = await window.claudeOMeter.probeAccessMode({ mode: 'manual', credentialPath: chosen })
  el.accessNote.textContent = probe && probe.found
    ? (probe.expired ? 'That file holds an expired login — run claude once to refresh it.' : 'Login found in that file.')
    : 'No Claude login in that file.'
  pushAccess()
})

function fillAccess(s) {
  const mode = s && s.accessMode ? s.accessMode : 'auto'
  for (const radio of el.accessOpts) radio.checked = radio.value === mode
  el.accessPath.value = (s && s.credentialPath) || ''
  paintAccess()
}

// ── where the numbers are coming from, or why there are none ───────
// A blank widget has half a dozen causes that look identical from the outside:
// no cswap, no Claude Code login on THIS machine, a credentials file that went
// stale because the CLI has not run in a while, polling switched off, or the
// endpoint rate-limiting us. Print the one that actually applies.
function ago(ms) {
  if (!ms) return 'never'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  return Math.round(s / 3600) + 'h ago'
}

function until(ms) {
  if (!ms) return 'for an unknown time'
  const m = Math.round((ms - Date.now()) / 60000)
  if (m <= 0) return 'expired'
  if (m < 60) return 'another ' + m + 'm'
  return 'another ' + Math.round(m / 60) + 'h'
}

function describeSource(d) {
  if (!d) return ''
  const lines = []
  if (d.swap && d.swap.ok && d.swap.accounts) {
    lines.push('Source: cswap — ' + d.swap.accounts + ' account' + (d.swap.accounts === 1 ? '' : 's'))
    return lines.join('\n')
  }
  lines.push("cswap: not detected — using this computer's Claude Code login")
  if (!d.pollEnabled) {
    lines.push("Polling is off — turn on 'Poll Claude usage' above")
    return lines.join('\n')
  }
  const c = d.provider && d.provider.credentials
  if (!c || !c.found) {
    lines.push('Claude Code credentials: none found on this computer')
    lines.push("Run 'claude' once and sign in, or use the button above")
  } else if (c.expired) {
    lines.push('Claude Code credentials: ' + c.source + ' — expired')
    lines.push("Run 'claude' once; it refreshes the token and this picks it up")
  } else {
    lines.push('Claude Code credentials: ' + c.source)
    lines.push('Token good for ' + until(c.expiresAt) + (c.subscriptionType ? ' · plan: ' + c.subscriptionType : ''))
  }
  const p = d.provider && d.provider.poll
  if (p && p.at) {
    lines.push(p.ok
      ? 'Last usage fetch: OK ' + ago(p.at)
      : 'Last usage fetch: failed ' + ago(p.at) + (p.status ? ' (HTTP ' + p.status + ')' : '') + (p.error ? ' — ' + p.error : ''))
  }
  return lines.join('\n')
}

function refreshDiagnostics() {
  window.claudeOMeter.claudeDiagnostics()
    .then((d) => { el.acctSrc.textContent = describeSource(d) })
    .catch(() => { el.acctSrc.textContent = '' })
}

refreshDiagnostics()
setInterval(refreshDiagnostics, 5000)

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
