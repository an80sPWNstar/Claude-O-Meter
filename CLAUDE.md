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
**v0.3.0 — working, verified against live data.** Not yet released or tagged.

v0.2.0 replaced the two icons inherited from tempsLCD-web. v0.3.0 made the tray icon static, put a
freshness chip on every account, moved account switching out of the panel and into menus, stopped
the OAuth provider competing with cswap for the same token budget, and replaced aspect-locked
resizing with reflow plus a text-size setting.

Verified 2026-08-19: the OAuth provider returns 6 real readings; `cswap list --json` returns 2 real
accounts; the assembled app paints the multi-account view and resizes itself to 400x288 for 2
accounts; all 8 themes render correctly; the settings window populates; `npm run build` produces
`dist/Claude-O-Meter Setup 0.1.0.exe` (~104 MB) with no errors.

Verified 2026-08-20 (v0.3.0): tray icon legible at 16px on a real taskbar; both accounts report
live figures without switching (sampled 6 min — an idle account refetched while inactive); zero
OAuth polls while cswap is present and the provider resumes when cswap is off PATH; layout reflows
correctly at seven window shapes and three text sizes.

Never exercised: the claude.ai cookie-session fallback (requires a real login, and the OAuth path
takes precedence on this machine), and the tray menu items.

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

Every account in the cswap payload carries live figures, not just the active one — but cswap
refetches each account on its own ~5 min schedule (`pollIntervalS` in its usage cache), so the
numbers in two rows are rarely the same age. `usageFetchedAt` is carried through as `usageFetchedMs`
and the renderer prints it as a per-account chip, because bars of different ages painted identically
read as if they were all current.

The active account is marked with an `ACTIVE` pill, not with an arrow and an accent colour. The
colour is still there but it now repeats a word instead of being the only carrier of the meaning —
an unlabelled marker reads as decoration.

**The OAuth provider and cswap never run at the same time.** Both hit the same
`/api/oauth/usage` endpoint, which budgets ~28-30 requests/hour *per token* and stays saturated for
up to an hour once tripped — cswap's `poll_policy.py` documents the measurements. cswap serves
anything younger than 180s from its own store, decays an idle account out to 600s while its usage
isn't moving, and after a 429 floors itself at 360s and backs off AIMD to 1800s. Our provider polled
the same token every 5 min (12 req/hr) while multi-account mode discarded its readings, which bought
nothing and pushed cswap into that backoff. `wantOAuthProvider()` in main.js now runs it only when
cswap reports no accounts, and the decision is made *before* `usage.start()` because the provider
fetches inside `start()`. Verified both ways: zero OAuth polls in 50s with cswap present, and the
provider resumes on its own when cswap is off PATH.

So 3 minutes is the freshness floor for any account and no amount of polling beats it — which is
what the per-account age chip is for. `POLL_MS` in claude-swap.js (30s) only bounds how long a fresh
cswap fetch sits in the store before the widget picks it up; it costs no request.

**Nothing in the widget body switches accounts.** The account name used to be a click target for
`cswap switch`, which sat under the pointer during a window drag and fired by accident. Switching is
a `Switch Account` submenu on the widget right-click menu and on the tray menu, both built from the
last poll; the renderer has no switch IPC at all any more. The tray version is rebuilt whenever the
account signature changes, since a tray context menu is set once rather than built per popup.

**Reading IDs:** `/claude/session/pct`, `/claude/week/pct`, `/claude/scoped/pct` and the matching
`/reset` ids. The scoped pair carries a `model` field and the meter labels itself from it — that is
the one behavioural change from tempsLCD-web, which hardcoded `fable` in the id and the label.

### Window sizing
Single account: 360x230. Two or more cswap accounts: `400 x (96 + 96n)`. The formula is duplicated
in `widgetSize()` in main.js and `nativeSize()` in renderer/renderer.js — **change both**.

