/**
 * Tests for @oakoliver/bubbletea — ports Go bubbletea's tea_test.go
 *
 * Uses bun:test. Full parity with the Go original:
 * - TestTeaModel
 * - TestTeaQuit
 * - TestTeaWaitQuit
 * - TestTeaWaitKill
 * - TestTeaWithFilter (x3)
 * - TestTeaKill
 * - TestTeaContext (AbortController)
 * - TestTeaContextImplodeDeadlock
 * - TestTeaContextBatchDeadlock
 * - TestTeaBatchMsg
 * - TestTeaSequenceMsg
 * - TestTeaSequenceMsgWithBatchMsg
 * - TestTeaNestedSequenceMsg
 * - TestTeaSend
 * - TestTeaNoRun
 * - TestTeaPanic
 * - TestTeaGoroutinePanic
 */

import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  type Msg,
  type Cmd,
  type Model,
  Program,
  QuitMsg,
  KeyPressMsg,
  KeyCode,
  KeyMod,
  BatchMsg,
  SequenceMsg,
  WindowSizeMsg,
  ErrProgramKilled,
  ErrProgramPanic,
  ErrInterrupted,
  ProgramError,
  WithInput,
  WithOutput,
  WithFilter,
  WithAbortSignal,
  WithoutRenderer,
  WithoutSignalHandler,
  WithoutCatchPanics,
  WithWindowSize,
  Quit,
  Batch,
  Sequence,
} from '../src/index.js';
import {
  type ExecCommand,
  ansi,
  ExtendedKeyCode,
  KeyExtended,
  BackgroundColorMsg,
  CapabilityMsg,
  ClipboardMsg,
  ClipboardSetRequestMsg,
  ColorProfile,
  ColorProfileMsg,
  Cursor,
  CursorShape,
  EnvMsg,
  Exec,
  InputDecoder,
  KeyReleaseMsg,
  KeyboardEnhancementsMsg,
  ModeReportMsg,
  ModeSetting,
  MouseButton,
  PasteMsg,
  MouseMotionMsg,
  MouseMode,
  NewCursor,
  NewProgressBar,
  NewView,
  ProgressBarState,
  Raw,
  Printf,
  RawMsg,
  parseInput,
  StandardRenderer,
  RequestWindowSize,
  SetClipboard,
  TerminalVersionMsg,
  View,
  WithColorProfile,
  WithEnvironment,
  formatProgressBarState,
  ClearScreen,
  RequestBackgroundColor,
  RequestForegroundColor,
  RequestCursorColor,
  RequestCursorPosition,
  ReadClipboard,
  ReadPrimaryClipboard,
  RequestCapability,
  RequestTerminalVersion,
} from '../src/index.js';

// ─── Helper: wait until condition ───────────────────────────────────────────

function waitFor(
  fn: () => boolean,
  timeoutMs = 3000,
  intervalMs = 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/** Create a null output stream */
function nullOutput(): PassThrough {
  const pt = new PassThrough();
  pt.resume(); // drain
  return pt;
}

/** Create a null input stream (never sends anything) */
function nullInput(): PassThrough {
  return new PassThrough();
}

/**
 * Create an input stream that sends data and then stays open.
 * The stream stays open so the program doesn't exit from EOF.
 */
function inputWithData(data: string): PassThrough {
  const pt = new PassThrough();
  pt.write(data);
  return pt;
}

// ─── Test message types ─────────────────────────────────────────────────────

class IncrementMsg {
  readonly _tag = 'IncrementMsg' as const;
}

class PanicMsg {
  readonly _tag = 'PanicMsg' as const;
}

class CtxImplodeMsg {
  readonly _tag = 'CtxImplodeMsg' as const;
  constructor(public readonly abort: () => void) {}
}

function panicCmd(): Msg {
  throw new Error('testing goroutine panic behavior');
}

// ─── Test model ─────────────────────────────────────────────────────────────

class TestModel implements Model {
  executed = false;
  counter = 0;

  init(): Cmd {
    return null;
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof CtxImplodeMsg) {
      msg.abort();
      // Sleep equivalent — block briefly (in Go this is 100ms sleep)
      return [this, null];
    }

    if (msg instanceof IncrementMsg) {
      this.counter++;
      return [this, null];
    }

    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();
      if (key === 'q' || key === 'ctrl+c') {
        return [this, Quit];
      }
    }

    if (msg instanceof PanicMsg) {
      throw new Error('testing panic behavior');
    }

    return [this, null];
  }

  view(): string {
    this.executed = true;
    return 'success';
  }
}

// ─── Standard program options for testing ───────────────────────────────────

function testOpts(
  input?: PassThrough,
  output?: PassThrough,
): Array<(p: Program) => void> {
  return [
    WithInput(input ?? nullInput()),
    WithOutput(output ?? nullOutput()),
    WithoutSignalHandler(),
    WithoutRenderer(),
    WithWindowSize(80, 24),
  ];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Program', () => {
  test('TestTeaModel — basic model run with input "q"', async () => {
    const output = new PassThrough();
    let outputData = '';
    output.on('data', (chunk: Buffer) => {
      outputData += chunk.toString();
    });

    const input = inputWithData('q');
    const m = new TestModel();
    const p = new Program(m, ...testOpts(input, output));

    await p.run();

    // Model's view should have been called
    expect(m.executed).toBe(true);
  });

  test('TestTeaQuit — programmatic quit', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    // Quit after model executes
    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.quit();
      }
    }, 1);

    await p.run();
    clearInterval(poll);
  });

  test('TestTeaWaitQuit — multiple waiters on quit', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    // Start run in background
    const runPromise = p.run();

    // Wait for model to execute
    await waitFor(() => m.executed);

    // Set up 5 waiters
    const waitPromises = Array.from({ length: 5 }, () => p.wait());

    // Quit after a short delay
    setTimeout(() => p.quit(), 50);

    // All waiters should resolve
    await Promise.all(waitPromises);
    await runPromise;
  });

  test('TestTeaWaitKill — multiple waiters on kill', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    const runPromise = p.run().catch((e) => e);

    await waitFor(() => m.executed);

    const waitPromises = Array.from({ length: 5 }, () => p.wait());

    setTimeout(() => p.kill(), 50);

    await Promise.all(waitPromises);
    const result = await runPromise;

    // Kill should produce ErrProgramKilled
    expect(result).toBe(ErrProgramKilled);
  });

  test('TestTeaWithFilter — preventCount=0', async () => {
    await testTeaWithFilter(0);
  });

  test('TestTeaWithFilter — preventCount=1', async () => {
    await testTeaWithFilter(1);
  });

  test('TestTeaWithFilter — preventCount=2', async () => {
    await testTeaWithFilter(2);
  });

  test('TestTeaKill — kill returns ErrProgramKilled', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.kill();
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    expect(err).toBe(ErrProgramKilled);
  });

  test('TestTeaContext — abort controller kills program', async () => {
    const ac = new AbortController();
    const m = new TestModel();
    const p = new Program(
      m,
      ...testOpts(),
      WithAbortSignal(ac.signal),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        ac.abort();
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    expect(err).toBe(ErrProgramKilled);
  });

  test('TestTeaContextImplodeDeadlock — abort from within update', async () => {
    const ac = new AbortController();
    const m = new TestModel();
    const p = new Program(
      m,
      ...testOpts(),
      WithAbortSignal(ac.signal),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.send(new CtxImplodeMsg(() => ac.abort()));
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    expect(err).toBe(ErrProgramKilled);
  });

  test('TestTeaContextBatchDeadlock — batch of cmds that abort', async () => {
    const ac = new AbortController();

    const inc = (): Msg => {
      ac.abort();
      return new IncrementMsg();
    };

    const m = new TestModel();
    const p = new Program(
      m,
      ...testOpts(),
      WithAbortSignal(ac.signal),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        const cmds: Cmd[] = Array.from({ length: 100 }, () => inc);
        p.send(new BatchMsg(cmds));
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    expect(err).toBe(ErrProgramKilled);
  });

  test('TestTeaBatchMsg — batch runs all commands', async () => {
    const inc = (): Msg => new IncrementMsg();

    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    // Send a BatchMsg, then quit once counter reaches 2
    setTimeout(() => {
      p.send(new BatchMsg([inc, inc]));
    }, 10);

    const poll = setInterval(() => {
      if (m.counter >= 2) {
        clearInterval(poll);
        p.quit();
      }
    }, 1);

    await p.run();
    clearInterval(poll);

    expect(m.counter).toBe(2);
  });

  test('TestTeaSequenceMsg — sequence runs in order', async () => {
    const inc = (): Msg => new IncrementMsg();

    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    setTimeout(() => {
      p.send(new SequenceMsg([inc, inc, Quit]));
    }, 10);

    await p.run();

    expect(m.counter).toBe(2);
  });

  test('TestTeaSequenceMsgWithBatchMsg — sequence containing batch', async () => {
    const inc = (): Msg => new IncrementMsg();
    const batch = (): Msg => new BatchMsg([inc, inc]);

    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    setTimeout(() => {
      p.send(new SequenceMsg([batch, inc, Quit]));
    }, 10);

    await p.run();

    expect(m.counter).toBe(3);
  });

  test('TestTeaNestedSequenceMsg — nested sequence and batch', async () => {
    const inc = (): Msg => new IncrementMsg();

    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    // Go: sequenceMsg{inc, Sequence(inc, inc, Batch(inc, inc)), Quit}
    // Our Sequence() and Batch() return Cmd (functions), so when executed
    // they return SequenceMsg/BatchMsg respectively.
    const innerSeq = Sequence(inc, inc, Batch(inc, inc));

    setTimeout(() => {
      p.send(new SequenceMsg([inc, innerSeq!, Quit]));
    }, 10);

    await p.run();

    expect(m.counter).toBe(5);
  });

  test('TestTeaSend — send before and after run', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    // Send QuitMsg slightly after start
    setTimeout(() => p.send(new QuitMsg()), 10);

    await p.run();

    // Sending after quit is a no-op (should not throw)
    p.send(new QuitMsg());
  });

  test('TestTeaNoRun — creating a program without running', () => {
    const m = new TestModel();
    const _p = new Program(m, ...testOpts());
    // Should not throw or do anything
  });

  test('TestTeaPanic — panic in model.update', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.send(new PanicMsg());
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    // In Go, the error wraps both ErrProgramPanic and ErrProgramKilled.
    // Our implementation sets ErrProgramPanic but the error that propagates
    // should indicate panic.
    expect(err).toBe(ErrProgramPanic);
  });

  test('TestTeaGoroutinePanic — panic in command goroutines', async () => {
    const m = new TestModel();
    const p = new Program(m, ...testOpts());

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        const cmds: Cmd[] = [];
        for (let i = 0; i < 10; i += 2) {
          cmds.push(Sequence(panicCmd)!);
          cmds.push(Batch(panicCmd)!);
        }
        p.send(new BatchMsg(cmds));
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    expect(err).toBe(ErrProgramPanic);
  });
});

