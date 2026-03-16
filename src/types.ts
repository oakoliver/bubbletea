/**
 * @oakoliver/bubbletea — Core types and message definitions
 *
 * Zero-dependency TypeScript port of Charmbracelet's Bubbletea.
 * Implements the Elm Architecture for terminal UIs.
 */

// ─── Msg ────────────────────────────────────────────────────────────────────

/**
 * Msg is any value returned from a Cmd. Messages trigger the Update function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = any;

// ─── Cmd ────────────────────────────────────────────────────────────────────

/**
 * Cmd is an I/O operation that returns a message when complete.
 * If null/undefined, it's considered a no-op.
 */
export type Cmd = (() => Msg | Promise<Msg>) | null | undefined;

// ─── Model ──────────────────────────────────────────────────────────────────

/**
 * Model contains the program's state and its core functions.
 */
export interface Model {
  /** Called once when the program starts. Return an optional initial command. */
  init(): Cmd;

  /** Called when a message is received. Returns updated model and optional command. */
  update(msg: Msg): [Model, Cmd];

  /** Renders the program's UI as a string. Called after every update. */
  view(): string;
}

// ─── Special Messages ───────────────────────────────────────────────────────

/** Signals that the program should quit. */
export class QuitMsg {
  readonly _tag = 'QuitMsg' as const;
}

/** Signals that the program should suspend (ctrl+z). */
export class SuspendMsg {
  readonly _tag = 'SuspendMsg' as const;
}

/** Sent when a program resumes from suspension. */
export class ResumeMsg {
  readonly _tag = 'ResumeMsg' as const;
}

/** Signals the program was interrupted (ctrl+c). */
export class InterruptMsg {
  readonly _tag = 'InterruptMsg' as const;
}

/** Reports the terminal window size. */
export class WindowSizeMsg {
  readonly _tag = 'WindowSizeMsg' as const;
  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}
}

/** Signals to clear the screen. */
export class ClearScreenMsg {
  readonly _tag = 'ClearScreenMsg' as const;
}

/** Focus gained message. */
export class FocusMsg {
  readonly _tag = 'FocusMsg' as const;
}

/** Focus lost message. */
export class BlurMsg {
  readonly _tag = 'BlurMsg' as const;
}

/** Bracketed paste content. */
export class PasteMsg {
  readonly _tag = 'PasteMsg' as const;
  constructor(public readonly content: string) {}
  toString(): string {
    return this.content;
  }
}

/** Paste start marker. */
export class PasteStartMsg {
  readonly _tag = 'PasteStartMsg' as const;
}

/** Paste end marker. */
export class PasteEndMsg {
  readonly _tag = 'PasteEndMsg' as const;
}

/** Raw escape sequence to write to terminal. */
export class RawMsg {
  readonly _tag = 'RawMsg' as const;
  constructor(public readonly data: string) {}
}

/** Print line above the managed area. */
export class PrintLineMsg {
  readonly _tag = 'PrintLineMsg' as const;
  constructor(public readonly body: string) {}
}

// ─── Batch & Sequence Messages ──────────────────────────────────────────────

/**
 * BatchMsg runs multiple commands concurrently.
 * Returned from Batch().
 */
export class BatchMsg {
  readonly _tag = 'BatchMsg' as const;
  constructor(public readonly cmds: Cmd[]) {}
}

/**
 * SequenceMsg runs commands one at a time in order.
 * Returned from Sequence().
 */
export class SequenceMsg {
  readonly _tag = 'SequenceMsg' as const;
  constructor(public readonly cmds: Cmd[]) {}
}

// ─── Key Types ──────────────────────────────────────────────────────────────

/** Modifier keys bitmask. */
export const enum KeyMod {
  None = 0,
  Shift = 1 << 0,
  Alt = 1 << 1,
  Ctrl = 1 << 2,
  Meta = 1 << 3,
}

/** Special key codes. */
export const enum KeyCode {
  // Control characters
  Backspace = 0x08,
  Tab = 0x09,
  Enter = 0x0d,
  Escape = 0x1b,
  Space = 0x20,
  Delete = 0x7f,

  // Navigation
  Up = 0x100,
  Down,
  Right,
  Left,
  Home,
  End,
  PgUp,
  PgDown,
  Insert,

  // Function keys
  F1 = 0x200,
  F2,
  F3,
  F4,
  F5,
  F6,
  F7,
  F8,
  F9,
  F10,
  F11,
  F12,
  F13,
  F14,
  F15,
  F16,
  F17,
  F18,
  F19,
  F20,
}

