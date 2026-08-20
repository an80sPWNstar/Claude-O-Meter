# Claude-O-Meter

## What This Is
A frameless desktop widget that shows Claude plan usage: the 5-hour session limit, the 7-day
weekly limit, and a model-scoped weekly limit when the account has one. Each meter shows percent
used, a bar, and a live reset countdown.

Extracted from the `claude` skin of `E:\vs_code_projects\tempsLCD-web` (v0.1.9). That project is
the system-hardware monitor; this is its Claude panel as a standalone app with the hardware half
removed. tempsLCD-web is still the active home of the skin — a fix here does not propagate there,
and vice versa.

## Current Status
**v0.1.0 — working, verified against live data.** Not yet released or tagged.

Verified 2026-08-19: the OAuth provider returns 6 real readings; `cswap list --json` returns 2 real
accounts; the assembled app paints the multi-account view and resizes itself to 400x288 for 2
accounts; all 8 themes render correctly; the settings window populates; `npm run build` produces
`dist/Claude-O-Meter Setup 0.1.0.exe` (~104 MB) with no errors.

Never exercised: the claude.ai cookie-session fallback (requires a real login, and the OAuth path
takes precedence on this machine), the tray menu items, and installing the built .exe.

## Tech Stack
- **Runtime:** Electron 43, no runtime dependencies
- **Language:** plain JavaScript — no framework, no bundler, no build step for the app itself
- **Main process:** `main.js` — the two windows, the tray, the collectors, all persistence
- **IPC bridge:** `preload.js` — `contextBridge` exposes `window.claudeOMeter`; `contextIsolation:
  true`, `nodeIntegration: false`
- **Packaging:** electron-builder → NSIS, one-click, per-user (no elevation, unlike tempsLCD-web
  which needs an elevated sensor bridge)

## Project Structure
```
Claude-O-Meter/
├── main.js                 # windows, tray, IPC, settings persistence, swap collector
├── preload.js              # contextBridge → window.claudeOMeter
├── renderer/
│   ├── index.html          # widget markup + all 8 themes (CSP-locked)
│   └── renderer.js         # scale-to-fit, JS drag, single- and multi-account views
├── settings/               # settings window — index.html + settings.js
├── src/sensors/
│   ├── claude-usage.js     # OAuth provider: token from ~/.claude/.credentials.json, 5 min poll
│   ├── claude-web.js       # claude.ai cookie session fallback (hidden BrowserWindow fetch)
│   ├── claude-swap.js      # cswap CLI collector: all accounts + auto-daemon detect, 45s poll
│   ├── cswap-cmd.js        # platform-correct cswap invocation (cmd.exe shim on Windows)
│   └── service.js          # 1s tick so reset countdowns stay live between 5 min polls
└── assets/                 # ShareTechMono, app/tray icons, theme art, lucide
```

## Architecture

### Data flow
1. `service.js` runs the OAuth provider and ticks it at 1s. The provider only hits the network
   every 5 minutes; the fast tick exists because `getReadings()` recomputes the countdowns against
   `Date.now()` on every call.
2. Separately, `claude-swap.js` polls `cswap list --json` every 45s and pushes an all-account
   payload on the `claude-swap` channel.
3. The renderer prefers the cswap payload when it reports accounts, and falls back to the
   single-account meters otherwise. Both views live in the same markup.

**Reading IDs:** `/claude/session/pct`, `/claude/week/pct`, `/claude/scoped/pct` and the matching
`/reset` ids. The scoped pair carries a `model` field and the meter labels itself from it — that is
the one behavioural change from tempsLCD-web, which hardcoded `fable` in the id and the label.

### Window sizing
Single account: 360x230. Two or more cswap accounts: `400 x (96 + 96n)`. The formula is duplicated
in `widgetSize()` in main.js and `nativeSize()` in renderer/renderer.js — **change both**. The
renderer pins the bezel to that native size and applies a `translate+scale` transform so an OS
resize zooms rather than reflows.

### Persistence (Electron `userData`)
`settings.json`, `swap-cache.json` (last good account payload, painted at launch so the widget
isn't blank for up to 45s), `claude-web.json` (session key, encrypted with `safeStorage`).

## Commands
- Run: `npm start` · DevTools: `npm run dev`
- Installer: `npm run build` (NSIS exe into `dist/`) · unpacked: `npm run build:dir`
- Mock 3 accounts without cswap: `CLAUDEOMETER_SWAP_MOCK=1`

## Gotchas

### Never transition the `background` shorthand
`.bezel` must not include `background` in its `transition`. Chromium leaves the shorthand stuck on
a blended intermediate frame when it interpolates between two `var()`-supplied multi-layer values,
so a theme change paints a washout: `#1F1E1B` painted as `rgb(162,160,154)`, and the porsche
crest at ~110px centre-right instead of 34px bottom-right. `getComputedStyle` reports the
**correct** values the whole time — only the paint is wrong, so a computed-style probe will tell
you the CSS is fine when it isn't. Verify theme colours by sampling pixels from a `capturePage()`,
never by reading computed style. Fixed in `fdb1eaf`; the same fix went into tempsLCD-web.

### Reading computed style in the same tick as `setAttribute` is unreliable
A probe that does `el.setAttribute('data-theme', x)` and then immediately reads
`getComputedStyle(el).backgroundPosition` can return stale values (observed: `0% 0%` for a
position that was actually `calc(100% - 12px) calc(100% - 10px)`). Wait a frame, or better, sample
pixels.

### Electron won't launch from a Claude Code shell
Claude Code sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node —
`require('electron')` returns a path string and `app` is undefined. `unset ELECTRON_RUN_AS_NODE` in
the same command.

### `npm install` can leave the Electron binary unextracted
`node_modules/electron/dist/` ends up empty with no `path.txt`. The cached zip is fine — extract it
by hand; the exact commands are in README.md under Development.

### Don't run `cmd.exe /c "cswap --version"` with the argument quoted
That spawns an interactive shell that never returns. `cswap` lives at
`C:\Users\Bryan\.local\bin\cswap.exe`; use `where cswap`, or go through `cswapCmd()`.

## Code Standards
- Keep `contextIsolation: true`, `nodeIntegration: false`, and the strict CSP in both windows
- The OAuth token and the claude.ai session key never leave the main process
- `cswap` is invoked with fixed argv arrays, never a shell string; account numbers validated
  against `/^[0-9]+$/`
- Clean and minimal; comments only where the WHY isn't obvious
- Don't re-read files already in context; prefer Grep/Glob over reading whole files to search

## Local LLM Delegation
The rules in `~/.claude/CLAUDE.md` apply unchanged — cost-offload priority, the one-probe-per-session
availability hold, DRY/sampling settings by literal density, prompt shapes, and the mandatory
delegation and failure reporting. Not duplicated here; read them there.

Project-specific note: local review of this repo's CSS is worth doing (it found four real
`--cl-hint` contrast failures) but its by-design rejection rate is high — it flagged all three
image-backed themes as readability defects when the decorative watermark is the point. Verify every
finding, and never accept a local model's verdict on how something *looks*.
