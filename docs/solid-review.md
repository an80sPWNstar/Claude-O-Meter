# SOLID review — Claude-O-Meter v0.3.1

Reviewed 2026-08-24 against the working tree at `59d0a9e`. Every file in the app was read
(`main.js`, `preload.js`, `renderer/`, `settings/`, `src/sensors/`). Line counts:

| file | lines | distinct responsibilities |
|---|---|---|
| `main.js` | 634 | 9 |
| `renderer/index.html` | 418 | markup + ~350 lines of CSS incl. 8 themes |
| `renderer/renderer.js` | 372 | 6 |
| `src/sensors/claude-web.js` | 326 | 4 |
| `src/sensors/claude-swap.js` | 245 | 4 |
| `src/sensors/claude-usage.js` | 174 | 4 |
| `settings/settings.js` | 154 | 3 |
| `preload.js` | 28 | 1 fat interface for 2 clients |

Context for the recommendations: there is no bundler, no test runner, and no lint config. That
matters more than any individual SOLID violation, because the reason to want small modules here is
that **almost nothing in this codebase can currently be executed without launching Electron**. The
refactor below is ordered to make the pure logic testable first.

---

## S — Single Responsibility

### `main.js` is the whole application, not a process entry point

It currently owns, in one file with 12 module-level mutable globals (`win`, `settingsWin`, `tray`,
`usageService`, `settings`, `settingsFile`, `lastReadings`, `claudeSwapHandle`, `lastClaudeSwap`,
`swapCacheFile`, `trayTip`, `dragBase`):

1. single-instance lock and app lifecycle
2. window geometry math (`widgetSize`, `minFactor`, `applyMinimumSize`, `fitWidget`)
3. swap-collector lifecycle and its disk cache (`loadSwapCache`, `sendClaudeSwap`)
4. usage-source arbitration (`wantOAuthProvider`, `applyUsageSource`)
5. tray icon and tooltip *text formatting* (`fmtMins`, `trayTooltip`, `refreshTray`)
6. user-facing prose — the entire Help essay and the About report are string literals at
   `main.js:230-290`
7. menu construction (tray, settings, help, theme, text-size, switch-account)
8. drag arithmetic and off-screen clamping (`widget:move`)
9. settings schema, validation, persistence, and broadcast

Each of 2, 3, 5, 7, 8, 9 is independently testable logic buried in a file that can only be loaded
by Electron. Item 6 is copy, not code: prose changes force a diff in the process entry point.

### The renderer has the same shape

`renderer/renderer.js` mixes the zoom/fit curve, the JS drag implementation, menu coordinate
translation, settings application, and two entirely separate view renderers. `fitBezel` and the
drag handlers have nothing to do with painting meters.

`renderer/index.html` carries all eight themes as inline CSS. Themes are *data*; they are currently
markup, and the same data exists a second time as hex values in `settings/settings.js:22-31` and a
third time as a label list in `main.js:429-433`.

### Sensors bundle unrelated concerns

- `claude-swap.js` = CLI invocation + JSON normalisation + **process discovery** (a PowerShell CIM
  query and a `pgrep` fallback) + a polling scheduler. Auto-daemon detection has no relationship to
  account usage beyond sharing a payload; it is the one part of the file that spawns PowerShell and
  the one part that is pure string matching (`isAutoCmdline`, `parsePsDate`), and it should be its
  own module.
- `claude-usage.js` = credential-file discovery + HTTP call + response mapping + scheduler +
  sensor-reading formatting.

---

## O — Open/Closed

**Adding a usage source requires editing four files.** There is no provider contract. Today the two
sources emit two different payload shapes on two different IPC channels, and the renderer branches
between them in `render()` (`renderer.js:313-357`), painting them with two near-duplicate functions:
`paintMeter` (readings-array flavour) and `paintRow` (account flavour) do the same job — clamp,
round, set width, toggle `.warn` — against different input shapes.

**Adding a theme requires editing three files** (CSS block, swatch hex table, menu label list).

**Adding a setting requires editing four places**: `DEFAULT_SETTINGS`, the hand-written if-chain in
`validateSettings`, `fill()`/`push()` in `settings/settings.js`, and the HTML control. A single
declarative schema (key → type/enum/default/label) closes all of these: validation, the menu items,
and the settings form all derive from one table.

