/**
 * Program — the core Bubble Tea runtime.
 *
 * Implements the Elm Architecture event loop for terminal UIs.
 * Ports Go bubbletea's Program struct and Run()/eventLoop() logic.
 * Zero-dependency — uses only Node.js built-ins.
 */

import {
  closeSync,
  createReadStream,
  createWriteStream,
  openSync,
  type ReadStream,
  type WriteStream,
} from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import {
  type Msg,
  type Cmd,
  type Model,
  type ExecCommand,
  type ExecCallback,
  QuitMsg,
  InterruptMsg,
  SuspendMsg,
  ResumeMsg,
  WindowSizeMsg,
  WindowSizeRequestMsg,
  CursorPositionRequestMsg,
  BackgroundColorRequestMsg,
  ForegroundColorRequestMsg,
  CursorColorRequestMsg,
  ClipboardReadRequestMsg,
  ClipboardSetRequestMsg,
  CapabilityRequestMsg,
  TerminalVersionRequestMsg,
  ExecRequestMsg,
  ClearScreenMsg,
  BatchMsg,
  SequenceMsg,
  PrintLineMsg,
  RawMsg,
  CapabilityMsg,
  ModeReportMsg,
  ModeSetting,
  ColorProfile,
  ColorProfileMsg,
  MouseClickMsg,
  MouseReleaseMsg,
  MouseWheelMsg,
  MouseMotionMsg,
  View,
  MouseMode,
  ErrProgramKilled,
  ErrProgramPanic,
  ErrInterrupted,
  ProgramError,
  EnvMsg,
} from './types.js';
import { type Renderer, StandardRenderer, NilRenderer } from './renderer.js';
import { InputDecoder } from './input.js';
import { Printf as PrintfCommand, Println as PrintlnCommand } from './commands.js';
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

interface MutableProgramOptions {
  _input: Readable | NodeJS.ReadStream | null;
  _output: Writable | NodeJS.WriteStream;
  _filter: ((model: Model, msg: Msg) => Msg | null) | null;
  _fps: number;
  _disableInput: boolean;
  _disableRenderer: boolean;
  _disableSignalHandler: boolean;
  _disableCatchPanics: boolean;
  _ignoreSignals: boolean;
  _width: number;
  _height: number;
  _externalSignal: AbortSignal | null;
  _mouseMode: MouseMode;
  _altScreen: boolean;
  _environment: string[];
  _colorProfile: ColorProfile | null;
}

function mutableOptions(program: Program): MutableProgramOptions {
  // Functional options are the sole controlled bridge to Program's private configuration.
  return program as unknown as MutableProgramOptions;
}

/** Sets the input stream. Pass null to disable input. */
export function WithInput(input: Readable | NodeJS.ReadStream | null): ProgramOption {
  return (p) => {
    mutableOptions(p)._input = input;
    if (input === null) mutableOptions(p)._disableInput = true;
  };
}

/** Sets the output stream. Defaults to process.stdout. */
export function WithOutput(output: Writable | NodeJS.WriteStream): ProgramOption {
  return (p) => {
    mutableOptions(p)._output = output;
  };
}

/** Sets the environment exposed through EnvMsg and terminal capability detection. */
export function WithEnvironment(
  environment: readonly string[] | Readonly<Record<string, string | undefined>>,
): ProgramOption {
  const values = [...new EnvMsg(environment).values];
  return (p) => {
    mutableOptions(p)._environment = values;
  };
}

/**
 * WithFilter supplies an event filter invoked before Bubble Tea processes a Msg.
 * Return the msg to process it, or null to discard.
 */
export function WithFilter(filter: (model: Model, msg: Msg) => Msg | null): ProgramOption {
  return (p) => {
    mutableOptions(p)._filter = filter;
  };
}

/** Sets a custom maximum FPS. Clamped to [1, 120]. */
export function WithFPS(fps: number): ProgramOption {
  return (p) => {
    mutableOptions(p)._fps = fps;
  };
}

