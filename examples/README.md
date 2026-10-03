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

## mission-control.ts

A full-screen dashboard built from Bubble Tea, Bubbles and Lip Gloss: a ports
table, test runs with streaming progress bars, before/after and lines-changed
bar charts, and an event log. By default it shows an invented dataset (six
fictional packages, their commits and test counts) with a simulated test run,
so it needs nothing but this repository.

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

### Dependencies

The example imports this repository's source directly (`../src/index.ts`) and
the sibling packages by name. They are not dependencies of `bubbletea`, so
install them without touching `package.json`:

```sh
bun add --no-save @oakoliver/bubbles@^1.2.2 @oakoliver/lipgloss@^1.1.2
```

It was written against `@oakoliver/bubbles` 1.2.2 and `@oakoliver/lipgloss`
1.1.2. Until those versions are published to npm, run it against local builds
instead: run `bun run build` in your bubbles, lipgloss and bubbletea checkouts
and copy each one's `package.json` and `dist/` into
`node_modules/@oakoliver/<name>/` here (bubbles resolves `@oakoliver/bubbletea`
from there too).

To type-check the examples: `bunx tsc -p examples/tsconfig.json`.
