# Claude-O-Meter

A small desktop widget that shows how much of your Claude usage you've used up, and when it resets.

No more guessing whether you're about to hit a limit mid-task.

## What it does

- Shows your **5-hour session limit** and your **weekly limit** — percent used, a bar, and a live
  countdown to when it resets.
- If your plan has a per-model weekly limit, that gets its own row too.
- **Multiple accounts?** If you use [cswap](https://github.com/realiti4/claude-swap) to switch
  between Claude accounts, the widget shows all of them at once, so you can see at a glance which
  one still has room.
- Lives in your system tray. Hover the icon to see where you're at without opening the window.
- Drag it anywhere, resize it however you like, pick from 8 color themes.
- Free. It reads the login you already have — there's nothing extra to sign up for.

## Install

### Windows

1. Download `Claude-O-Meter Setup <version>.exe` from the
   [Releases page](https://github.com/an80sPWNstar/Claude-O-Meter/releases).
2. Double-click it. It won't ask for admin rights — it installs just for you.
3. It opens on its own and puts an icon in your tray, down by the clock.

If you already have Claude Code installed and logged in, the numbers show up within a few seconds
and you're done. If not, click **Settings** at the top of the widget → **Settings…** → **Log in with
Claude account**.

A couple of things worth knowing:

- **Installing a newer version?** Quit the running copy first (right-click the tray icon → Quit).
  Windows won't let the installer replace the app while it's running, and the install fails halfway.
- **To uninstall:** Settings → Apps → Installed apps, same as anything else.

### Linux — Ubuntu, Debian, Mint, Pop!_OS

Download the `.deb`, then install it from a terminal in that folder:

```bash
sudo apt install ./claude-o-meter_<version>_amd64.deb
```

The `./` in front matters — that's what tells apt to pull in the handful of system libraries the app
needs. To remove it later: `sudo apt remove claude-o-meter`.

### Linux — everything else (Arch, Fedora, openSUSE, and friends)

Download the `.AppImage`. It's the whole app in one file, no install:

```bash
chmod +x Claude-O-Meter-<version>.AppImage
./Claude-O-Meter-<version>.AppImage
```

**If you get an error mentioning `libfuse.so.2`**, that's not a broken download. AppImages need an
older helper library that most distros no longer ship by default. Either install it:

```bash
sudo pacman -S fuse2                 # Arch, Manjaro, EndeavourOS
sudo dnf install fuse fuse-libs      # Fedora, RHEL
sudo apt install libfuse2            # Ubuntu 22.04+
sudo zypper install fuse             # openSUSE
```

...or skip it entirely, which needs nothing installed:

```bash
./Claude-O-Meter-<version>.AppImage --appimage-extract-and-run
```

The AppImage won't add itself to your applications menu.
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) will do that for you if you care
about it.

### Mac

**There's no Mac build yet.** Not because it's hard — a Mac app can only be built on a Mac, and I
don't have one. If people ask for it, I'll set one up.

If you have a Mac and want it now, you can build it yourself in about five minutes — see below. One
catch: it won't be signed by Apple (that needs a paid developer account), so macOS will refuse to
open it the first time. Right-click the app → **Open**, and you'll get the option to run it anyway.
After that it opens normally.

### Build it yourself

Works on any platform. You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/an80sPWNstar/Claude-O-Meter.git
cd Claude-O-Meter
npm ci
npm start
```

That runs the app straight from source. To make an installer instead:

| You want | Run this | You need to be on |
| --- | --- | --- |
| Windows `.exe` | `npm run build` | Windows, or Linux/WSL with Wine installed |
| Linux `.AppImage` + `.deb` | `npm run build:linux` | Linux (WSL works) |
| Mac `.dmg` | `npm run build:mac` | a Mac, no way around it |

Finished files land in `dist/`.

**On Windows with WSL, you can build everything except the Mac version.** Run the Linux build inside
your WSL terminal, not PowerShell — and copy the project into your Linux home folder first
(`cp -r /mnt/c/path/to/Claude-O-Meter ~/`), because building it on the Windows drive loses file
permissions the AppImage needs. WSL needs its own `npm install`, since the one on the Windows side
holds Windows-only files.

## Using it

**The two buttons at the top** are the whole menu. **Settings** has text size, colors, always-on-top,
refresh, and account switching. **Help** explains what you're looking at.

**Each account row** shows the account name, an `ACTIVE` tag on whichever one Claude Code is signed
in as right now, and a small label like `live` or `4m ago`.

That last one is just honesty about how fresh the number is. Claude limits how often usage can be
checked — roughly once every three minutes per account — so a row can be a few minutes behind, and
an account you haven't touched in a while drifts further out because nothing is changing on it. If
that label turns orange, the account hasn't been able to check in for a while.

**To switch accounts**, use Settings → Switch Account. It's deliberately not a click on the account
name — that was too easy to hit by accident while dragging the window around.

## Settings

- Start with Windows *(Windows only, installed builds only)*
- Minimize to tray instead of closing
- Always on top
- Text size (90%–150%)
- Poll Claude usage — turn this off and the app makes no network calls at all
- Log in / out of claude.ai
- Theme: cream, dark, midnight, phosphor, outrun, cinch, porsche, temple

## Where the numbers come from

The app tries these in order, and any one of them is enough:

1. **Claude Code's saved login** on your computer (`~/.claude/.credentials.json`), checked every 5
   minutes.
2. **A claude.ai login** through the app, if there's no Claude Code login to read.
3. **cswap**, if you have it — checked every 30 seconds, and this is what fills in the
   multi-account view.

If you have none of those, the widget tells you so instead of sitting there blank.

When cswap is running, the app stops doing its own check. Both would be asking Anthropic the same
question about the same account, and asking too often gets an account temporarily cut off from
checking at all.

## For developers

```bash
npm run dev          # DevTools open on both windows
npm run build        # Windows installer into dist/
npm run build:dir    # unpacked build, no installer
npm run build:linux  # AppImage + deb
npm run build:mac    # dmg (macOS only)
```

`CLAUDEOMETER_SWAP_MOCK=1` fills the multi-account view with three fake accounts, so that layout can
be worked on without cswap installed. `design/fit-check.cjs` screenshots the widget at a range of
window sizes and text scales using offscreen capture — which also works when the desktop is locked
or another window is covering it.

**Gotcha:** `npm install` sometimes leaves `node_modules/electron/dist/` empty — the post-install
download claims a cache hit but extracts nothing, so `npm start` silently does nothing. The cached
zip is fine, so unpack it by hand:

```bash
ZIP="$LOCALAPPDATA/electron/Cache/<hash>/electron-v<version>-win32-x64.zip"
unzip -t "$ZIP"                                    # expect "No errors detected"
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
unzip -o -q "$ZIP" -d node_modules/electron/dist
printf 'electron.exe' > node_modules/electron/path.txt
```

**Gotcha:** Claude Code sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node and
`app` come back undefined. `unset ELECTRON_RUN_AS_NODE` first, or use a different terminal.

### Project layout

```text
.
├── main.js                  # windows, tray, menus, settings, cswap collector
├── preload.js               # contextBridge → window.claudeOMeter
├── renderer/
│   ├── index.html           # widget markup + all 8 themes
│   └── renderer.js          # fit/zoom, drag, both usage views
├── settings/                # settings window
├── src/sensors/
│   ├── claude-usage.js      # OAuth usage provider (5 min poll)
│   ├── claude-web.js        # claude.ai cookie-session fallback
│   ├── claude-swap.js       # cswap multi-account collector (30s poll)
│   ├── cswap-cmd.js         # platform-correct cswap invocation
│   └── service.js           # 1s tick so reset countdowns stay live
├── scripts/make-icons.cjs   # regenerates every icon from geometry
├── design/                  # verification harnesses (offscreen screenshots)
└── assets/
    ├── images/              # icons + theme art
    └── fonts/, lucide.min.js
```

### Icons

Every icon is generated, not hand-exported. Rebuild them with:

```bash
unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe scripts/make-icons.cjs
```

That writes both `.ico` files at 16/24/32/48/64/128/256 (stroke weight raised at the small sizes so
they don't go thin and patchy), plus a 1024px `icon.png` for Linux and Mac packaging and a
`tray-icon.png`, since a GTK tray won't take an `.ico`.

The mark is a cut C, an open letterform whose stroke is the usage fill. The app icon is terracotta
on cream; the tray icon flips it to cream on solid terracotta. The tray icon is deliberately
**static** — an earlier version drew live usage as an arc, and at 16px a few percent is a two-pixel
stroke that reads as a stray dot rather than an icon. The live numbers live in the tooltip instead.

### Security notes

- `contextIsolation: true`, `nodeIntegration: false`; the renderer only gets the narrow
  `window.claudeOMeter` bridge.
- Strict CSP in both windows (`default-src 'self'`).
- The OAuth token and the claude.ai session key never leave the main process; the session key is
  encrypted at rest with `safeStorage`.
- `cswap` is invoked with fixed argument arrays, never a shell string, and account numbers are
  checked against `/^[0-9]+$/`.
- The login window only navigates to claude.ai and known SSO hosts, and denies popups.

## Credits

Extracted from the `claude` skin of
[tempsLCD-web](https://github.com/an80sPWNstar/tempsLCD-web) — this is that panel as a standalone
app, with the hardware monitoring taken out. The cookie-session approach is adapted from
`SlavomirDurej/claude-usage-widget`.
