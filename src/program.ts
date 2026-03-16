/**
 * Program — the core Bubble Tea runtime.
 *
 * Implements the Elm Architecture event loop for terminal UIs.
 * Ports Go bubbletea's Program struct and Run()/eventLoop() logic.
 * Zero-dependency — uses only Node.js built-ins.
 */

import type { Readable, Writable } from 'node:stream';
import {
  type Msg,
  type Cmd,
  type Model,
  QuitMsg,
  InterruptMsg,
  SuspendMsg,
  ResumeMsg,
  WindowSizeMsg,
  ClearScreenMsg,
  FocusMsg,
  BlurMsg,
  BatchMsg,
  SequenceMsg,
  PrintLineMsg,
  RawMsg,
  MouseMode,
  ErrProgramKilled,
  ErrProgramPanic,
  ErrInterrupted,
  ProgramError,
} from './types.js';
import { type Renderer, StandardRenderer, NilRenderer } from './renderer.js';
import { parseInput } from './input.js';
import * as ansi from './ansi.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_FPS = 60;
const MAX_FPS = 120;

// ─── ProgramOption ──────────────────────────────────────────────────────────

/**
 * ProgramOption is used to set options when initializing a Program.
 * Mirrors Go's functional options pattern.
 */
export type ProgramOption = (p: Program) => void;

/** Sets the input stream. Pass null to disable input. */
export function WithInput(input: Readable | NodeJS.ReadStream | null): ProgramOption {
  return (p) => {
    (p as any)._input = input;
    if (input === null) (p as any)._disableInput = true;
  };
}

/** Sets the output stream. Defaults to process.stdout. */
export function WithOutput(output: Writable | NodeJS.WriteStream): ProgramOption {
  return (p) => {
    (p as any)._output = output;
  };
}

/**
 * WithFilter supplies an event filter invoked before Bubble Tea processes a Msg.
 * Return the msg to process it, or null to discard.
 */
export function WithFilter(filter: (model: Model, msg: Msg) => Msg | null): ProgramOption {
  return (p) => {
    (p as any)._filter = filter;
  };
}

/** Sets a custom maximum FPS. Clamped to [1, 120]. */
export function WithFPS(fps: number): ProgramOption {
  return (p) => {
    (p as any)._fps = fps;
  };
}

/** Disables the renderer (headless/daemon mode). */
export function WithoutRenderer(): ProgramOption {
  return (p) => {
    (p as any)._disableRenderer = true;
  };
}

/** Disables the signal handler. */
export function WithoutSignalHandler(): ProgramOption {
  return (p) => {
    (p as any)._disableSignalHandler = true;
  };
}

/** Disables panic catching. */
export function WithoutCatchPanics(): ProgramOption {
  return (p) => {
    (p as any)._disableCatchPanics = true;
  };
}

/** Sets the initial window size. Useful for testing. */
export function WithWindowSize(width: number, height: number): ProgramOption {
  return (p) => {
    (p as any)._width = width;
    (p as any)._height = height;
  };
}

/** Provides an AbortSignal to cancel the program from outside. */
export function WithAbortSignal(signal: AbortSignal): ProgramOption {
  return (p) => {
    (p as any)._externalSignal = signal;
  };
}

/** Disables mouse tracking. Only meaningful if mouse mode was set via model view. */
export function WithMouseMode(mode: MouseMode): ProgramOption {
  return (p) => {
    (p as any)._mouseMode = mode;
  };
}

/** Enables alt screen mode from the start. */
export function WithAltScreen(): ProgramOption {
  return (p) => {
    (p as any)._altScreen = true;
  };
}

// ─── Program ────────────────────────────────────────────────────────────────

/**
 * Program is the core Bubble Tea runtime. It manages the event loop,
 * renders the view, handles input, and coordinates the Elm Architecture.
 */
export class Program {
  // ── Configuration ──
  private _initialModel: Model;
  private _input: Readable | NodeJS.ReadStream | null;
  private _output: Writable | NodeJS.WriteStream;
  private _filter: ((model: Model, msg: Msg) => Msg | null) | null = null;
  private _fps = DEFAULT_FPS;
  private _disableInput = false;
  private _disableRenderer = false;
  private _disableSignalHandler = false;
  private _disableCatchPanics = false;
  private _altScreen = false;
  private _mouseMode: MouseMode = MouseMode.None;
  private _width = 0;
  private _height = 0;
  private _externalSignal: AbortSignal | null = null;

