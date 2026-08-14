<p align="center">
  <img src="assets/icon.png" width="128" alt="GroupShuffle">
</p>

# GroupShuffle

<p align="center"><b>English</b> · <a href="README.md">简体中文</a></p>

A Windows desktop app that splits a list of lines into random, evenly sized groups. Electron plus plain HTML/CSS/JS, **zero runtime dependencies**, tuned specifically for inputs of 100,000+ lines.

## Run

```bash
npm install
```

```bash
npm start
```

## Build

```bash
npm run dist
```

Artifacts land in `dist/` (both x64):

| File | What it is |
|---|---|
| `GroupShuffle-Setup.exe` | Installer, about 92 MB |
| `GroupShuffle-1.2.0-portable.exe` | Portable single file, just double-click it |

Installing works like any other Windows app: double-click, walk through the wizard, optionally change the install directory (defaults to `C:\Program Files\GroupShuffle`), get desktop and Start menu shortcuts, and tick "run now" at the end. **The target machine needs no Node.js and no development environment** — the Electron runtime ships inside.

Installing into `Program Files` is a per-machine install, so Windows shows one UAC prompt. For a per-user install with no elevation (into `%LOCALAPPDATA%\Programs`), set `nsis.perMachine` to `false` in `package.json`.

The installer, uninstaller, desktop shortcut and Start menu entry all use `assets/icon.ico`. Regenerate it after changing `assets/icon.png`:

```bash
npm run icon
```

The first build downloads the Electron binaries and NSIS resources, so expect it to take a while; later builds hit the cache and finish in under a minute.

> The build is not code-signed, so Windows SmartScreen warns on first run ("More info → Run anyway"). Removing that prompt requires a code signing certificate — hand it to electron-builder through `CSC_LINK` / `CSC_KEY_PASSWORD`.

## Features

- One item per line; blank lines are dropped, everything else is kept verbatim (no trimming, no dedup)
- Group count: 2 / 3 / 4 / 5 shortcut buttons, or any custom value from 1 to 1000
- Group sizes differ by **at most 1**, and the groups that get the extra item are chosen at random — they don't always land on the first few
- Per-group "Copy group" and "Export TXT", plus "Export all to folder" which writes `group-1.txt … group-N.txt` in one go
- "Include numbering when copying / exporting" toggle (off by default — cleaner when pasting into chat apps)
- "Wrap long lines" toggle; turn it off to truncate to a single line, which is the cheapest to scroll
- Import TXT: pick a file, or just drop a `.txt` onto the input area
- `Ctrl + Enter` to shuffle
- **Language picker** behind the 🌐 icon in the top right; every language is listed under its own endonym (中文 / English). The choice is stored in localStorage and defaults to your system language, and native dialogs plus the tray menu follow along
- **Minimizes to the system tray** (notification area) instead of the taskbar; click the tray icon to restore, right-click for "Show window / Quit"
- **Closing the window asks for confirmation**, so a stray click won't throw away your grouping. Tray "Quit" and system shutdown are explicit, so they don't ask twice
- Scrollbars follow the light/dark theme instead of the glaring default white bar

Exported files are **UTF-8 with BOM and CRLF line endings**, so Notepad and Excel open them without mojibake and without collapsing everything onto one line.

### Only the twenty visible rows are rendered

Whether the input is 10 lines or 100,000, the UI **mounts only the ~20 visible rows** and renders the rest on demand as you scroll — this applies to both the input preview and every group card. With 100,000 lines split into 5 groups, the whole window holds around 100 row nodes. Lists shorter than 20 rows shrink to fit instead of leaving blank space.

### Large content never reaches the text box

Above 5,000 lines the input no longer goes into the `<textarea>`. It collapses into a **scrollable read-only preview** (with an "N lines loaded" header); the text itself lives in memory and grouping works exactly the same. While collapsed you can **keep pasting and the content is appended** — no need to expand first. Up to 50,000 lines you can still click "Edit" to put it back into a real text box.

This is the single biggest performance trap in the app: native text-control layout is synchronous, so it cannot be chunked, and once laid out, a spacer tens of millions of pixels tall drags on every window drag and scroll.

The rule is "how big will it be after the paste", not "how was it pasted". Early versions only intercepted whole-content replacement, so a paste appended at the end slipped through — exactly the pattern of pasting 100k lines at a time and building up. Measured UI freeze per paste:

| Accumulated | Before | After |
|---:|---:|---:|
| 100k | 961 ms | **29 ms** |
| 500k | 5620 ms | **69 ms** |
| 1M | 10152 ms | **141 ms** |
| **10 rounds total** | **~53 s** | **0.8 s** |

Knock-on wins: scroll P95 dropped from 22.8 ms to 8.2 ms (inside one frame budget), memory from 415 MB to 273 MB, and clicking "Edit" went from a 15.7-second freeze to a 155 ms message.

## Performance design

