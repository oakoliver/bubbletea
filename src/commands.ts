/**
 * Commands — convenience functions for creating Cmds.
 * Ports Go bubbletea's commands.go.
 */

import {
  type Cmd,
  type Msg,
  QuitMsg,
  InterruptMsg,
  SuspendMsg,
  ClearScreenMsg,
  WindowSizeMsg,
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

/** A command that requests the current window size. */
export function RequestWindowSize(): Msg {
  return new WindowSizeMsg(0, 0); // placeholder, Program will handle
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
  return () =>
    new Promise<Msg>((resolve) => {
      setTimeout(() => {
        resolve(fn(new Date()));
      }, durationMs);
    });
}

/**
 * Every ticks in sync with the system clock at the given interval.
 * For example, Every(1000, ...) will tick at the start of each second.
 */
export function Every(durationMs: number, fn: (t: Date) => Msg): Cmd {
  const now = Date.now();
  const next = Math.ceil(now / durationMs) * durationMs;
  const delay = next - now;

  return () =>
    new Promise<Msg>((resolve) => {
      setTimeout(() => {
        resolve(fn(new Date()));
      }, delay);
    });
}

// ─── Println / Printf ──────────────────────────────────────────────────────

/**
 * Println prints above the Program. This output is unmanaged and persists
 * across renders.
 */
export function Println(...args: unknown[]): Cmd {
  return () => new PrintLineMsg(args.map(String).join(' '));
}

/**
 * Printf prints a formatted string above the Program.
 */
export function Printf(template: string, ...args: unknown[]): Cmd {
  // Simple sprintf-style replacement
  let i = 0;
  const body = template.replace(/%[sdvf]/g, () => {
    if (i < args.length) return String(args[i++]);
    return '';
  });
  return () => new PrintLineMsg(body);
}

// ─── Raw ────────────────────────────────────────────────────────────────────

/**
 * Raw sends an escape sequence directly to the terminal.
 */
export function Raw(seq: string): Cmd {
  return () => new RawMsg(seq);
}