**The "keep in sync" comments are the OCP violation made explicit.** `BASE_SIZE`, the multi-account
size formula, `ZOOM_CURVE`, `MIN_ZOOM`, and `MIN_BOX` are duplicated across `main.js` and
`renderer.js`, and CLAUDE.md documents the hazard three times ("change both", "must stay in sync").
Documentation is not a mechanism.

---

## L — Liskov Substitution

Little inheritance, so mostly not applicable — but there are two *near-miss* interfaces that should
be one. `usage.start(onData, opts)` returns `{ stop, setClaudeUsage }`; `startClaudeSwap(onData)`
returns `{ stop, refresh }`. Both are "a thing that pushes usage data on a timer", neither is
substitutable for the other, so `main.js` needs bespoke start/stop/refresh code per collector
(`startSwapCollector`, `stopSwapCollector`, `applyUsageSource`, and the `claudeSwapHandle &&
claudeSwapHandle.refresh()` guard repeated in two menu builders). One contract —
`{ start, stop, refresh, onData }` — lets main hold a list instead of named globals.

---

## I — Interface Segregation

`preload.js` exposes one 15-method bridge to both windows. The widget receives `claudeLogin`,
`claudeLogout`, `claudeStatus`, `onClaudeStatusChange`, `getSettings`, `closeSettings` — six methods
it never calls. The settings window receives `moveWindow`, `dragStart`, `dragEnd`, `showMenu`,
`minimize`, `close`, `onUsageData`, `onClaudeSwap` — eight it never calls. Two bridge objects
(`widgetApi`, `settingsApi`) built from a shared core, selected by which window is loading, cuts the
attack surface of each window to what it actually uses. This is the one SOLID finding that is also a
security finding, given the project's stated stance on `contextIsolation` and CSP.

---

## D — Dependency Inversion

`main.js` `require`s concrete sensor modules at the top and calls Electron APIs inline throughout.
`claude-web.js` reaches for `app.getPath('userData')` itself (`claude-web.js:47`), and
`claude-swap.js` reads `process.env.CLAUDEOMETER_SWAP_MOCK` deep inside its own tick loop
(`claude-swap.js:200`) — the mock switch is baked into the collector rather than injected, which is
why the mock path also needs a guard in `sendClaudeSwap` to avoid poisoning the disk cache.

Consequence: zero unit tests are possible today on functions that are otherwise pure —
`parseSwap`, `clampPct`, `isoMs`, `accountAlias`, `parsePsDate`, `isAutoCmdline`,
`validateSettings`, `minFactor`, `fmtAge`, `fmtMinutes`. That list is the highest-value test suite
in the project and it needs no Electron at all, only the modules split out.

---

## Bugs found while reading (not style — these are live)

1. **`main.js:567-583` calls two functions that do not exist.** `getClaudeWeb()` and
   `sendClaudeStatus()` are referenced by the `claude:login`, `claude:logout` and `claude:status`
   IPC handlers and are defined nowhere in the repo (`grep` confirms). Effects, all user-reachable
   from the settings window: `claudeStatus()` always resolves to `{loggedIn:false}` because the
   `ReferenceError` is swallowed by the handler's `catch`; clicking **Log in with Claude account**
   displays the literal string *"getClaudeWeb is not defined"* in the settings error line
   (`settings.js:141`); `claude:logout` rejects. `claude-web.js` itself is fine and exports
   `{ login, logout, status, fetchUsage, onSessionExpired }` — it is only reachable today through
   the lazy `require` inside `claude-usage.js:111`. This is almost certainly what CLAUDE.md means
   by "never exercised: the claude.ai cookie-session fallback". Fix is a require plus a small
   `sendClaudeStatus` that broadcasts `claude:status-change`; `onSessionExpired` is also never
   subscribed, so an expiring session never notifies the settings window.
2. **Two write paths for settings.** `ipcMain.on('settings:set')` validates; the theme, text-size
   and always-on-top menu handlers mutate `settings.x = value` directly and then `saveSettings()`,
   bypassing `validateSettings` and `applyUsageSource`. Correct today only because the menus can
   only produce legal values.
3. **`fmtMins` (main.js:174) and `fmtMinutes` (renderer.js:170) are the same function** under two
   names — already drifting in name, will drift in behaviour.
