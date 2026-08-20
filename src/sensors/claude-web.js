// Cookie-session Claude usage source (main-process only). When no Claude Code
// OAuth token exists, the user can log into claude.ai in a popup window; we
// capture the sessionKey cookie, store it encrypted (safeStorage), and fetch
// usage from claude.ai's internal API through a hidden BrowserWindow — a plain
// fetch() gets blocked by Cloudflare, a real Chromium page does not.
// Adapted from SlavomirDurej/claude-usage-widget.

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, session, safeStorage } = require('electron')

const FALLBACK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let _cachedUA = null

// Real Chromium UA of the running Electron, minus the Electron and app-name
// tokens — a stale hardcoded Chrome version is prime Cloudflare bot-bait.
function realisticUA() {
  if (_cachedUA) return _cachedUA
  const raw = app.userAgentFallback
  if (!raw) {
    _cachedUA = FALLBACK_UA
    return _cachedUA
  }
  let ua = raw.replace(/(electron|claude-o-meter[^ ]*)\/[\S]+ ?/gi, '')
  ua = ua.replace(/  +/g, ' ').trim()
  _cachedUA = ua
  return _cachedUA
}

// Transient-failure tracking: one Cloudflare hiccup in the hidden fetch window
// must not nuke the stored session (the user isn't there to re-login).
let consecutiveAuthFails = 0
let lastError = null
const FETCH_TIMEOUT_MS = 30 * 1000
const ALLOWED_LOGIN_HOSTS = [
  'claude.ai',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
]

// ---- store: { sessionKeyEnc | sessionKey, organizationId } ----------------

function storePath() {
  return path.join(app.getPath('userData'), 'claude-web.json')
}

function readStore() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')) } catch { return null }
}

function writeStore(data) {
  fs.writeFileSync(storePath(), JSON.stringify(data))
}

function deleteStore() {
  try { fs.unlinkSync(storePath()) } catch { /* already gone */ }
}

function getSessionKey() {
  const store = readStore()
  if (!store) return null
  if (store.sessionKeyEnc) {
    try { return safeStorage.decryptString(Buffer.from(store.sessionKeyEnc, 'base64')) } catch { return null }
  }
  return store.sessionKey || null
}

function saveSessionKey(key) {
  const store = readStore() || {}
  delete store.sessionKey
  delete store.sessionKeyEnc
  if (safeStorage.isEncryptionAvailable()) {
    store.sessionKeyEnc = safeStorage.encryptString(key).toString('base64')
  } else {
    store.sessionKey = key
  }
  writeStore(store)
}

// ---- session-expired callbacks ---------------------------------------------

const expiredCallbacks = []

function onSessionExpired(cb) {
  expiredCallbacks.push(cb)
}

function fireExpired() {
  for (const cb of expiredCallbacks) {
    try { cb() } catch { /* callback's problem */ }
  }
}

// ---- cookies ---------------------------------------------------------------

async function removeClaudeCookies() {
  const cookies = await session.defaultSession.cookies.get({ name: 'sessionKey' })
  for (const c of cookies) {
    if (!c.domain || !c.domain.includes('claude.ai')) continue
    const url = `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`
    try { await session.defaultSession.cookies.remove(url, 'sessionKey') } catch { /* best effort */ }
  }
}

async function plantSessionCookie(key) {
  await session.defaultSession.cookies.set({
    url: 'https://claude.ai',
    name: 'sessionKey',
    value: key,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true,
  })
}

// ---- hidden-window fetch ----------------------------------------------------

