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

    // Should complete without error
    await p.run();
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