4. **The account signature is computed twice**: `acctSig` in `main.js:110` and an inline copy in
   `renderAccounts` (`renderer.js:248`). Main uses it to decide whether to rebuild the tray menu,
   the renderer to decide whether to rebuild the DOM; if one changes, the other silently disagrees.

---

## Recommended module layout

```
main.js                          # ~60 lines: lifecycle wiring only
shared/                          # loaded by BOTH main (require) and renderer (<script>)
  geometry.js                    # BASE_SIZE, multi-account size, ZOOM_CURVE, MIN_ZOOM, MIN_BOX
  format.js                      # fmtMinutes, fmtAge, acctSig, clamp
  settings-schema.js             # keys, types, enums, defaults, labels, THEMES, TEXT_SCALES
src/main/
  settings-store.js              # load/save/validate/subscribe — derived from settings-schema
  windows/widget-window.js       # create, sizing, drag, min/close
  windows/settings-window.js
  tray-controller.js             # icon + tooltip
  menus.js                       # tray/settings/help templates
  dialogs.js                     # about + help (prose in a separate .txt or .md asset)
  usage-hub.js                   # source arbitration, disk cache, fan-out to windows
  ipc.js                         # every ipcMain registration, each a 1-3 line delegation
src/sensors/
  contract.js                    # Collector: {start, stop, refresh, onData} + Account shape
  oauth/token-source.js  oauth/usage-api.js  oauth/collector.js
  cswap/cli.js  cswap/parse.js  cswap/auto-detect.js  cswap/collector.js  cswap/mock.js
  web/...                        # claude-web.js split the same way
renderer/
  index.html                     # markup only
  css/base.css  css/themes.css
  fit.js  drag.js  menu-buttons.js
  view-model.js                  # normalise BOTH sources to Account[]
  views/accounts.js              # the only paint path
settings/...                     # form generated from shared/settings-schema.js
```

Two design decisions carry most of the benefit:

**1. One normalised view model.** Both sources produce `Account[]`; the single-account case is an
array of one. That deletes the `render()` branch, one of the two paint functions, and the renderer's
awareness that cswap exists at all. It also makes the third source (claude.ai cookie) a drop-in
rather than a fourth code path.

**2. A `shared/` directory that both processes really load.** No bundler is needed — write each
shared module with a dual export and load it with a `<script src>` in the two HTML files (the
existing `'self'` CSP already permits this, as it does for `renderer.js`):

```js
// shared/geometry.js
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.COMeter = Object.assign(root.COMeter || {}, { geometry: api })
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BASE_SIZE = { width: 360, height: 230 }
  const ZOOM_CURVE = 0.6, MIN_ZOOM = 0.75, MAX_ZOOM = 2.5, MIN_BOX = 0.88
  const nativeSize = (n) => (n >= 2 ? { width: 400, height: 96 + 96 * n } : BASE_SIZE)
  const minFactor = (textScale = 1) => Math.pow(MIN_BOX * textScale, 1 / (1 - ZOOM_CURVE))
  const fittedZoom = (ww, wh, nw, nh, textScale = 1) =>
    Math.min(Math.max(Math.pow(Math.min(ww / nw, wh / nh), ZOOM_CURVE), MIN_ZOOM), MAX_ZOOM) * textScale
  return { BASE_SIZE, ZOOM_CURVE, MIN_ZOOM, MAX_ZOOM, MIN_BOX, nativeSize, minFactor, fittedZoom }
})
```

Every "keep both in sync" comment in CLAUDE.md then describes a single function instead of a
convention.

---

## Staged plan

Each stage is independently shippable and verifiable with `npm start` plus the existing manual
checks (seven window shapes, three text sizes, eight themes).

| # | change | risk | payoff |
|---|---|---|---|
| 1 | `shared/geometry.js` + `shared/format.js`; delete the 5 duplicated constants and the two copies each of the minute formatter and account signature | low | kills every documented sync hazard |
| 2 | `shared/settings-schema.js`; generate `validateSettings`, the theme/text-size menus, and the settings form from it | low | a new setting or theme becomes one edit |
| 3 | Extract `tray-controller.js`, `dialogs.js` (Help/About prose to an asset), `menus.js`, `ipc.js` out of `main.js` | low | `main.js` under ~100 lines |
| 4 | Fix the `getClaudeWeb`/`sendClaudeStatus` break while the IPC layer is being extracted | low | a visibly broken button starts working, or gets deliberately removed |
| 5 | `view-model.js` + one paint path; move themes to `css/themes.css` | medium | renderer drops ~90 lines and one whole branch |
| 6 | `contract.js` and split both collectors (cli / parse / auto-detect / scheduler); inject the mock instead of reading `process.env` inside the tick | medium | a third source stops being a fourth code path |
| 7 | `node:test` suite over the now-pure modules; add a lint config | low | the first automated safety net this project has |

