# Changelog

## 1.3.0

### Changed

- **Frames are written in the program's colour profile.** As in Go, where the renderer converts every cell to the profile, the renderer now downsamples the colours of each frame: 24-bit colours become the nearest of the 256 colours (`ANSI256`) or of the 16 ANSI colours (`ANSI`), `Ascii` drops colours but keeps bold, italic and underline, and `NoTTY` writes no styles or hyperlinks at all. The conversion is a port of x/ansi's `Convert256`/`Convert16` (HSLuv distance between the colour cube and the greys). `WithColorProfile` used to change only the `ColorProfileMsg` the model received; it now also sets the profile frames are written in. Lines printed with `println`/`printf` are still written as given, as in Go.
- **Colour profile detection follows Go's `colorprofile.Detect`.** An output that is not a terminal (`isTTY` is not true) is now `NoTTY`, so a program piped to a file or another program writes plain text, unless `TTY_FORCE` or `CLICOLOR_FORCE` is true. `NO_COLOR` is read as a Go boolean (`1`, `true`, `t`; `NO_COLOR=yes` no longer counts) and only limits a terminal to `Ascii`. `TERM=dumb` or an empty `TERM` is `NoTTY` instead of `Ascii`. `CLICOLOR`, `CLICOLOR_FORCE`, `COLORTERM=yes|true`, `*-direct` terminals, kitty, ghostty, wezterm, alacritty, foot, contour, rio, `WT_SESSION`, `GOOGLE_CLOUD_SHELL`, `TMUX` and the Windows console version are taken into account. The terminfo database and `tmux info` are not read. **If you write to a stream that stands for a terminal but is not a TTY** (an SSH channel, a web terminal), pass `WithColorProfile`, or your program's output will have no colours.

### Added

- `ColorProfile.NoTTY`.
- `program.settle()`: resolves once every queued message has been handled (including follow-ups from synchronous commands and input bytes waiting to be told apart) and the frame for the resulting model has been written. Not part of Go's API; it lets test helpers such as `@oakoliver/teatest` look at the screen right after sending input.

### Docs

- The startup synchronized-output/unicode-core probe is written whether or not the output is a terminal, as in Go (`tea.go`, `Run` → `executeQuery`): it depends on the environment and on input being enabled. The README says how to make it deterministic.

## 1.2.2

### Fixed

- **Alt+letter keys read as `alt+x`.** `ESC x` was decoded with `text: 'x'`, so `toString()` returned `"x"` and bindings such as `alt+b` never matched. As in Go, Alt-prefixed keys now carry no text, and an upper-case letter is reported as its lower-case code with shift (`alt+shift+a`).

## 1.2.1

### Fixed

- **Crash reports survive the alternate screen.** When `update`, a command or a mouse handler threw, the error and its stack were written to stderr before the terminal was restored, so in a full-screen program they vanished with the alternate screen and only `program experienced a panic` was left. They are now printed after the terminal is restored, as Bubble Tea does in Go. `run()` still rejects with `ErrProgramPanic`.
- **`ProgramError` no longer prints `cause: undefined`.** `cause` is set only when one is given.

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