/** Represents a key event. */
export interface Key {
  /** The text content of the key (printable characters). Empty for special keys. */
  text: string;
  /** Modifier keys. */
  mod: KeyMod;
  /** Key code — either a special KeyCode or a character code point. */
  code: number;
  /** Whether this is a key repeat. */
  isRepeat?: boolean;
}

/** Key press message. */
export class KeyPressMsg implements Key {
  readonly _tag = 'KeyPressMsg' as const;
  text: string;
  mod: KeyMod;
  code: number;
  isRepeat?: boolean;

  constructor(key: Key) {
    this.text = key.text;
    this.mod = key.mod;
    this.code = key.code;
    this.isRepeat = key.isRepeat;
  }

  /** Returns a human-readable string representation like "ctrl+c", "enter", "a". */
  toString(): string {
    return formatKey(this);
  }
}

/** Key release message. */
export class KeyReleaseMsg implements Key {
  readonly _tag = 'KeyReleaseMsg' as const;
  text: string;
  mod: KeyMod;
  code: number;
  isRepeat?: boolean;

  constructor(key: Key) {
    this.text = key.text;
    this.mod = key.mod;
    this.code = key.code;
    this.isRepeat = key.isRepeat;
  }

  toString(): string {
    return formatKey(this);
  }
}

// ─── Mouse Types ────────────────────────────────────────────────────────────

/** Mouse buttons. */
export const enum MouseButton {
  None = 0,
  Left = 1,
  Middle = 2,
  Right = 3,
  WheelUp = 4,
  WheelDown = 5,
  WheelLeft = 6,
  WheelRight = 7,
  Backward = 8,
  Forward = 9,
}

/** Mouse event data. */
export interface Mouse {
  x: number;
  y: number;
  button: MouseButton;
  mod: KeyMod;
}

/** Mouse click message. */
export class MouseClickMsg implements Mouse {
  readonly _tag = 'MouseClickMsg' as const;
  x: number;
  y: number;
  button: MouseButton;
  mod: KeyMod;

  constructor(m: Mouse) {
    this.x = m.x;
    this.y = m.y;
    this.button = m.button;
    this.mod = m.mod;
  }

  toString(): string {
    return formatMouse(this);
  }
}

/** Mouse release message. */
export class MouseReleaseMsg implements Mouse {
  readonly _tag = 'MouseReleaseMsg' as const;
  x: number;
  y: number;
  button: MouseButton;
  mod: KeyMod;

  constructor(m: Mouse) {
    this.x = m.x;
    this.y = m.y;
    this.button = m.button;
    this.mod = m.mod;
  }

  toString(): string {
    return formatMouse(this);
  }
}

/** Mouse wheel message. */
export class MouseWheelMsg implements Mouse {
  readonly _tag = 'MouseWheelMsg' as const;
  x: number;
  y: number;
  button: MouseButton;
  mod: KeyMod;

  constructor(m: Mouse) {
    this.x = m.x;
    this.y = m.y;
    this.button = m.button;
    this.mod = m.mod;
  }

  toString(): string {
    return formatMouse(this);
  }
}

/** Mouse motion message. */
export class MouseMotionMsg implements Mouse {
  readonly _tag = 'MouseMotionMsg' as const;
  x: number;
  y: number;
  button: MouseButton;
  mod: KeyMod;

  constructor(m: Mouse) {
    this.x = m.x;
    this.y = m.y;
    this.button = m.button;
    this.mod = m.mod;
  }

  toString(): string {
    const base = formatMouse(this);
    return this.button !== MouseButton.None ? base + '+motion' : base + 'motion';
  }
}

// ─── Cursor Types ───────────────────────────────────────────────────────────

/** Cursor shapes. */
export const enum CursorShape {
  Block = 0,
  Underline = 1,
  Bar = 2,
}

/** Cursor position report message. */
export class CursorPositionMsg {
  readonly _tag = 'CursorPositionMsg' as const;
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

// ─── Mouse Mode ─────────────────────────────────────────────────────────────

export const enum MouseMode {
  None = 0,
  CellMotion = 1,
  AllMotion = 2,
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ProgramError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ProgramError';
  }
}