Stage 7 is the point of stages 1-6. Suggested first tests, all Electron-free: `parseSwap` against a
captured `cswap list --json` fixture (including the `relogin_required` and no-`usage` accounts),
`clampPct('')`/`clampPct(null)` → null, `isoMs` on a bad date, `parsePsDate` on both PowerShell 5.1
and 7 date forms, `isAutoCmdline` on a path containing the word "auto", `validateSettings` on
hostile JSON, `minFactor`/`fittedZoom` at the 0.75 floor and 150% text, `fmtAge` at the 75s and
12-minute boundaries.

## File length as a smell — where this repo stands

The 400-500 line rule of thumb applies here, with one refinement: length is the symptom, "number of
reasons this file has to change" is the diagnostic. Both readings agree on the same two files.

| file | lines | verdict |
|---|---|---|
| `main.js` | 634 | **over** — 9 reasons to change (list at the top of this doc). Split. |
| `renderer/index.html` | 418 | **over** — 350 of those lines are CSS, and 8 theme blocks are data. Extract `css/base.css` + `css/themes.css` and the file drops to ~60 lines of markup. |
| `renderer/renderer.js` | 372 | approaching, and 6 reasons to change. Split now, not at 500. |
| `src/sensors/claude-web.js` | 326 | acceptable length, 4 reasons to change — cookie planting, org discovery, login window, usage mapping. Split when it is next touched. |
| everything else | ≤ 245 | fine |

After the staged plan the largest file should be ~120 lines, and no file should have more than two
reasons to change.

Worth stating explicitly for the review: nothing in this repo is long because of clever density. It
is long because unrelated jobs were added to the nearest existing file, which is the cheap thing to
do when there are only three files. The split is mechanical, not a rewrite.

---

## Purity audit

Honest framing first: this is an Electron app, so a large share of the code *must* be impure — it
spawns processes, writes files, mutates DOM, and pops native menus. The achievable target is not
"all functions pure"; it is **a pure core with a thin imperative shell**: all computation pure and
testable, all effects in small named functions that do nothing but the effect.

Measured against that, the codebase already does well on the leaf helpers and badly on anything
that touches state.

### Already pure — keep them that way

`clampPct`, `isoMs`, `accountAlias`, `parseSwap`, `parsePsDate`, `isAutoCmdline`, `readAuto`
(claude-swap.js) · `pct`, `parseDate` (claude-usage.js) · `clamp`, `fmtMinutes`, `acctHtml`
(renderer.js) · `fmtMins`, `acctSig`, `validateSettings`, `cswapCmd`.

`readAuto(rows, now)` is the model the rest of the codebase should copy: it takes the clock as an
argument instead of calling `Date.now()`, so its behaviour is fully determined by its inputs.

### Impure through hidden inputs — fix these

These read module-level `let` state or the clock instead of taking it as a parameter. Each is pure
computation wearing an impure signature, and each becomes testable by moving one thing into the
argument list:

| current | reads secretly | should be |
|---|---|---|
| `widgetSize()` (main.js:47) | `lastClaudeSwap` | `sizeForAccounts(n)` |
| `minFactor()` (main.js:66) | `settings.textScale` | `minFactor(textScale)` |
| `trayTooltip()` (main.js:180) | `settings`, `lastClaudeSwap`, `lastReadings`, `Date.now()` | `trayTooltip(state, now)` |
| `buildReport()` (main.js:203) | `lastClaudeSwap`, `lastReadings`, `process.versions`, `os` | `buildReport(env, state)` |
| `nativeSize()` (renderer.js:39) | `lastSwap` | `nativeSize(n)` — same function as `sizeForAccounts` |
| `fmtResetMs(ms)` (renderer.js:179) | `Date.now()` | `fmtResetMs(ms, now)` |
| `fmtAge(fetchedMs)` (renderer.js:222) | `Date.now()` | `fmtAge(fetchedMs, now)` |
| `minutesUntil(ts)` (claude-usage.js:43) | `Date.now()` | `minutesUntil(ts, now)` |
| `getReadings()` (claude-usage.js:135) | closure `cache`, `Date.now()` | pure `readingsFrom(cache, now)` + a 1-line closure caller |
| `render()` (renderer.js:313) | `lastSwap`, `lastReadings`, `usageEnabled`, `el` | pure `viewModel(state)` → `paint(vm)` |
| `fitBezel()` (renderer.js:45) | `lastSwap`, `textScale`, `window.inner*` | pure `fittedZoom(...)` → 3-line style setter |

