// Cross-platform discovery of Claude Code's OAuth credentials. Main-process
// only; the token never leaves it. Nothing about the host machine is assumed —
// the config dir may be moved by CLAUDE_CONFIG_DIR, the login may live in a WSL
// distro while the widget runs on Windows, or on macOS in the login keychain
// instead of a file at all.

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

// A token this close to expiry is treated as expired: the usage endpoint would
// reject it before the next poll anyway.
const EXPIRY_SKEW_MS = 60 * 1000
const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const EXEC_TIMEOUT_MS = 5000
// How long a fruitless deep sweep is remembered. Without this the 30s
// no-data retry would re-enumerate every WSL distro twice a minute forever.
const DEEP_COOLDOWN_MS = 10 * 60 * 1000

let lastDeepSweep = 0

// Directories that may hold a .credentials.json, cheapest and most likely
// first. Every entry is a plain string path; callers filter out the ones that
// do not exist.
function candidateDirs() {
  const home = os.homedir()
  const dirs = []
  const configDir = process.env.CLAUDE_CONFIG_DIR
  if (configDir) {
    for (const entry of configDir.split(',')) {
      const trimmed = entry.trim()
      if (trimmed) dirs.push(trimmed)
    }
  }
  dirs.push(path.join(home, '.claude'))
  if (process.env.XDG_CONFIG_HOME) dirs.push(path.join(process.env.XDG_CONFIG_HOME, 'claude'))
  dirs.push(path.join(home, '.config', 'claude'))
  if (process.platform === 'win32') {
    // Both variables are normally set, but a service account or a stripped
    // environment can be missing either — path.join throws on undefined.
    for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
      if (!base) continue
      dirs.push(path.join(base, 'Claude'))
      dirs.push(path.join(base, 'Claude Code'))
    }
  }
  dirs.push(...siblingClaudeDirs(home))
  return dirs
}

// Directories directly inside `home` named .claude<something>. Returns [] on any
// error — an unreadable home is not worth a crash.
function siblingClaudeDirs(home) {
  try {
    return fs.readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('.claude') && e.name !== '.claude')
      .map((e) => path.join(home, e.name))
  } catch {
    return []
  }
}

// Deep, slow candidates: the same login sitting in another OS's home on the
// same box. Only called when the cheap pass found nothing, because enumerating
// a \wsl$ share or /mnt can block for seconds.
function crossOsDirs() {
  const dirs = []
  if (process.platform === 'win32') {
    // Only distros that are already running. Touching a //wsl.localhost path
    // for a stopped distro boots the whole VM, and silently starting someone's
    // WSL to look for a file is not a thing a usage widget gets to do.
    for (const distro of runningWslDistros()) {
      // Forward slashes on purpose: Windows accepts them, and path.join()
      // normalises the UNC prefix away when the root is built with backslashes.
      const root = '//wsl.localhost/' + distro
      try {
        for (const user of fs.readdirSync(root + '/home')) {
          dirs.push(root + '/home/' + user + '/.claude')
        }
      } catch { /* no /home, or the share went away mid-sweep */ }
      dirs.push(root + '/root/.claude')
    }
    return dirs
  }
  // From WSL, or a Linux box with the Windows disk mounted, the login may be
  // sitting in the Windows profile instead.
  // Every drive WSL has mounted, not a guessed list of letters: a Windows disk
  // can land on /mnt/windows or any other name.
  const roots = []
  try {
    for (const entry of fs.readdirSync('/mnt')) roots.push(`/mnt/${entry}/Users`)
  } catch { /* no /mnt at all */ }
  roots.push('/c/Users')
  for (const base of roots) {
    try {
      for (const user of fs.readdirSync(base)) dirs.push(path.join(base, user, '.claude'))
    } catch { /* not mounted */ }
  }
  return dirs
}

