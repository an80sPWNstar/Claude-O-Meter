// Claude-swap (cswap CLI) account usage collector — ported from guiTOP.
// Polls `cswap list --json` for ALL connected accounts (5h/7d/model-scoped
// usage each) and detects a running `cswap auto` daemon. cswap may not be
// installed; this degrades gracefully and just reports ok: false in that case
// (the widget then falls back to its single-account OAuth/cookie meters).
// Aliases are cswap's own (`cswap alias <num> <name>`) — no local override.

const { execFile } = require('child_process')
const { cswapCmd } = require('./cswap-cmd')

// Reading cswap's store costs no network request — cswap serves anything
// younger than its own 180s freshness floor straight from disk — so this only
// bounds how long a fresh fetch sits there before the widget shows it.
const POLL_MS = 30000

// `cswap auto` is a foreground polling loop — no daemon, no pidfile, nothing on
// disk to check — so the only way to know it is running is to look for the
// process. uv-installed tools run under python.exe with the shim path in their
// command line, so the command line is what gets matched, never the name.
const PS_PROC_QUERY = 'Get-CimInstance Win32_Process -Filter "Name=\'python.exe\' OR Name=\'pythonw.exe\' OR Name=\'cswap.exe\'" | Select-Object ProcessId, CommandLine, CreationDate | ConvertTo-Json'

function runCswap(cb) {
  const { file, args } = cswapCmd(['list', '--json'])
  execFile(file, args, {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  }, cb)
}

// Windows PowerShell 5.1 serialises a DateTime as "/Date(1769...)/" while
// PowerShell 7 emits ISO 8601, and which one answers depends on the machine.
function parsePsDate(val) {
  if (typeof val !== 'string') return null
  // The epoch form sometimes carries a trailing timezone offset: /Date(ms+0100)/.
  const epoch = val.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//)
  const ms = epoch ? Number(epoch[1]) : Date.parse(val)
  return Number.isFinite(ms) ? ms : null
}

function isAutoCmdline(cmdline) {
  if (typeof cmdline !== 'string') return false
  if (!/cswap/i.test(cmdline)) return false
  // The subcommand is a bare argument: `"...\cswap.exe" auto --interval 60`.
  // Matching a loose /auto/ would also hit any directory called "auto".
  return /\sauto(\s|$)/.test(cmdline)
}

function readAuto(rows, now) {
  for (const row of rows) {
    if (!row || !isAutoCmdline(row.CommandLine)) continue
    const started = parsePsDate(row.CreationDate)
    return {
      autoOn: true,
      autoSinceMin: started === null ? null : Math.max(0, Math.floor((now - started) / 60000)),
    }
  }
  return { autoOn: false, autoSinceMin: null }
}

// Never reports an error: a detection that cannot run just means "not detected".
function detectAuto(cb) {
  const none = { autoOn: false, autoSinceMin: null }

  if (process.platform === 'win32') {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_PROC_QUERY], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => {
      if (err) return cb(none)
      let parsed
      try { parsed = JSON.parse(stdout) } catch { return cb(none) }
      // ConvertTo-Json emits a bare object, not an array, for a single match.
      cb(readAuto(Array.isArray(parsed) ? parsed : [parsed], Date.now()))
    })
    return
  }

  // pgrep reports no start time, so autoSinceMin stays null off Windows.
  execFile('pgrep', ['-af', 'cswap'], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) return cb(none)
    const rows = String(stdout).split('\n')
      .filter(l => l.trim() && !l.includes('pgrep'))
      .map(l => ({ CommandLine: l }))
    cb(readAuto(rows, Date.now()))
  })
}

