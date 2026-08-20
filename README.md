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
- **Window behavior** — frameless, transparent, draggable by its body. Optional always-on-top.
  Resizes itself to fit the account count in multi-account mode.
- **Settings and Help in the header** — the two header buttons carry everything: text size, theme,
  always-on-top, refresh, account switching, a plain-language guide to the panel, and About. There
  is no right-click menu.
- **Resizes freely** — width and height are independent; the bars stretch and the type scales
  sub-linearly so it stays readable at small sizes. Settings → Text Size raises the whole curve
  (90%–150%) and grows the window's minimum to match.
- **Tray tooltip** — hovering the tray icon gives the active account's session and weekly percentages and the reset countdown, without opening the window.
- **Tray menu** — show/hide widget, refresh now, switch account, settings, about, quit. The app
  stays resident in the tray and only quits from there.
- **8 themes** — cream, dark, midnight, phosphor, outrun, cinch, porsche, temple. Picked from the
  settings window or from Settings → Colors in the header.

## Install

### Easiest — download a release

Grab the file for your platform from the [Releases page](https://github.com/an80sPWNstar/Claude-O-Meter/releases):

| Platform | File | Notes |
| --- | --- | --- |
| Windows 10/11 | `Claude-O-Meter Setup <version>.exe` | one-click, per-user, no admin |
| Debian / Ubuntu / Mint / Pop!_OS | `claude-o-meter_<version>_amd64.deb` | pulls its own dependencies |
| Any other Linux | `Claude-O-Meter-<version>.AppImage` | one file, no install |
| macOS | — | no prebuilt build; see [macOS](#macos) |

Nothing is published yet — until a release exists, use the per-platform steps below or
[build from source](#build-from-source-any-platform).

### Windows

Run the installer. It is per-user, so it never asks for admin rights, and it lands in
`%LOCALAPPDATA%\Programs\claude-o-meter`. The app starts on finish and lives in the tray.

Quit any running copy from its tray menu **before** reinstalling — NSIS cannot replace a running
`Claude-O-Meter.exe` and the install fails partway.

Uninstall from Settings → Apps → Installed apps, like any other program.

To build the installer yourself: `npm ci && npm run build`, which writes the exe to `dist/`.

### Linux — Debian, Ubuntu, Mint, Pop!_OS

```bash
sudo apt install ./claude-o-meter_<version>_amd64.deb
```

Use `apt install ./file.deb` rather than `dpkg -i`, so the dependencies come along:
`libgtk-3-0`, `libnotify4`, `libnss3`, `libxss1`, `libxtst6`, `xdg-utils`, `libatspi2.0-0`,
`libuuid1`, `libsecret-1-0`. The last one matters — `libsecret` is what Electron's `safeStorage`
uses to encrypt a claude.ai session key, and without a keyring the app still runs but cannot store
that login.

The app appears in your launcher as Claude-O-Meter. Remove it with
`sudo apt remove claude-o-meter`.

### Linux — Arch, Manjaro, EndeavourOS

There is no AUR package. Use the AppImage:

```bash
sudo pacman -S fuse2                 # AppImages need FUSE 2, not the FUSE 3 that ships by default
chmod +x Claude-O-Meter-<version>.AppImage
./Claude-O-Meter-<version>.AppImage
```

If you would rather not install `fuse2`, the AppImage can unpack itself instead:

```bash
./Claude-O-Meter-<version>.AppImage --appimage-extract-and-run
```

Or build from source with `sudo pacman -S nodejs npm` and the steps below.

### Linux — Fedora, RHEL, openSUSE

Same AppImage, with the FUSE 2 compatibility package:

```bash
sudo dnf install fuse fuse-libs      # openSUSE: sudo zypper install fuse
chmod +x Claude-O-Meter-<version>.AppImage
./Claude-O-Meter-<version>.AppImage
```

An `.rpm` is not published, but the tooling can produce one — `npx electron-builder --linux rpm` on
a machine with `rpm-build` installed.

### Linux — any distro (AppImage)

The AppImage is self-contained and needs no install: mark it executable and run it. Two things are
worth knowing.

**FUSE 2 is required.** Most current distros ship FUSE 3, and the AppImage fails with
`dlopen(): error loading libfuse.so.2`. Either install the compatibility package for your distro
(above) or run with `--appimage-extract-and-run`, which unpacks to a temp dir and skips FUSE
entirely.

**Desktop integration is not automatic.** The AppImage does not create a menu entry by itself;
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) does that if you want it.

### macOS

There is no macOS build, and one cannot be produced on Windows or Linux: `.dmg` creation needs
Apple's `hdiutil` and the app bundle needs `codesign`, so electron-builder refuses the target
anywhere but macOS.

On a Mac, build it yourself:

```bash
npm ci
npm run build:mac        # dist/Claude-O-Meter-<version>.dmg
```

The result is **unsigned**, so Gatekeeper blocks the first launch. Right-click the app → Open (which
offers an override the double-click path does not), or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Claude-O-Meter.app"
```

A signed, notarized build needs a paid Apple Developer account. Without a Mac at hand, a GitHub
Actions `macos-latest` runner can do the build instead.

**Nobody has run this on macOS yet.** It should work — the code is platform-neutral apart from the
tray icon and the autostart toggle — but the menu bar icon in particular would likely want a
monochrome template image before it looks right.

### Build from source (any platform)

Needs Node 22 or newer.

```bash
git clone https://github.com/an80sPWNstar/Claude-O-Meter.git
cd Claude-O-Meter
npm ci
npm start                # run it directly, no packaging
```

Then, for an installer: `npm run build` (Windows), `npm run build:linux` (AppImage + deb), or
`npm run build:mac` (dmg, macOS only).

Building the **Linux** packages from a Windows box works through WSL2, but copy the checkout into
the Linux filesystem first — building on `/mnt/c` or `/mnt/e` loses the executable bits the AppImage
needs:

```bash
cp -r /mnt/e/path/to/Claude-O-Meter ~/build && cd ~/build
rm -rf node_modules dist && npm install
npm run build:linux
```

If `npm start` does nothing at all, see the Electron extraction gotcha under
[Development](#development).

### After installing

Neither is required, but both add something:

- **Claude Code** — if it is installed and logged in, the widget reads its OAuth token and needs no
  setup of its own. Otherwise use Settings → *Log in with Claude account*.
- **[cswap](https://github.com/realiti4/claude-swap)** (`claude-swap`, installed with
  `uv tool install claude-swap`) — the multi-account switcher for Claude Code. With it installed,
  every connected account gets its own meter block.

## How usage data is found

Sources are tried in this order:

1. **Claude Code OAuth** — reads the access token from `~/.claude/.credentials.json` and polls `https://api.anthropic.com/api/oauth/usage` every 5 minutes. The token is re-read each poll, so Claude Code's own refresh is picked up automatically.
2. **claude.ai cookie session** — used when no OAuth token exists. Log in through a popup; the `sessionKey` cookie is stored encrypted with Electron `safeStorage` and usage is fetched through a hidden Chromium window (a plain `fetch()` gets blocked by Cloudflare, a real page does not).
3. **cswap CLI** — polls `cswap list --json` every 30 seconds. When it reports accounts, the multi-account view takes over from the single-account meters, and a footer dot indicates a running `cswap auto` daemon.

Nothing is required: with no Claude Code install, no login, and no `cswap`, the widget just shows why it has no data.

## Themes

`cream` `dark` `midnight` `phosphor` `outrun` `cinch` `porsche` `temple`

Change from the settings window, or Settings → Colors in the widget header.

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