// ─── Additional tests for TS-specific features ─────────────────────────────

describe('Input parser', () => {
  const { parseInput } = require('../src/input.js');

  test('parses simple ASCII characters', () => {
    const msgs = parseInput(Buffer.from('abc'));
    expect(msgs.length).toBe(3);
    expect(msgs[0]).toBeInstanceOf(KeyPressMsg);
    expect(msgs[0].text).toBe('a');
    expect(msgs[1].text).toBe('b');
    expect(msgs[2].text).toBe('c');
  });

  test('parses Ctrl+C as ctrl+c', () => {
    const msgs = parseInput(Buffer.from([0x03])); // Ctrl+C
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toBeInstanceOf(KeyPressMsg);
    expect(msgs[0].mod & KeyMod.Ctrl).toBeTruthy();
    expect(msgs[0].code).toBe(0x63); // 'c'
  });

  test('parses Enter key', () => {
    const msgs = parseInput(Buffer.from([0x0d]));
    expect(msgs.length).toBe(1);
    expect(msgs[0].code).toBe(KeyCode.Enter);
  });

  test('parses Escape key', () => {
    const msgs = parseInput(Buffer.from([0x1b]));
    expect(msgs.length).toBe(1);
    expect(msgs[0].code).toBe(KeyCode.Escape);
  });

  test('parses arrow keys (CSI sequences)', () => {
    // Up: ESC [ A
    const up = parseInput(Buffer.from([0x1b, 0x5b, 0x41]));
    expect(up[0].code).toBe(KeyCode.Up);

    // Down: ESC [ B
    const down = parseInput(Buffer.from([0x1b, 0x5b, 0x42]));
    expect(down[0].code).toBe(KeyCode.Down);

    // Right: ESC [ C
    const right = parseInput(Buffer.from([0x1b, 0x5b, 0x43]));
    expect(right[0].code).toBe(KeyCode.Right);

    // Left: ESC [ D
    const left = parseInput(Buffer.from([0x1b, 0x5b, 0x44]));
    expect(left[0].code).toBe(KeyCode.Left);
  });

  test('parses F1-F4 via SS3 sequences', () => {
    // F1: ESC O P
    const f1 = parseInput(Buffer.from([0x1b, 0x4f, 0x50]));
    expect(f1[0].code).toBe(KeyCode.F1);

    // F2: ESC O Q
    const f2 = parseInput(Buffer.from([0x1b, 0x4f, 0x51]));
    expect(f2[0].code).toBe(KeyCode.F2);

    // F3: ESC O R
    const f3 = parseInput(Buffer.from([0x1b, 0x4f, 0x52]));
    expect(f3[0].code).toBe(KeyCode.F3);

    // F4: ESC O S
    const f4 = parseInput(Buffer.from([0x1b, 0x4f, 0x53]));
    expect(f4[0].code).toBe(KeyCode.F4);
  });

  test('parses F5-F12 via tilde sequences', () => {
    // F5: ESC [ 15 ~
    const f5 = parseInput(Buffer.from('\x1b[15~'));
    expect(f5[0].code).toBe(KeyCode.F5);

    // F6: ESC [ 17 ~
    const f6 = parseInput(Buffer.from('\x1b[17~'));
    expect(f6[0].code).toBe(KeyCode.F6);

    // F12: ESC [ 24 ~
    const f12 = parseInput(Buffer.from('\x1b[24~'));
    expect(f12[0].code).toBe(KeyCode.F12);
  });

  test('parses Home/End/Insert/Delete/PgUp/PgDown', () => {
    expect(parseInput(Buffer.from('\x1b[2~'))[0].code).toBe(KeyCode.Insert);
    expect(parseInput(Buffer.from('\x1b[3~'))[0].code).toBe(KeyCode.Delete);
    expect(parseInput(Buffer.from('\x1b[5~'))[0].code).toBe(KeyCode.PgUp);
    expect(parseInput(Buffer.from('\x1b[6~'))[0].code).toBe(KeyCode.PgDown);
    expect(parseInput(Buffer.from('\x1b[H'))[0].code).toBe(KeyCode.Home);
    expect(parseInput(Buffer.from('\x1b[F'))[0].code).toBe(KeyCode.End);
  });

  test('parses Alt+key', () => {
    // Alt+a = ESC a
    const msgs = parseInput(Buffer.from([0x1b, 0x61]));
    expect(msgs[0].mod & KeyMod.Alt).toBeTruthy();
    expect(msgs[0].text).toBe('a');
  });

  test('parses Shift+Tab', () => {
    // ESC [ Z
    const msgs = parseInput(Buffer.from('\x1b[Z'));
    expect(msgs[0].code).toBe(KeyCode.Tab);
    expect(msgs[0].mod & KeyMod.Shift).toBeTruthy();
  });

  test('parses UTF-8 multi-byte characters', () => {
    const msgs = parseInput(Buffer.from('€')); // 3-byte UTF-8
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('€');
  });

  test('parses backspace (0x7f)', () => {
    const msgs = parseInput(Buffer.from([0x7f]));
    expect(msgs[0].code).toBe(KeyCode.Backspace);
  });
});

describe('Commands', () => {
  test('Printf supports Go-style numeric width, precision, quoting and percent escaping', () => {
    const msg = Printf('%04d %.2f %q %X %%', 7, 1.25, 'tea', 255)!();
    expect(msg.body).toBe('0007 1.25 "tea" FF %');
  });

  test('Batch with no commands returns null', () => {
    const cmd = Batch();
    expect(cmd).toBeNull();
  });

  test('Batch with one command returns the command itself', () => {
    const inner = () => new QuitMsg();
    const cmd = Batch(inner);
    expect(cmd).toBe(inner);
  });

  test('Batch with multiple commands returns BatchMsg', () => {
    const a = () => new IncrementMsg();
    const b = () => new IncrementMsg();
    const cmd = Batch(a, b);
    expect(cmd).not.toBeNull();
    const msg = cmd!();
    expect(msg).toBeInstanceOf(BatchMsg);
  });

  test('Sequence with no commands returns null', () => {
    const cmd = Sequence();
    expect(cmd).toBeNull();
  });

  test('Sequence with one command returns the command itself', () => {
    const inner = () => new QuitMsg();
    const cmd = Sequence(inner);
    expect(cmd).toBe(inner);
  });

  test('Sequence with multiple commands returns SequenceMsg', () => {
    const a = () => new IncrementMsg();
    const b = () => new IncrementMsg();
    const cmd = Sequence(a, b);
    expect(cmd).not.toBeNull();
    const msg = cmd!();
    expect(msg).toBeInstanceOf(SequenceMsg);
  });

  test('Batch filters null commands', () => {
    const a = () => new IncrementMsg();
    const cmd = Batch(null, a, undefined, null);
    expect(cmd).toBe(a);
  });
});

