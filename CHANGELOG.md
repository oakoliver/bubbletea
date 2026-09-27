# Changelog

## 1.2.0 — parity with Bubble Tea v2.0.10

Syncs with upstream [v2.0.9](https://github.com/charmbracelet/bubbletea/releases/tag/v2.0.9) and [v2.0.10](https://github.com/charmbracelet/bubbletea/releases/tag/v2.0.10).

### Fixed

- **Input disabled skips terminal queries** (upstream #1801). With `WithInput(null)`, every command that expects a terminal reply (background/foreground/cursor color, cursor position, clipboard reads, termcap, terminal version, window size) and the startup synchronized-output/unicode-core probe are no longer written, so replies can't leak into the shell after exit. The renderer also leaves the Kitty keyboard / modifyOtherKeys protocol untouched when input is disabled (`StandardRenderer.setNoInput`).
- **Kitty keyboard stack is restored on exit** (upstream #1750). The renderer now pushes an entry (`CSI > flags u`) on first render and on each alt-screen switch, updates the top entry in place (`CSI = flags ; 1 u`) when only the flags change, and pops it (`CSI < 1 u`) when switching screens and on close, instead of overwriting the terminal's entry. `ansi.kittyKeyboard` now emits the x/ansi `CSI = flags ; mode u` encoding (it previously emitted `CSI > …`), and `ansi.pushKittyKeyboard` / `ansi.popKittyKeyboard` were added.
- **Clear screen always redraws** (upstream #1755, `pendingErase`). `StandardRenderer.clearScreen()` marks the frame dirty, so the next flush repaints even when the view is unchanged instead of leaving a blank screen.
- **Media record and mouse button 11** (upstream #1757, #1754). `ExtendedKeyCode.MediaRecord` and `MouseButton.Button11` are distinct values with regression coverage. In this port, `ExtendedKeyCode` members that auto-increment after a `KeyExtended + n` initializer were `undefined` at runtime under Bun and esbuild (including the published `dist`), which broke media, lock and F22+ keys. Enum initializers are now numeric literals.
- **`ProgressBarState` names** (upstream #1748). `formatProgressBarState` returns `"Unknown"` for out-of-range values, with regression coverage.

### Docs

- Query commands and `WithInput` document that input must be enabled for replies to arrive.

## 1.1.0 — parity with Bubble Tea v2.0.8

- Ported the Bubble Tea v2.0.8 API and behavior surface.