The clock is the important one. Every countdown and freshness rule in this app is a function of
`now`, and `now` is currently reached for from inside eight different functions. That is exactly why
the 75-second "live" threshold and the 12-minute stale threshold cannot be tested today, and why
`STALE_MS` is verified by staring at the widget for twelve minutes. Injecting `now` makes both
boundary cases a two-line test.

### Legitimately impure — keep, but isolate

`detectAuto`, `runCswap`, `swapSwitch`, `poll`/`pollWeb`, `loadSwapCache`, `saveSettings`,
`createWindow`, `openSettings`, `createTray`, `refreshTray`, `paintRow`, `paintMeter`,
`renderAccounts`, `renderAuto`, `fill`, `push`, and every `ipcMain` handler.

Two rules to apply to that list rather than trying to purify it:

1. **An effect function does the effect and nothing else.** `sendClaudeSwap` currently decides a
   size change, writes a cache file, re-arbitrates the usage source, rebuilds a tray menu, refreshes
   a tooltip, and sends IPC — six effects and one policy decision in twelve lines. Split the policy
   (`whatChanged(prev, next)`, pure) from the effects.
2. **Paint functions take data, not state.** `paintRow(acctEl, role, pct, resetMs)` already does
   this correctly. `render()` does not.

### Purity anti-pattern to fix while there

`validateSettings` is pure and correct, but the menu handlers bypass it and assign to `settings`
directly (`main.js:495`, `main.js:509`, `main.js:522`). A pure validator with a bypass around it is
worse than no validator, because reviewers stop checking the bypass path. Route all writes through
one `settings-store.set(patch)`.

---

## Magic numbers and strings

The repo is better than average here — `POLL_MS`, `ZOOM_CURVE`, `MIN_ZOOM`, `STALE_MS`,
`RESIZE_BORDER`, `CSWAP_NUM_RE`, `TEXT_SCALES` are all named. What remains falls into five groups,
in descending order of how much a typo would cost.

### 1. IPC channel names — the dangerous ones

Fifteen raw string literals spread across `preload.js` and `main.js`: `'usage-data'`,
`'claude-swap'`, `'widget:minimize'`, `'widget:close'`, `'widget:menu'`, `'widget:move'`,
`'widget:drag-start'`, `'widget:drag-end'`, `'settings:get'`, `'settings:set'`, `'settings:close'`,
`'settings-change'`, `'claude:login'`, `'claude:logout'`, `'claude:status'`,
`'claude:status-change'`.

A typo on either side of one of these is a **silent** failure — no exception, the message simply
never arrives. Note that `'settings-change'` and `'claude:status-change'` do not even follow the
same naming convention as their siblings, which is the kind of drift raw literals guarantee. Move
them to `shared/channels.js` and import on both sides.

### 2. Reading IDs — a contract expressed as six strings, in three files

`'/claude/session/pct'`, `'/claude/week/pct'`, `'/claude/scoped/pct'` and the three `/reset` ids are
produced in `claude-usage.js:138-162`, matched again in `renderer.js:329-334`, and matched a third
time in `trayTooltip` (`main.js:189`). Same silent-failure class as the channels.
`shared/reading-ids.js`.

### 3. Unnamed thresholds and dimensions

