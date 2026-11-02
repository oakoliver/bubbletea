# canary

Watch an invented release go from build to production, approve it at the gate,
and let the terminal know what the program is doing.

<img alt="The canary running under host.ts: a pipeline goes through build, test and image, then a 5% and a 25% canary with live error-rate charts. A snapshot is drawn while the pipeline keeps moving. At the approval gate the status line under the program turns yellow (blocked, permission) and a pre-filled approval form opens; after it is submitted, production runs and the status line turns green (done)" src="../../assets/canary.gif" width="800">

It combines what landed in the 2026-11-02 releases of the TypeScript Charm ports:

| Port | What it does here |
| --- | --- |
| `@oakoliver/bubbletea` 1.4 | `view.programStatus` reports the release to the terminal with OSC 7501: working with its progress, blocked on your approval (`kind: permission`), done, or an error after a rollback. Frames are written in the terminal's colour profile, down to `NoTTY`. |
| `@oakoliver/huh` 1.1.3 | The approval form. Its ticket and notes are bound to values that are already filled in; since 1.1.3 they show before you reach those fields. |
| `@oakoliver/ntcharts` 1.1 | The stage-time bars and the metric chart get fixed zone IDs (`WithZoneID`), so the click handler and the tests name them. One sparkline is reused for every stage with `clear()` + `resetMax()`. |
| `@oakoliver/freeze` 1.1 | `s` draws a 4x PNG with `renderPNGAsync`. The pipeline keeps moving while it is drawn, and the footer says how long the event loop was held up. |
| `@oakoliver/teatest` 1.1 | [`canary.test.ts`](canary.test.ts): 11 tests that check the screen right after `settle()`. |

`host.ts` runs a program in a pseudo-terminal and shows its OSC 7501 reports in
a status line under it, the way a terminal that supports the protocol shows
them in a tab. It answers the support query, decodes the reports and draws the
root record on a row the program never sees. It works with any program:
`bun host.ts --cmd bun ../program-status.ts`.

**The release is invented.** A seeded PRNG makes every number. Nothing is built
or deployed, and nothing is read from this machine or the network.

```sh
bun examples/canary/main.ts                    # in this terminal (100×30 or more)
bun examples/canary/host.ts                    # under the host, with the status line (Bun only)
bun examples/canary/host.ts --faulty           # the 25% canary fails and is rolled back
bun examples/canary/host.ts --log reports.jsonl  # also writes every report, decoded
bun test ./examples/canary/canary.test.ts      # UPDATE_GOLDEN=1 to rewrite the golden file
bun examples/canary/bench-snapshot.ts          # renderPNG against renderPNGAsync, 7 runs each
```

Flags of `main.ts` (`host.ts` passes on the ones it doesn't know): `--seed N` (7),
`--faulty`, `--speed MS` (250: one step of five pipeline seconds every MS),
`--start N` (begin N steps in), `--out DIR` (where `s` writes; default the
current directory), `--sync-snapshots` (draw with the blocking `renderPNG`, to
compare), `--user NAME` (who approves; default `$USER`).

Keys: `↑`/`↓` stage · `esc` follow the running stage · `m` error rate or p95 ·
`space` pause · `s` snapshot · `q` quit. At the gate: `←`/`→` promote or roll
back, `tab` to the ticket and the notes, `enter` to go on and submit. Mouse:
click a stage, a bar, or the chart.

**Runtimes.** `main.ts` and the tests run on Bun 1.4.4; `main.ts` also runs on
Node.js 26.8.1 (`node examples/canary/main.ts`). `host.ts` needs Bun, for the
`terminal` option of `Bun.spawn`.

**Dependencies.** Install the ports without touching `package.json`:

```sh
bun add --no-save @oakoliver/bubbles @oakoliver/bubblezone @oakoliver/lipgloss@^1.1.4 @oakoliver/huh@^1.1.3 \
  @oakoliver/freeze@^1.1.0 @oakoliver/ntcharts@^1.1.0 @oakoliver/teatest@^1.1.0
```

On 2026-11-02, freeze 1.1.0, ntcharts 1.1.0 and teatest 1.1.0 were tagged but
not yet on npm. Until they are, pack them from their repositories and install
the tarballs:

```sh
git clone -b v1.1.0 https://github.com/oakoliver/freeze && (cd freeze && bun install && bun run build && npm pack)
git clone -b v1.1.0 https://github.com/oakoliver/ntcharts && (cd ntcharts && bun install && bun run build && npm pack)
git clone -b v1.1.0 https://github.com/oakoliver/teatest && (cd teatest && bun install && bun run build && npm pack)
bun add --no-save ./freeze/oakoliver-freeze-1.1.0.tgz ./ntcharts/oakoliver-ntcharts-1.1.0.tgz ./teatest/oakoliver-teatest-1.1.0.tgz
```

Do not run the tests with teatest 1.0.0: Bubble Tea 1.3 and later give an output
that is not a terminal no colours, and teatest 1.0.0's output does not say it is
one, so the golden file loses every colour; its `settle()` also returns before
the frame is written.
