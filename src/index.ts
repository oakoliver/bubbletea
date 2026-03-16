/**
 * @oakoliver/bubbletea — Elm Architecture TUI framework for TypeScript
 *
 * Zero-dependency port of Charmbracelet's Bubbletea (Go).
 * Build rich terminal user interfaces with the Elm Architecture pattern.
 *
 * @module
 */

// ── Types & Messages ────────────────────────────────────────────────────────
export type { Msg, Cmd, Model, Key, Mouse } from './types.js';
export {
  // Special messages
  QuitMsg,
  InterruptMsg,
  SuspendMsg,
  ResumeMsg,
  WindowSizeMsg,
  ClearScreenMsg,
  FocusMsg,
  BlurMsg,
  PasteMsg,
  PasteStartMsg,
  PasteEndMsg,
  RawMsg,
  PrintLineMsg,
  BatchMsg,
  SequenceMsg,

  // Key types
  KeyMod,
  KeyCode,
  KeyPressMsg,
  KeyReleaseMsg,

  // Mouse types
  MouseButton,
  MouseClickMsg,
  MouseReleaseMsg,
  MouseWheelMsg,
  MouseMotionMsg,

  // Cursor types
  CursorShape,
  CursorPositionMsg,

  // Mouse mode
  MouseMode,

  // Errors
  ProgramError,
  ErrProgramKilled,
  ErrProgramPanic,
  ErrInterrupted,

  // Helpers
  formatKey,
} from './types.js';

// ── Commands ────────────────────────────────────────────────────────────────
export {
  Quit,
  Interrupt,
  Suspend,
  ClearScreen,
  RequestWindowSize,
  Batch,
  Sequence,
  Tick,
  Every,
  Println,
  Printf,
  Raw,
} from './commands.js';

// ── ANSI sequences (for advanced use) ───────────────────────────────────────
export * as ansi from './ansi.js';

// ── Input parser (for advanced use) ─────────────────────────────────────────
export { parseInput } from './input.js';

// ── Renderer ────────────────────────────────────────────────────────────────
export type { Renderer } from './renderer.js';
export { NilRenderer, StandardRenderer } from './renderer.js';

// ── Program ─────────────────────────────────────────────────────────────────
export type { ProgramOption } from './program.js';
export {
  Program,
  WithInput,
  WithOutput,
  WithFilter,
  WithFPS,
  WithoutRenderer,
  WithoutSignalHandler,
  WithoutCatchPanics,
  WithWindowSize,
  WithAbortSignal,
  WithMouseMode,
  WithAltScreen,
} from './program.js';
