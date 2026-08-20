// Claude Code plan-usage provider: polls the Anthropic OAuth usage endpoint
// every 5 minutes and exposes session/weekly utilization plus reset countdowns
// as standard sensor readings. Falls back to the claude.ai cookie session
// (./claude-web) when no OAuth token exists. Main-process only — the token
// never leaves it.
// Any failure (missing credentials, non-200, bad JSON) just clears nothing and
// retries next poll; getReadings() returns [] until a fetch succeeds.

const fs = require('fs')
const path = require('path')
const os = require('os')

const POLL_MS = 5 * 60 * 1000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CREDENTIAL_FILES = [
  path.join(os.homedir(), '.claude', '.credentials.json'),          // CLI
  path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', '.credentials.json'),    // Desktop app (Electron)
  path.join(os.homedir(), 'AppData', 'Roaming', 'Claude Code', '.credentials.json'), // Desktop app variant
  path.join(os.homedir(), 'AppData', 'Local', 'Claude', '.credentials.json'),    // Desktop app (Local)
  path.join(os.homedir(), 'AppData', 'Local', 'Claude Code', '.credentials.json'), // Desktop app variant
]

function readToken() {
  for (const file of CREDENTIAL_FILES) {
    try {
      const creds = JSON.parse(fs.readFileSync(file, 'utf8'))
      const token = creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken
      if (typeof token === 'string' && token.length) return token
    } catch { /* next path */ }
  }
  return null
}

function pct(v) {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null
}

function parseDate(iso) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function minutesUntil(ts) {
  return Math.max(0, Math.round((ts - Date.now()) / 60000))
}

function start() {
  let cache = null
  let timer = null
  let stopped = false

  async function poll() {
    // Re-read every poll — Claude Code refreshes the token itself.
    const token = readToken()
    if (!token) {
      console.log('[claude-usage] no OAuth token — falling back to cookie session')
      return pollWeb()
    }
    try {
      console.log('[claude-usage] polling OAuth endpoint…')
      const res = await fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`[claude-usage] HTTP ${res.status}: ${text.slice(0, 300)}`)
        return
      }
      const body = await res.json()
      if (stopped) return

      // Model-scoped weekly limit (e.g. Fable) lives in the limits array.
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

      cache = {
        sessionPct: pct(body?.five_hour?.utilization),
        sessionResetsAt: parseDate(body?.five_hour?.resets_at),
        weekPct: pct(body?.seven_day?.utilization),
        weekResetsAt: parseDate(body?.seven_day?.resets_at),
        scopedPct,
        scopedResetsAt,
        scopedModel,
        fetchedAt: Date.now(),
      }
    } catch (err) {
      console.warn('[claude-usage] poll error:', err && err.message)
    }
  }

  // Fallback when no OAuth token exists: claude.ai cookie session (claude-web).
  // Lazy require — pulls in electron, and the feature may never be used.
  async function pollWeb() {
    let web
    try { web = require('./claude-web') } catch { return }
    if (!web.status().loggedIn) return
    try {
      const usage = await web.fetchUsage()
      if (stopped) return
      cache = { ...usage, fetchedAt: Date.now() }
    } catch (err) {
      // SessionExpired: clear cache so the widget shows the login hint (and
      // tick() reverts to the 30s fast retry). Other errors keep last cache.
      if (err && err.message === 'SessionExpired') cache = null
    }
  }

  // Retry fast (30s) until the first successful fetch, then settle into the
  // 5-minute cadence — otherwise a missed poll at startup leaves the widget
  // empty for 5 minutes.
  async function tick() {
    await poll()
    if (stopped) return
    timer = setTimeout(tick, cache ? POLL_MS : 30 * 1000)
  }
  tick()

  return {
    getReadings() {
      if (!cache) return []
      const out = []
      if (cache.sessionPct != null) out.push({
        id: '/claude/session/pct', name: 'Claude Session', type: 'Load',
        unit: '%', value: cache.sessionPct, min: 0, max: 100,
      })
      if (cache.weekPct != null) out.push({
        id: '/claude/week/pct', name: 'Claude Weekly', type: 'Load',
        unit: '%', value: cache.weekPct, min: 0, max: 100,
      })
      if (cache.scopedPct != null) out.push({
        id: '/claude/scoped/pct', name: 'Claude ' + (cache.scopedModel || 'Scoped') + ' Weekly', type: 'Load',
        model: cache.scopedModel || null, unit: '%', value: cache.scopedPct, min: 0, max: 100,
      })
      // Countdowns recomputed each call so they tick down between polls.
      if (cache.sessionResetsAt != null) out.push({
        id: '/claude/session/reset', name: 'Session Reset', type: 'Countdown',
        unit: 'min', value: minutesUntil(cache.sessionResetsAt), min: 0, max: 300,
      })
      if (cache.weekResetsAt != null) out.push({
        id: '/claude/week/reset', name: 'Weekly Reset', type: 'Countdown',
        unit: 'min', value: minutesUntil(cache.weekResetsAt), min: 0, max: 10080,
      })
      if (cache.scopedResetsAt != null) out.push({
        id: '/claude/scoped/reset', name: (cache.scopedModel || 'Scoped') + ' Reset', type: 'Countdown',
        model: cache.scopedModel || null, unit: 'min', value: minutesUntil(cache.scopedResetsAt), min: 0, max: 10080,
      })
      return out
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      cache = null
    },
  }
}

module.exports = { start }
