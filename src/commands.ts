import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * Commands — convenience functions for creating Cmds.
 * Ports Go bubbletea's commands.go.
 */

import {
  type Cmd,
  type Msg,
  type ExecCallback,
  type ExecCommand,
  QuitMsg,
  InterruptMsg,
  SuspendMsg,
  ClearScreenMsg,
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
  BatchMsg,
  SequenceMsg,
  PrintLineMsg,
  RawMsg,
} from './types.js';

// ─── Quit / Interrupt / Suspend ─────────────────────────────────────────────

/** A command that tells the program to quit. */
export function Quit(): Msg {
  return new QuitMsg();
}

/** A command that tells the program it was interrupted. */
export function Interrupt(): Msg {
  return new InterruptMsg();
}

/** A command that tells the program to suspend. */
export function Suspend(): Msg {
  return new SuspendMsg();
}

// ─── ClearScreen ────────────────────────────────────────────────────────────

/** A command that clears the screen. */
export function ClearScreen(): Msg {
  return new ClearScreenMsg();
}

/** A command that asks Program to query the current terminal size. */
export function RequestWindowSize(): Msg {
  return new WindowSizeRequestMsg();
}

// ─── Batch ──────────────────────────────────────────────────────────────────

/**
 * Batch performs a bunch of commands concurrently with no ordering guarantees.
 * Nil commands are filtered out.
 */
export function Batch(...cmds: Cmd[]): Cmd {
  return compactCmds(cmds, 'batch');
}

/**
 * Sequence runs the given commands one at a time, in order.
 */
export function Sequence(...cmds: Cmd[]): Cmd {
  return compactCmds(cmds, 'sequence');
}

function compactCmds(cmds: Cmd[], type: 'batch' | 'sequence'): Cmd {
  const valid = cmds.filter((c): c is NonNullable<Cmd> => c != null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  if (type === 'batch') {
    return () => new BatchMsg(valid);
  } else {
    return () => new SequenceMsg(valid);
  }
}

// ─── Tick / Every ───────────────────────────────────────────────────────────

/**
 * Tick produces a command after the given duration (ms).
 * The callback receives the timestamp when the tick fired.
 */
export function Tick(durationMs: number, fn: (t: Date) => Msg): Cmd {
  return async () => fn(await waitForTimer(durationMs));
}

/**
 * Every ticks in sync with the system clock at the given interval.
 * For example, Every(1000, ...) will tick at the start of each second.
 */
export function Every(durationMs: number, fn: (t: Date) => Msg): Cmd {
  return async () => {
    const now = Date.now();
    const remainder = durationMs > 0 ? now % durationMs : 0;
    const delay = durationMs > 0 ? durationMs - remainder : 0;
    return fn(await waitForTimer(delay));
  };
}

function waitForTimer(durationMs: number): Promise<Date> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(new Date()), Math.max(0, durationMs));
  });
}

// ─── Println / Printf ──────────────────────────────────────────────────────

/**
 * Println prints above the Program. This output is unmanaged and persists
 * across renders.
 */
export function Println(...args: unknown[]): Cmd {
  return () => new PrintLineMsg(formatSprint(args));
}

/**
 * Printf prints a formatted string above the Program.
 */