/** Disables the renderer (headless/daemon mode). */
export function WithoutRenderer(): ProgramOption {
  return (p) => {
    mutableOptions(p)._disableRenderer = true;
  };
}

/** Disables the signal handler. */
export function WithoutSignalHandler(): ProgramOption {
  return (p) => {
    mutableOptions(p)._disableSignalHandler = true;
  };
}

/** Installs signal handlers but ignores SIGINT and SIGTERM. Primarily useful for tests. */
export function WithoutSignals(): ProgramOption {
  return (p) => {
    mutableOptions(p)._ignoreSignals = true;
  };
}

/** Disables panic catching. */
export function WithoutCatchPanics(): ProgramOption {
  return (p) => {
    mutableOptions(p)._disableCatchPanics = true;
  };
}

/** Sets the initial window size. Useful for testing. */
export function WithWindowSize(width: number, height: number): ProgramOption {
  return (p) => {
    mutableOptions(p)._width = width;
    mutableOptions(p)._height = height;
  };
}

/** Provides an AbortSignal to cancel the program from outside. */
export function WithAbortSignal(signal: AbortSignal): ProgramOption {
  return (p) => {
    mutableOptions(p)._externalSignal = signal;
  };
}

/** Upstream-compatible alias for AbortSignal-based cancellation. */
export const WithContext = WithAbortSignal;

/** Disables mouse tracking. Only meaningful if mouse mode was set via model view. */
export function WithMouseMode(mode: MouseMode): ProgramOption {
  return (p) => {
    mutableOptions(p)._mouseMode = mode;
  };
}

/** Enables alt screen mode from the start. */
export function WithAltScreen(): ProgramOption {
  return (p) => {
    mutableOptions(p)._altScreen = true;
  };
}

/** Forces the color profile reported to the model. */
export function WithColorProfile(profile: ColorProfile): ProgramOption {
  return (p) => {
    mutableOptions(p)._colorProfile = profile;
  };
}


export interface TTYStreams {
  readonly input: ReadStream;
  readonly output: WriteStream;
  close(): void;
}

/** Open the controlling terminal independently of redirected stdin/stdout. */
export function OpenTTY(): TTYStreams {
  const inputPath = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';
  const outputPath = process.platform === 'win32' ? 'CONOUT$' : '/dev/tty';
  const inputFd = openSync(inputPath, 'r');
  let outputFd: number;
  try {
    outputFd = openSync(outputPath, 'w');
  } catch (error) {
    closeSync(inputFd);
    throw error;
  }

  const input = createReadStream(inputPath, { fd: inputFd, autoClose: false });
  const output = createWriteStream(outputPath, { fd: outputFd, autoClose: false });
  let closed = false;
  return {
    input,
    output,
    close() {
      if (closed) return;
      closed = true;
      input.destroy();
      output.destroy();
      closeSync(inputFd);
      closeSync(outputFd);
    },
  };
}
// ─── Program ────────────────────────────────────────────────────────────────