  // ── Runtime state ──
  private _model: Model;
  private _renderer: Renderer | null = null;
  private _renderTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _killed = false;
  private _finished: PromiseWithResolvers<void> | null = null;
  private _previousRawMode: boolean | undefined;
  private _inputListener: ((data: Buffer) => void) | null = null;
  private _signalHandlers: Array<[string, (...args: any[]) => void]> = [];
  private _abortHandler: (() => void) | null = null;

  // ── Message queue (replaces Go channel) ──
  private _msgQueue: Msg[] = [];
  private _msgResolve: (() => void) | null = null;
  private _eventLoopError: Error | null = null;

  constructor(model: Model, ...opts: ProgramOption[]) {
    this._initialModel = model;
    this._model = model;
    this._input = null; // set lazily to process.stdin if not provided
    this._output = process.stdout;

    // Apply options
    for (const opt of opts) {
      opt(this);
    }

    // Clamp FPS
    if (this._fps < 1) this._fps = DEFAULT_FPS;
    if (this._fps > MAX_FPS) this._fps = MAX_FPS;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Run initializes the program and runs its event loop.
   * Blocks (awaits) until the program quits or is killed.
   * Returns the final model.
   */
  async run(): Promise<Model> {
    if (this._running) {
      throw new ProgramError('program is already running');
    }
    this._running = true;
    this._killed = false;
    this._msgQueue = [];
    this._msgResolve = null;
    this._eventLoopError = null;

    this._finished = withResolvers<void>();

    try {
      return await this._run();
    } finally {
      this._running = false;
      this._finished.resolve();
    }
  }

  /**
   * Send sends a message to the program's event loop.
   * Safe to call from outside the program.
   */
  send(msg: Msg): void {
    if (!this._running || this._killed) return;
    this._enqueueMsg(msg);
  }

  /**
   * Quit sends a QuitMsg to the program.
   */
  quit(): void {
    this.send(new QuitMsg());
  }

  /**
   * Kill stops the program immediately and restores the terminal.
   */
  kill(): void {
    this._killed = true;
    // Don't overwrite a more specific error (e.g. ErrProgramPanic)
    if (!this._eventLoopError) {
      this._eventLoopError = ErrProgramKilled;
    }
    // Wake up the event loop
    if (this._msgResolve) {
      this._msgResolve();
      this._msgResolve = null;
    }
  }

  /**
   * Wait blocks until the program finishes running.
   */
  async wait(): Promise<void> {
    if (this._finished) {
      await this._finished.promise;
    }
  }

  // ── Internal: Main run sequence ─────────────────────────────────────────

  private async _run(): Promise<Model> {
    // Resolve input
    if (!this._disableInput && this._input === null) {
      this._input = process.stdin;
    }

    // Get initial terminal size
    if (this._width === 0 && this._height === 0) {
      const size = this._getTerminalSize();
      this._width = size.width;
      this._height = size.height;
    }

    // Set up renderer
    if (this._disableRenderer) {
      this._renderer = new NilRenderer();
    } else {
      const r = new StandardRenderer(
        this._output as NodeJS.WritableStream,
        this._width,
        this._height,
      );
      this._renderer = r;

      if (this._altScreen) {
        r.enterAltScreen();
      }
    }

    // Enter raw mode
    this._enterRawMode();

    // Set up signal handlers
    this._setupSignalHandlers();

    // Set up input reader
    this._setupInputReader();

    // Enable mouse if requested
    this._enableMouse();

    // Enable bracketed paste + focus reporting
    this._enableTerminalFeatures();

    // Start the renderer ticker
    this._startRenderer();

    // Send initial WindowSizeMsg
    this._enqueueMsg(new WindowSizeMsg(this._width, this._height));

    // Initialize model
    let model = this._initialModel;
    const initCmd = model.init();
    if (initCmd) {
      this._executeCmd(initCmd);
    }

    // Render initial view
    this._render(model);

    // Run event loop
    let err: Error | null = null;
    try {
      model = await this._eventLoop(model);
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e));
    }

    if (this._eventLoopError) {
      err = this._eventLoopError;
    }

    const killed = this._killed || !!err;

    if (!killed) {
      // Final render on graceful exit
      this._render(model);
      this._renderer?.flush(true);
    }

    // Cleanup
    this._shutdown(killed);

    this._model = model;

    if (err) {
      throw err;
    }

