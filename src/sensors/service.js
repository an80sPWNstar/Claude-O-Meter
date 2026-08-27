// Usage service: runs the Claude usage provider and pushes its readings to the
// renderer on a 1s tick. The provider itself only hits the network every 5
// minutes — the fast tick exists so the reset countdowns stay live between
// polls (getReadings() recomputes them against Date.now() each call).

const claudeUsageProvider = require('./claude-usage')

const DEFAULT_INTERVAL_MS = 1000

function start(onData, { intervalMs = DEFAULT_INTERVAL_MS, claudeUsage = true, getAccess } = {}) {
  let timer = null
  let claude = claudeUsage ? claudeUsageProvider.start({ getAccess }) : null

  function tick() {
    onData({ readings: claude ? claude.getReadings() : [] })
  }

  tick()
  timer = setInterval(tick, intervalMs)

  return {
    // Passed through for the settings window's 'why is this empty' line.
    diagnostics() {
      return claude ? claude.diagnostics() : { enabled: false }
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      if (claude) { claude.stop(); claude = null }
    },
    setClaudeUsage(enabled) {
      if (enabled && !claude) claude = claudeUsageProvider.start({ getAccess })
      else if (!enabled && claude) { claude.stop(); claude = null }
    },
  }
}

module.exports = { start }