/** Upstream-compatible constructor helper. */
export function NewProgram(model: Model, ...options: ProgramOption[]): Program {
  return new Program(model, ...options);
}

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
  private _environment: string[] = Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  private _colorProfile: ColorProfile | null = null;
  private _ignoreSignals = false;

  // ── Runtime state ──
  private _model: Model;
  private _renderer: Renderer | null = null;
  private _renderTimer: NodeJS.Timeout | null = null;
  private _running = false;
  private _killed = false;
  private _finished = withResolvers<void>();
  private _previousRawMode: boolean | undefined;
  private _inputListener: ((data: Buffer) => void) | null = null;
  private readonly _inputDecoder = new InputDecoder();
  private _inputFlushTimer: NodeJS.Timeout | null = null;
  private _signalHandlers: Array<[NodeJS.Signals, () => void]> = [];
  private _abortHandler: (() => void) | null = null;
  private _terminalReleased = false;
  private _ignoreSignalsBeforeRelease: boolean | null = null;
  private _cancelInteractive: (() => void) | null = null;
  private _hasRun = false;
  private _runGeneration = 0;
  private _pendingMessages: Msg[] = [];

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
    const restarting = this._hasRun;
    if (restarting) {
      this._finished = withResolvers<void>();
      this._killed = false;
      this._eventLoopError = null;
    }
    this._runGeneration++;
    this._inputDecoder.reset();
    this._running = true;
    this._hasRun = true;
    this._msgQueue = this._pendingMessages;
    this._pendingMessages = [];
    this._msgResolve = null;

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
    if (this._killed || (this._hasRun && !this._running)) return;
    if (!this._running) {
      this._pendingMessages.push(msg);
      return;
    }
    this._enqueueMsg(msg);
  }

  /** Print unmanaged output above the current view. */
  println(...args: unknown[]): void {
    const command = PrintlnCommand(...args);
    if (command) this.send(command());
  }

  /** Print formatted unmanaged output above the current view. */
  printf(template: string, ...args: unknown[]): void {
    const command = PrintfCommand(template, ...args);
    if (command) this.send(command());
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
    this._cancelInteractive?.();
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
    await this._finished.promise;
  }

  /** Release raw mode and terminal ownership for an interactive subprocess. */
  releaseTerminal(): void {
    if (!this._running || this._terminalReleased) return;
    this._ignoreSignalsBeforeRelease = this._ignoreSignals;
    this._ignoreSignals = true;
    this._stopRenderer(false);
    this._teardownInputReader();
    this._exitRawMode();
    this._terminalReleased = true;
  }

  /** Restore terminal ownership after releaseTerminal(). */
  restoreTerminal(): void {
    if (!this._running || !this._terminalReleased) return;
    this._ignoreSignals = this._ignoreSignalsBeforeRelease ?? this._ignoreSignals;
    this._ignoreSignalsBeforeRelease = null;
    this._enterRawMode();
    this._setupInputReader();
    this._startRenderer();
    this._renderer?.repaint();
    this._renderer?.flush(false);
    this._terminalReleased = false;
    this._refreshTerminalSize();
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
    }

    // Enter raw mode
    this._enterRawMode();

    // Set up signal handlers
    this._setupSignalHandlers();

    // Set up input reader
    this._setupInputReader();


    // Start rendering, then publish the startup reports Bubble Tea guarantees.
    this._startRenderer();
    if (!this._disableRenderer && shouldQuerySynchronizedOutput(this._environment)) {
      this._writeToOutput(ansi.requestSyncOutputMode + ansi.requestUnicodeCoreMode);
    }
    this._colorProfile ??= detectColorProfile(this._environment);
    this._enqueueMsg(new ColorProfileMsg(this._colorProfile));
    this._enqueueMsg(new WindowSizeMsg(this._width, this._height));
    this._enqueueMsg(new EnvMsg(this._environment));

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

      const result = await this._processMsg(model, msg);
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

  private async _processMsg(
    model: Model,
    msg: Msg,
  ): Promise<{ model: Model; cmd: Cmd; done: boolean; error?: Error } | null> {
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
    }
    if (msg instanceof WindowSizeMsg) {
      this._renderer?.resize(msg.width, msg.height);
      this._width = msg.width;
      this._height = msg.height;
    }
    if (msg instanceof WindowSizeRequestMsg) {
      const size = this._reportedTerminalSize();
      if (size) this._enqueueMsg(new WindowSizeMsg(size.width, size.height));
      else this._writeToOutput(ansi.requestWindowSize);
    }
    if (msg instanceof CursorPositionRequestMsg) {
      this._writeToOutput(ansi.requestCursorPosition);
    }
    if (msg instanceof BackgroundColorRequestMsg) {
      this._writeToOutput(ansi.requestBackgroundColor);
    }
    if (msg instanceof ForegroundColorRequestMsg) {
      this._writeToOutput(ansi.requestForegroundColor);
    }
    if (msg instanceof CursorColorRequestMsg) {
      this._writeToOutput(ansi.requestCursorColor);
    }
    if (msg instanceof ClipboardReadRequestMsg) {
      this._writeToOutput(ansi.requestClipboard(msg.selection));
    }
    if (msg instanceof ClipboardSetRequestMsg) {
      this._writeToOutput(ansi.setClipboard(msg.selection, msg.content));
    }
    if (msg instanceof CapabilityRequestMsg) {
      this._writeToOutput(ansi.requestTermcap(msg.capability));
    }
    if (msg instanceof TerminalVersionRequestMsg) {
      this._writeToOutput(ansi.requestTerminalVersion);
    }
    if (msg instanceof ExecRequestMsg) {
      await this._executeInteractive(msg.command, msg.callback);
    }
    if (msg instanceof CapabilityMsg && (msg.content === 'RGB' || msg.content === 'Tc')) {
      if (this._colorProfile !== ColorProfile.TrueColor) {
        this._colorProfile = ColorProfile.TrueColor;
        this._enqueueMsg(new ColorProfileMsg(this._colorProfile));
      }
    }
    if (
      msg instanceof ModeReportMsg &&
      msg.mode === 2026 &&
      msg.value === ModeSetting.Reset
    ) {
      this._renderer?.setSynchronizedOutput?.(true);
    }
    if (
      msg instanceof MouseClickMsg ||
      msg instanceof MouseReleaseMsg ||
      msg instanceof MouseWheelMsg ||
      msg instanceof MouseMotionMsg
    ) {
      try {
        const cmd = this._renderer?.onMouse?.(msg);
        if (cmd) this._executeCmd(cmd);
      } catch (error) {
        if (this._disableCatchPanics) throw error;
        this._recoverFromPanic(error);
        return { model, cmd: null, done: true, error: ErrProgramPanic };
      }
    }
    if (msg instanceof ClearScreenMsg) {
      this._renderer?.clearScreen();
    }
    if (msg instanceof PrintLineMsg) {
      this._renderer?.insertAbove(msg.body);
    }
    if (msg instanceof RawMsg) {
      this._writeToOutput(String(msg.data));
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
    const generation = this._runGeneration;

    // Execute the command asynchronously (like a goroutine).
    const run = async () => {
      try {
        const result = cmd();
        const msg = result instanceof Promise ? await result : result;
        if (generation === this._runGeneration && this._running) this.send(msg);
      } catch (error) {
        if (generation !== this._runGeneration || !this._running) return;
        this._failAsyncCommand(error);
      }
    };
    void run();
  }
  private _execBatchMsg(msg: BatchMsg): void {
    const generation = this._runGeneration;
    void this._execBatchMsgAsync(msg, generation).catch((error) => {
      if (generation === this._runGeneration && this._running) this._failAsyncCommand(error);
    });
  }

  private async _execBatchMsgAsync(msg: BatchMsg, generation: number): Promise<void> {
    await Promise.all(
      msg.cmds
        .filter((cmd): cmd is NonNullable<Cmd> => cmd != null)
        .map((cmd) => this._executeNestedCommand(cmd, generation)),
    );
  }
  private _execSequenceMsg(msg: SequenceMsg): void {
    const generation = this._runGeneration;
    void this._execSequenceMsgAsync(msg, generation).catch((error) => {
      if (generation === this._runGeneration && this._running) this._failAsyncCommand(error);
    });
  }

  private async _execSequenceMsgAsync(msg: SequenceMsg, generation: number): Promise<void> {
    for (const cmd of msg.cmds) {
      if (!cmd || generation !== this._runGeneration || !this._running) continue;
      await this._executeNestedCommand(cmd, generation);
      if (this._killed) return;
    }
  }

  private async _executeNestedCommand(
    cmd: NonNullable<Cmd>,
    generation: number,
  ): Promise<void> {
    try {
      const result = cmd();
      const resolved = result instanceof Promise ? await result : result;
      if (generation !== this._runGeneration || !this._running) return;
      if (resolved instanceof BatchMsg) {
        await this._execBatchMsgAsync(resolved, generation);
      } else if (resolved instanceof SequenceMsg) {
        await this._execSequenceMsgAsync(resolved, generation);
      } else {
        this.send(resolved);
      }
    } catch (error) {
      if (generation !== this._runGeneration || !this._running) return;
      if (this._disableCatchPanics) throw error;
      this._recoverFromPanic(error);
    }
  }

  private _failAsyncCommand(error: unknown): void {
    if (!this._disableCatchPanics) {
      this._recoverFromPanic(error);
      return;
    }
    this._eventLoopError = error instanceof Error ? error : new Error(String(error));
    this.kill();
  }

  private async _executeInteractive(
    command: ExecCommand,
    callback: ExecCallback | null,
  ): Promise<void> {
    this.releaseTerminal();
    const interrupted = withResolvers<void>();
    let cancelled = false;
    this._cancelInteractive = () => {
      cancelled = true;
      try {
        command.cancel?.();
      } catch {
        // Cancellation is best-effort; killing Program must still unblock Run.
      } finally {
        interrupted.resolve();
      }
    };

    command.setStdin(this._input);
    command.setStdout(this._output);
    command.setStderr(process.stderr);
    const execution = Promise.resolve()
      .then(() => {
        if (cancelled || this._killed) return;
        return command.run();
      })
      .then(
        () => ({ cancelled: false as const, error: null }),
        (cause: unknown) => ({
          cancelled: false as const,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        }),
      );
    const cancellation = interrupted.promise.then(() => ({
      cancelled: true as const,
      error: null,
    }));
    const outcome = await Promise.race([execution, cancellation]);
    this._cancelInteractive = null;
    if (outcome.cancelled || this._killed) return;

    this.restoreTerminal();
    if (callback) {
      try {
        this._enqueueMsg(callback(outcome.error));
      } catch (cause) {
        if (this._disableCatchPanics) throw cause;
        this._recoverFromPanic(cause);
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private _render(model: Model): void {
    if (!this._renderer) return;
    const rendered = model.view();
    if (typeof rendered === 'string') {
      const view = new View(rendered);
      view.altScreen = this._altScreen;
      view.mouseMode = this._mouseMode;
      this._renderer.render(view);
      return;
    }
    const view = rendered.clone();
    if (this._altScreen) view.altScreen = true;
    if (this._mouseMode !== MouseMode.None) view.mouseMode = this._mouseMode;
    this._renderer.render(view);
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

  private _reportedTerminalSize(): { width: number; height: number } | null {
    const out = this._output as NodeJS.WriteStream;
    if (out && typeof out.columns === 'number' && typeof out.rows === 'number') {
      return { width: out.columns, height: out.rows };
    }
    return null;
  }

  private _getTerminalSize(): { width: number; height: number } {
    return this._reportedTerminalSize() ?? { width: 80, height: 24 };
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
      clearTimeout(this._inputFlushTimer ?? undefined);
      for (const msg of this._inputDecoder.feed(data)) this._enqueueMsg(msg);
      this._inputFlushTimer = setTimeout(() => {
        for (const msg of this._inputDecoder.flush()) this._enqueueMsg(msg);
        this._inputFlushTimer = null;
      }, 10);
      this._inputFlushTimer.unref?.();
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

    if (this._inputFlushTimer) {
      clearTimeout(this._inputFlushTimer);
      this._inputFlushTimer = null;
    }
    // Input fragments never cross terminal ownership or run boundaries.
    this._inputDecoder.reset();
    if (this._input === process.stdin) {
      process.stdin.pause();
    }
  }


  private _writeToOutput(s: string): void {
    if (s.length > 0) {
      this._output.write(s);
    }
  }

  // ── Signal handling ───────────────────────────────────────────────────

  private _setupSignalHandlers(): void {
    this._setupProcessSignalHandlers();
    if (this._externalSignal) {
      this._abortHandler = () => {
        this.kill();
      };
      this._externalSignal.addEventListener('abort', this._abortHandler);
      if (this._externalSignal.aborted) this._abortHandler();
    }
  }

  private _setupProcessSignalHandlers(): void {
    if (this._signalHandlers.length > 0) return;
    if (!this._disableSignalHandler) {
      const onSigint = () => {
        if (!this._ignoreSignals) this._enqueueMsg(new InterruptMsg());
      };
      const onSigterm = () => {
        if (!this._ignoreSignals) this._enqueueMsg(new QuitMsg());
      };
      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);
      this._signalHandlers.push(['SIGINT', onSigint], ['SIGTERM', onSigterm]);
    }
    if (!this._disableSignalHandler && process.platform !== 'win32') {
      const onResize = () => {
        if (this._ignoreSignals) return;
        const size = this._getTerminalSize();
        this._enqueueMsg(new WindowSizeMsg(size.width, size.height));
      };
      process.on('SIGWINCH', onResize);
      this._signalHandlers.push(['SIGWINCH', onResize]);
    }
  }

  private _refreshTerminalSize(): void {
    const size = this._reportedTerminalSize();
    if (!size) {
      this._writeToOutput(ansi.requestWindowSize);
      return;
    }
    if (size.width === this._width && size.height === this._height) return;
    this._width = size.width;
    this._height = size.height;
    this._renderer?.resize(size.width, size.height);
    this._enqueueMsg(new WindowSizeMsg(size.width, size.height));
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
    if (process.platform === 'win32') return;

    this.releaseTerminal();
    const onResume = () => {
      this.restoreTerminal();
      this._enqueueMsg(new ResumeMsg());
    };
    process.once('SIGCONT', onResume);
    process.kill(process.pid, 'SIGTSTP');
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
    this._teardownSignalHandlers();
    this._teardownInputReader();

    this._stopRenderer(killed);
    this._exitRawMode();
    if (this._ignoreSignalsBeforeRelease !== null) {
      this._ignoreSignals = this._ignoreSignalsBeforeRelease;
      this._ignoreSignalsBeforeRelease = null;
    }
    this._terminalReleased = false;
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Polyfill for Promise.withResolvers (Node 22+) */
function withResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}


function detectColorProfile(environment: readonly string[]): ColorProfile {
  const env = new EnvMsg(environment);
  if (env.lookupEnv('NO_COLOR')[1] || env.getenv('TERM') === 'dumb') return ColorProfile.Ascii;
  const colorTerm = env.getenv('COLORTERM').toLowerCase();
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return ColorProfile.TrueColor;
  if (env.getenv('TERM').includes('256color')) return ColorProfile.ANSI256;
  return ColorProfile.ANSI;
}
interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function shouldQuerySynchronizedOutput(environment: readonly string[]): boolean {
  const env = new EnvMsg(environment);
  const term = env.getenv('TERM').toLowerCase();
  const [termProgram, hasTermProgram] = env.lookupEnv('TERM_PROGRAM');
  const hasSshTty = env.lookupEnv('SSH_TTY')[1];
  const hasWindowsTerminal = env.lookupEnv('WT_SESSION')[1];
  return (
    (!hasTermProgram && !hasSshTty) ||
    hasWindowsTerminal ||
    (hasTermProgram && !termProgram.includes('Apple') && !hasSshTty) ||
    ['ghostty', 'wezterm', 'alacritty', 'kitty', 'rio'].some((name) => term.includes(name))
  );
}
