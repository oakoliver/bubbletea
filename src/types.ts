import type { Readable, Writable } from 'node:stream';

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

  /** Renders the program's UI. String views remain supported for source compatibility. */
  view(): string | View;
}

// ─── Views ──────────────────────────────────────────────────────────────────

/** A color accepted by terminal view controls. */
export type TerminalColor =
  | string
  | { readonly r: number; readonly g: number; readonly b: number; readonly a?: number };

/** Position relative to the upper-left corner of the rendered frame. */
export interface Position {
  x: number;
  y: number;
}

/** Requested Kitty keyboard protocol features. */
export interface KeyboardEnhancements {
  reportEventTypes?: boolean;
  reportAlternateKeys?: boolean;
  reportAllKeysAsEscapeCodes?: boolean;
  reportAssociatedText?: boolean;
}

/** Windows Terminal progress indicator states. */
export enum ProgressBarState {
  None = 0,
  Default = 1,
  Error = 2,
  Indeterminate = 3,
  Warning = 4,
}

/** Human-readable upstream names for progress bar states. */
export function formatProgressBarState(state: ProgressBarState): string {
  return ['None', 'Default', 'Error', 'Indeterminate', 'Warning'][state] ?? 'Unknown';
}

/** Terminal progress indicator. Values are clamped to the range 0–100. */
export class ProgressBar {
  readonly state: ProgressBarState;
  readonly value: number;

  constructor(state: ProgressBarState, value: number) {
    this.state = state;
    this.value = Math.min(100, Math.max(0, Math.trunc(value)));
  }
}

export function NewProgressBar(state: ProgressBarState, value: number): ProgressBar {
  return new ProgressBar(state, value);
}

/** Cursor rendered on top of the view. */
export class Cursor implements Position {
  color: TerminalColor | null = null;
  shape = CursorShape.Block;
  blink = true;

  constructor(
    public x: number,
    public y: number,
  ) {}
}

export function NewCursor(x: number, y: number): Cursor {
  return new Cursor(x, y);
}

/** Complete render state. A plain string returned by Model.view() is still accepted. */
export class View {
  content: string;
  onMouse: ((msg: MouseMsg) => Cmd) | null = null;
  cursor: Cursor | null = null;
  backgroundColor: TerminalColor | null = null;
  foregroundColor: TerminalColor | null = null;
  windowTitle = '';
  progressBar: ProgressBar | null = null;
  altScreen = false;
  reportFocus = false;
  disableBracketedPasteMode = false;
  mouseMode = MouseMode.None;
  keyboardEnhancements: KeyboardEnhancements = {};

  constructor(content = '') {
    this.content = content;
  }

  setContent(content: string): this {
    this.content = content;
    return this;
  }

  clone(): View {
    const view = new View(this.content);
    view.onMouse = this.onMouse;
    view.cursor = this.cursor
      ? Object.assign(new Cursor(this.cursor.x, this.cursor.y), {
          color: this.cursor.color,
          shape: this.cursor.shape,
          blink: this.cursor.blink,
        })
      : null;
    view.backgroundColor = this.backgroundColor;
    view.foregroundColor = this.foregroundColor;
    view.windowTitle = this.windowTitle;
    view.progressBar = this.progressBar
      ? new ProgressBar(this.progressBar.state, this.progressBar.value)
      : null;
    view.altScreen = this.altScreen;
    view.reportFocus = this.reportFocus;
    view.disableBracketedPasteMode = this.disableBracketedPasteMode;
    view.mouseMode = this.mouseMode;
    view.keyboardEnhancements = { ...this.keyboardEnhancements };
    return view;
  }
}

