# Claude-O-Meter

Frameless desktop widget showing Claude plan usage limits and reset countdowns.

## Features

- **Usage meters** — 5-hour session limit, 7-day weekly limit, and the model-scoped weekly limit when the account has one. Each shows percent used, a progress bar, and a live reset countdown.
- **Multi-account** — with the `cswap` CLI installed, one meter block per connected account, each
  with its own freshness chip (`live`, `4m ago`) since cswap refetches each account on its own
  schedule — 3 minutes is the endpoint's freshness floor, and an idle account drifts further out
  while its usage isn't moving. Switching the active account is a right-click menu item, on the
  widget and on the tray, so nothing in the panel itself can fire `cswap switch` on a stray click.
  With cswap present the app's own OAuth poll is suspended, since both share one per-token request
  budget and only the cswap figures get painted.
- **Window behavior** — frameless, transparent, draggable by its body, resizable with scale-to-fit zoom. Optional always-on-top. Resizes itself to fit the account count in multi-account mode.
- **Settings and Help in the header** — the two header buttons carry everything: text size, theme,
  always-on-top, refresh, account switching, a plain-language guide to the panel, and About. There
  is no right-click menu.
- **Resizes freely** — width and height are independent; the bars stretch and the type scales
  sub-linearly so it stays readable at small sizes. Settings → Text Size raises the whole curve
  (90%–150%) and grows the window's minimum to match.
- **Tray tooltip** — hovering the tray icon gives the active account's session and weekly percentages and the reset countdown, without opening the window.
- **Tray menu** — show/hide widget, refresh now, settings, about, quit. The app stays resident in the tray; it only quits from the tray or the right-click menu.
- **8 themes** — cream, dark, midnight, phosphor, outrun, cinch, porsche, temple. Picked from the settings window or by right-clicking the widget.

## Install

```bash
npm install
npm start
```

Windows is the primary target (NSIS installer). Linux packages build too — `npm run build:linux`
produces an AppImage and a .deb; on a Windows box run that inside WSL2, since electron-builder needs
a Linux filesystem for the AppImage's permission bits. On Linux the tray takes the PNG icon rather
than the .ico, "Start with Windows" is disabled because Electron only implements it on Windows and
macOS, and `cswap auto` detection falls back from PowerShell to `pgrep`.

macOS cannot be built from Windows or Linux at all: `.dmg` needs `hdiutil` and the bundle needs
`codesign`, both Apple-only. `.github/workflows/build.yml` builds it on a GitHub `macos-latest`
runner instead — run it manually from the Actions tab. Those artifacts are unsigned, so Gatekeeper
blocks the first launch; right-click → Open, or
`xattr -dr com.apple.quarantine "/Applications/Claude-O-Meter.app"`.

## How usage data is found

Sources are tried in this order:

1. **Claude Code OAuth** — reads the access token from `~/.claude/.credentials.json` and polls `https://api.anthropic.com/api/oauth/usage` every 5 minutes. The token is re-read each poll, so Claude Code's own refresh is picked up automatically.
2. **claude.ai cookie session** — used when no OAuth token exists. Log in through a popup; the `sessionKey` cookie is stored encrypted with Electron `safeStorage` and usage is fetched through a hidden Chromium window (a plain `fetch()` gets blocked by Cloudflare, a real page does not).
3. **cswap CLI** — polls `cswap list --json` every 45 seconds. When it reports accounts, the multi-account view takes over from the single-account meters, and a footer dot indicates a running `cswap auto` daemon.

Nothing is required: with no Claude Code install, no login, and no `cswap`, the widget just shows why it has no data.

## Themes

`cream` `dark` `midnight` `phosphor` `outrun` `cinch` `porsche` `temple`

Change via the settings window or right-click → Colors.

## Configuration

Settings live in the settings window (tray → Settings):

- Start with Windows (installed builds only)
- Minimize to tray instead of closing
- Always on top
- Poll Claude usage (off = no network calls at all)
- claude.ai login / logout
- Theme

Persisted to `settings.json` in the Electron `userData` directory, alongside `swap-cache.json` (last account payload, painted at launch so the widget isn't blank for the first poll) and `claude-web.json` (encrypted session key).

## Development

```bash
npm run dev        # opens DevTools on both windows
npm run build      # NSIS installer into dist/
npm run build:dir  # unpacked build, no installer
```

Set `CLAUDEOMETER_SWAP_MOCK=1` to feed the multi-account view three fake accounts without `cswap` installed.

**Gotcha:** `npm install` can leave `node_modules/electron/dist/` empty — Electron's post-install download reports a cache hit but extracts nothing, so `electron.exe` is missing and `npm start` does nothing. The cached zip is intact; extract it by hand:

```bash
ZIP="$LOCALAPPDATA/electron/Cache/<hash>/electron-v<version>-win32-x64.zip"
unzip -t "$ZIP"                                    # expect "No errors detected"
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
unzip -o -q "$ZIP" -d node_modules/electron/dist
printf 'electron.exe' > node_modules/electron/path.txt
```

**Gotcha:** Claude Code sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node (`app` comes back undefined). `unset ELECTRON_RUN_AS_NODE` first, or launch from a separate terminal.

## Project layout

```text
.
├── main.js                  # windows, tray, IPC, settings persistence, swap collector
├── preload.js               # contextBridge → window.claudeOMeter
├── renderer/
│   ├── index.html           # widget markup + all 8 themes
│   └── renderer.js          # scale-to-fit, drag, both usage views
├── settings/
│   ├── index.html
│   └── settings.js
├── src/sensors/
│   ├── claude-usage.js      # OAuth usage provider (5 min poll)
│   ├── claude-web.js        # claude.ai cookie-session fallback
│   ├── claude-swap.js       # cswap multi-account collector (45s poll)
│   ├── cswap-cmd.js         # platform-correct cswap invocation
│   └── service.js           # 1s tick so reset countdowns stay live
├── scripts/
│   └── make-icons.cjs       # regenerates both .ico files from geometry
└── assets/
    ├── images/              # app-icon.ico, tray-icon.ico, theme art
    └── fonts/, lucide.min.js
```

## Icons

`app-icon.ico` and `tray-icon.ico` are generated, not hand-exported — run
`unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe scripts/make-icons.cjs`
to rebuild them from the geometry in that file. It emits both `.ico` files at
16/24/32/48/64/128/256 with the stroke weight raised at the small end.

The mark is a cut C — an open letterform whose stroke is the usage fill. The app icon draws it in
terracotta on a cream tile over a grey track; the tray icon inverts that to a cream mark on a solid
terracotta tile, with no track and no value. The tray icon is deliberately **static**: a gauge drawn
at 16px is unreadable at low usage, where a few percent is a two-pixel stroke that reads as a stray
dot rather than an icon. The live numbers are in the tooltip.

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`; the renderer gets only the narrow `window.claudeOMeter` bridge.
- Strict CSP in both windows (`default-src 'self'`).
- The OAuth token and the claude.ai session key never leave the main process; the session key is encrypted at rest with `safeStorage`.
- `cswap` is invoked with fixed argv arrays, never a shell string, and account numbers are validated against `/^[0-9]+$/`.
- The login window restricts navigation to claude.ai and known SSO hosts, and denies popups.

## Credits

Extracted from the `claude` skin of [tempsLCD-web](https://github.com/an80sPWNstar/tempsLCD-web) — this is that skin as a standalone app, with the hardware monitoring removed. The cookie-session approach is adapted from `SlavomirDurej/claude-usage-widget`.
