# Claude-O-Meter — session handoff

Append-only. Newest entry wins; older entries are history, not instructions.
Entries are hints, not facts — verify a named file, branch or service still matches before acting.

## 2026-08-19 23:40 -- extraction + first fix (opus/claude-code)

Created the project and the private GitHub repo `an80sPWNstar/Claude-O-Meter` by extracting the
`claude` skin out of `tempsLCD-web`. Two commits on `main`, both pushed.

Verified against live data, not mocks: OAuth provider returns 6 readings; `cswap list --json`
returns 2 accounts (cinchit, drcu — drcu active, has a Fable scoped limit); the assembled app
paints the multi-account view and self-resizes to 400x288; all 8 themes render; settings window
populates; `npm run build` produced `dist/Claude-O-Meter Setup 0.1.0.exe` (~104 MB), exit 0, no
error lines.

Fixed a real paint bug: `background` must not be in the `.bezel` transition — Chromium sticks on a
blended frame between var()-supplied multi-layer values, which washed out dark/cinch and put the
porsche crest at the wrong size and place. `getComputedStyle` reported correct values throughout,
so verify theme colours by sampling capturePage pixels, never by reading computed style. Also
raised `--cl-hint` to WCAG AA on cream/midnight/phosphor/outrun (measured 3.05/3.91/3.97/3.13).

**In flight / next:** nothing in progress. Untested surfaces are the claude.ai cookie-session
fallback (needs a real login; OAuth wins on this machine so the fallback never runs), the tray menu
items, and actually installing the built .exe. Not tagged or released.

**Don't touch:** the window-size formula is duplicated in `widgetSize()` in main.js and
`nativeSize()` in renderer/renderer.js — changing one alone desyncs the window from the bezel.

**Related, outside this repo:** the same transition fix was committed in `tempsLCD-web`
(`2a3cccd`, on `main`, **committed but NOT pushed** — local was 1 ahead of origin at the time).

## 2026-08-20 14:13 -- v0.3.0 UI pass (opus/claude-code)