async function fetchJson(url) {
  // Re-plant the stored cookie so the fetch works even if Electron's session
  // cookies were cleared while our stored key is still valid.
  const key = getSessionKey()
  if (key) await plantSessionCookie(key)

  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  try {
    win.webContents.setUserAgent(realisticUA())
    const body = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), FETCH_TIMEOUT_MS)
      win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
        // Subframe failures and ERR_ABORTED (-3, fired on redirects) are not
        // fatal for the main document — ignore them or we false-reject.
        if (!isMainFrame || code === -3) return
        clearTimeout(timer)
        reject(new Error(`LoadFailed: ${desc || code}`))
      })
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript('document.body.innerText || document.body.textContent')
          .then((text) => { clearTimeout(timer); resolve(text || '') })
          .catch((err) => { clearTimeout(timer); reject(err) })
      })
      win.loadURL(url).catch(() => { /* did-fail-load rejects */ })
    })

    if (body.includes('Just a moment')) throw new Error('CloudflareBlocked')
    if (body.includes('Enable JavaScript and cookies to continue')) throw new Error('CloudflareChallenge')
    const trimmed = body.trim()
    if (trimmed.startsWith('<html') || trimmed.startsWith('<!')) throw new Error('UnexpectedHTML')
    try {
      return JSON.parse(trimmed)
    } catch {
      throw new Error(`InvalidJSON: ${trimmed.slice(0, 200)}`)
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

// ---- org discovery -----------------------------------------------------------

async function discoverOrgId() {
  const orgs = await fetchJson('https://claude.ai/api/organizations')
  if (!Array.isArray(orgs) || !orgs.length) throw new Error('NoOrganization')
  const chat = orgs.filter((o) => o && Array.isArray(o.capabilities) && o.capabilities.includes('chat'))
  const pick = chat.find((o) => o.raven_type === 'team') || chat[0] || orgs[0]
  const id = pick && (pick.uuid || pick.id)
  if (!id) throw new Error('NoOrganization')
  const store = readStore() || {}
  store.organizationId = id
  writeStore(store)
  return id
}

// ---- public API ---------------------------------------------------------------

async function login() {
  // Leftover cookies from an earlier login would fire the 'changed' listener
  // with a stale key — clear them first.
  await removeClaudeCookies().catch(() => {})

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    let settled = false

    const onCookieChanged = (_event, cookie, _cause, removed) => {
      if (settled) return
      if (cookie.name !== 'sessionKey' || removed || !cookie.value) return
      if (!cookie.domain || !cookie.domain.includes('claude.ai')) return
      settled = true
      session.defaultSession.cookies.removeListener('changed', onCookieChanged)
      saveSessionKey(cookie.value)
      consecutiveAuthFails = 0
      lastError = null
      if (!win.isDestroyed()) win.close()
      // Org discovery failure is non-fatal — fetchUsage retries it lazily.
      discoverOrgId().then(
        () => resolve({ success: true }),
        () => resolve({ success: true })
      )
    }
    session.defaultSession.cookies.on('changed', onCookieChanged)

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      let host = ''
      try { host = new URL(url).hostname } catch { /* fall through to block */ }
      const ok = ALLOWED_LOGIN_HOSTS.some((h) => host === h || host.endsWith('.' + h))
      if (!ok) event.preventDefault()
    })
    win.on('closed', () => {
      if (settled) return
      settled = true
      session.defaultSession.cookies.removeListener('changed', onCookieChanged)
      resolve({ success: false, error: 'Login window closed' })
    })

    win.webContents.setUserAgent(realisticUA())
    win.loadURL('https://claude.ai/login')
  })
}

async function logout() {
  deleteStore()
  await removeClaudeCookies().catch(() => {})
  try {
    await session.defaultSession.clearStorageData({
      origin: 'https://claude.ai',
      storages: ['localstorage', 'sessionstorage', 'cachestorage'],
    })
  } catch { /* best effort */ }
  fireExpired()
}

function status() {
  return { loggedIn: !!getSessionKey(), lastError }
}

function expire() {
  deleteStore()
  fireExpired()
  throw new Error('SessionExpired')
}

function pct(v) {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null
}

function parseDate(iso) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

async function fetchUsage() {
  if (!getSessionKey()) throw new Error('NotLoggedIn')

  const store = readStore() || {}
  const orgId = store.organizationId || await discoverOrgId()

  let body
  try {
    body = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`)
  } catch (err) {
    // Cloudflare interstitial / HTML instead of JSON usually means a transient
    // bot-check in the hidden window, not a dead session — only force a
    // re-login after three failures in a row.
    if (['CloudflareBlocked', 'CloudflareChallenge', 'UnexpectedHTML'].includes(err && err.message)) {
      consecutiveAuthFails++
      lastError = err && err.message
      if (consecutiveAuthFails >= 3) expire()
    } else {
      lastError = err && err.message
    }
    throw err
  }

  const sessionResetsAt = parseDate(body?.five_hour?.resets_at)
  const weekResetsAt = parseDate(body?.seven_day?.resets_at)
  if (sessionResetsAt == null && weekResetsAt == null) {
    // API shape changed — keep the session, surface the problem instead.
    lastError = 'SchemaMismatch'
    throw new Error('SchemaMismatch')
  }

  // Model-scoped weekly limit (e.g. Fable) — the limits array may be absent
  // on this endpoint, parse fully defensively.
  let scopedPct = null
  let scopedResetsAt = null
  let scopedModel = null
  if (Array.isArray(body?.limits)) {
    const scopedEntry = body.limits.find(
      (entry) => entry.kind === 'weekly_scoped' && entry?.scope?.model
    )
    if (scopedEntry) {
      scopedPct = pct(scopedEntry.percent)
      scopedResetsAt = parseDate(scopedEntry.resets_at)
      scopedModel = typeof scopedEntry.scope.model.display_name === 'string'
        ? scopedEntry.scope.model.display_name
        : null
    }
  }

  consecutiveAuthFails = 0
  lastError = null

  return {
    sessionPct: pct(body?.five_hour?.utilization),
    sessionResetsAt,
    weekPct: pct(body?.seven_day?.utilization),
    weekResetsAt,
    scopedPct,
    scopedResetsAt,
    scopedModel,
  }
}

module.exports = { login, logout, status, fetchUsage, onSessionExpired }
