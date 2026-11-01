# Examples

## Small programs

Single-file programs with no dependencies beyond this repository. The README
recordings are made from them with the tapes in `assets/tapes/`.

```sh
bun examples/shopping-list.ts  # the Bubble Tea basics tutorial
bun examples/counter.ts        # the README Quick Start
bun examples/countdown.ts      # Tick, Sequence and Println
bun examples/keys.ts           # how KeyPressMsg describes each key
bun examples/window-size.ts    # alt screen + WindowSizeMsg
bun examples/program-status.ts # Program Status Protocol (OSC 7501)
```

## Larger programs

Full-screen programs that combine Bubble Tea with the sibling ports. Each one
has a recording in `assets/` made from its tape in `assets/tapes/`.

```sh
bun examples/chat.ts                  # streaming coding-agent chat (Bubbles, Glamour, Lip Gloss)
bun examples/sysmon.ts [--demo]       # htop-style system monitor (Bubbles, Lip Gloss)
bun examples/kanban.ts [--file F]     # kanban board with dialogs and mouse (Bubbles, Lip Gloss)
bun examples/blocks.ts [--autoplay]   # falling-blocks game (Lip Gloss)
bun examples/mission-control.ts       # dashboard (Bubbles, Lip Gloss)
bun examples/station/main.ts [--serve] [--demo]
                                      # ops dashboard shared over SSH (ntcharts, bubblezone,
                                      # wish, freeze, teatest, Lip Gloss)
```

### Dependencies

These programs import this repository's source directly (`../src/index.ts`)
and the sibling packages by name. They are not dependencies of `bubbletea`, so
install them without touching `package.json`:

```sh
bun add --no-save @oakoliver/bubbles@^1.2.2 @oakoliver/lipgloss@^1.1.3 @oakoliver/glamour@^2.0.0
```

They were written against `@oakoliver/bubbles` 1.2.2, `@oakoliver/lipgloss`
1.1.3 and `@oakoliver/glamour` 2.0.0. Bubbles resolves `@oakoliver/bubbletea`
from `node_modules`, a second copy next to `../src`; that works because Bubbles
recognises messages by their tag rather than by class.

To type-check the examples: `bunx tsc -p examples/tsconfig.json`.

## chat.ts

A streaming coding-agent chat with a scripted assistant: no network, no API
key. Prompts about "why is my render slow", "a failing test" or "resizing"
get their own answers; "hello" lists the keys; anything else gets a default
answer. Each answer runs one to three fake tools (spinner, then a check mark,
a duration and a summary) and streams Markdown through Glamour.