// Names of the WSL distros that are up right now. wsl.exe answers in UTF-16LE
// with NULs, which is why this decodes a buffer instead of asking for a string.
function runningWslDistros() {
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q', '--running'], {
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.toString('utf16le')
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// Pull the OAuth block out of a parsed credentials payload. The file is
// { claudeAiOauth: { accessToken, expiresAt, subscriptionType, ... } }.
function fromPayload(parsed, source) {
  const o = parsed && parsed.claudeAiOauth
  if (!o || typeof o.accessToken !== 'string' || !o.accessToken.length) return null
  return {
    token: o.accessToken,
    expiresAt: Number(o.expiresAt) || null,
    subscriptionType: o.subscriptionType || null,
    source,
  }
}

// Parse one .credentials.json. Returns null when the file is missing,
// unparseable, or carries no access token.
function readCredentialFile(file) {
  try {
    return fromPayload(JSON.parse(fs.readFileSync(file, 'utf8')), file)
  } catch {
    return null
  }
}

// macOS keeps the credentials in the login keychain rather than on disk.
// Returns the same shape as readCredentialFile, or null.
function readKeychain() {
  if (process.platform !== 'darwin') return null
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return null
    return fromPayload(JSON.parse(out), 'macOS login keychain')
  } catch {
    return null
  }
}

// Every credential set this machine can see, latest expiry first.
// Shape per entry: { token, expiresAt, subscriptionType, source }.
function collect(deep) {
  const dirs = candidateDirs()
  if (deep) dirs.push(...crossOsDirs())

  const found = []
  const seen = new Set()
  for (const dir of dirs) {
    const entry = readCredentialFile(path.join(dir, '.credentials.json'))
    if (entry && !seen.has(entry.token)) { seen.add(entry.token); found.push(entry) }
  }
  const keychain = readKeychain()
  if (keychain && !seen.has(keychain.token)) found.push(keychain)

  return found.sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0))
}

function isExpired(entry) {
  if (!Number.isFinite(entry.expiresAt)) return false
  return entry.expiresAt - EXPIRY_SKEW_MS <= Date.now()
}

// The single result the poller acts on. Never throws.
//   { token, source, expiresAt, subscriptionType, expired, found, mode }
// found is how many credential sets were seen; token is null when none is
// usable. When every set found is expired, the newest expired one comes back
// with expired: true, so the caller can say which file is stale instead of
// claiming there is no login at all.
//
// `mode` decides how much of the disk this is allowed to touch, and the user
// picks it — at install time, at first run, or in Settings:
//   'auto'    the sweep described above
//   'manual'  one path the user named, and nothing else
//   'browser' no filesystem access at all; the claude.ai sign-in owns it
//   'ask'     not chosen yet — behaves like 'browser' until it is
function findCredentials(options) {
  const mode = (options && options.mode) || 'ask'
  if (mode === 'browser' || mode === 'ask') return none(mode)
  if (mode === 'manual') return manualOnly(options && options.credentialPath, mode)

  let list = collect(false)
  // A stale token found cheaply is still a reason to look further: the live
  // login may be the one sitting in a WSL distro, and stopping at the expired
  // Windows copy would report 'expired' forever on a machine that has a good one.
  const worthDigging = !list.length || list.every(isExpired)
  if (worthDigging && Date.now() - lastDeepSweep > DEEP_COOLDOWN_MS) {
    lastDeepSweep = Date.now()
    list = collect(true)
  }
  return pick(list, mode)
}

// Exactly one location, named by the user. Accepts either the file itself or
// the directory holding it, because both are things a person reasonably points
// at when asked where their credentials are.
function manualOnly(credentialPath, mode) {
  if (!credentialPath) return none(mode)
  const candidates = [credentialPath, path.join(credentialPath, '.credentials.json')]
  for (const candidate of candidates) {
    const entry = readCredentialFile(candidate)
    if (entry) return pick([entry], mode)
  }
  return none(mode)
}

function none(mode) {
  return { token: null, source: null, expiresAt: null, subscriptionType: null, expired: false, found: 0, mode }
}

function pick(list, mode) {
  if (!list.length) return none(mode)
  const chosen = list.find((e) => !isExpired(e)) || list[0]
  return { ...chosen, expired: isExpired(chosen), found: list.length, mode }
}

module.exports = { findCredentials }