| literal | where | suggested name |
|---|---|---|
| `80` (warn threshold, twice) | renderer.js:239-240, 309-310 | `WARN_PCT` |
| `75` (seconds counted as "live") | renderer.js:225 | `LIVE_MS` (as `75 * 1000`, matching `STALE_MS`) |
| `40` (px kept on screen while dragging) | main.js:406-407 | `MIN_ONSCREEN_PX` |
| `360`/`230`/`400`/`96 + 96 * n` | main.js:45-52, renderer.js:17-42 | `shared/geometry.js` (see above) |
| `400`/`430` (settings window) | main.js:307-311 | `SETTINGS_WINDOW_SIZE` — the 400 already needed a 3-line comment defending it, which is what a named constant is for |
| `15000`/`5000` + `1024 * 1024` (exec timeout/buffer, 3 sites) | main.js:604, claude-swap.js:26, 67 | one `EXEC_OPTS` / `EXEC_OPTS_FAST` |
| `300` (error-message truncation, 2 sites) | main.js:606, claude-usage.js:69 | `ERR_SNIPPET_CHARS` |
| `30 * 1000` (fast retry before first success) | claude-usage.js:130 | `FAST_RETRY_MS` |
| `24`/`16` (alias and scoped-name truncation) | claude-swap.js:108, 134 | `MAX_ALIAS_CHARS`, `MAX_SCOPED_CHARS` |
| `2880`/`1440`/`60`/`60000` (duplicated in two formatters) | main.js:175-177, renderer.js:171-173 | one `shared/format.js` |
| `1` (the "Copy Report" button index) | main.js:227 | derive from the `buttons` array, not a literal |
| `300`/`10080` (reading `max` fields) | claude-usage.js:153-161 | `MINUTES_PER_5H_WINDOW`, `MINUTES_PER_WEEK` |

### 4. Magic strings that encode behaviour

- `'cream'` appears as a fallback in four places (`main.js:449`, `renderer` default in markup,
  `settings.js:62`, plus `DEFAULT_SETTINGS`). One default, one place.
- `'Fable'` as the fallback scoped-limit name (`claude-swap.js:134`) is a guess presented as data —
  and hardcoding `fable` in the id and label is the exact thing this project deliberately fixed
  relative to tempsLCD-web. It should fall back to `'Scoped'`, or to `null`, never to a specific
  model name.
- `'oauth-2025-04-20'` (`claude-usage.js:64`), the usage URL, and the credential-file list are API
  contract, not configuration — group them in one `oauth/api-constants.js` so a Claude API change is
  a one-file diff.
- `'ok'`, `'relogin_required'`, and the other seven cswap usage states are string-compared in three
  places (`claude-swap.js:129`, `renderer.js:259`, `renderer.js:271`). The two lookup tables
  (`STATUS_LABEL`, `STATUS_ACTIONABLE`) are already good practice; add a `USAGE_STATUS` frozen enum
  next to them so the comparisons stop using bare literals.
- `'s5'`, `'s7'`, `'sf'` data-role strings are written in `acctHtml()` and matched by `paintRow`
  callers (`renderer.js:188-195`, 280-286). Same file today, so low risk — but they must move
  together, so name them.
- Filenames `'settings.json'`, `'swap-cache.json'`, `'claude-web.json'`, `'tray-icon.ico'`,
  `'tray-icon.png'`, `'app-icon.ico'` — one `paths.js`.

### 5. The standard to adopt

A literal appears exactly once, in the module that names it; use sites reference the name. Anything
crossing a process boundary (channel, reading id, settings key, status value) lives in `shared/` and
is `Object.freeze`d. Anything that is a measured value — the 28-30 requests/hour budget, the 180s
cswap floor, the 0.6 zoom exponent — keeps its explanatory comment attached to the constant, which
is where a reader will look for it. This project's comments are its best asset; a named constant is
just the correct place to hang one.

---

## Swallowed errors

Raised in review against `loadSwapCache` (`main.js:105-110`). The criticism is correct, and the
pattern is repo-wide: **13 catch blocks discard the error entirely**, 8 of them with only a comment
where the log line should be.

```
main.js:109                 catch { /* no cache yet */ }
main.js:143                 catch { /* non-fatal */ }          // cache write
main.js:453                 catch { settings = validateSettings(null) }
main.js:583                 catch { return { loggedIn: false } }
claude-swap.js:73           catch { return cb(none) }          // PowerShell JSON
claude-usage.js:29          catch { /* next path */ }
claude-usage.js:111         catch { return }                   // lazy require
claude-web.js:51, 59, 66, 93, 104, 240
```

### `loadSwapCache` specifically

The intent — "no cache on first launch is not an error" — is right, but the catch is wider than the
intent. It swallows four distinguishable cases:

| case | frequency | should do |
|---|---|---|
| `ENOENT` — no cache yet | once per install | nothing, silently. This is the only case the comment describes. |
| truncated / corrupt JSON | rare, but **permanent once it happens** | log a warning and delete the file |
| `EACCES`/`EPERM` | rare, indicates a broken profile dir | log a warning — `settings.json` writes are about to fail too |
| a bug in the shape check | any refactor | log; this is the one that costs an afternoon |

Case 2 is the one that makes this worth fixing rather than defending, and it is reachable from this
same file: the cache is written with a bare `fs.writeFileSync` (`main.js:143`) with no temp-file +
rename, so a crash or a power loss mid-write leaves a truncated JSON file on disk. From then on
every launch fails to parse it, silently, forever — and the only symptom is that the widget is blank
for up to 30 seconds at startup, which looks exactly like cswap being slow. Two silent handlers
covering for each other is how a five-minute bug becomes unfindable.

Suggested shape — one helper, used by all three JSON stores (`settings.json`, `swap-cache.json`,
`claude-web.json`), which also removes three copies of this try/catch:

```js
// src/main/json-store.js
function readJson(file, label) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[${label}] unreadable (${err.code || err.name}): ${err.message}`)
    return { ok: false, err }
  }
}

function writeJsonAtomic(file, value, label) {
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8')
    fs.renameSync(tmp, file)   // atomic on both NTFS and ext4
  } catch (err) {
    console.error(`[${label}] save failed (${err.code || err.name}): ${err.message}`)
  }
}
```

`loadSwapCache` then becomes: read, log on anything but ENOENT, and on a parse failure
`fs.rmSync(swapCacheFile, { force: true })` so the next run starts clean instead of failing
identically forever.

### The other twelve, triaged

- **Legitimately silent, but should still narrow the catch:** `claude-usage.js:29` (probing five
  candidate credential paths — ENOENT is the expected answer for four of them, but a *parse* failure
  on a file that does exist means Claude Code's credentials are corrupt and deserves one warning),
  `claude-web.js:59` (`unlinkSync` on logout, already gone is fine),
  `claude-web.js:93` (a subscriber's callback throwing is genuinely not this module's problem —
  though it should still log, or a broken subscriber is invisible).
- **Should log, no behaviour change:** `main.js:143` (cache write), `main.js:453` (settings unreadable
  → falls back to defaults, which means **a corrupt settings file silently resets every preference
  the user has set**; that deserves a warning at minimum), `claude-swap.js:73` (PowerShell returned
  something that is not JSON — worth one log, since it is the difference between "no auto daemon" and
  "process detection is broken"), `claude-web.js:51`, `:66` (a `safeStorage` decrypt failure means the
  OS keychain changed — the user needs to know they must log in again), `:104`, `:240`.
- **Actively hiding a defect today:** `main.js:583`. `catch { return { loggedIn: false } }` is what
  converts the `getClaudeWeb is not defined` ReferenceError above into a plausible-looking
  "not connected" status. A `console.error` there would have surfaced that bug the first time the
  settings window opened.

### The rule worth adopting

An empty catch is a claim that *every possible* error at that site is expected and harmless. That
claim is almost never true, and it is never true for `JSON.parse` and `fs` together, because the
"file missing" case has a specific error code and everything else is a real fault. So:

1. Catch narrowly — check `err.code`/`err.name`, re-throw or log the rest.
2. Never let a comment stand in for a log line. `/* non-fatal */` is a note to the author; a log line
   is a note to whoever is debugging at 2am.
3. If a silent catch really is correct, say *why it is exhaustive* in the comment — not just that the
   common case is fine.

This is also a SOLID point, not only a hygiene one: these handlers are silent because each of the
three JSON stores hand-rolls its own persistence. One `json-store` module makes correct logging the
default everywhere and the decision reviewable in one place.

---

## What not to change

- The single-instance lock, fixed-argv `execFile` invocations, and the `CSWAP_NUM_RE` check are
  correct as written; keep them exactly when they move.
- `contextIsolation: true` / `nodeIntegration: false` / the strict CSP are non-negotiable — the
  `shared/` script-tag approach above is chosen specifically because it needs no CSP relaxation.
- The comment density in the sensors is unusually good and explains real measured behaviour
  (the 28-30 req/hr budget, the `zoom` vs `transform: scale` decision, the flash-attn-class
  gotchas). Move those comments with the code; do not summarise them away.
