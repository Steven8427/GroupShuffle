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

Artifacts land in `dist/`: an NSIS installer and a portable exe (both x64). The first build downloads the Electron binaries, so expect it to take a while.

## Features

- One item per line; blank lines are dropped, everything else is kept verbatim (no trimming, no dedup)
- Group count: 2 / 3 / 4 / 5 shortcut buttons, or any custom value from 1 to 1000
- Group sizes differ by **at most 1**, and the groups that get the extra item are chosen at random — they don't always land on the first few
- Per-group "Copy group" and "Export TXT", plus "Export all to folder" which writes `group-1.txt … group-N.txt` in one go
- "Include numbering when copying / exporting" toggle (off by default — cleaner when pasting into chat apps)
- "Wrap long lines" toggle; turn it off to truncate to a single line, which is the cheapest to scroll
- Import TXT: pick a file, or just drop a `.txt` onto the input area
- `Ctrl + Enter` to shuffle
- **One-click 中文 / English switch** in the top right. The choice is stored in localStorage and defaults to your system language. Native dialogs and the tray menu follow it too
- **Minimizes to the system tray** (notification area) instead of the taskbar; click the tray icon to restore, right-click for "Show window / Quit"
- **Closing the window asks for confirmation**, so a stray click won't throw away your grouping. Tray "Quit" and system shutdown are explicit, so they don't ask twice
- Scrollbars follow the light/dark theme instead of the glaring default white bar

Exported files are **UTF-8 with BOM and CRLF line endings**, so Notepad and Excel open them without mojibake and without collapsing everything onto one line.

### Only the twenty visible rows are rendered

Whether the input is 10 lines or 100,000, the UI **mounts only the ~20 visible rows** and renders the rest on demand as you scroll — this applies to both the input preview and every group card. With 100,000 lines split into 5 groups, the whole window holds around 100 row nodes. Lists shorter than 20 rows shrink to fit instead of leaving blank space.

### Large inputs collapse automatically

Above 5,000 lines the input no longer goes into the `<textarea>`. It collapses into a **scrollable read-only preview** (with an "N lines loaded" header); the text itself lives in memory and grouping works exactly the same. Click "Edit" to put it back into a real text box.

This isn't a shortcut — it's the single biggest performance trap in this app. A native text control holding 100,000 lines is 2 million pixels tall internally, and **laying it out alone costs 2.6 seconds**. Worse, every time the virtual list resizes its spacer, that text control gets relaid out along with it. Measured:

| Scenario | Before collapsing | After |
|---|---|---|
| First layout after pasting 100k lines | 2615 ms | **4 ms** |
| Clicking "Shuffle & split" until results appear | 3677 ms | **46 ms** |
| One scroll frame in the results list | 600–1100 ms | **≤ 5 ms** |

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

Measured with 100,000 lines split into 5 groups: 26 ms parsing, 9 ms shuffling, under 1 ms grouping — 46 ms end to end.

## Generating test data

Write 100,000 long lines, then load the file with "Import TXT":

```bash
node -e "const a=[];for(let i=0;i<100000;i++)a.push('residential.wealthproxies.com:3128:user'+i+':7u1aHTqmZBWjBArn-S'+Math.random().toString(16).slice(2)+'-walmart-US');require('fs').writeFileSync('sample-100k.txt',a.join('\r\n'),'utf8')"
```

## Layout

```
main.js              Main process: window, native dialogs, fs access
preload.js           contextBridge allowlist (setLang / openTxt / saveTxt / saveAll / reveal)
renderer/index.html  Markup (copy is tagged with data-i18n, never hardcoded)
renderer/styles.css  Styles (follows the system light/dark theme)
renderer/core.js     DOM-free core algorithms (rng / parse / shuffle / grouping / Fenwick)
renderer/i18n.js     Chinese and English string tables
renderer/app.js      UI interactions and virtual scrolling
```

All UI copy goes through `renderer/i18n.js`. The main process keeps its own small table for native dialogs and the tray menu; the renderer pushes language changes across via `app:setLang`.

`core.js` has no DOM dependencies, so you can `require` it straight from Node to test:

```bash
node -e "require('./renderer/core.js').parseItems('a\nb\n\nc').then(r=>console.log(r))"
```

To debug renderer errors, start with `RG_DEBUG=1` and its console output is forwarded to the terminal.

The renderer runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. It never touches the filesystem directly — every read and write goes through the five methods preload exposes.