function clampPct(v) {
  // Guard null/undefined/'' explicitly: Number(null) and Number('') are both 0,
  // which is finite, so a missing usage value would otherwise read as a real 0%.
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

// cswap emits resetsAt as an ISO 8601 string; the widget wants absolute epoch
// ms so it can tick a live countdown between polls. Non-strings/bad dates → null.
function isoMs(v) {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

function accountAlias(a) {
  return String(a.alias || String(a.email || '').split('@')[0] || ('ACC' + a.number)).slice(0, 24)
}

function parseSwap(stdout) {
  const data = JSON.parse(stdout)
  return {
    activeNumber: data.activeAccountNumber ?? null,
    accounts: (data.accounts || []).map(a => {
      const u = a.usage || {}
      // Model-scoped weekly limit (e.g. Fable) — cswap reports it per account,
      // so every row gets its own scoped meter, not just the active account.
      const scoped = Array.isArray(u.scoped) ? u.scoped[0] : null
      return {
        number: Number(a.number) || 0,
        alias: accountAlias(a),
        active: !!a.active,
        disabled: !!a.disabled,
        // cswap reports 'ok' only when it actually fetched usage; anything else
        // (e.g. 'unavailable' after a 403/429 on the usage endpoint) leaves the
        // pcts null. Carry it through so the widget can show "no data" rather
        // than an empty bar that reads as 0%.
        usageStatus: String(a.usageStatus || (a.usage ? 'ok' : 'unavailable')),
        fiveHourPct: clampPct(u.fiveHour && u.fiveHour.pct),
        sevenDayPct: clampPct(u.sevenDay && u.sevenDay.pct),
        fiveHourResetMs: isoMs(u.fiveHour && u.fiveHour.resetsAt),
        sevenDayResetMs: isoMs(u.sevenDay && u.sevenDay.resetsAt),
        scopedName: scoped ? String(scoped.name || 'Fable').slice(0, 16) : null,
        scopedPct: scoped ? clampPct(scoped.pct) : null,
        scopedResetMs: scoped ? isoMs(scoped.resetsAt) : null,
        // How old the numbers are. cswap refetches each account on its own
        // ~5 min schedule, so an idle account's figures are current to within
        // that window, not to the 45s widget poll — the widget says which.
        usageFetchedMs: isoMs(a.usageFetchedAt),
      }
    }),
  }
}

function mockPayload() {
  return {
    ok: true,
    ts: Date.now(),
    autoOn: true,
    autoSinceMin: 23,
    accounts: [
      { number: 1, alias: 'cinchit', active: false, disabled: false, usageStatus: 'ok',
        fiveHourPct: 62, sevenDayPct: 41, fiveHourResetMs: Date.now() + 47 * 60000,
        sevenDayResetMs: Date.now() + 30 * 3600000, scopedName: 'Fable', scopedPct: 71,
        scopedResetMs: Date.now() + 30 * 3600000, usageFetchedMs: Date.now() - 4 * 60000 },
      { number: 2, alias: 'cintrix', active: true, disabled: false, usageStatus: 'ok',
        fiveHourPct: 97, sevenDayPct: 83, fiveHourResetMs: Date.now() + 12 * 60000,
        sevenDayResetMs: Date.now() + 52 * 3600000, scopedName: 'Fable', scopedPct: 88,
        scopedResetMs: Date.now() + 52 * 3600000, usageFetchedMs: Date.now() - 20000 },
      { number: 3, alias: 'drcu', active: false, disabled: false, usageStatus: 'relogin_required',
        fiveHourPct: null, sevenDayPct: null, fiveHourResetMs: null, sevenDayResetMs: null,
        scopedName: null, scopedPct: null, scopedResetMs: null, usageFetchedMs: null },
    ],
  }
}

function startClaudeSwap(onData) {
  let firstTimer = null
  let interval = null
  let running = false
  let stopped = false
  // Auto-daemon detection spawns powershell.exe — seconds when cold — so it
  // must never gate the account meters. Accounts emit as soon as cswap
  // answers, carrying the last known auto state; if detection then lands
  // with a different answer, the payload is re-emitted with it.
  let lastAuto = { autoOn: false, autoSinceMin: null }
  let lastAccounts = null

  // An execFile callback can land after stop(); a stale ok:true payload would
  // undo the caller's "cleared" state, so drop anything post-stop.
  function emit(payload) {
    if (!stopped) onData(payload)
  }

  function emitAccounts() {
    emit({
      ok: true,
      ts: Date.now(),
      autoOn: lastAuto.autoOn,
      autoSinceMin: lastAuto.autoSinceMin,
      accounts: lastAccounts,
    })
  }

  function tick() {
    if (running) return
    running = true

    if (process.env.CLAUDEOMETER_SWAP_MOCK === '1') {
      emit(mockPayload())
      running = false
      return
    }

    detectAuto((auto) => {
      const changed = auto.autoOn !== lastAuto.autoOn
      lastAuto = auto
      if (changed && lastAccounts) emitAccounts()
    })

    runCswap((err, stdout) => {
      running = false
      if (err) {
        lastAccounts = null // a late auto-detect callback must not re-emit stale ok:true
        emit({ ok: false, ts: Date.now(), error: err.message, accounts: [] })
        return
      }
      try {
        lastAccounts = parseSwap(stdout).accounts
      } catch (parseErr) {
        lastAccounts = null
        emit({ ok: false, ts: Date.now(), error: parseErr.message, accounts: [] })
        return
      }
      emitAccounts()
    })
  }

  // Deferred one macrotask only, so the caller holds the handle before
  // onData can fire. The old 2s grace here was a visible launch delay.
  firstTimer = setTimeout(tick, 50)
  interval = setInterval(tick, POLL_MS)

  return {
    refresh() { tick() },
    stop() {
      stopped = true
      clearTimeout(firstTimer)
      clearInterval(interval)
    },
  }
}

module.exports = { startClaudeSwap, parseSwap }