export function NewView(content: string): View {
  return new View(content);
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

/** Raw value to write to the terminal without intermediate processing. */
export class RawMsg {
  readonly _tag = 'RawMsg' as const;
  constructor(public readonly data: unknown) {}

  /** Upstream-compatible name for the raw value. */
  get msg(): unknown {
    return this.data;
  }
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
export enum KeyMod {
  None = 0,
  Shift = 1 << 0,
  Alt = 1 << 1,
  Ctrl = 1 << 2,
  Meta = 1 << 3,
  Hyper = 1 << 4,
  Super = 1 << 5,
  CapsLock = 1 << 6,
  NumLock = 1 << 7,
  ScrollLock = 1 << 8,
}

/** Special key codes. */
export enum KeyCode {
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

/** Upstream key aliases not present in the original TypeScript surface. */
export const KeyExtended = 0x110000;
export const KeyReturn = KeyCode.Enter;
export const KeyEsc = KeyCode.Escape;

/** Additional key codes from Bubble Tea's Kitty keyboard protocol surface. */
export enum ExtendedKeyCode {
  Begin = KeyExtended + 5,
  Find,
  Select = KeyExtended + 9,
  KpEnter = KeyExtended + 14,
  KpEqual,
  KpMultiply,
  KpPlus,
  KpComma,
  KpMinus,
  KpDecimal,
  KpDivide,
  Kp0,
  Kp1,
  Kp2,
  Kp3,
  Kp4,
  Kp5,
  Kp6,
  Kp7,
  Kp8,
  Kp9,
  KpSeparator,
  KpUp,
  KpDown,
  KpLeft,
  KpRight,
  KpPgUp,
  KpPgDown,
  KpHome,
  KpEnd,
  KpInsert,
  KpDelete,
  KpBegin,
  F21 = KeyExtended + 64,
  F22,
  F23,
  F24,
  F25,
  F26,
  F27,
  F28,
  F29,
  F30,
  F31,
  F32,
  F33,
  F34,
  F35,
  F36,
  F37,
  F38,
  F39,
  F40,
  F41,
  F42,
  F43,
  F44,
  F45,
  F46,
  F47,
  F48,
  F49,
  F50,
  F51,
  F52,
  F53,
  F54,
  F55,
  F56,
  F57,
  F58,
  F59,
  F60,
  F61,
  F62,
  F63,
  CapsLock,
  ScrollLock,
  NumLock,
  PrintScreen,
  Pause,
  Menu,
  MediaPlay,
  MediaPause,
  MediaPlayPause,
  MediaReverse,
  MediaStop,
  MediaFastForward,
  MediaRewind,
  MediaNext,
  MediaPrevious,
  MediaRecord,
  LowerVolume,
  RaiseVolume,
  Mute,
  LeftShift,
  LeftAlt,
  LeftCtrl,
  LeftSuper,
  LeftHyper,
  LeftMeta,
  RightShift,
  RightAlt,
  RightCtrl,
  RightSuper,
  RightHyper,
  RightMeta,
  IsoLevel3Shift,
  IsoLevel5Shift,
}

/** Represents a key event. */
export interface Key {
  /** Printable text associated with the key, or empty for special keys. */
  text: string;
  mod: KeyMod;
  code: number;
  shiftedCode?: number;
  baseCode?: number;
  isRepeat?: boolean;
}

/** Key press message. */
export class KeyPressMsg implements Key {
  readonly _tag = 'KeyPressMsg' as const;
  text: string;
  mod: KeyMod;
  code: number;
  shiftedCode?: number;
  baseCode?: number;
  isRepeat?: boolean;

  constructor(key: Key) {
    this.text = key.text;
    this.mod = key.mod;
    this.code = key.code;
    this.shiftedCode = key.shiftedCode;
    this.baseCode = key.baseCode;
    this.isRepeat = key.isRepeat;
  }

  /** Returns a human-readable string representation like "ctrl+c", "enter", "a". */
  toString(): string {
    return formatKey(this);
  }

  /** Keystroke form always includes modifiers, even when printable text exists. */
  keystroke(): string {
    return formatKeystroke(this);
  }

  /** Returns a copy of the underlying key event. */
  key(): Key {
    return { ...this };
  }
}

/** Key release message. */
export class KeyReleaseMsg implements Key {
  readonly _tag = 'KeyReleaseMsg' as const;
  text: string;
  mod: KeyMod;
  code: number;
  shiftedCode?: number;
  baseCode?: number;
  isRepeat?: boolean;

  constructor(key: Key) {
    this.text = key.text;
    this.mod = key.mod;
    this.code = key.code;
    this.shiftedCode = key.shiftedCode;
    this.baseCode = key.baseCode;
    this.isRepeat = key.isRepeat;
  }

  toString(): string {
    return formatKey(this);
  }

  keystroke(): string {
    return formatKeystroke(this);
  }

  key(): Key {
    return { ...this };
  }
}

/** A key press or release event. */
export interface KeyMsg {
  toString(): string;
  keystroke(): string;
  key(): Key;
}

// ─── Mouse Types ────────────────────────────────────────────────────────────

/** Mouse buttons. */
export enum MouseButton {
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
  Button10 = 10,
  Button11 = 11,
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

  mouse(): Mouse {
    return { x: this.x, y: this.y, button: this.button, mod: this.mod };
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

  mouse(): Mouse {
    return { x: this.x, y: this.y, button: this.button, mod: this.mod };
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

  mouse(): Mouse {
    return { x: this.x, y: this.y, button: this.button, mod: this.mod };
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

  mouse(): Mouse {
    return { x: this.x, y: this.y, button: this.button, mod: this.mod };
  }
}

/** A click, release, wheel, or motion event. */
export interface MouseMsg {
  toString(): string;
  mouse(): Mouse;
}

// ─── Cursor Types ───────────────────────────────────────────────────────────

/** Cursor shapes. */
export enum CursorShape {
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

export enum MouseMode {
  None = 0,
  CellMotion = 1,
  AllMotion = 2,
}

// ─── Terminal Reports & Requests ────────────────────────────────────────────

export enum KittyKeyboardFlag {
  DisambiguateEscapeCodes = 1,
  ReportEventTypes = 2,
  ReportAlternateKeys = 4,
  ReportAllKeysAsEscapeCodes = 8,
  ReportAssociatedText = 16,
}

export class KeyboardEnhancementsMsg {
  readonly _tag = 'KeyboardEnhancementsMsg' as const;
  constructor(public readonly flags: number) {}
  supportsKeyDisambiguation(): boolean {
    return this.flags > 0;
  }
  supportsEventTypes(): boolean {
    return (this.flags & KittyKeyboardFlag.ReportEventTypes) !== 0;
  }
  supportsAlternateKeys(): boolean {
    return (this.flags & KittyKeyboardFlag.ReportAlternateKeys) !== 0;
  }
  supportsAllKeysAsEscapeCodes(): boolean {
    return (this.flags & KittyKeyboardFlag.ReportAllKeysAsEscapeCodes) !== 0;
  }
  supportsAssociatedText(): boolean {
    return (this.flags & KittyKeyboardFlag.ReportAssociatedText) !== 0;
  }
}

export class EnvMsg {
  readonly _tag = 'EnvMsg' as const;
  readonly values: readonly string[];
  private readonly environment: ReadonlyMap<string, string>;

  constructor(values: readonly string[] | Readonly<Record<string, string | undefined>>) {
    this.values = Array.isArray(values)
      ? [...values]
      : Object.entries(values)
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${value}`);
    this.environment = new Map(
      this.values.map((entry): [string, string] => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [entry, '']
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
  }

  getenv(key: string): string {
    return this.environment.get(key) ?? '';
  }
  lookupEnv(key: string): [string, boolean] {
    return this.environment.has(key)
      ? [this.environment.get(key) ?? '', true]
      : ['', false];
  }
}

export enum ColorProfile {
  Ascii = 'ascii',
  ANSI = 'ansi',
  ANSI256 = 'ansi256',
  TrueColor = 'truecolor',
}

export class ColorProfileMsg {
  readonly _tag = 'ColorProfileMsg' as const;
  constructor(public readonly profile: ColorProfile) {}
}

abstract class TerminalColorMsg {
  abstract readonly _tag: string;
  constructor(public readonly color: string) {}
  toString(): string {
    return this.color;
  }
  isDark(): boolean {
    const hex = this.color.match(/^#?([0-9a-f]{6})$/i)?.[1];
    if (!hex) return false;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) < 0.179;
  }
}

export class ForegroundColorMsg extends TerminalColorMsg {
  readonly _tag = 'ForegroundColorMsg' as const;
}
export class BackgroundColorMsg extends TerminalColorMsg {
  readonly _tag = 'BackgroundColorMsg' as const;
}
export class CursorColorMsg extends TerminalColorMsg {
  readonly _tag = 'CursorColorMsg' as const;
}

export class ClipboardMsg {
  readonly _tag = 'ClipboardMsg' as const;
  constructor(
    public readonly content: string,
    public readonly selection: 'c' | 'p' | string = 'c',
  ) {}
  clipboard(): string {
    return this.selection;
  }
  toString(): string {
    return this.content;
  }
}

export class CapabilityMsg {
  readonly _tag = 'CapabilityMsg' as const;
  constructor(public readonly content: string) {}
  toString(): string {
    return this.content;
  }
}

export class TerminalVersionMsg {
  readonly _tag = 'TerminalVersionMsg' as const;
  constructor(public readonly name: string) {}
  toString(): string {
    return this.name;
  }
}

export class ModeSetting {
  static readonly NotRecognized = new ModeSetting(0, 'not-recognized');
  static readonly Set = new ModeSetting(1, 'set');
  static readonly Reset = new ModeSetting(2, 'reset');
  static readonly PermanentlySet = new ModeSetting(3, 'permanently-set');
  static readonly PermanentlyReset = new ModeSetting(4, 'permanently-reset');

  static from(value: number): ModeSetting {
    return [
      ModeSetting.NotRecognized,
      ModeSetting.Set,
      ModeSetting.Reset,
      ModeSetting.PermanentlySet,
      ModeSetting.PermanentlyReset,
    ][value] ?? new ModeSetting(value, 'unknown');
  }

  private constructor(
    public readonly value: number,
    private readonly name: string,
  ) {}
  isNotRecognized(): boolean {
    return this.value === 0;
  }
  toString(): string {
    return this.name;
  }
}

export class ModeReportMsg {
  readonly _tag = 'ModeReportMsg' as const;
  constructor(
    public readonly mode: number,
    public readonly value: ModeSetting,
  ) {}
}

/** Internal request messages are public only so commands remain inspectable. */
export class WindowSizeRequestMsg {
  readonly _tag = 'WindowSizeRequestMsg' as const;
}
export class CursorPositionRequestMsg {
  readonly _tag = 'CursorPositionRequestMsg' as const;
}
export class BackgroundColorRequestMsg {
  readonly _tag = 'BackgroundColorRequestMsg' as const;
}
export class ForegroundColorRequestMsg {
  readonly _tag = 'ForegroundColorRequestMsg' as const;
}
export class CursorColorRequestMsg {
  readonly _tag = 'CursorColorRequestMsg' as const;
}
export class ClipboardReadRequestMsg {
  readonly _tag = 'ClipboardReadRequestMsg' as const;
  constructor(public readonly selection: 'c' | 'p') {}
}
export class ClipboardSetRequestMsg {
  readonly _tag = 'ClipboardSetRequestMsg' as const;
  constructor(
    public readonly selection: 'c' | 'p',
    public readonly content: string,
  ) {}
}
export class CapabilityRequestMsg {
  readonly _tag = 'CapabilityRequestMsg' as const;
  constructor(public readonly capability: string) {}
}
export class TerminalVersionRequestMsg {
  readonly _tag = 'TerminalVersionRequestMsg' as const;
}

/** Blocking command used by Exec. Stream setters are called before run(). */
export interface ExecCommand {
  run(): void | Promise<void>;
  cancel?(): void;
  setStdin(input: Readable | NodeJS.ReadStream | null): void;
  setStdout(output: Writable | NodeJS.WriteStream): void;
  setStderr(output: Writable | NodeJS.WriteStream): void;
}

export type ExecCallback = (error: Error | null) => Msg;

export class ExecRequestMsg {
  readonly _tag = 'ExecRequestMsg' as const;
  constructor(
    public readonly command: ExecCommand,
    public readonly callback: ExecCallback | null,
  ) {}
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
  if (key.text && key.text !== ' ') {
    return key.text;
  }
  return formatKeystroke(key);
}

/** Return the physical keystroke with modifiers in Bubble Tea's stable order. */
export function formatKeystroke(key: Key): string {
  const parts: string[] = [];
  if (key.mod & KeyMod.Ctrl) parts.push('ctrl');
  if (key.mod & KeyMod.Alt) parts.push('alt');
  if (key.mod & KeyMod.Shift) parts.push('shift');
  if (key.mod & KeyMod.Meta) parts.push('meta');
  if (key.mod & KeyMod.Hyper) parts.push('hyper');
  if (key.mod & KeyMod.Super) parts.push('super');

  const code = key.baseCode || key.code;
  let name = specialKeyNames[code] ?? extendedKeyNames[code];
  if (code >= ExtendedKeyCode.F21 && code <= ExtendedKeyCode.F63) {
    name = `f${21 + code - ExtendedKeyCode.F21}`;
  }
  if (name) {
    parts.push(name);
  } else if (code === KeyExtended) {
    parts.push(key.text);
  } else if (code >= 0x20 && code <= 0x10ffff) {
    parts.push(String.fromCodePoint(code));
  } else if (code >= 1 && code <= 26) {
    parts.push(String.fromCharCode(code + 0x60));
  } else {
    parts.push(`<${code.toString(16)}>`);
  }
  return parts.join('+');
}

const extendedKeyNames: Record<number, string> = {
  [ExtendedKeyCode.Begin]: 'begin',
  [ExtendedKeyCode.Find]: 'find',
  [ExtendedKeyCode.Select]: 'select',
  [ExtendedKeyCode.KpEnter]: 'enter',
  [ExtendedKeyCode.KpEqual]: 'equal',
  [ExtendedKeyCode.KpMultiply]: 'mul',
  [ExtendedKeyCode.KpPlus]: 'plus',
  [ExtendedKeyCode.KpComma]: 'comma',
  [ExtendedKeyCode.KpMinus]: 'minus',
  [ExtendedKeyCode.KpDecimal]: 'period',
  [ExtendedKeyCode.KpDivide]: 'div',
  [ExtendedKeyCode.KpSeparator]: 'sep',
  [ExtendedKeyCode.Kp0]: '0',
  [ExtendedKeyCode.Kp1]: '1',
  [ExtendedKeyCode.Kp2]: '2',
  [ExtendedKeyCode.Kp3]: '3',
  [ExtendedKeyCode.Kp4]: '4',
  [ExtendedKeyCode.Kp5]: '5',
  [ExtendedKeyCode.Kp6]: '6',
  [ExtendedKeyCode.Kp7]: '7',
  [ExtendedKeyCode.Kp8]: '8',
  [ExtendedKeyCode.Kp9]: '9',
  [ExtendedKeyCode.KpUp]: 'up',
  [ExtendedKeyCode.KpDown]: 'down',
  [ExtendedKeyCode.KpLeft]: 'left',
  [ExtendedKeyCode.KpRight]: 'right',
  [ExtendedKeyCode.KpPgUp]: 'pgup',
  [ExtendedKeyCode.KpPgDown]: 'pgdown',
  [ExtendedKeyCode.KpHome]: 'home',
  [ExtendedKeyCode.KpEnd]: 'end',
  [ExtendedKeyCode.KpInsert]: 'insert',
  [ExtendedKeyCode.KpDelete]: 'delete',
  [ExtendedKeyCode.KpBegin]: 'begin',
  [ExtendedKeyCode.CapsLock]: 'capslock',
  [ExtendedKeyCode.ScrollLock]: 'scrolllock',
  [ExtendedKeyCode.NumLock]: 'numlock',
  [ExtendedKeyCode.PrintScreen]: 'printscreen',
  [ExtendedKeyCode.Pause]: 'pause',
  [ExtendedKeyCode.Menu]: 'menu',
  [ExtendedKeyCode.MediaPlay]: 'mediaplay',
  [ExtendedKeyCode.MediaPause]: 'mediapause',
  [ExtendedKeyCode.MediaPlayPause]: 'mediaplaypause',
  [ExtendedKeyCode.MediaReverse]: 'mediareverse',
  [ExtendedKeyCode.MediaStop]: 'mediastop',
  [ExtendedKeyCode.MediaFastForward]: 'mediafastforward',
  [ExtendedKeyCode.MediaRewind]: 'mediarewind',
  [ExtendedKeyCode.MediaNext]: 'medianext',
  [ExtendedKeyCode.MediaPrevious]: 'mediaprev',
  [ExtendedKeyCode.MediaRecord]: 'mediarecord',
  [ExtendedKeyCode.LowerVolume]: 'lowervol',
  [ExtendedKeyCode.RaiseVolume]: 'raisevol',
  [ExtendedKeyCode.Mute]: 'mute',
  [ExtendedKeyCode.LeftShift]: 'leftshift',
  [ExtendedKeyCode.LeftAlt]: 'leftalt',
  [ExtendedKeyCode.LeftCtrl]: 'leftctrl',
  [ExtendedKeyCode.LeftSuper]: 'leftsuper',
  [ExtendedKeyCode.LeftHyper]: 'lefthyper',
  [ExtendedKeyCode.LeftMeta]: 'leftmeta',
  [ExtendedKeyCode.RightShift]: 'rightshift',
  [ExtendedKeyCode.RightAlt]: 'rightalt',
  [ExtendedKeyCode.RightCtrl]: 'rightctrl',
  [ExtendedKeyCode.RightSuper]: 'rightsuper',
  [ExtendedKeyCode.RightHyper]: 'righthyper',
  [ExtendedKeyCode.RightMeta]: 'rightmeta',
};

const mouseButtonNames: Record<number, string> = {
  [MouseButton.Left]: 'left',
  [MouseButton.Middle]: 'middle',
  [MouseButton.Right]: 'right',
  [MouseButton.WheelUp]: 'wheelup',
  [MouseButton.WheelDown]: 'wheeldown',
  [MouseButton.WheelLeft]: 'wheelleft',
  [MouseButton.WheelRight]: 'wheelright',
  [MouseButton.Backward]: 'backward',
  [MouseButton.Forward]: 'forward',
  [MouseButton.Button10]: 'button10',
  [MouseButton.Button11]: 'button11',
};

function formatMouse(m: Mouse): string {
  const modifiers: string[] = [];
  if (m.mod & KeyMod.Ctrl) modifiers.push('ctrl');
  if (m.mod & KeyMod.Alt) modifiers.push('alt');
  if (m.mod & KeyMod.Shift) modifiers.push('shift');

  const prefix = modifiers.length > 0 ? `${modifiers.join('+')}+` : '';
  if (m.button === MouseButton.None) return prefix;
  return prefix + (mouseButtonNames[m.button] || 'unknown');
}