// ─── Go Parity: commands_test.go ────────────────────────────────────────────
// Port of bubbletea/commands_test.go

import { Tick, Every } from '../src/commands.js';
import { NilRenderer } from '../src/renderer.js';

describe('Go Parity: commands_test.go', () => {
  test('Tick and Every schedule only when their Cmd executes', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalNow = Date.now;
    const delays: number[] = [];
    globalThis.setTimeout = ((
      handler: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      delays.push(Number(delay ?? 0));
      queueMicrotask(() => handler(...args));
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout;
    try {
      Date.now = () => 1250;
      const tick = Tick(25, () => 'tick');
      const every = Every(1000, () => 'every');
      await Promise.resolve();
      expect(delays).toEqual([]);

      Date.now = () => 1500;
      await tick!();
      await every!();
      expect(delays).toEqual([25, 500]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      Date.now = originalNow;
    }
  });

  // TestEvery: Verifies Every command returns the expected message after firing
  test('TestEvery — returns expected msg', async () => {
    const expected = 'every ms';
    const cmd = Every(1, (_t: Date) => expected);
    expect(cmd).not.toBeNull();
    const msg = await cmd!();
    expect(msg).toBe(expected);
  });

  // TestTick: Verifies Tick command returns the expected message after firing
  test('TestTick — returns expected msg', async () => {
    const expected = 'tick';
    const cmd = Tick(1, (_t: Date) => expected);
    expect(cmd).not.toBeNull();
    const msg = await cmd!();
    expect(msg).toBe(expected);
  });

  // TestBatch: Tests Batch behavior matching Go's testMultipleCommands[BatchMsg]
  describe('TestBatch', () => {
    test('nil cmd — returns null', () => {
      // In Go: Batch(nil) returns nil
      const b = Batch(null);
      expect(b).toBeNull();
    });

    test('empty cmd — returns null', () => {
      // In Go: Batch() returns nil
      const b = Batch();
      expect(b).toBeNull();
    });

    test('single cmd — returns QuitMsg', () => {
      // In Go: Batch(Quit)() returns QuitMsg
      const b = Batch(Quit);
      expect(b).not.toBeNull();
      const msg = b!();
      expect(msg).toBeInstanceOf(QuitMsg);
    });

    test('mixed nil cmds — filters nils and returns BatchMsg with len 2', () => {
      // In Go: Batch(nil, Quit, nil, Quit, nil, nil)() returns []Cmd with len 2
      const b = Batch(null, Quit, null, Quit, null, null);
      expect(b).not.toBeNull();
      const msg = b!();
      expect(msg).toBeInstanceOf(BatchMsg);
      expect((msg as BatchMsg).cmds.length).toBe(2);
    });
  });

  // TestSequence: Tests Sequence behavior matching Go's testMultipleCommands[sequenceMsg]
  describe('TestSequence', () => {
    test('nil cmd — returns null', () => {
      // In Go: Sequence(nil) returns nil
      const s = Sequence(null);
      expect(s).toBeNull();
    });

    test('empty cmd — returns null', () => {
      // In Go: Sequence() returns nil
      const s = Sequence();
      expect(s).toBeNull();
    });

    test('single cmd — returns QuitMsg', () => {
      // In Go: Sequence(Quit)() returns QuitMsg
      const s = Sequence(Quit);
      expect(s).not.toBeNull();
      const msg = s!();
      expect(msg).toBeInstanceOf(QuitMsg);
    });

    test('mixed nil cmds — filters nils and returns SequenceMsg with len 2', () => {
      // In Go: Sequence(nil, Quit, nil, Quit, nil, nil)() returns []Cmd with len 2
      const s = Sequence(null, Quit, null, Quit, null, null);
      expect(s).not.toBeNull();
      const msg = s!();
      expect(msg).toBeInstanceOf(SequenceMsg);
      expect((msg as SequenceMsg).cmds.length).toBe(2);
    });
  });
});

describe('Types', () => {
  test('KeyPressMsg toString', () => {
    const msg = new KeyPressMsg({ text: 'a', mod: KeyMod.None, code: 0x61 });
    expect(msg.toString()).toBe('a');
  });

  test('KeyPressMsg with Ctrl modifier', () => {
    const msg = new KeyPressMsg({ text: '', mod: KeyMod.Ctrl, code: 0x63 });
    expect(msg.toString()).toBe('ctrl+c');
  });

  test('KeyPressMsg special key', () => {
    const msg = new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Enter });
    expect(msg.toString()).toBe('enter');
  });

  test('QuitMsg tag', () => {
    const msg = new QuitMsg();
    expect(msg._tag).toBe('QuitMsg');
  });

  test('WindowSizeMsg', () => {
    const msg = new WindowSizeMsg(80, 24);
    expect(msg.width).toBe(80);
    expect(msg.height).toBe(24);
  });
});

describe('Renderer', () => {
  const { StandardRenderer, NilRenderer } = require('../src/renderer.js');

  test('NilRenderer does nothing', () => {
    const r = new NilRenderer();
    r.start();
    r.render('hello');
    r.flush(false);
    r.insertAbove('test');
    r.resize(100, 50);
    r.clearScreen();
    r.repaint();
    r.close();
    // Should not throw
  });

  test('StandardRenderer renders to output', () => {
    const output = new PassThrough();
    let data = '';
    output.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });

    const r = new StandardRenderer(output, 80, 24);
    r.start();
    r.render('hello world');
    r.flush(false);
    r.close();

    expect(data.length).toBeGreaterThan(0);
    expect(data).toContain('hello world');
  });

  test('StandardRenderer alt screen', () => {
    const output = new PassThrough();
    let data = '';
    output.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });

    const r = new StandardRenderer(output, 80, 24);
    r.start();
    r.enterAltScreen();
    expect(r.isAltScreen).toBe(true);

    r.render('alt screen content');
    r.flush(false);

    r.exitAltScreen();
    expect(r.isAltScreen).toBe(false);
    r.close();

    // Should contain alt screen enter/exit sequences
    expect(data).toContain('\x1b[?1049h'); // enterAltScreen
    expect(data).toContain('\x1b[?1049l'); // exitAltScreen
  });
});

// ─── Helper: testTeaWithFilter ──────────────────────────────────────────────

async function testTeaWithFilter(preventCount: number): Promise<void> {
  const m = new TestModel();
  let shutdowns = 0;

  const p = new Program(
    m,
    ...testOpts(),
    WithFilter((_model: Model, msg: Msg) => {
      if (!(msg instanceof QuitMsg)) return msg;
      if (shutdowns < preventCount) {
        shutdowns++;
        return null;
      }
      return msg;
    }),
  );

  const poll = setInterval(() => {
    if (shutdowns <= preventCount) {
      p.quit();
    }
  }, 1);

  await p.run();
  clearInterval(poll);

  expect(shutdowns).toBe(preventCount);
}

// ─── Go Parity: options_test.go ─────────────────────────────────────────────
// Port of bubbletea/options_test.go
// Tests verify that program options are correctly applied.
// Since TypeScript fields are private, we test through behavior.