export const ErrProgramKilled = new ProgramError('program was killed');
export const ErrProgramPanic = new ProgramError('program experienced a panic');
export const ErrInterrupted = new ProgramError('program was interrupted');

// ─── Helper Functions ───────────────────────────────────────────────────────

const specialKeyNames: Record<number, string> = {
  [KeyCode.Backspace]: 'backspace',
  [KeyCode.Tab]: 'tab',
  [KeyCode.Enter]: 'enter',
  [KeyCode.Escape]: 'esc',
  [KeyCode.Space]: 'space',
  [KeyCode.Delete]: 'delete',
  [KeyCode.Up]: 'up',
  [KeyCode.Down]: 'down',
  [KeyCode.Right]: 'right',
  [KeyCode.Left]: 'left',
  [KeyCode.Home]: 'home',
  [KeyCode.End]: 'end',
  [KeyCode.PgUp]: 'pgup',
  [KeyCode.PgDown]: 'pgdown',
  [KeyCode.Insert]: 'insert',
  [KeyCode.F1]: 'f1',
  [KeyCode.F2]: 'f2',
  [KeyCode.F3]: 'f3',
  [KeyCode.F4]: 'f4',
  [KeyCode.F5]: 'f5',
  [KeyCode.F6]: 'f6',
  [KeyCode.F7]: 'f7',
  [KeyCode.F8]: 'f8',
  [KeyCode.F9]: 'f9',
  [KeyCode.F10]: 'f10',
  [KeyCode.F11]: 'f11',
  [KeyCode.F12]: 'f12',
  [KeyCode.F13]: 'f13',
  [KeyCode.F14]: 'f14',
  [KeyCode.F15]: 'f15',
  [KeyCode.F16]: 'f16',
  [KeyCode.F17]: 'f17',
  [KeyCode.F18]: 'f18',
  [KeyCode.F19]: 'f19',
  [KeyCode.F20]: 'f20',
};

/**
 * Format a key event into a human-readable string.
 * Matches Go bubbletea's Key.String() output.
 */
export function formatKey(key: Key): string {
  // If there's printable text and no modifiers beyond shift, use it directly
  if (key.text && !(key.mod & ~KeyMod.Shift)) {
    return key.text;
  }

  const parts: string[] = [];
  if (key.mod & KeyMod.Ctrl) parts.push('ctrl');
  if (key.mod & KeyMod.Alt) parts.push('alt');
  if (key.mod & KeyMod.Shift) parts.push('shift');
  if (key.mod & KeyMod.Meta) parts.push('meta');

  // Special key name
  const name = specialKeyNames[key.code];
  if (name) {
    parts.push(name);
  } else if (key.text) {
    parts.push(key.text);
  } else if (key.code >= 0x20 && key.code < 0x7f) {
    // Printable ASCII
    parts.push(String.fromCharCode(key.code));
  } else if (key.code >= 1 && key.code <= 26) {
    // Ctrl+letter (C0 control codes)
    parts.push(String.fromCharCode(key.code + 0x60)); // 'a' = 0x61
  } else {
    parts.push(`<${key.code.toString(16)}>`);
  }

  return parts.join('+');
}

const mouseButtonNames: Record<number, string> = {
  [MouseButton.None]: '',
  [MouseButton.Left]: 'left',
  [MouseButton.Middle]: 'middle',
  [MouseButton.Right]: 'right',
  [MouseButton.WheelUp]: 'wheelup',
  [MouseButton.WheelDown]: 'wheeldown',
  [MouseButton.WheelLeft]: 'wheelleft',
  [MouseButton.WheelRight]: 'wheelright',
  [MouseButton.Backward]: 'backward',
  [MouseButton.Forward]: 'forward',
};

function formatMouse(m: Mouse): string {
  const parts: string[] = [];
  if (m.mod & KeyMod.Ctrl) parts.push('ctrl');
  if (m.mod & KeyMod.Alt) parts.push('alt');
  if (m.mod & KeyMod.Shift) parts.push('shift');

  const btn = mouseButtonNames[m.button] || '';
  if (btn) parts.push(btn);

  return parts.join('+') || 'mouse';
}
