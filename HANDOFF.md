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