describe('Go Parity: options_test.go — TestOptions', () => {
  // t.Run("output", func...)
  // Verified by testing that custom output receives data
  test('output — custom output stream', async () => {
    const output = new PassThrough();
    let data = '';
    output.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });

    const m = new TestModel();
    const p = new Program(
      m,
      WithInput(nullInput()),
      WithOutput(output),
      WithoutSignalHandler(),
      WithWindowSize(80, 24),
    );

    // Quit after model executes
    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.quit();
      }
    }, 1);

    await p.run();
    clearInterval(poll);

    // Output should have received render data
    expect(data.length).toBeGreaterThan(0);
  });

  // t.Run("renderer", func...)
  // Tests WithoutRenderer — no output should be produced
  test('renderer — WithoutRenderer disables rendering', async () => {
    const output = new PassThrough();
    let data = '';
    output.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });

    const m = new TestModel();
    const p = new Program(
      m,
      WithInput(nullInput()),
      WithOutput(output),
      WithoutRenderer(),
      WithoutSignalHandler(),
      WithWindowSize(80, 24),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.quit();
      }
    }, 1);

    await p.run();
    clearInterval(poll);

    // With renderer disabled, output should be minimal (only terminal setup sequences)
    // The model's view() "success" should NOT appear
    expect(data).not.toContain('success');
  });

  // t.Run("without signals", func...)
  // Note: Go tests WithoutSignals() which sets ignoreSignals.
  // TypeScript has WithoutSignalHandler() which disables SIGINT/SIGTERM handlers.
  // We test that the program doesn't respond to signals when disabled.
  // This is inherently hard to test in unit tests, so we verify the option doesn't throw.
  test('without signals — WithoutSignalHandler option works', async () => {
    const sigintListeners = process.listenerCount('SIGINT');
    const resizeListeners = process.listenerCount('SIGWINCH');
    const m = new TestModel();
    const p = new Program(
      m,
      WithInput(nullInput()),
      WithOutput(nullOutput()),
      WithoutSignalHandler(),
      WithoutRenderer(),
      WithWindowSize(80, 24),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.quit();
      }
    }, 1);

    const running = p.run();
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
    expect(process.listenerCount('SIGWINCH')).toBe(resizeListeners);
    await running;
    clearInterval(poll);
    expect(m.executed).toBe(true);
  });

  // t.Run("filter", func...)
  // Tests WithFilter — already covered by TestTeaWithFilter tests above
  // But let's add explicit verification that filter is invoked
  test('filter — WithFilter is called on messages', async () => {
    const m = new TestModel();
    let filterCalled = false;

    const p = new Program(
      m,
      WithInput(nullInput()),
      WithOutput(nullOutput()),
      WithoutRenderer(),
      WithoutSignalHandler(),
      WithWindowSize(80, 24),
      WithFilter((_model: Model, msg: Msg) => {
        filterCalled = true;
        return msg;
      }),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        p.quit();
      }
    }, 1);

    await p.run();
    clearInterval(poll);

    // Filter should have been called (at least for WindowSizeMsg and QuitMsg)
    expect(filterCalled).toBe(true);
  });

  // t.Run("external context", func...)
  // Tests WithContext (Go) / WithAbortSignal (TypeScript)
  test('external context — WithAbortSignal cancels program', async () => {
    const ac = new AbortController();
    const m = new TestModel();
    const p = new Program(
      m,
      WithInput(nullInput()),
      WithOutput(nullOutput()),
      WithoutRenderer(),
      WithoutSignalHandler(),
      WithWindowSize(80, 24),
      WithAbortSignal(ac.signal),
    );

    const poll = setInterval(() => {
      if (m.executed) {
        clearInterval(poll);
        ac.abort();
      }
    }, 1);

    let err: Error | null = null;
    try {
      await p.run();
    } catch (e) {
      err = e as Error;
    }

    clearInterval(poll);
    expect(err).toBe(ErrProgramKilled);
  });

  // t.Run("input options", func...)
  describe('input options', () => {
    // t.Run("nil input", func...)
    test('nil input — disables input', async () => {
      const m = new TestModel();
      const p = new Program(
        m,
        WithInput(null),
        WithOutput(nullOutput()),
        WithoutRenderer(),
        WithoutSignalHandler(),
        WithWindowSize(80, 24),
      );

      const poll = setInterval(() => {
        if (m.executed) {
          clearInterval(poll);
          p.quit();
        }
      }, 1);

      // Should complete without error even with null input
      await p.run();
      clearInterval(poll);
      expect(m.executed).toBe(true);
    });

    // t.Run("custom input", func...)
    test('custom input — reads from custom stream', async () => {
      const input = inputWithData('q');
      const m = new TestModel();
      const p = new Program(
        m,
        WithInput(input),
        WithOutput(nullOutput()),
        WithoutRenderer(),
        WithoutSignalHandler(),
        WithWindowSize(80, 24),
      );

      // Program should quit when it receives 'q' from input
      await p.run();
      expect(m.executed).toBe(true);
    });
  });

  // t.Run("startup options", func...)
  describe('startup options', () => {
    // t.Run("without catch panics", func...)
    test('without catch panics — panics propagate', async () => {
      const m = new TestModel();
      const p = new Program(
        m,
        WithInput(nullInput()),
        WithOutput(nullOutput()),
        WithoutRenderer(),
        WithoutSignalHandler(),
        WithWindowSize(80, 24),
        WithoutCatchPanics(),
      );

      const poll = setInterval(() => {
        if (m.executed) {
          clearInterval(poll);
          p.send(new PanicMsg());
        }
      }, 1);

      let thrownError: Error | null = null;
      try {
        await p.run();
      } catch (e) {
        thrownError = e as Error;
      }

      clearInterval(poll);
      
      // With catch panics disabled, the error should propagate with the actual message
      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toBe('testing panic behavior');
    });

    // t.Run("without signal handler", func...)
    // Already tested above in "without signals" test
    test('without signal handler — disables signal handling', async () => {
      const m = new TestModel();
      const p = new Program(
        m,
        WithInput(nullInput()),
        WithOutput(nullOutput()),
        WithoutRenderer(),
        WithoutSignalHandler(),
        WithWindowSize(80, 24),
      );

      const poll = setInterval(() => {
        if (m.executed) {
          clearInterval(poll);
          p.quit();
        }
      }, 1);

      await p.run();
      clearInterval(poll);
      expect(m.executed).toBe(true);
    });
  });
});