| Bottleneck | Approach |
|---|---|
| String copying | Lines are stored once; shuffling and grouping work purely on `Uint32Array` indices — 100k lines cost only 400 KB extra |
| Long tasks on the main thread | Parsing and shuffling run in 50k-item chunks, yielding to the event loop between batches and updating the progress bar |
| Yielding to the event loop | Uses MessageChannel rather than `setTimeout(0)` — the latter is clamped to 4 ms once nested, and throttled to once per second when the window is minimized |
| Randomness | xoshiro128\*\* seeded from `crypto`, with rejection sampling so there's no modulo bias; in-place Fisher–Yates |
| Balanced groups | `base = ⌊n/k⌋`, remainder distributed at random, prefix sums stored in `offsets` — no k separate arrays are ever built |
| DOM blowup | One virtual list for the input preview and one per group, mounting only the ~20 visible rows with a reused node pool; with many groups the cards mount lazily, reserving height beforehand so they don't collapse and pop |
| Variable row heights from wrapping | Heights in a `Uint16Array` plus a Fenwick tree for prefix sums, giving O(log n) lookups; estimates are corrected against measured heights and `scrollTop` is compensated so scrolling doesn't jump |
| Frequent reflow from the spacer | Small drifts in total height are batched until they exceed 400 px, or until you scroll near the end |
| Storing input lines | Only the start offset of each line is kept (`Uint32Array`), slicing on demand. 1M lines cost 4 MB as offsets versus 120 MB as strings |
| Appending content | Only the newly pasted chunk is scanned, never the whole buffer (a full rescan costs 2.1 s at 1M lines) |
| Row heights after an append | Only the new range is measured; existing rows keep their heights. Re-measuring all 3M rows costs 355 ms — four fifths of a single paste |
| Slicing strings for grouping | Never happens. `selectNonBlank` scans char codes to pick out non-blank line numbers and slices only when text is needed. Grouping 3M lines went from 519 ms to 217 ms |
| The browser's height ceiling | Chromium clamps element height at 33,554,428 px and silently truncates past it, leaving the tail unreachable. Above the ceiling the list switches to proportional coordinate mapping — coarser scroll precision, but the end stays reachable |

Measured with 100,000 lines split into 5 groups: 26 ms parsing, 9 ms shuffling, under 1 ms grouping — 46 ms end to end.

## Generating test data

Write 100,000 long lines, then load the file with "Import TXT":

```bash
node -e "const a=[];for(let i=0;i<100000;i++)a.push('proxy-pool.example.com:3128:user'+i+':password-placeholder-'+Math.random().toString(16).slice(2)+'-region-US');require('fs').writeFileSync('sample-100k.txt',a.join('\r\n'),'utf8')"
```

## Layout

```
main.js                Main process: window, native dialogs, fs access
preload.js             contextBridge allowlist (setLang / openTxt / saveTxt / saveAll / reveal)
renderer/index.html    Markup (copy is tagged with data-i18n, never hardcoded)
renderer/styles.css    Styles (follows the system light/dark theme)
renderer/core.js       DOM-free core algorithms (rng / line selection / shuffle / grouping / Fenwick)
renderer/i18n.js       Language registry and every string, shared by both processes
renderer/app.js        UI interactions and virtual scrolling
scripts/make-icon.ps1  Builds the multi-size icon.ico from icon.png
scripts/check-i18n.js  Checks that every language has matching keys and placeholders
```

## Adding a language

Everything lives in the `LANGS` array in `renderer/i18n.js` — append one entry:

```js
{ code: 'ja', name: '日本語', locale: 'ja-JP', strings: { /* copy zh's keys, translate each */ } }
```

The language menu, system language detection and number formatting all pick it up automatically, and **no other file needs a single line changed**. A few deliberate choices:

- The menu always shows the **endonym** (日本語, not "Japanese") so users can find their language whatever the current UI language is
- System language matching only compares the BCP-47 primary subtag: `ja-JP` hits `ja`, and `zh-TW` / `zh-Hans-CN` both hit `zh`
- Keys missing from `strings` fall back to Chinese rather than exposing a raw key, so a half-finished translation is safe to merge
- Keys prefixed `main.` belong to the main process (native dialogs, tray menu). It `require`s the same table, so the two can never drift apart

Run the completeness check once you're done — a missing key just silently reverts one line of the UI to Chinese, which is easy to miss:

```bash
npm run check-i18n
```

It reports missing keys, stray keys, and mismatched placeholders (a translation that drops `{n}` would never show the number).

`core.js` has no DOM dependencies, so you can `require` it straight from Node to test:

```bash
node -e "require('./renderer/core.js').parseItems('a\nb\n\nc').then(r=>console.log(r))"
```

To debug renderer errors, start with `RG_DEBUG=1` and its console output is forwarded to the terminal.

The renderer runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. It never touches the filesystem directly — every read and write goes through the five methods preload exposes.

## Licence

**Proprietary — all rights reserved.** No use, copying, modification or distribution without the copyright holder's prior written permission.

The source is readable here, but being readable is not a licence. Please obtain permission before using it; full terms in [LICENSE](LICENSE).
