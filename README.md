# @oakoliver/bubbletea

Elm Architecture TUI framework for TypeScript. A pure TypeScript port of [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea) with zero runtime dependencies. Version 1.2.0 targets API and behavior parity with upstream **Bubble Tea v2.0.10**. See [CHANGELOG.md](CHANGELOG.md) for what each upstream sync ported.

<img alt="A shopping-list program built with @oakoliver/bubbletea: the cursor moves through three items and space toggles their checkboxes" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/shopping-list.gif" width="600">

**Read the article:** [Getting Started with Bubble Tea in TypeScript](https://engineering.oakoliver.com/articles/getting-started-bubbletea-typescript-terminal-apps) · [Porting Bubble Tea from Go to TypeScript](https://engineering.oakoliver.com/articles/porting-go-bubbletea-to-typescript-elm-architecture-tui-framework)

## Larger Examples

Five full-screen programs in [`examples/`](examples/) combine Bubble Tea with our ports of [Bubbles](https://github.com/oakoliver/bubbles), [Lip Gloss](https://github.com/oakoliver/lipgloss) and [Glamour](https://github.com/oakoliver/glamour). To run them, see [Running the larger examples](#running-the-larger-examples).

### chat.ts: a streaming coding-agent chat

<img alt="examples/chat.ts: a prompt is sent, two tool calls run with spinners and finish with a check mark and a duration, and a Markdown answer with a numbered list and a code block streams in. Page up mid-stream switches the header to scrolled and counts the new lines below; tab expands the tool output; page down follows the answer again" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/chat.gif" width="700">

A scripted coding agent (no network, no API key) with tool calls, collapsible tool output, three themes and Markdown answers streamed token by token through Glamour. The transcript is rendered the way OpenCode's Bubble Tea TUI did it: each finished part is rendered once and cached under a hash of its inputs, only the part still streaming is re-rendered, and the view follows new output only while you are at the bottom. Walkthrough: [How OpenCode Renders Messages in Bubble Tea](https://engineering.oakoliver.com/articles/how-opencode-renders-messages-in-bubble-tea).

### sysmon.ts: an htop-style system monitor

<img alt="examples/sysmon.ts in demo mode: per-core CPU bars and a CPU history chart move, a memory gauge and load average sit beside them, and the process table is sorted by memory and CPU, filtered to postgres, opened in a details pane and folded into a tree" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/sysmon.gif" width="760">

Per-core CPU bars, CPU and memory history, load average and uptime from `node:os`, and a process table from `ps` that you can sort, filter, open and fold into a tree. Read-only: it has no kill or signal features. `--demo` shows invented data, as in the recording.

### kanban.ts: a board with dialogs and mouse support

<img alt="examples/kanban.ts: a card moves from To do to In progress with a flash, a New card dialog opens over the dimmed board and adds Write the changelog, the filter narrows the board to docs cards, a card is deleted after a confirmation dialog, and the help overlay opens and closes" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/kanban.gif" width="760">

Three columns of cards, a live filter, new, edit and delete dialogs drawn as Lip Gloss layers over the dimmed board, and the mouse: click to select, wheel to scroll a column, drag a card to another column. `--file board.json` saves the board after every change.

### blocks.ts: a falling-blocks game

<img alt="examples/blocks.ts --autoplay: a small AI moves and rotates pieces step by step in a 10 by 20 well with a ghost piece, a hold box, a three-piece preview and a stats panel, and clears several lines" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/blocks.gif" width="520">

SRS rotation with wall kicks, a 7-bag randomiser, lock delay, hold, a ghost piece, a three-piece preview, levels and a line-clear animation, all driven by one `Tick`. `--autoplay` lets a small heuristic AI play, and `--seed N` repeats a game.

### mission-control.ts: a dashboard

<img alt="examples/mission-control.ts: a ports table, simulated test runs with streaming progress bars, tests-per-port and lines-changed bar charts, and an event log that fills as each run finishes" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/mission-control.gif" width="800">

A ports table, test runs with streaming progress bars, bar charts and an event log, on invented data or, with `--live`, on real checkouts of the Charm ports.

### Running the larger examples

They import this repository's source and the sibling ports by name. The ports are not dependencies of `bubbletea`, so install them without touching `package.json`:

```bash
git clone https://github.com/oakoliver/bubbletea && cd bubbletea
bun install
bun add --no-save @oakoliver/bubbles @oakoliver/lipgloss @oakoliver/glamour
bun examples/chat.ts            # also: sysmon.ts --demo, kanban.ts, blocks.ts --autoplay, mission-control.ts
```

Keys, flags and details for each one are in [`examples/README.md`](examples/README.md).

## Features

- Full Elm Architecture: `init`, `update`, `view` lifecycle
- Keyboard and mouse input parsing (CSI, SS3, SGR, Kitty protocol)
- Alt screen, bracketed paste, focus reporting
- Standard renderer with automatic 60fps flushing
- Commands: `Batch` (concurrent), `Sequence` (ordered), `Tick`, `Every`
- External cancellation via `AbortSignal`
- Raw mode management, SIGINT/SIGTERM/SIGWINCH handling
- Works on Node.js and Bun

## Upstream v2.0.10 Surface Map

The TypeScript API keeps its established camel-case lifecycle (`init`, `update`, `view`, `run`, `send`) while mapping the complete portable v2.0.10 surface (v2.0.9 and v2.0.10 were fix-only releases on top of v2.0.8):

| Upstream Bubble Tea | TypeScript surface |
| --- | --- |
| `Model`, `Msg`, `Cmd`, `NewProgram`, `Program.Run/Send/Quit/Kill/Wait` | `Model`, `Msg`, `Cmd`, `NewProgram`, `Program.run/send/quit/kill/wait` |
| `View`, `NewView`, `View.SetContent`, `Cursor`, `NewCursor`, `ProgressBar`, `NewProgressBar` | `View`, `NewView`, `View.setContent`, `Cursor`, `NewCursor`, `ProgressBar`, `NewProgressBar` |
| View alt-screen, mouse, focus, paste, keyboard-enhancement, title, color, cursor, and progress fields | Corresponding camel-case `View` fields; string-returning legacy models remain supported |
| `Key`, `KeyMsg`, press/release messages, modifiers, special/Kitty key constants | `Key`, `KeyMsg`, `KeyPressMsg`, `KeyReleaseMsg`, `KeyMod`, `KeyCode`, `ExtendedKeyCode` |
| `Mouse`, `MouseMsg`, button and click/release/wheel/motion messages | `Mouse`, `MouseMsg`, `MouseButton`, and the four concrete message classes |
| Focus, paste, window, cursor, mode, color, clipboard, capability, terminal-version, environment, and color-profile reports | Same message names with camel-case fields and methods |
| `Batch`, `Sequence`, `Tick`, `Every`, `Quit`, `Interrupt`, `Suspend`, `ClearScreen`, `Raw`, `Println`, `Printf` | Same exported command names |
| Window/cursor/color/capability/version/clipboard requests | Same exported request and clipboard command names |
| `Exec`, `ExecProcess`, `ExecCommand`, `ExecCallback` | Same concepts; `ExecProcess(command, args, callback)` creates a Node/Bun child process after terminal release |
| `WithContext`, environment/output/input/filter/FPS/profile/window options, signal/panic/renderer options | Same option names; `WithContext` and `WithAbortSignal` accept `AbortSignal` |
| `OpenTTY`, terminal release/restore, program printing | `OpenTTY`, `Program.releaseTerminal/restoreTerminal/println/printf` |

The only omitted exported upstream APIs are `LogOptionsSetter`, `LogToFile`, and `LogToFileWith`. They configure Go's process-wide `log.Default()` object and return an `*os.File`; Node and Bun have no equivalent process-wide logger contract to mutate. Use a Node/Bun logger with an append-mode file stream instead. Terminal suspension remains unavailable on Windows, matching upstream's own `suspendSupported` platform gate.

## Install

```bash
npm install @oakoliver/bubbletea
```

## Quick Start

<img alt="examples/counter.ts running inline below the shell command: the count goes up and down with the arrow keys, then q quits and the shell prompt returns on its own line" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/counter.gif" width="480">

```typescript
import {
  type Msg,
  type Cmd,
  type Model,
  Program,
  QuitMsg,
  KeyPressMsg,
  Quit,
} from '@oakoliver/bubbletea';

class Counter implements Model {
  constructor(public count: number = 0) {}

  init(): Cmd {
    return null;
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();
      if (key === 'q' || key === 'ctrl+c') return [this, Quit];
      if (key === 'up') return [new Counter(this.count + 1), null];
      if (key === 'down') return [new Counter(this.count - 1), null];
    }
    return [this, null];
  }

  view(): string {
    return `Count: ${this.count}\n\nPress up/down to change, q to quit.`;
  }
}

const p = new Program(new Counter());
await p.run();
```

### Examples

Runnable programs live in [`examples/`](examples/):

```bash
bun examples/shopping-list.ts  # the Bubble Tea basics tutorial
bun examples/counter.ts        # the Quick Start above
bun examples/countdown.ts      # Tick, Sequence and Println
bun examples/keys.ts           # how KeyPressMsg describes each key
bun examples/window-size.ts    # alt screen + WindowSizeMsg
```

The full-screen programs are listed under [Larger Examples](#larger-examples).

The README recordings are made with [@oakoliver/vhs](https://github.com/oakoliver/vhs) from the tapes in [`assets/tapes/`](assets/tapes/).

## The Elm Architecture

Every Bubbletea program revolves around three methods on a `Model`:

1. **`init()`** — Returns an optional command to run at startup.
2. **`update(msg)`** — Receives a message, returns the new model and an optional command.
3. **`view()`** — Returns the current UI as a string or a declarative `View`.

Messages (`Msg`) flow through the event loop. Commands (`Cmd`) are functions that produce messages asynchronously.

## Commands

<img alt="examples/countdown.ts: a progress bar counts down from 5 while Println prints a line above the program on every Tick, ending with Liftoff" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/countdown.gif" width="480">

Commands are functions that return a `Msg` (or a `Promise<Msg>`). Bubbletea executes them asynchronously outside the event loop.

```typescript
import { Batch, Sequence, Tick, Quit } from '@oakoliver/bubbletea';

// Run multiple commands concurrently
const cmd = Batch(cmdA, cmdB, cmdC);

// Run commands sequentially (each waits for the previous)
const cmd = Sequence(cmdA, cmdB, Quit);

// Fire a message after a delay
const cmd = Tick(1000, () => new TickMsg());
```

## Program Options

Configure the program with functional options:

```typescript
import {
  Program,
  WithInput,
  WithOutput,
  WithFilter,
  WithFPS,
  WithAltScreen,
  WithAbortSignal,
  WithMouseMode,
  WithWindowSize,
  WithoutRenderer,
  WithoutSignalHandler,
  WithoutCatchPanics,
  MouseMode,
} from '@oakoliver/bubbletea';

const p = new Program(
  model,
  WithAltScreen(),                   // Start in alt screen mode
  WithMouseMode(MouseMode.AllMotion), // Enable mouse tracking
  WithFPS(30),                        // Custom frame rate
  WithAbortSignal(controller.signal), // External cancellation
  WithFilter((model, msg) => msg),    // Event filter
);
```

With input disabled (`WithInput(null)`), no terminal query is ever sent, since the reply could not be read and would otherwise leak into the shell after exit: `RequestBackgroundColor`, `RequestForegroundColor`, `RequestCursorColor`, `RequestCursorPosition`, `ReadClipboard`, `ReadPrimaryClipboard`, `RequestCapability`, `RequestTerminalVersion`, `RequestWindowSize` (when the output stream has no dimensions), the startup mode probe, and the Kitty keyboard enhancement protocol are all skipped.

## Key Input

`KeyPressMsg` carries the parsed key event:

```typescript
if (msg instanceof KeyPressMsg) {
  msg.text;       // Printable character (e.g. 'a')
  msg.code;       // KeyCode enum value
  msg.mod;        // Bitmask: KeyMod.Ctrl | KeyMod.Alt | KeyMod.Shift
  msg.toString(); // Human-readable: 'ctrl+a', 'enter', 'f1'
}
```

<img alt="examples/keys.ts printing msg.toString(), text and modifiers for a, Z, enter, tab, shift+tab, ctrl+a and left" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/keys.gif" width="600">

Special keys are in the `KeyCode` enum: `Enter`, `Tab`, `Escape`, `Backspace`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PgUp`, `PgDown`, `Insert`, `Delete`, `F1`-`F12`.

## Mouse Input

When mouse mode is enabled, you receive `MouseClickMsg`, `MouseReleaseMsg`, `MouseWheelMsg`, and `MouseMotionMsg`:

```typescript
if (msg instanceof MouseClickMsg) {
  msg.x;      // Column
  msg.y;      // Row
  msg.button; // MouseButton enum
}
```

## Window Size

`WindowSizeMsg` is sent on startup and whenever the terminal resizes:

<img alt="examples/window-size.ts drawing a full-screen frame in the alternate screen, showing the WindowSizeMsg dimensions and a ticking clock" src="https://raw.githubusercontent.com/oakoliver/bubbletea/main/assets/window-size.gif" width="600">

```typescript
if (msg instanceof WindowSizeMsg) {
  msg.width;
  msg.height;
}
```

## External Control

```typescript
const p = new Program(model);

// Send messages from outside
p.send(new CustomMsg());

// Graceful quit
p.quit();

// Immediate kill (throws ErrProgramKilled)
p.kill();

// Wait for the program to finish
await p.wait();
```

## AbortSignal Integration

```typescript
const ac = new AbortController();
const p = new Program(model, WithAbortSignal(ac.signal));

const runPromise = p.run().catch(console.error);

// Cancel from outside
ac.abort(); // Program exits with ErrProgramKilled
```

## API

### Program

- `new Program(model: Model, ...opts: ProgramOption[])` — Create a program.
- `program.run(): Promise<Model>` — Run the event loop. Returns the final model.
- `program.send(msg: Msg): void` — Send a message to the event loop.
- `program.quit(): void` — Send a `QuitMsg`.
- `program.kill(): void` — Immediately kill the program.
- `program.wait(): Promise<void>` — Wait until the program finishes.
- `program.releaseTerminal()` / `program.restoreTerminal()` — Temporarily hand terminal ownership to an interactive process.
- `program.println(...)` / `program.printf(...)` — Print unmanaged lines above an inline view.

### Command Helpers

- `Quit: Cmd` — Command that sends a `QuitMsg`.
- `Batch(...cmds): Cmd` — Run commands concurrently.
- `Sequence(...cmds): Cmd` — Run commands in order.
- `Tick(durationMs, fn): Cmd` — Fire after a delay.
- `Every(intervalMs, fn): Cmd` — Fire once at the next wall-clock interval boundary; schedule it again from `update` for repetition.

### Message Types

- `QuitMsg` — Graceful exit
- `KeyPressMsg` / `KeyReleaseMsg` — Keyboard events
- `MouseClickMsg` / `MouseReleaseMsg` / `MouseWheelMsg` / `MouseMotionMsg` — Mouse events
- `WindowSizeMsg` — Terminal resize
- `FocusMsg` / `BlurMsg` — Terminal focus
- `InterruptMsg` — Ctrl+C / SIGINT
- `SuspendMsg` / `ResumeMsg` — Process suspend/resume
- `ClearScreenMsg` / `PrintLineMsg` — Renderer control
- `EnvMsg` / `ColorProfileMsg` — Startup environment and detected/forced color profile
- `KeyboardEnhancementsMsg` / `ModeReportMsg` — Terminal protocol capability reports
- `ClipboardMsg` / color messages / `CapabilityMsg` / `TerminalVersionMsg` — Query responses

### Errors

- `ErrProgramKilled` — Program was killed via `kill()` or `AbortSignal`
- `ErrProgramPanic` — Unhandled exception in `update()` or a command
- `ErrInterrupted` — SIGINT / Ctrl+C

## Attribution

This is a TypeScript port of [bubbletea](https://github.com/charmbracelet/bubbletea) by [Charmbracelet, Inc.](https://charm.sh), licensed under MIT.

## License

MIT