describe('Bubble Tea v2.0.8 parity surface', () => {
  test('View, Cursor and ProgressBar preserve declarative render state', () => {
    const cursor = NewCursor(3, 4);

    expect(cursor).toBeInstanceOf(Cursor);
    expect(cursor.blink).toBe(true);

    const view = NewView('content');
    view.cursor = cursor;
    view.altScreen = true;
    view.reportFocus = true;
    view.mouseMode = MouseMode.CellMotion;
    view.keyboardEnhancements.reportEventTypes = true;
    view.progressBar = NewProgressBar(ProgressBarState.Default, 120);

    expect(view).toBeInstanceOf(View);
    expect(view.content).toBe('content');
    expect(view.progressBar.value).toBe(100);
    expect(view.clone()).not.toBe(view);
    expect(view.clone().cursor).not.toBe(cursor);
  });

  test('Program println and printf persist unmanaged output', async () => {
    class PrintModel implements Model {
      init(): Cmd {
        return Quit;
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const program = new Program(
      new PrintModel(),
      WithInput(null),
      WithOutput(output),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    );
    program.println('value=', 7);
    program.printf(' hex=%02X', 15);
    await program.run();
    expect(rendered).toContain('value=7');
    expect(rendered).toContain(' hex=0F');
  });

  test('key formatting distinguishes String from Keystroke and release events', () => {
    const shifted = new KeyPressMsg({
      text: '?',
      code: '/'.codePointAt(0)!,
      shiftedCode: '?'.codePointAt(0),
      mod: KeyMod.Shift,
    });
    expect(shifted.toString()).toBe('?');
    expect(shifted.keystroke()).toBe('shift+/');
    expect(shifted.key().shiftedCode).toBe('?'.codePointAt(0));

    const [released] = parseInput(Buffer.from('\x1b[97;5:3u'));
    expect(released).toBeInstanceOf(KeyReleaseMsg);
    expect(released.toString()).toBe('ctrl+a');
  });

  test('mouse motion formatting matches upstream for buttonless movement', () => {
    const motion = new MouseMotionMsg({
      x: 2,
      y: 5,
      button: MouseButton.None,
      mod: KeyMod.Ctrl,
    });
    expect(motion.toString()).toBe('ctrl+motion');
    expect(motion.mouse()).toEqual({ x: 2, y: 5, button: MouseButton.None, mod: KeyMod.Ctrl });
  });

  test('parser preserves C0 and Alt-key distinctions', () => {
    const [lineFeed] = parseInput(Buffer.from([0x0a]));
    expect(lineFeed.toString()).toBe('ctrl+j');

    const [altTab] = parseInput(Buffer.from([0x1b, 0x09]));
    expect(altTab.toString()).toBe('alt+tab');

    const [altUnicode] = parseInput(Buffer.concat([Buffer.from([0x1b]), Buffer.from('€')]));
    expect(altUnicode.toString()).toBe('€');
    expect(altUnicode.keystroke()).toBe('alt+€');
  });

  test('parser emits Kitty enhancements, mode reports and repeat metadata', () => {
    const [enhancements] = parseInput(Buffer.from('\x1b[?3u'));
    expect(enhancements).toBeInstanceOf(KeyboardEnhancementsMsg);
    expect(enhancements.supportsKeyDisambiguation()).toBe(true);
    expect(enhancements.supportsEventTypes()).toBe(true);

    const [mode] = parseInput(Buffer.from('\x1b[?2026;2$y'));
    expect(mode).toBeInstanceOf(ModeReportMsg);
    expect(mode.mode).toBe(2026);
    expect(mode.value).toBe(ModeSetting.Reset);

    const [repeat] = parseInput(Buffer.from('\x1b[97;1:2u'));
    expect(repeat).toBeInstanceOf(KeyPressMsg);
    expect(repeat.isRepeat).toBe(true);
    expect(repeat.text).toBe('a');
  });

  test('parser emits OSC color and clipboard reports', () => {
    const [background] = parseInput(Buffer.from('\x1b]11;rgb:ffff/0000/8080\x1b\\'));
    expect(background).toBeInstanceOf(BackgroundColorMsg);
    expect(background.toString()).toBe('#ff0080');

    const c1 = Buffer.concat([
      Buffer.from([0x9d]),
      Buffer.from('11;rgb:0000/ffff/0000'),
      Buffer.from([0x9c]),
    ]);
    const [c1Background] = parseInput(c1);
    expect(c1Background.toString()).toBe('#00ff00');

    const [clipboard] = parseInput(Buffer.from('\x1b]52;c;aGVsbG8=\x07'));
    expect(clipboard).toBeInstanceOf(ClipboardMsg);
    expect(clipboard.clipboard()).toBe('c');
    expect(clipboard.toString()).toBe('hello');
  });

  test('parser emits DCS capability and terminal version reports', () => {
    const [capability] = parseInput(Buffer.from('\x1bP1+r5463\x1b\\'));
    expect(capability).toBeInstanceOf(CapabilityMsg);
    expect(capability.toString()).toBe('Tc');

    const [version] = parseInput(Buffer.from('\x1bP>|XTerm(390)\x1b\\'));
    expect(version).toBeInstanceOf(TerminalVersionMsg);
    expect(version.toString()).toBe('XTerm(390)');
  });

  test('InputDecoder retains split escape sequences and UTF-8', () => {
    const decoder = new InputDecoder();
    expect(decoder.feed(Buffer.from('\x1b['))).toEqual([]);
    const [up] = decoder.feed(Buffer.from('A'));
    expect(up.code).toBe(KeyCode.Up);

    const euro = Buffer.from('€');
    expect(decoder.feed(euro.subarray(0, 1))).toEqual([]);
    const [decoded] = decoder.feed(euro.subarray(1));
    expect(decoded.text).toBe('€');

    expect(decoder.feed(Buffer.from([0x9b, 0x3f, 0x32]))).toEqual([]);
    const [c1Mode] = decoder.feed(Buffer.from('026;2$y'));
    expect(c1Mode).toBeInstanceOf(ModeReportMsg);
  });

  test('terminal request commands use distinct request messages and preserve raw values', () => {
    expect(RequestWindowSize()).not.toBeInstanceOf(WindowSizeMsg);
    const clipboard = SetClipboard('hello')!();
    expect(clipboard).toBeInstanceOf(ClipboardSetRequestMsg);
    expect(clipboard.content).toBe('hello');

    const value = { custom: true };
    const raw = Raw(value)!() as RawMsg;
    expect(raw).toBeInstanceOf(RawMsg);
    expect(raw.msg).toBe(value);
  });

  test('renderer applies declarative terminal state and view-local mouse handler', () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const renderer = new StandardRenderer(output, 80, 24);
    const mouseCommand = Quit;
    const view = NewView('hello');
    view.altScreen = true;
    view.reportFocus = true;
    view.mouseMode = MouseMode.AllMotion;
    view.windowTitle = 'parity';
    view.cursor = NewCursor(1, 2);
    view.onMouse = () => mouseCommand;

    renderer.start();
    renderer.render(view);
    renderer.flush(false);
    expect(rendered).toContain('\x1b[?1049h');
    expect(rendered).toContain('\x1b[?1004h');
    expect(rendered).toContain('\x1b[?1003h');
    expect(rendered).toContain('\x1b]2;parity\x1b\\');
    rendered = '';
    renderer.setSynchronizedOutput(true);
    view.setContent('updated');
    renderer.render(view);
    renderer.flush(false);
    expect(rendered).toContain('\x1b[?2026h');
    expect(rendered).toContain('\x1b[?2026l');
    expect(renderer.onMouse(new MouseMotionMsg({
      x: 0,
      y: 0,
      button: MouseButton.None,
      mod: KeyMod.None,
    }))).toBe(mouseCommand);
  });

  test('Program publishes environment, color profile and window reports at startup', async () => {
    class ReportsModel implements Model {
      reports: Msg[] = [];
      init(): Cmd {
        return null;
      }
      update(msg: Msg): [Model, Cmd] {
        this.reports.push(msg);
        return [this, msg instanceof EnvMsg ? Quit : null];
      }
      view(): string {
        return '';
      }
    }

    const model = new ReportsModel();
    const program = new Program(
      model,
      WithInput(null),
      WithoutRenderer(),
      WithoutSignalHandler(),
      WithEnvironment(['TERM=xterm-256color', 'EMPTY=']),
      WithColorProfile(ColorProfile.ANSI256),
      WithWindowSize(90, 30),
    );
    await program.run();

    expect(model.reports.some((msg) => msg instanceof ColorProfileMsg)).toBe(true);
    expect(model.reports.some((msg) => msg instanceof WindowSizeMsg)).toBe(true);
    const environment = model.reports.find((msg) => msg instanceof EnvMsg) as EnvMsg;
    expect(environment.getenv('TERM')).toBe('xterm-256color');
    expect(environment.lookupEnv('EMPTY')).toEqual(['', true]);
  });

  test('Program queues pre-run Send and rejects an already-aborted context', async () => {
    const queued = new Program(new TestModel(), ...testOpts());
    queued.send(new QuitMsg());
    await queued.run();

    const controller = new AbortController();
    controller.abort();
    const aborted = new Program(new TestModel(), ...testOpts(), WithAbortSignal(controller.signal));
    await expect(aborted.run()).rejects.toBe(ErrProgramKilled);
  });

  test('Exec releases the terminal, runs the command and delivers callback result', async () => {
    class ExecDone {}
    let ran = false;
    const command: ExecCommand = {
      setStdin() {},
      setStdout() {},
      setStderr() {},
      async run() {
        ran = true;
      },
    };
    class ExecModel implements Model {
      init(): Cmd {
        return Exec(command, (error) => {
          expect(error).toBeNull();
          return new ExecDone();
        });
      }
      update(msg: Msg): [Model, Cmd] {
        return [this, msg instanceof ExecDone ? Quit : null];
      }
      view(): string {
        return '';
      }
    }

    await new Program(new ExecModel(), ...testOpts()).run();
    expect(ran).toBe(true);
  });
  test('XTVERSION and extended key constants match upstream protocol values', () => {
    expect(ansi.requestTerminalVersion).toBe('\x1b[>q');
    expect(ExtendedKeyCode.Begin).toBe(KeyExtended + 5);
    expect(ExtendedKeyCode.Select).toBe(KeyExtended + 9);
    expect(ExtendedKeyCode.KpEnter).toBe(KeyExtended + 14);
    expect(ExtendedKeyCode.F21).toBe(KeyExtended + 64);
  });

  test('InputDecoder timeout flush preserves partial protocols but emits bare Escape', () => {
    const decoder = new InputDecoder();
    expect(decoder.feed(Buffer.from('\x1b['))).toEqual([]);
    expect(decoder.flush()).toEqual([]);
    const [up] = decoder.feed(Buffer.from('A'));
    expect(up.code).toBe(KeyCode.Up);

    expect(decoder.feed(Buffer.from('\x1b'))).toEqual([]);
    const [escape] = decoder.flush();
    expect(escape.code).toBe(KeyCode.Escape);
  });

  test('renderer close resets declarative terminal state', () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const renderer = new StandardRenderer(output, 80, 24);
    const view = NewView('state');
    view.windowTitle = 'temporary';
    view.cursor = NewCursor(4, 2);
    view.cursor.color = '#ffffff';
    view.progressBar = NewProgressBar(ProgressBarState.Default, 50);
    renderer.start();
    renderer.render(view);
    renderer.flush(false);
    renderer.close();
    expect(rendered).toContain('\x1b[0 q');
    expect(rendered).toContain('\x1b]112\x1b\\');
    expect(rendered).toContain('\x1b]9;4;0;0\x1b\\');
    expect(rendered).toContain('\x1b]2;\x1b\\');
    expect(rendered).toContain('\x1b[?25h');
  });

  test('RequestWindowSize queries streams without synchronous dimensions', async () => {
    class SizeRequestModel implements Model {
      init(): Cmd {
        return Sequence(RequestWindowSize, Quit);
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    // The reply arrives on the input, so the query needs input enabled (v2.0.10).
    await new Program(
      new SizeRequestModel(),
      WithInput(nullInput()),
      WithOutput(output),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    ).run();
    expect(rendered).toContain(ansi.requestWindowSize);
  });

  test('command results from an earlier run cannot enter a later run', async () => {
    let resolveOld!: (msg: Msg) => void;
    class RerunModel implements Model {
      runs = 0;
      staleUpdates = 0;
      init(): Cmd {
        this.runs++;
        if (this.runs === 1) {
          return () => new Promise<Msg>((resolve) => {
            resolveOld = resolve;
          });
        }
        return Tick(5, Quit);
      }
      update(msg: Msg): [Model, Cmd] {
        if (msg instanceof IncrementMsg) this.staleUpdates++;
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    const model = new RerunModel();
    const program = new Program(model, ...testOpts());
    program.send(new QuitMsg());
    await program.run();
    const rerun = program.run();
    resolveOld(new IncrementMsg());
    await rerun;
    expect(model.staleUpdates).toBe(0);
  });

  test('Exec guards parent process signal handlers while the child owns the terminal', async () => {
    const baseline = process.listenerCount('SIGINT');
    let duringExec = -1;
    const command: ExecCommand = {
      setStdin() {},
      setStdout() {},
      setStderr() {},
      async run() {
        duringExec = process.listenerCount('SIGINT');
      },
    };
    class SignalExecModel implements Model {
      init(): Cmd {
        return Exec(command, () => new QuitMsg());
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    await new Program(
      new SignalExecModel(),
      WithInput(null),
      WithOutput(new PassThrough()),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
    ).run();
    expect(duringExec).toBe(baseline + 1);
  });

  test('WithoutCatchPanics propagates nested Sequence rejection through run', async () => {
    const failure = new Error('nested command failed');
    class NestedFailureModel implements Model {
      init(): Cmd {
        return Sequence(() => Promise.reject(failure));
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    const program = new Program(
      new NestedFailureModel(),
      ...testOpts(),
      WithoutCatchPanics(),
    );
    await expect(program.run()).rejects.toBe(failure);
  });

  test('malformed Kitty shifted codepoints are ignored without throwing', () => {
    const [key] = parseInput(Buffer.from('\x1b[97:1114112;2u'));
    expect(key).toBeInstanceOf(KeyPressMsg);
    expect(key.shiftedCode).toBeUndefined();
    expect(key.text).toBe('a');
  });

  test('C1 bracketed paste is decoded as one PasteMsg', () => {
    const input = Buffer.concat([
      Buffer.from([0x9b]),
      Buffer.from('200~pasted'),
      Buffer.from([0x9b]),
      Buffer.from('201~'),
    ]);
    const [paste] = parseInput(input);
    expect(paste).toBeInstanceOf(PasteMsg);
    expect(paste.content).toBe('pasted');
  });

  test('view mouse callback panics use Program panic recovery', async () => {
    const view = NewView('mouse');
    view.onMouse = () => {
      throw new Error('mouse callback panic');
    };
    class MousePanicModel implements Model {
      init(): Cmd {
        return Tick(30, () => new MouseMotionMsg({
          x: 1,
          y: 1,
          button: MouseButton.None,
          mod: KeyMod.None,
        }));
      }
      update(msg: Msg): [Model, Cmd] {
        return [this, msg instanceof MouseMotionMsg ? Quit : null];
      }
      view(): View {
        return view;
      }
    }
    const program = new Program(
      new MousePanicModel(),
      WithInput(null),
      WithOutput(new PassThrough()),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    );
    await expect(program.run()).rejects.toBe(ErrProgramPanic);
  });

  test('renderer redraws unchanged content when declarative screen state changes', () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const renderer = new StandardRenderer(output, 80, 24);
    const view = NewView('same');
    renderer.start();
    renderer.render(view);
    renderer.flush(false);
    rendered = '';
    view.altScreen = true;
    renderer.render(view);
    renderer.flush(false);
    expect(rendered).toContain(ansi.enterAltScreen);
    expect(rendered).toContain('same');
  });

  test('renderer mouse handler is available before the first timer flush', () => {
    const renderer = new StandardRenderer(new PassThrough(), 80, 24);
    const view = NewView('mouse');
    view.onMouse = Quit;
    renderer.start();
    renderer.render(view);
    expect(renderer.onMouse(new MouseMotionMsg({
      x: 0,
      y: 0,
      button: MouseButton.None,
      mod: KeyMod.None,
    }))).toBeInstanceOf(QuitMsg);
  });

  test('renderer close resets only declarative state that was emitted', () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const renderer = new StandardRenderer(output, 80, 24);
    renderer.start();
    renderer.render(NewView('plain'));
    renderer.flush(false);
    rendered = '';
    renderer.close();
    expect(rendered).not.toContain(ansi.resetWindowTitle);
    expect(rendered).not.toContain(ansi.resetCursorColor);
    expect(rendered).not.toContain(ansi.resetCursorShape);
    expect(rendered).not.toContain(ansi.resetProgressBar);
    expect(rendered).not.toContain(ansi.resetForegroundColor);
    expect(rendered).not.toContain(ansi.resetBackgroundColor);
  });

  test('Program shutdown emits no alt-screen enter after its final exit', async () => {
    class AltShutdownModel implements Model {
      init(): Cmd {
        return Quit;
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): View {
        const view = NewView('alt');
        view.altScreen = true;
        return view;
      }
    }
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    await new Program(
      new AltShutdownModel(),
      WithInput(null),
      WithOutput(output),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    ).run();
    expect(rendered.lastIndexOf(ansi.exitAltScreen)).toBeGreaterThan(
      rendered.lastIndexOf(ansi.enterAltScreen),
    );
  });

  test('restoreTerminal publishes a changed synchronous terminal size', async () => {
    const output = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
    const sizes: WindowSizeMsg[] = [];
    const command: ExecCommand = {
      setStdin() {},
      setStdout() {},
      setStderr() {},
      async run() {
        output.columns = 100;
        output.rows = 40;
      },
    };
    class ResizeExecModel implements Model {
      init(): Cmd {
        return Exec(command, () => new QuitMsg());
      }
      update(msg: Msg): [Model, Cmd] {
        if (msg instanceof WindowSizeMsg) sizes.push(msg);
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    await new Program(
      new ResizeExecModel(),
      WithInput(null),
      WithOutput(output),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    ).run();
    expect(sizes.some((size) => size.width === 100 && size.height === 40)).toBe(true);
  });
  test('Exec restore repaints the view that preceded terminal release', async () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const command: ExecCommand = {
      setStdin() {},
      setStdout() {},
      setStderr() {},
      async run() {
        output.write('CHILD');
      },
    };
    class RepaintExecModel implements Model {
      init(): Cmd {
        return Exec(command, () => new QuitMsg());
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return 'persistent view';
      }
    }
    await new Program(
      new RepaintExecModel(),
      WithInput(null),
      WithOutput(output),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    ).run();
    expect(rendered.slice(rendered.indexOf('CHILD') + 5)).toContain('persistent view');
  });

  test('renderer reuse after close does not retain alt-screen intent', () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const renderer = new StandardRenderer(output, 80, 24);
    const alt = NewView('alt');
    alt.altScreen = true;
    renderer.start();
    renderer.render(alt);
    renderer.flush(false);
    renderer.close();
    rendered = '';
    renderer.start();
    renderer.render('inline');
    renderer.flush(false);
    expect(rendered).not.toContain(ansi.enterAltScreen);
    expect(rendered).toContain('inline');
  });

  test('kill cancels an in-flight interactive command and unblocks run', async () => {
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let cancelled = false;
    const command: ExecCommand = {
      setStdin() {},
      setStdout() {},
      setStderr() {},
      run() {
        signalStarted();
        return new Promise<void>(() => {});
      },
      cancel() {
        cancelled = true;
      },
    };
    class HungExecModel implements Model {
      init(): Cmd {
        return Exec(command);
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    const program = new Program(new HungExecModel(), ...testOpts());
    const running = program.run();
    await started;
    program.kill();
    await expect(running).rejects.toBe(ErrProgramKilled);
    expect(cancelled).toBe(true);
  });


  test('removing a declarative cursor resets its terminal shape', () => {
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => {
      rendered += chunk.toString();
    });
    const renderer = new StandardRenderer(output, 80, 24);
    const withCursor = NewView('cursor');
    withCursor.cursor = NewCursor(0, 0);
    withCursor.cursor.shape = CursorShape.Bar;
    withCursor.cursor.blink = false;
    renderer.start();
    renderer.render(withCursor);
    renderer.flush(false);
    rendered = '';
    renderer.render(NewView('no cursor'));
    renderer.flush(false);
    expect(rendered).toContain(ansi.resetCursorShape);
  });

  test('Kitty C0 and invalid scalar codepoints match upstream semantics', () => {
    const [ctrlSpace] = parseInput(Buffer.from('\x1b[0;5u'));
    expect(ctrlSpace).toBeInstanceOf(KeyPressMsg);
    expect(ctrlSpace.code).toBe(KeyCode.Space);
    expect(ctrlSpace.mod & KeyMod.Ctrl).toBeTruthy();
    expect(ctrlSpace.toString()).toBe('ctrl+space');

    const [ctrlA] = parseInput(Buffer.from('\x1b[1;5u'));
    expect(ctrlA.code).toBe('a'.codePointAt(0));
    expect(ctrlA.toString()).toBe('ctrl+a');

    const [ctrlBackslash] = parseInput(Buffer.from('\x1b[28;5u'));
    expect(ctrlBackslash.code).toBe('\\'.codePointAt(0));
    expect(ctrlBackslash.toString()).toBe('ctrl+\\');

    for (const invalid of [55296, 0x110000]) {
      const [replacement] = parseInput(Buffer.from(`\x1b[${invalid};1u`));
      expect(replacement.code).toBe(0xfffd);
      expect(replacement.text).toBe('\ufffd');
      expect(replacement.toString()).toBe('\ufffd');
    }
  });
  test('kill during interactive setup prevents a deferred command start', async () => {
    let ran = false;
    let program!: Program;
    const command: ExecCommand = {
      setStdin() {},
      setStdout() {},
      setStderr() {
        program.kill();
      },
      async run() {
        ran = true;
      },
    };
    class ImmediateKillExecModel implements Model {
      init(): Cmd {
        return Exec(command);
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return '';
      }
    }
    program = new Program(new ImmediateKillExecModel(), ...testOpts());
    await expect(program.run()).rejects.toBe(ErrProgramKilled);
    expect(ran).toBe(false);
  });

});

// ─── Bubble Tea v2.0.9 / v2.0.10 parity ─────────────────────────────────────

describe('Bubble Tea v2.0.10 parity', () => {
  function capture(): { stream: PassThrough; data: () => string; reset: () => void } {
    const stream = new PassThrough();
    let data = '';
    stream.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    return { stream, data: () => data, reset: () => (data = '') };
  }

  class QueryModel implements Model {
    init(): Cmd {
      return Sequence(
        RequestBackgroundColor,
        RequestForegroundColor,
        RequestCursorColor,
        RequestCursorPosition,
        ReadClipboard,
        ReadPrimaryClipboard,
        RequestCapability('RGB'),
        RequestTerminalVersion,
        RequestWindowSize,
        Quit,
      );
    }
    update(): [Model, Cmd] {
      return [this, null];
    }
    view(): string {
      return 'queries';
    }
  }

  const queries = [
    ansi.requestBackgroundColor,
    ansi.requestForegroundColor,
    ansi.requestCursorColor,
    ansi.requestCursorPosition,
    ansi.requestClipboard('c'),
    ansi.requestClipboard('p'),
    ansi.requestTermcap('RGB'),
    ansi.requestTerminalVersion,
    ansi.requestWindowSize,
    ansi.requestSyncOutputMode,
    ansi.requestUnicodeCoreMode,
    ansi.requestKittyKeyboard,
  ];

  test('KeyMediaRecord is a distinct key (fix #1757)', () => {
    const [record] = parseInput(Buffer.from('\x1b[57437u'));
    expect(record).toBeInstanceOf(KeyPressMsg);
    expect(ExtendedKeyCode.MediaRecord).toBe(ExtendedKeyCode.MediaPrevious + 1);
    expect(record.code).toBe(ExtendedKeyCode.MediaRecord);
    expect(record.code).not.toBe(ExtendedKeyCode.MediaPrevious);
    expect(record.toString()).toBe('mediarecord');

    const [previous] = parseInput(Buffer.from('\x1b[57436u'));
    expect(previous.toString()).toBe('mediaprev');
  });

  test('every ExtendedKeyCode member is defined at runtime', () => {
    // Auto-incremented members after a `KeyExtended + n` initializer used to
    // be undefined under Bun/esbuild, which broke media, lock and F22+ keys.
    const values = Object.keys(ExtendedKeyCode)
      .filter((name) => Number.isNaN(Number(name)))
      .map((name) => ExtendedKeyCode[name as keyof typeof ExtendedKeyCode]);
    expect(values.length).toBeGreaterThan(100);
    for (const value of values) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThanOrEqual(KeyExtended);
    }
    expect(new Set(values).size).toBe(values.length);
    expect(parseInput(Buffer.from('\x1b[57358u'))[0].toString()).toBe('capslock');
    expect(parseInput(Buffer.from('\x1b[57385u'))[0].toString()).toBe('f22');
  });

  test('MouseButton11 is distinct from MouseButton10 (fix #1754)', () => {
    expect(MouseButton.Button11).not.toBe(MouseButton.Button10);
    // SGR extended buttons: 128 = backward, 129 = forward, 130 = button10, 131 = button11.
    const [b10] = parseInput(Buffer.from('\x1b[<130;5;6M'));
    const [b11] = parseInput(Buffer.from('\x1b[<131;5;6M'));
    expect(b10.button).toBe(MouseButton.Button10);
    expect(b11.button).toBe(MouseButton.Button11);
    expect(b11.toString()).toBe('button11');
  });

  test('ProgressBarState formatting returns Unknown for out-of-range values (fix #1748)', () => {
    expect(formatProgressBarState(ProgressBarState.None)).toBe('None');
    expect(formatProgressBarState(ProgressBarState.Default)).toBe('Default');
    expect(formatProgressBarState(ProgressBarState.Error)).toBe('Error');
    expect(formatProgressBarState(ProgressBarState.Indeterminate)).toBe('Indeterminate');
    expect(formatProgressBarState(ProgressBarState.Warning)).toBe('Warning');
    expect(formatProgressBarState(5 as ProgressBarState)).toBe('Unknown');
    expect(formatProgressBarState(-1 as ProgressBarState)).toBe('Unknown');
    expect(formatProgressBarState(255 as ProgressBarState)).toBe('Unknown');
  });

  test('clearScreen forces a redraw of an unchanged view (pendingErase, fix #1755)', () => {
    const out = capture();
    const r = new StandardRenderer(out.stream, 80, 24);
    r.start();
    r.render(NewView('still here'));
    r.flush(false);
    expect(out.data()).toContain('still here');

    out.reset();
    r.flush(false); // Nothing changed, nothing to do.
    expect(out.data()).toBe('');

    r.clearScreen();
    r.flush(false); // No new render() call, but the erase must be repainted.
    expect(out.data().startsWith(ansi.clearScreen)).toBe(true);
    expect(out.data().indexOf('still here')).toBeGreaterThan(out.data().indexOf(ansi.clearScreen));
  });

  test('resize forces a redraw of an unchanged view (pendingErase, fix #1755)', () => {
    const out = capture();
    const r = new StandardRenderer(out.stream, 80, 24);
    r.start();
    r.render(NewView('sized'));
    r.flush(false);
    out.reset();
    r.resize(100, 30);
    r.flush(false);
    expect(out.data()).toContain('sized');
  });

  test('Kitty keyboard stack is pushed on first render and popped on close (fix #1750)', () => {
    const out = capture();
    const r = new StandardRenderer(out.stream, 80, 24);
    r.start();
    r.render(NewView('kitty'));
    r.flush(false);
    // DisambiguateEscapeCodes (1) is always requested.
    expect(out.data()).toContain(ansi.setModifyOtherKeys2 + ansi.pushKittyKeyboard(1) + ansi.requestKittyKeyboard);
    expect(out.data()).not.toContain(ansi.popKittyKeyboard(1));

    out.reset();
    r.close();
    expect(out.data()).toContain(ansi.resetModifyOtherKeys + ansi.popKittyKeyboard(1));
    expect(out.data()).not.toContain('\x1b[>0;1u');
    expect(out.data()).not.toContain('\x1b[>u');
  });

  test('Kitty flag changes on the same screen update the top entry in place', () => {
    const out = capture();
    const r = new StandardRenderer(out.stream, 80, 24);
    r.start();
    r.render(NewView('a'));
    r.flush(false);
    out.reset();

    const view = NewView('a');
    view.keyboardEnhancements.reportEventTypes = true;
    r.render(view);
    r.flush(false);
    expect(out.data()).toContain(ansi.kittyKeyboard(3, 1));
    expect(ansi.kittyKeyboard(3, 1)).toBe('\x1b[=3;1u');
    expect(out.data()).not.toContain(ansi.pushKittyKeyboard(3));
    expect(out.data()).not.toContain(ansi.popKittyKeyboard(1));
  });

  test('switching screens pops the old Kitty entry before pushing a new one', () => {
    const out = capture();
    const r = new StandardRenderer(out.stream, 80, 24);
    r.start();
    r.render(NewView('main'));
    r.flush(false);
    out.reset();

    const alt = NewView('alt');
    alt.altScreen = true;
    r.render(alt);
    r.flush(false);
    const data = out.data();
    const pop = data.indexOf(ansi.resetModifyOtherKeys + ansi.popKittyKeyboard(1));
    const enter = data.indexOf(ansi.enterAltScreen);
    const push = data.indexOf(ansi.pushKittyKeyboard(1));
    expect(pop).toBeGreaterThanOrEqual(0);
    expect(enter).toBeGreaterThan(pop);
    expect(push).toBeGreaterThan(enter);

    // Pushes and pops stay balanced across a full lifecycle.
    r.render(NewView('main again'));
    r.flush(false);
    r.close();
    const all = out.data();
    const count = (needle: string) => all.split(needle).length - 1;
    expect(count(ansi.pushKittyKeyboard(1))).toBe(2);
    expect(count(ansi.popKittyKeyboard(1))).toBe(3);
  });

  test('ansi Kitty helpers match x/ansi encodings', () => {
    expect(ansi.pushKittyKeyboard(0)).toBe('\x1b[>u');
    expect(ansi.pushKittyKeyboard(9)).toBe('\x1b[>9u');
    expect(ansi.popKittyKeyboard(1)).toBe('\x1b[<1u');
    expect(ansi.popKittyKeyboard(0)).toBe('\x1b[<u');
    expect(ansi.kittyKeyboard(0, 1)).toBe('\x1b[=0;1u');
  });

  test('renderer with input disabled never touches the keyboard protocol', () => {
    const out = capture();
    const r = new StandardRenderer(out.stream, 80, 24);
    r.setNoInput(true);
    r.start();
    r.render(NewView('main'));
    r.flush(false);
    const alt = NewView('alt');
    alt.altScreen = true;
    alt.keyboardEnhancements.reportEventTypes = true;
    r.render(alt);
    r.flush(false);
    r.close();
    const data = out.data();
    expect(data).toContain('alt');
    expect(data).toContain(ansi.enterAltScreen);
    for (const seq of [
      ansi.setModifyOtherKeys2,
      ansi.resetModifyOtherKeys,
      ansi.requestKittyKeyboard,
      '\x1b[>1u',
      '\x1b[<1u',
      '\x1b[=',
    ]) {
      expect(data).not.toContain(seq);
    }
  });

  test('WithInput(null) skips every terminal query (fix #1801)', async () => {
    const out = capture();
    await new Program(
      new QueryModel(),
      WithInput(null),
      WithOutput(out.stream),
      WithWindowSize(80, 24),
      // An environment that would normally trigger the startup mode probe.
      WithEnvironment({ TERM: 'xterm-ghostty' }),
      WithoutSignalHandler(),
    ).run();
    const data = out.data();
    expect(data).toContain('queries');
    for (const query of queries) expect(data).not.toContain(query);
  });

  test('queries are still sent when input is enabled', async () => {
    const out = capture();
    await new Program(
      new QueryModel(),
      WithInput(nullInput()),
      WithOutput(out.stream),
      // No WithWindowSize/stream dimensions, so RequestWindowSize must query.
      WithEnvironment({ TERM: 'xterm-ghostty' }),
      WithoutSignalHandler(),
    ).run();
    const data = out.data();
    // The Kitty keyboard query is skipped on the closing flush, so exclude it.
    for (const query of queries.filter((q) => q !== ansi.requestKittyKeyboard)) {
      expect(data).toContain(query);
    }
  });

  test('ClearScreen command still clears with input disabled', async () => {
    class ClearModel implements Model {
      init(): Cmd {
        return Sequence(ClearScreen, Quit);
      }
      update(): [Model, Cmd] {
        return [this, null];
      }
      view(): string {
        return 'cleared';
      }
    }
    const out = capture();
    await new Program(
      new ClearModel(),
      WithInput(null),
      WithOutput(out.stream),
      WithWindowSize(80, 24),
      WithEnvironment({ TERM_PROGRAM: 'Apple_Terminal' }),
      WithoutSignalHandler(),
    ).run();
    expect(out.data()).toContain(ansi.clearScreen);
    expect(out.data().lastIndexOf('cleared')).toBeGreaterThan(out.data().indexOf(ansi.clearScreen));
  });
});
// ─── Inline renderer screen behaviour ───────────────────────────────────────

/**
 * Minimal terminal: applies the cursor movement and erase sequences the
 * inline renderer emits to a list of screen lines, so tests can assert on
 * what a user sees rather than on exact escape strings.
 */
function emulate(initial: string[], data: string): string[] {
  const lines = [...initial];
  let row = lines.length;
  let col = 0;
  const line = () => {
    while (lines.length <= row) lines.push('');
    return lines[row];
  };
  const re = /\x1b\[([?<=>\d;]*)([A-Za-z])|\r|\n|[^\x1b\r\n]/g;
  for (const [token, params, final] of data.matchAll(re)) {
    if (token === '\r') col = 0;
    else if (token === '\n') row++;
    else if (final !== undefined) {
      if (/^[?<=>]/.test(params)) continue;
      const n = params === '' ? 1 : Number(params);
      if (final === 'A') row = Math.max(0, row - n);
      else if (final === 'B') row += n;
      else if (final === 'K') lines[row] = (line(), '');
      else if (final === 'J') lines.length = Math.min(lines.length, row + 1), (lines[row] = line().slice(0, col));
      else if (final === 'L') lines.splice(row, 0, ...Array(n).fill(''));
    } else {
      const current = line().padEnd(col);
      lines[row] = current.slice(0, col) + token + current.slice(col + 1);
      col++;
    }
  }
  return lines.map((l) => l.trimEnd());
}

describe('StandardRenderer inline mode', () => {
  const { StandardRenderer } = require('../src/renderer.js');

  function setup() {
    const output = new PassThrough();
    let data = '';
    output.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    const r = new StandardRenderer(output, 80, 24);
    r.start();
    const frame = (view: string) => {
      r.render(view);
      r.flush(false);
    };
    // `after` is what the shell writes once the program exits.
    return { r, frame, screen: (after = '') => emulate(['$ shell output'], data + after) };
  }

  test('re-rendering keeps the lines above the program', () => {
    const { r, frame, screen } = setup();
    frame('one\ntwo\nthree');
    frame('one\ntwo\nTHREE');
    frame('uno\ndos\ntres');
    r.close();
    expect(screen()).toEqual(['$ shell output', 'uno', 'dos', 'tres']);
  });

  test('a shorter frame clears the leftover lines', () => {
    const { r, frame, screen } = setup();
    frame('a\nb\nc');
    frame('a');
    r.close();
    expect(screen().filter(Boolean)).toEqual(['$ shell output', 'a']);
  });

  test('closing leaves the shell prompt on its own line', () => {
    for (const [view, expected] of [
      ['Count: 3\nPress q to quit.', ['$ shell output', 'Count: 3', 'Press q to quit.', '$ next']],
      ['Count: 3\nPress q to quit.\n', ['$ shell output', 'Count: 3', 'Press q to quit.', '$ next']],
    ] as const) {
      const { r, frame, screen } = setup();
      frame(view);
      r.close();
      expect(screen('$ next')).toEqual([...expected]);
    }
  });

  test('insertAbove prints above the frame without losing it', () => {
    const { r, frame, screen } = setup();
    frame('frame 1\nframe 2');
    r.insertAbove('printed');
    frame('frame 1\nframe 2!');
    r.close();
    expect(screen()).toEqual(['$ shell output', 'printed', 'frame 1', 'frame 2!']);
  });
});