The transcript is rendered the way OpenCode's Bubble Tea TUI did it: every
finished part is rendered once and cached under a hash of its id, text, width,
theme and tool-details flag; the part still streaming is never cached; a burst
of tokens becomes one render per 16 ms tick; and the viewport follows the tail
only while you are at the bottom. The header shows the cache hits climbing.
On quit it prints the number of events, renders and cache hits. Walkthrough:
[How OpenCode Renders Messages in Bubble Tea](https://engineering.oakoliver.com/articles/how-opencode-renders-messages-in-bubble-tea).

Keys: `enter` send · `alt+enter`, `shift+enter` or `ctrl+j` new line ·
`tab`/`ctrl+o` show or hide tool output · `pgup`/`pgdn`, `alt+↑`/`alt+↓` and
the mouse wheel scroll · `ctrl+end` jump to the latest · `ctrl+t` theme ·
`esc` or `ctrl+c` quit.

## sysmon.ts

An htop-style monitor. CPU (per-core bars and a history chart), memory, load
average and uptime come from `node:os` and work on macOS, Linux and Windows;
on macOS memory is read from `vm_stat`, because `os.freemem()` counts cached
memory as used. The process table comes from `ps` (macOS and Linux), run as an
async child process every 2 s; without `ps` a note replaces the table.

It is read-only: it has no kill, signal or renice feature. `--demo` shows a
deterministic, invented machine (eight cores, about 47 processes, a seeded
PRNG) and reads nothing from yours; the recording uses it.

Keys: `↑`/`↓` (`k`/`j`, `pgup`/`pgdn`, `g`/`G`) select · `enter` details ·
`/` filter by name (`enter` keeps it, `esc` clears it) · `c` CPU, `m` memory,
`p` PID, `n` name (again to reverse) · `t` tree view · `esc` close or clear ·
`q` quit.

## kanban.ts

A board with three columns and twelve invented cards. The new, edit and delete
dialogs are Lip Gloss layers composited over the dimmed board. The filter
matches titles, tags and initials as you type. Mouse: click a card to select
it, click a column header to focus it, the wheel scrolls the column under the
pointer, and press-and-drag moves a card (a ghost follows the pointer and the
target column lights up).

The board lives in memory. `--file board.json` loads the file if it exists and
saves after every change (written to a temporary file, then renamed); nothing
is written without the flag, and an invalid file is reported, never
overwritten.

Keys: `←`/`→` or `h`/`l` column · `↑`/`↓` or `j`/`k` card · `shift+←/→` or
`<`/`>` move the card to the next column · `shift+↑/↓` reorder · `n` new ·
`e`/`enter` edit · `d` delete (asks first) · `/` filter · `?` help · `q` quit.
In the dialog: `tab` or `↑`/`↓` next field, `←`/`→` choose a tag or assignee,
`enter` saves, `esc` cancels.

## blocks.ts

A falling-blocks game: a 10×20 well, SRS rotation with wall kicks, a 7-bag
randomiser on a seeded PRNG, lock delay, hold, a ghost piece, a three-piece
preview, scoring and levels, and a line-clear animation. One `Tick` drives the
whole game; the model decides how much game time each tick is worth.

`--autoplay` lets a small AI play. For each piece it scores every rotation and
column for the current and the next piece (aggregate height, holes,
bumpiness, completed lines), then moves, rotates and drops one visible step at
a time; in this mode each frame advances a fixed time, so a seed always
replays the same game. `--seed N` fixes the piece order.

Keys: `←`/`→` or `h`/`l` move · `↓` soft drop · `space` hard drop · `↑`/`x`
rotate clockwise · `z` rotate counter-clockwise · `c` hold · `p` pause · `r`
restart · `q` quit.

## mission-control.ts

A full-screen dashboard built from Bubble Tea, Bubbles and Lip Gloss: a ports
table, test runs with streaming progress bars, before/after and lines-changed
bar charts, and an event log. By default it shows an invented dataset (six
fictional packages, their commits and test counts) with a simulated test run.

```sh
bun examples/mission-control.ts                # demo data
bun examples/mission-control.ts --live [ROOT]  # real checkouts of the Charm ports
```

Keys: `↑`/`k` and `↓`/`j` select a row, `q` quits. It needs a terminal at least
120 columns wide.

`--live` reads the lipgloss, glamour, bubbletea, bubbles, huh and glow
checkouts in `ROOT` (default: `$PORTS_ROOT`, then the parent directory of this
repository) and reports any it can't find. For each one it reads the tip of
`$SYNC_BRANCH` (default `sync/upstream-2026-09`), its commits and
`git diff --shortstat` against `main`, and runs `bun test` on `git archive`
exports of both `main` and the branch tip, so the checkouts themselves are
never modified. `main` is installed from its own lockfile; the branch tip uses
the repo's `node_modules`, so install whatever sibling versions that branch
requires there first.

## station/

An ops dashboard for six invented services that several people can share
over SSH. It is the one example that uses five more ports, each doing the part
it was written for:

| Port | What it does here |
| --- | --- |
| [`@oakoliver/ntcharts`](https://github.com/oakoliver/ntcharts) | The selected service's p95 latency against its objective (time series), its requests per second (streaming line, zoomed latency view), a sparkline per service, the error rate of every service per minute (heatmap) and today's deploys (horizontal bar chart). |
| [`@oakoliver/bubblezone`](https://github.com/oakoliver/bubblezone) | Every click: tabs, service rows, `ack`, `zoom`/`back`, the window buttons, heatmap rows (through `pos()`), bars (the bar chart marks its own zone and `barDataFromPoint()` names the bar), the log and the latency chart for the wheel. Each viewer has its own manager. |
| [`@oakoliver/wish`](https://github.com/oakoliver/wish) | `--serve`: one Bubble Tea program per SSH session on one shared World, built with `MiddlewareWithProgramHandler`; a `snapshot` command for sessions without a terminal; a rate limiter and an idle timeout. |
| [`@oakoliver/freeze`](https://github.com/oakoliver/freeze) | `s` (or the `snapshot` button) writes the current frame as `station-HHMMSS.svg`, plus a 4x PNG when `@resvg/resvg-js` is installed. Over SSH, `ssh -p 2323 localhost snapshot > station.svg` (or `snapshot png`, or `snapshot 160x44`) renders the shared state. |
| [`@oakoliver/teatest`](https://github.com/oakoliver/teatest) | [`station.test.ts`](station/station.test.ts): golden files of the overview, the latency view, a mouse flow and a two-viewer flow, at 120×34; clicks are SGR mouse bytes written to the program's input. |

```sh
bun examples/station/main.ts                     # this terminal
bun examples/station/main.ts --serve             # ssh -p 2323 <name>@localhost, from as many terminals as you like
ssh -p 2323 localhost snapshot > station.svg     # an image of the current state, no terminal needed
bun test ./examples/station/station.test.ts      # UPDATE_GOLDEN=1 to rewrite the golden files
```

Flags: `--serve`, `--port N` (2323), `--seed N` (7), `--out DIR` (where `s`
writes; default the current directory), `--demo` (a scripted mouse for
recordings: locally, and over SSH for the users `alice` and `bob`).

Keys: `↑`/`↓` service · `tab` or `1`-`4` view · `esc` overview · `a`
acknowledge the selected service's alert · `w` latency window · `space`
pause for everyone · `s` snapshot · `pgup`/`pgdn` log · `q` quit. Mouse:
click tabs, rows, `ack`, `zoom`, window buttons, heatmap rows and bars; the
wheel scrolls the log and zooms the latency chart.

**The data is invented.** A seeded PRNG drives six made-up services, with a
scripted incident every two minutes of real time (a slow payments database, a bad
search release and its rollback). Nothing is read from this machine or the
network. One step of station time is five seconds, taken every 800 ms; over
SSH the clock only runs while someone is connected.

**Sharing.** Everything people share lives in one `World`: samples, alerts,
deploys, the log, and each viewer's selection and pointer. A pointer is
stored as a zone ID and a cell inside that zone, not as screen coordinates,
so another viewer's pointer lands on the same row or button even when the
two windows have different sizes. User names are cleaned of control
characters before anyone else sees them.

**Security.** The server listens on `127.0.0.1` and lets every SSH client in;
the user name is only a name. Add authentication (`WithAuthorizedKeys`) before
binding it anywhere else. The host key is written to `.ssh/station_ed25519`.

**Snapshots.** An SVG of a 120×34 frame takes about 7 ms. A PNG at freeze's default 4x scale takes about 1.2 s, which would hold up every session if resvg ran on the main thread (medians on an Apple M5 Max with Bun 1.4.4, nothing else running). The SSH command uses freeze 1.1's `renderPNGAsync`: resvg draws on a worker thread, so other sessions keep running, and only the PNG encoding of the finished pixels (about 150 ms) happens on the main thread. The `s` key still draws synchronously in your own terminal, where nobody else is waiting.

**Dependencies.** The station imports Bubble Tea by package name, like an
application, not from `../src`, and has its own `package.json` so that the
name does not resolve to this repository. wish and teatest create the
`Program` with the Bubble Tea they import; a second copy from `../src` would
not recognise their messages (`instanceof` fails across copies) or the
station's `Quit`. Install the ports as shown in the top-level README's
[Running the larger examples](../README.md#running-the-larger-examples).
`bunfig.toml` keeps a plain `bun test` to `tests/`, so the repository's own
suite does not need these packages.

The recording is made with `assets/tapes/station.tape`; a background script,
`assets/tapes/station-bot.ts`, keeps bob's SSH session open while the
server's demo script moves his pointer.
