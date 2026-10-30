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