**Text size is a setting, and the window floor is derived from it.** `textScale` (0.9/1/1.15/1.3/1.5,
validated against `TEXT_SCALES` in main.js) multiplies the fitted zoom. `minFactor()` inverts the
zoom curve to find the smallest window that still lays the rows out at `MIN_BOX` of native:
`native x (MIN_BOX x textScale)^(1/(1-ZOOM_CURVE))`. Picking a larger size therefore grows the
window — `applyMinimumSize()` calls `setSize` as well as `setMinimumSize`, since the latter does not
grow a window that is already smaller, and at 150% on a flat 0.75 floor the account rows overlapped
the AUTO footer. `ZOOM_CURVE` and the formula are duplicated in main.js and renderer.js.

**The header carries Settings and Help; there is no right-click menu.** `widget:context-menu` is
gone, replaced by `widget:menu` with a `kind`. The renderer converts the button rect from the
bezel's zoomed space into real window pixels before sending (`r.left * zoom`), because
`Menu.popup()` places in window coordinates while `getBoundingClientRect()` reports zoomed ones —
skip that and the menus drift further from their buttons the larger the window gets.

Resizing reflows; it does not zoom the picture. `fitBezel()` sizes the bezel to the window in both
axes, so width and height are independent — a wider window lengthens the bars, a taller one spreads
the account blocks (`justify-content: space-evenly`). Only the type scale is uniform: a single
factor from `min(ww/nw, wh/nh) ^ ZOOM_CURVE`, clamped to `MIN_ZOOM`..`MAX_ZOOM` (0.75–2.5), then
multiplied by `textScale`, applied as CSS `zoom`. The exponent (0.6) is the fix for type that
"gets too small too fast": proportional scaling means half the window is half the type, unreadable
long before the layout needs the room; at 0.6 half the window still leaves type at ~66%, so
shrinking costs whitespace and bar length first. Three more things:

- **`zoom`, not `transform: scale`.** A transform paints over a layout box that never changed size,
  which is exactly the old aspect-locked behaviour. `zoom` changes the box, so the flex rows lay out
  against the real window.
- **Per-axis scaling is not an option** even though it would fill the window perfectly — stretching
  glyphs by different x and y factors is the thing that "messes up the text".
- **The window minimum tracks the layout.** The renderer will not shrink type past `MIN_ZOOM`, so
  below that fraction of the native size the rows collide with the footer. `applyMinimumSize()`
  recomputes `setMinimumSize()` from the current account count; `MIN_ZOOM` is duplicated in main.js
  and must stay in sync with the renderer's.

### Persistence (Electron `userData`)
`settings.json`, `swap-cache.json` (last good account payload, painted at launch so the widget
isn't blank for up to 45s), `claude-web.json` (session key, encrypted with `safeStorage`).

## Commands
- Run: `npm start` · DevTools: `npm run dev`
- Installer: `npm run build` (NSIS exe into `dist/`) · unpacked: `npm run build:dir`
- Mock 3 accounts without cswap: `CLAUDEOMETER_SWAP_MOCK=1`

## Icons and the tray
Both `.ico` files are generated by
`scripts/make-icons.cjs` (run it with Electron, not node). Nothing here is hand-exported, so edit
the geometry in that script rather than the binaries.

The tray icon is **static** — a cream cut-C on a solid terracotta tile — and that is a decision, not
an omission. v0.2.0 shipped a live gauge: 44 pre-rendered frames, one per 5%, swapped on the usage
tick. Installed and looked at on a real taskbar it failed, because at low usage the value arc is a
two-pixel stroke on a transparent background and reads as a stray dot next to the filled icons
around it. The filled tile is what makes the icon survive 16px. Live numbers moved to the tooltip,
which `refreshTray()` still updates on the 1s tick.

If a live tray icon is ever attempted again, the frame must stay a constant, filled shape at every
value — vary a fill level inside the tile, never the length of a thin arc on transparency.

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