export function Printf(template: string, ...args: unknown[]): Cmd {
  let index = 0;
  const body = template.replace(
    /%([+#0\- ]*)(\d+)?(?:\.(\d+))?([vTtbcdoOxXUeEfFgGsqx%])/g,
    (token, flags: string, widthText: string, precisionText: string, verb: string) => {
      if (verb === '%') return '%';
      if (index >= args.length) return token;
      const precision = precisionText === undefined ? undefined : Number(precisionText);
      const formatted = formatPrintValue(args[index++], verb, precision, flags);
      return padPrintValue(formatted, Number(widthText || 0), flags);
    },
  );
  return () => new PrintLineMsg(body);
}

// ─── Raw ────────────────────────────────────────────────────────────────────

/**
 * Raw sends a value directly to the terminal after string coercion.
 */
export function Raw(value: unknown): Cmd {
  return () => new RawMsg(value);
}

// ─── Terminal queries and clipboard ─────────────────────────────────────────

/**
 * Requests the cursor position, reported as a CursorPositionMsg.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function RequestCursorPosition(): Msg {
  return new CursorPositionRequestMsg();
}

/**
 * Requests the terminal background color.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function RequestBackgroundColor(): Msg {
  return new BackgroundColorRequestMsg();
}

/**
 * Requests the terminal foreground color.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function RequestForegroundColor(): Msg {
  return new ForegroundColorRequestMsg();
}

/**
 * Requests the terminal cursor color.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function RequestCursorColor(): Msg {
  return new CursorColorRequestMsg();
}

export function SetClipboard(content: string): Cmd {
  return () => new ClipboardSetRequestMsg('c', content);
}

/**
 * Reads the system clipboard using OSC52. Not supported in all terminals.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function ReadClipboard(): Msg {
  return new ClipboardReadRequestMsg('c');
}

export function SetPrimaryClipboard(content: string): Cmd {
  return () => new ClipboardSetRequestMsg('p', content);
}

/**
 * Reads the primary (X11/Wayland) clipboard using OSC52.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function ReadPrimaryClipboard(): Msg {
  return new ClipboardReadRequestMsg('p');
}

/**
 * Requests the terminal's Termcap/Terminfo response for a capability.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function RequestCapability(capability: string): Cmd {
  return () => new CapabilityRequestMsg(capability);
}

/**
 * Queries the terminal version using XTVERSION.
 * Use WithInput to enable input, since the reply cannot be read otherwise.
 */
export function RequestTerminalVersion(): Msg {
  return new TerminalVersionRequestMsg();
}

// ─── Blocking terminal commands ─────────────────────────────────────────────

export function Exec(command: ExecCommand, callback: ExecCallback | null = null): Cmd {
  return () => new ExecRequestMsg(command, callback);
}

/**
 * Node/Bun adaptation of Go's ExecProcess. The process is created only after
 * Bubble Tea releases the terminal, so it can safely inherit the TUI streams.
 */
export function ExecProcess(
  command: string,
  argsOrCallback: readonly string[] | ExecCallback | null = [],
  callback: ExecCallback | null = null,
): Cmd {
  const args = typeof argsOrCallback === 'function' || argsOrCallback === null ? [] : argsOrCallback;
  const done = typeof argsOrCallback === 'function' ? argsOrCallback : callback;
  return Exec(new SpawnExecCommand(command, args), done);
}

class SpawnExecCommand implements ExecCommand {
  private input: Readable | NodeJS.ReadStream | null = null;
  private output: Writable | NodeJS.WriteStream | null = null;
  private error: Writable | NodeJS.WriteStream | null = null;
  private child: ChildProcess | null = null;

  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
  ) {}

  setStdin(input: Readable | NodeJS.ReadStream | null): void {
    this.input = input;
  }

  setStdout(output: Writable | NodeJS.WriteStream): void {
    this.output = output;
  }

  setStderr(output: Writable | NodeJS.WriteStream): void {
    this.error = output;
  }

  async run(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const inputFd = fileDescriptor(this.input);
      const outputFd = fileDescriptor(this.output);
      const errorFd = fileDescriptor(this.error);
      const child = spawn(this.command, [...this.args], {
        stdio: [inputFd ?? 'pipe', outputFd ?? 'pipe', errorFd ?? 'pipe'],
      });
      this.child = child;

      if (child.stdin) {
        if (this.input) this.input.pipe(child.stdin);
        else child.stdin.end();
      }
      if (child.stdout && this.output) child.stdout.pipe(this.output, { end: false });
      if (child.stderr && this.error) child.stderr.pipe(this.error, { end: false });

      child.once('error', (error) => {
        this.child = null;
        reject(error);
      });
      child.once('exit', (code, signal) => {
        this.child = null;
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            signal
              ? `${this.command} terminated by ${signal}`
              : `${this.command} exited with status ${code ?? 'unknown'}`,
          ),
        );
      });
    });
  }

  cancel(): void {
    this.child?.kill('SIGTERM');
  }
}

