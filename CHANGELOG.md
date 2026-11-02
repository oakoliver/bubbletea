# Changelog

## 1.4.0 — parity with Bubble Tea v2.1.1

Syncs with upstream [v2.1.0](https://github.com/charmbracelet/bubbletea/releases/tag/v2.1.0) and [v2.1.1](https://github.com/charmbracelet/bubbletea/releases/tag/v2.1.1) (the full `v2.0.10...v2.1.1` diff, and the ultraviolet, x/ansi v0.11.9 and go-colorful bumps it pulls in). A minor version because v2.1.0 adds API. It builds on the unreleased 1.3.0 below; if 1.3.0 is not published on its own, both entries ship in 1.4.0.

### Added

- **Program Status Protocol (OSC 7501)** (upstream #1841). `View.programStatus` reports whether the program is idle, working (with optional progress), blocked on the user, done, or failed, and why, to terminals that support it. New: the `ProgramStatus` type, the `ProgramState` and `ProgramStatusKind` enums, `RequestProgramStatusSupport` and `ProgramStatusSupportMsg` (decoded from the terminal's `OSC 7501 ; ?` reply; the query is skipped when input is disabled, like every other query), and `ansi.setProgramStatus`, `ansi.clearProgramStatus`, `ansi.clearProgramStatusID`, `ansi.requestProgramStatusSupport` (a port of x/ansi v0.11.9's `programstatus.go`: control characters in the title and message become spaces, text is cut to 192/2048 bytes on a character boundary and base64-encoded, an invalid app or a kind/progress used with the wrong state is left out, an unknown state or invalid id writes nothing). As in Go, the renderer writes a report only when the status changes, clears the old record first when the id changes or the status goes back to null, leaves the status in place on exit, and sends it again after a suspend or `restoreTerminal()`. As in Go, `progress` is sent only when `hasProgress` is true. Upstream's `examples/program-status` is ported as `examples/program-status.ts`.

### Fixed

- **Implausible window sizes are ignored** (upstream #1887, [GHSA-qc58-pfg9-7pph](https://github.com/charmbracelet/bubbletea/security/advisories/GHSA-qc58-pfg9-7pph)). A `WindowSizeMsg` with a negative side, a side over 4096, or more than 1,048,576 cells is dropped before the filter, the renderer and the model see it. Size reports arrive on the input (`CSI 8 ; h ; w t`), so anything that can write to it could claim a 99999×99999 screen; in this port the alt-screen renderer would then write a line clear for every one of those rows on each frame. A size read from a terminal output that is implausible no longer resizes the renderer either.
- **A terminal that reports 0×0 gets a usable size** (upstream #1836). On startup, on SIGWINCH, on `RequestWindowSize` and after `restoreTerminal()`, a non-positive width or height falls back to `COLUMNS`/`LINES` from the program's environment (`WithEnvironment`, otherwise `process.env` as it was when the program was created; parsed like Go's `strconv.Atoi`), then to 80×24, one side at a time. An output that is not a terminal still reports 80×24 (Go reports 0×0 there, a difference this port has always had) and, as in Go, does not read `COLUMNS`/`LINES`.

### Upstream changes and what happened to them

| Upstream | Disposition |
| --- | --- |
| #1841 feat: OSC 7501 (with ultraviolet #207 and x/ansi `programstatus.go`) | Ported (above). Tests: x/ansi `TestSetProgramStatus`, `TestProgramStatusTruncation`, `TestClearProgramStatusID`; bubbletea `TestCursedRenderer_programStatus`, `TestTranslateProgramStatusSupport`; ultraviolet's OSC 7501 decoder cases. ultraviolet's `TerminalScreen` `Reset`/`Restore` behaviour is covered by the renderer test (close leaves the status, a restart sends it again). |
| #1887 fix: ignore implausible terminal resize reports (v2.1.1, GHSA-qc58-pfg9-7pph) | Ported (above). `TestIsPlausibleWindowSize` is ported through the event loop, plus a forged `CSI 8 t` report on the input. |
| #1836 fix(tty): fall back to default dimensions when terminal size is 0x0 | Ported (above). `TestFallbackDimensions` is ported through program runs on a terminal output reporting 0×0. Of `TestProgramNonTTYDimensions`, the parts that hold here are ported (non-terminal output ignores `COLUMNS`/`LINES`; `WithWindowSize` is kept); its 0×0 expectation is not, see above. |
| #1806 fix: prevent signal goroutine deadlock on shutdown | Already equivalent. Go's handler could block forever sending on the message channel once the event loop had stopped; here the handler only queues the message and is removed on shutdown. A regression test delivers SIGINT during shutdown and checks that `run()` returns and no handler is left. |
| #1833 docs: fix command and environment godoc examples | No equivalent: the Go doc comments it fixes (`Batch`, `BackgroundColorMsg`, `WithEnvironment`) have no code examples in this port. |
| `UPGRADE_GUIDE_V2.md`, `examples/go.mod`, `go.mod`/`go.sum` bumps | Docs and Go modules; the `View.programStatus` row is in the README surface map. |
| x/ansi v0.11.7 → v0.11.9: `wcwidth` now sums code points per grapheme cluster (ZWJ emoji, flags, Indic conjuncts measure wider under `WcWidth`) | Not applicable: this port's renderer writes lines as given and measures nothing. (It matters to ports that measure text with `WcWidth`.) |
| x/ansi: kitty graphics `Options.Quite` → `Quiet`; lint-only `nolint` changes; `Convert256` comment | Not applicable (no Kitty graphics in this port) / no behaviour change. |
| go-colorful v1.4.0 → v1.4.1 (`D50ToD65` matrix) | Not applicable: the colour downsampling port uses HSLuv distances, not the wide-gamut conversions. |
| go-runewidth, x/sys, x/sync, xo/terminfo bumps | Not applicable (width tables, Go runtime, terminfo, none of which this port reads). |
| ultraviolet renderer fixes (#128 trailing empty cells, #148 dropped rows and clusters across resizes, #150 clusters wider than 4 columns, width disagreements, repaint on height/size change, hardware-scroll repaint, inline frames resized under the renderer, autowrap at the margin, hyperlinks across wrapped lines, emoji rows on resize) | Not applicable: they fix ultraviolet's cell buffer and damage tracking, which this port does not have; its line renderer repaints the whole frame on every resize. Known limitation that stays: when the terminal reflows an inline (non-alt-screen) frame on narrowing, the renderer still moves up by the frame's logical line count. |
| ultraviolet `styled.go`: carry APC/DCS/SOS/PM sequences in cells, fold combining marks, semicolons in OSC 8 URLs (#170, #172) | Not applicable: the renderer writes view content as given, so these sequences and URLs already reach the terminal unchanged. |
| ultraviolet input loop: a copy per read (#178), reader held for the loop's lifetime (#179) | Already equivalent: Node and Bun hand each `data` event its own buffer, and the reader is removed, not nil-ed, on teardown. |
| ultraviolet decoder `rgbToHSL` parentheses | No behaviour change. |

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