Committed 503a596 on `main` and bumped to 0.3.0. Tray icon is static now (the live 5%-step gauge
was unreadable at 16px); every account block carries a freshness chip and an ACTIVE pill; account
switching left the panel for the Settings menu; the OAuth provider is suspended while cswap reports
accounts (both share one ~28-30 req/hour token budget and multi-account mode discarded the
provider's readings); resizing reflows on both axes with a sub-linear type curve plus a
Settings -> Text Size setting; header Settings/Help buttons replaced the right-click menu.

Verified live, not mocked: idle account refetches without being switched to (6 min sample), zero
OAuth polls with cswap present and automatic resume with cswap off PATH, layout at seven window
shapes and three text sizes via design/fit-check.cjs (an offscreen capturePage harness — use it,
screen capture is useless when the desktop is locked or another window is on top).

**In flight:** installer build for 0.3.0 and a push to origin. **Untested:** the claude.ai
cookie-session fallback, and the tray menu items. **Don't touch:** the window-size formula is
duplicated in main.js widgetSize() and renderer nativeSize(), and ZOOM_CURVE now is too.

## 2026-08-22 17:38 -- v0.3.1 released (opus/claude-code)

Rebuilt the Windows NSIS installer from a clean tree at 59d0a9e (nothing was unpushed; the
0.3.1 exe already in dist/ from 08-20 18:42 was equivalent, rebuilt anyway) and published the
repo's **first** GitHub release: tag `v0.3.1`, asset `Claude-O-Meter Setup 0.3.1.exe`
(104 MB, x64, one-click per-user). Verified asset state `uploaded` via `gh release view`.
https://github.com/an80sPWNstar/Claude-O-Meter/releases/tag/v0.3.1

`npm run build` works as-is on Windows — no WSL/Wine needed for the win target.

**Still open from 08-20, unchanged by this:** installer never installed-and-run end to end,
claude.ai cookie-session fallback untested, tray menu items untested. Linux/mac targets not
built or attached to this release. **Don't touch:** window-size formula duplicated in main.js
`widgetSize()`, renderer `nativeSize()`, and ZOOM_CURVE.

## 2026-08-26 04:30 -- code-quality standard rollout (opus/claude-code)

Reviewed this repo against a developer-supplied brief (SOLID, file length, purity, magic values,
swallowed errors) and wrote `docs/solid-review.md` -- 445 lines, 11 sections, every finding cited
to file:line. No code changes. `.gitignore` rewritten from the github/gitignore Node + Global
Windows/macOS templates (verified: `git ls-files | git check-ignore --stdin -v` prints nothing).

**Live bug found, not yet fixed:** `main.js:567-583` -- the `claude:login`, `claude:logout` and
`claude:status` IPC handlers call `getClaudeWeb()` and `sendClaudeStatus()`, which are defined
NOWHERE in the repo. Effect: the settings window Log-in button prints the literal string
"getClaudeWeb is not defined", and `claude:status` always reports not-connected because the
ReferenceError is swallowed by its own catch. `src/sensors/claude-web.js` is fine and exports
{login,logout,status,fetchUsage,onSessionExpired}; it is only reachable via the lazy require in
`claude-usage.js:111`. This is what "claude.ai cookie-session fallback never exercised" actually is.

**Conflict to resolve before anyone acts on the review:** the 08-22 entry says do not touch the
window-size formula duplicated across `widgetSize()`/`nativeSize()`/`ZOOM_CURVE`. The review's
stage 1 recommends extracting exactly that into a `shared/geometry.js` dual-export module. Both
positions are defensible -- the duplication is load-bearing and well-commented, and it is also the
single most-repeated hazard in this codebase. Decide deliberately; do not let a refactor drift into
it.

The house standard this was measured against now lives at `~/.claude/standards/code-quality.md`
with a `code-quality-audit` skill; six sibling repos were audited the same way the same night.

## 2026-08-26 14:35 -- login-crash fix
`main.js` called `getClaudeWeb()` and `sendClaudeStatus()` in all three `claude:*` IPC handlers;
neither was ever defined, so clicking "Log in with Claude account" returned
`getClaudeWeb is not defined` to the settings window. Both now exist above the handlers: a lazy
require of `src/sensors/claude-web` that wires `onSessionExpired` once, and a sender that pushes
`claude:status-change` to `settingsWin`. This is the audit's "never exercised" fallback -- it was
not merely unexercised, it was unreachable.

`readToken()` in `src/sensors/claude-usage.js` now checks `$CLAUDE_CONFIG_DIR/.credentials.json`
first. A machine using that env var has no `~/.claude/.credentials.json` and read as never-logged-in.

Not verified end to end: the login popup itself still needs a real claude.ai login to prove out.

## 2026-08-26 15:10 -- credential discovery on unmanaged machines
New `src/sensors/claude-credentials.js`. `claude-usage.js` no longer looks for
`~/.claude/.credentials.json` itself; it asks that module, which sweeps CLAUDE_CONFIG_DIR (comma
separated), `~/.claude`, `~/.claude*` wrapper dirs, XDG, the four Windows AppData layouts and the
macOS login keychain, then -- only when all of that is empty, and at most once per 10 min -- WSL
distro homes from Windows and Windows profiles from WSL.

Two deliberate calls in there. WSL is swept only for distros `wsl.exe -l -q --running` already
reports, because touching `//wsl.localhost/<distro>` boots the VM. And an expired token is treated
as no token: the provider skips the request instead of spending a 401, and does NOT refresh the
token itself, because the refresh token rotates and renewing it would log the user's CLI out.

Verified on this machine: normal path finds `~/.claude` in 2 ms; forced-empty-home deep sweep found
a real (expired, 2026-07-31) login at `\wsl.localhost\Ubuntu\home\bryan\.credentials.json` in
90 ms and flagged it expired; an Electron probe of the live provider returned HTTP 200 and 4
readings. I started the Ubuntu WSL distro to test that path and left it running.

`claude:diagnostics` (main.js) + a new line in the settings window report cswap count, credential
source, token life and the last fetch result. All six states exercised through settings.js.

## 2026-08-26 15:35 -- follow-up from the local-box review
rtx (boundary lens) found one real hole: the deep sweep only ran when the cheap pass found
NOTHING, so a machine holding an expired `~/.claude` token would never look at the WSL login that
was actually live. `findCredentials()` now digs when every cheap hit is expired, not only when
there are none. Same pass: `/mnt` is enumerated instead of guessing drive letters c-f.

Verified after the fix: stale local file + live WSL file -> found 2, picks the newer one and still
reports expired honestly. tesla's correctness pass produced 67 copies of one claim (execFileSync
timeout ignored on Windows); tested and refuted -- ETIMEDOUT fires at 1510 ms and the catch eats it.

## 2026-08-26 16:40 -- consent before discovery
The credential sweep is now gated on a choice the user makes. `accessMode` in settings.json:
`ask` (default, reads nothing), `auto`, `manual` (+ `credentialPath`), `browser`. `findCredentials()`
takes `{mode, credentialPath}` and there is no path that opens a credentials file without one.

The Windows installer is no longer one-click. Four pages: the disclosure (build/access-notice.txt as
the licence page), a changeable install directory, the access choice, and a finish page repeating
what was picked. It writes `userData/install-prefs.txt` (key=value, no JSON escaping of Windows
paths); `adoptInstallerChoice()` consumes and deletes it on first launch. Platforms with no
installer get `onboarding/index.html` at first run instead -- same three choices.

build/installer.nsh cost three builds to two NSIS ordering rules, both now commented in the file:
the custom include lands before MUI2.nsh (so anything needing MUI_HEADER_TEXT must sit inside the
customPageAfterChangeDir macro), and MUI_FINISHPAGE_TEXT must be defined at file scope because
customHeader is inserted after the pages. Third build died on warning 6001 for page-only Vars that
do not exist during the uninstaller pass -- those Vars now live inside the macro too.

Verified: all five access modes behave (ask/browser read nothing, manual reads only the named file,
auto sweeps); onboarding window renders and its controls drive correctly under a real preload;
settings window paints the mode and the file picker round-trips through a probe. Installer build was
still running at the time of writing -- confirm `dist/Claude-O-Meter Setup 0.3.1.exe` has today's
timestamp before trusting it, and nobody has run the installer GUI yet.