function fileDescriptor(stream: object | null): number | undefined {
  if (stream && 'fd' in stream && typeof stream.fd === 'number') return stream.fd;
  return undefined;
}

function formatPrintValue(
  value: unknown,
  verb: string,
  precision: number | undefined,
  flags: string,
): string {
  const number = Number(value);
  let formatted: string;
  switch (verb) {
    case 'T':
      formatted = value === null
        ? '<nil>'
        : typeof value === 'object'
          ? value.constructor?.name ?? 'object'
          : typeof value;
      break;
    case 't':
      formatted = String(Boolean(value));
      break;
    case 'b':
    case 'o':
    case 'O':
    case 'x':
    case 'X': {
      const radix = verb === 'b' ? 2 : verb === 'o' || verb === 'O' ? 8 : 16;
      formatted = typeof value === 'string' && (verb === 'x' || verb === 'X')
        ? Buffer.from(value).toString('hex')
        : Math.trunc(number).toString(radix);
      if (verb === 'X') formatted = formatted.toUpperCase();
      if (verb === 'O' || flags.includes('#')) {
        const prefix = radix === 2 ? '0b' : radix === 8 ? '0o' : verb === 'X' ? '0X' : '0x';
        formatted = prefix + formatted;
      }
      break;
    }
    case 'c':
      formatted = String.fromCodePoint(Math.trunc(number));
      break;
    case 'd':
      formatted = Math.trunc(number).toString(10);
      break;
    case 'U': {
      const codepoint = Math.trunc(number);
      formatted = `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
      if (flags.includes('#')) formatted += ` '${String.fromCodePoint(codepoint)}'`;
      break;
    }
    case 'e':
    case 'E':
      formatted = number.toExponential(precision ?? 6);
      if (verb === 'E') formatted = formatted.toUpperCase();
      break;
    case 'f':
    case 'F':
      formatted = number.toFixed(precision ?? 6);
      break;
    case 'g':
    case 'G':
      formatted = precision === undefined ? String(number) : number.toPrecision(precision);
      if (verb === 'G') formatted = formatted.toUpperCase();
      break;
    case 'q':
      formatted = JSON.stringify(String(value)) ?? '""';
      break;
    case 's':
      formatted = String(value);
      if (precision !== undefined) formatted = Array.from(formatted).slice(0, precision).join('');
      break;
    default:
      formatted = flags.includes('#') && typeof value === 'object'
        ? JSON.stringify(value) ?? String(value)
        : String(value);
      break;
  }
  if (number >= 0 && 'bdoOxXeEfFgG'.includes(verb)) {
    if (flags.includes('+')) formatted = `+${formatted}`;
    else if (flags.includes(' ')) formatted = ` ${formatted}`;
  }
  return formatted;
}

function padPrintValue(value: string, width: number, flags: string): string {
  const padding = Math.max(0, width - Array.from(value).length);
  if (padding === 0) return value;
  const fill = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
  if (flags.includes('-')) return value + fill.repeat(padding);
  if (fill === '0' && /^[+-]/.test(value)) {
    return value[0] + fill.repeat(padding) + value.slice(1);
  }
  return fill.repeat(padding) + value;
}

function formatSprint(args: readonly unknown[]): string {
  let result = '';
  let previousWasString = false;
  for (const arg of args) {
    const currentWasString = typeof arg === 'string';
    if (result && !previousWasString && !currentWasString) result += ' ';
    result += String(arg);
    previousWasString = currentWasString;
  }
  return result;
}