    return model;
  }

  // ── Internal: Event loop ────────────────────────────────────────────────

  private async _eventLoop(model: Model): Promise<Model> {
    while (!this._killed) {
      // Wait for a message
      const msg = await this._dequeueMsg();
      if (msg === undefined || this._killed) break;

      const result = this._processMsg(model, msg);
      if (result === null) continue; // filtered out

      if (result.done) {
        model = result.model;
        if (result.error) {
          this._eventLoopError = result.error;
        }
        break;
      }

      model = result.model;
      if (result.cmd) {
        this._executeCmd(result.cmd);
      }

      // Render
      this._render(model);
    }

    return model;
  }

  private _processMsg(
    model: Model,
    msg: Msg,
  ): { model: Model; cmd: Cmd; done: boolean; error?: Error } | null {
    // Apply filter
    if (this._filter) {
      const filtered = this._filter(model, msg);
      if (filtered === null || filtered === undefined) return null;
      msg = filtered;
    }

    // Handle special internal messages BEFORE model.update()
    if (msg instanceof QuitMsg) {
      return { model, cmd: null, done: true };
    }
    if (msg instanceof InterruptMsg) {
      return { model, cmd: null, done: true, error: ErrInterrupted };
    }
    if (msg instanceof SuspendMsg) {
      this._suspend();
      return null; // don't pass to model
    }
    if (msg instanceof WindowSizeMsg) {
      this._renderer?.resize(msg.width, msg.height);
      this._width = msg.width;
      this._height = msg.height;
    }
    if (msg instanceof ClearScreenMsg) {
      this._renderer?.clearScreen();
    }
    if (msg instanceof PrintLineMsg) {
      this._renderer?.insertAbove(msg.body);
    }
    if (msg instanceof RawMsg) {
      this._writeToOutput(msg.data);
    }

    // Handle BatchMsg and SequenceMsg (don't pass to model)
    if (msg instanceof BatchMsg) {
      this._execBatchMsg(msg);
      return null;
    }
    if (msg instanceof SequenceMsg) {
      this._execSequenceMsg(msg);
      return null;
    }

    // Call model.update()
    let cmd: Cmd = null;
    try {
      if (!this._disableCatchPanics) {
        try {
          [model, cmd] = model.update(msg);
        } catch (e) {
          this._recoverFromPanic(e);
          return { model, cmd: null, done: true, error: ErrProgramPanic };
        }
      } else {
        [model, cmd] = model.update(msg);
      }
    } catch (e) {
      throw e;
    }

    return { model, cmd, done: false };
  }

  // ── Message queue ───────────────────────────────────────────────────────

  private _enqueueMsg(msg: Msg): void {
    this._msgQueue.push(msg);
    if (this._msgResolve) {
      this._msgResolve();
      this._msgResolve = null;
    }
  }

  private async _dequeueMsg(): Promise<Msg | undefined> {
    while (this._msgQueue.length === 0 && !this._killed) {
      await new Promise<void>((resolve) => {
        this._msgResolve = resolve;
      });
    }
    return this._msgQueue.shift();
  }

  // ── Command execution ─────────────────────────────────────────────────

  private _executeCmd(cmd: Cmd): void {
    if (!cmd) return;

    // Execute the command asynchronously (like a goroutine)
    const run = async () => {
      try {
        const result = cmd();
        if (result instanceof Promise) {
          const msg = await result;
          this.send(msg);
        } else {
          this.send(result);
        }
      } catch (e) {
        if (!this._disableCatchPanics) {
          this._recoverFromPanic(e);
        } else {
          throw e;
        }
      }
    };
    run();
  }

  private _execBatchMsg(msg: BatchMsg): void {
    // Execute all commands concurrently (like Go's WaitGroup pattern)
    for (const cmd of msg.cmds) {
      if (!cmd) continue;

      const run = async () => {
        try {
          const result = cmd();
          const resolved = result instanceof Promise ? await result : result;

          if (resolved instanceof BatchMsg) {
            this._execBatchMsg(resolved);
          } else if (resolved instanceof SequenceMsg) {
            this._execSequenceMsg(resolved);
          } else {
            this.send(resolved);
          }
        } catch (e) {
          if (!this._disableCatchPanics) {
            this._recoverFromPanic(e);
          }
        }
      };
      run();
    }
  }

  private _execSequenceMsg(msg: SequenceMsg): void {
    // Execute commands one at a time, in order
    const run = async () => {
      for (const cmd of msg.cmds) {
        if (!cmd) continue;
        try {
          const result = cmd();
          const resolved = result instanceof Promise ? await result : result;

          if (resolved instanceof BatchMsg) {
            this._execBatchMsg(resolved);
          } else if (resolved instanceof SequenceMsg) {
            // Recursive, but sequential
            await this._execSequenceMsgAsync(resolved);
          } else {
            this.send(resolved);
          }
        } catch (e) {
          if (!this._disableCatchPanics) {
            this._recoverFromPanic(e);
          }
        }
      }
    };
    run();
  }

  private async _execSequenceMsgAsync(msg: SequenceMsg): Promise<void> {
    for (const cmd of msg.cmds) {
      if (!cmd) continue;
      try {
        const result = cmd();
        const resolved = result instanceof Promise ? await result : result;

        if (resolved instanceof BatchMsg) {
          this._execBatchMsg(resolved);
        } else if (resolved instanceof SequenceMsg) {
          await this._execSequenceMsgAsync(resolved);
        } else {
          this.send(resolved);
        }
      } catch (e) {
        if (!this._disableCatchPanics) {
          this._recoverFromPanic(e);
        }
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private _render(model: Model): void {
    if (this._renderer) {
      this._renderer.render(model.view());
    }
  }

  private _startRenderer(): void {
    if (!this._renderer) return;
    this._renderer.start();

    const frameInterval = Math.round(1000 / this._fps);
    this._renderTimer = setInterval(() => {
      if (this._renderer) {
        this._renderer.flush(false);
      }
    }, frameInterval);

    // Unref the timer so it doesn't keep the process alive
    if (this._renderTimer && typeof this._renderTimer === 'object' && 'unref' in this._renderTimer) {
      (this._renderTimer as NodeJS.Timeout).unref();
    }
  }

  private _stopRenderer(kill: boolean): void {
    if (this._renderTimer) {
      clearInterval(this._renderTimer);
      this._renderTimer = null;
    }

    if (this._renderer) {
      if (!kill) {
        this._renderer.flush(true);
      }
      this._renderer.close();
    }
  }

  // ── Terminal management ───────────────────────────────────────────────

  private _getTerminalSize(): { width: number; height: number } {
    const out = this._output as NodeJS.WriteStream;
    if (out && typeof out.columns === 'number' && typeof out.rows === 'number') {
      return { width: out.columns, height: out.rows };
    }
    return { width: 80, height: 24 };
  }

  private _enterRawMode(): void {
    if (this._disableInput || !this._input) return;

    const stdin = this._input as NodeJS.ReadStream;
    if (typeof stdin.setRawMode === 'function') {
      this._previousRawMode = stdin.isRaw;
      stdin.setRawMode(true);
    }
  }

  private _exitRawMode(): void {
    if (this._disableInput || !this._input) return;

    const stdin = this._input as NodeJS.ReadStream;
    if (typeof stdin.setRawMode === 'function' && this._previousRawMode !== undefined) {
      stdin.setRawMode(this._previousRawMode);
    }
  }

  private _setupInputReader(): void {
    if (this._disableInput || !this._input) return;

    const input = this._input;

    this._inputListener = (data: Buffer) => {
      const msgs = parseInput(data);
      for (const msg of msgs) {
        this._enqueueMsg(msg);
      }
    };

    input.on('data', this._inputListener);

    // Resume the stream if paused
    if (typeof (input as any).resume === 'function') {
      (input as any).resume();
    }
  }

  private _teardownInputReader(): void {
    if (this._inputListener && this._input) {
      this._input.removeListener('data', this._inputListener);
      this._inputListener = null;
    }

    // Pause stdin if it's process.stdin to not keep the process alive
    if (this._input === process.stdin) {
      process.stdin.pause();
    }
  }

  private _enableMouse(): void {
    if (this._mouseMode === MouseMode.None) return;

    let seq = '';
    if (this._mouseMode === MouseMode.AllMotion) {
      seq = ansi.enableMouseAllMotion + ansi.enableMouseSGR;
    } else if (this._mouseMode === MouseMode.CellMotion) {
      seq = ansi.enableMouseCellMotion + ansi.enableMouseSGR;
    }
    this._writeToOutput(seq);
  }

  private _disableMouse(): void {
    if (this._mouseMode === MouseMode.None) return;

    let seq = '';
    if (this._mouseMode === MouseMode.AllMotion) {
      seq = ansi.disableMouseAllMotion + ansi.disableMouseSGR;
    } else if (this._mouseMode === MouseMode.CellMotion) {
      seq = ansi.disableMouseCellMotion + ansi.disableMouseSGR;
    }
    this._writeToOutput(seq);
  }

  private _enableTerminalFeatures(): void {
    let seq = '';
    seq += ansi.enableBracketedPaste;
    seq += ansi.enableFocusReporting;
    this._writeToOutput(seq);
  }

  private _disableTerminalFeatures(): void {
    let seq = '';
    seq += ansi.disableBracketedPaste;
    seq += ansi.disableFocusReporting;
    seq += ansi.showCursor;
    this._writeToOutput(seq);
  }

  private _writeToOutput(s: string): void {
    if (s.length > 0) {
      this._output.write(s);
    }
  }

  // ── Signal handling ───────────────────────────────────────────────────

  private _setupSignalHandlers(): void {
    // Process signal handlers (SIGINT, SIGTERM, SIGWINCH) are gated by
    // _disableSignalHandler, but the external AbortSignal is always
    // honoured — matching Go's behaviour where context cancellation
    // is independent of WithoutSignalHandler().
    if (!this._disableSignalHandler) {
      // SIGINT → InterruptMsg
      const onSigint = () => {
        this._enqueueMsg(new InterruptMsg());
      };
      process.on('SIGINT', onSigint);
      this._signalHandlers.push(['SIGINT', onSigint]);

      // SIGTERM → QuitMsg
      const onSigterm = () => {
        this._enqueueMsg(new QuitMsg());
      };
      process.on('SIGTERM', onSigterm);
      this._signalHandlers.push(['SIGTERM', onSigterm]);

      // SIGWINCH → resize
      if (process.platform !== 'win32') {
        const onResize = () => {
          const size = this._getTerminalSize();
          this._enqueueMsg(new WindowSizeMsg(size.width, size.height));
        };
        process.on('SIGWINCH', onResize);
        this._signalHandlers.push(['SIGWINCH', onResize]);
      }
    }

    // External abort signal — always registered regardless of
    // _disableSignalHandler (mirrors Go's context.Context behaviour)
    if (this._externalSignal) {
      this._abortHandler = () => {
        this._killed = true;
        if (!this._eventLoopError) {
          this._eventLoopError = ErrProgramKilled;
        }
        if (this._msgResolve) {
          this._msgResolve();
          this._msgResolve = null;
        }
      };
      this._externalSignal.addEventListener('abort', this._abortHandler);
    }
  }

  private _teardownSignalHandlers(): void {
    for (const [event, handler] of this._signalHandlers) {
      process.removeListener(event, handler);
    }
    this._signalHandlers = [];

    if (this._externalSignal && this._abortHandler) {
      this._externalSignal.removeEventListener('abort', this._abortHandler);
      this._abortHandler = null;
    }
  }

  // ── Suspend / Resume ──────────────────────────────────────────────────

  private _suspend(): void {
    // Only supported on Unix
    if (process.platform === 'win32') return;

    // Release terminal
    this._stopRenderer(false);
    this._disableMouse();
    this._disableTerminalFeatures();

    const renderer = this._renderer as StandardRenderer;
    if (renderer && typeof renderer.exitAltScreen === 'function') {
      renderer.exitAltScreen();
    }

    this._teardownInputReader();
    this._exitRawMode();

    // Send SIGTSTP to suspend the process
    process.kill(process.pid, 'SIGTSTP');

    // When we resume, restore everything
    // Use SIGCONT to detect resume
    const onResume = () => {
      process.removeListener('SIGCONT', onResume);

      this._enterRawMode();
      this._setupInputReader();
      this._enableTerminalFeatures();
      this._enableMouse();

      if (this._altScreen && renderer && typeof renderer.enterAltScreen === 'function') {
        renderer.enterAltScreen();
      }

      this._startRenderer();
      this._renderer?.repaint();

      this._enqueueMsg(new ResumeMsg());
    };
    process.on('SIGCONT', onResume);
  }

  // ── Panic recovery ────────────────────────────────────────────────────

  private _recoverFromPanic(err: unknown): void {
    this._eventLoopError = ErrProgramPanic;
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    process.stderr.write(`Caught panic:\r\n\r\n${msg}\r\n\r\n`);
    if (stack) {
      process.stderr.write(`${stack.replace(/\n/g, '\r\n')}\r\n`);
    }
    process.stderr.write('Restoring terminal...\r\n\r\n');
    this.kill();
  }

  // ── Shutdown ──────────────────────────────────────────────────────────

  private _shutdown(killed: boolean): void {
    // Tear down signal handlers
    this._teardownSignalHandlers();

    // Tear down input
    this._teardownInputReader();

    // Disable terminal features
    this._disableMouse();
    this._disableTerminalFeatures();

    // Exit alt screen if needed
    const renderer = this._renderer as StandardRenderer;
    if (renderer && typeof renderer.exitAltScreen === 'function' && renderer.isAltScreen) {
      renderer.exitAltScreen();
    }

    // Stop renderer
    this._stopRenderer(killed);

    // Restore terminal state
    this._exitRawMode();
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Polyfill for Promise.withResolvers (Node 22+) */
function withResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}
