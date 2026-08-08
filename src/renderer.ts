/**
 * Renderer — manages terminal output, diffing, and redrawing.
 * Ports Go bubbletea's renderer interface and cursed renderer.
 */

import * as ansi from './ansi.js';
import {
  type Cmd,
  type MouseMsg,
  type TerminalColor,
  KittyKeyboardFlag,
  MouseMode,
  ProgressBarState,
  View,
} from './types.js';

/**
 * Renderer interface for Bubble Tea.
 */
export interface Renderer {
  start(): void;
  close(): void;
  render(view: string | View): void;
  flush(closing: boolean): void;
  reset(): void;
  insertAbove(s: string): void;
  resize(width: number, height: number): void;
  clearScreen(): void;
  repaint(): void;
  onMouse?(msg: MouseMsg): Cmd;
  setSynchronizedOutput?(enabled: boolean): void;
}

/**
 * A no-op renderer for headless/daemon programs.
 */
export class NilRenderer implements Renderer {
  start(): void {}
  close(): void {}
  render(_view: string | View): void {}
  flush(_closing: boolean): void {}
  reset(): void {}
  insertAbove(_s: string): void {}
  resize(_w: number, _h: number): void {}
  clearScreen(): void {}
  repaint(): void {}
  onMouse(_msg: MouseMsg): Cmd {
    return null;
  }
  setSynchronizedOutput(_enabled: boolean): void {}
}

/**
 * StandardRenderer — the main renderer that diffs frames and updates the terminal.
 * Writes only changed lines using cursor movement to minimize flicker.
 */
export class StandardRenderer implements Renderer {
  private output: NodeJS.WritableStream;
  private width = 80;
  private height = 24;

  private lastFrame = '';
  private lastLines: string[] = [];
  private currentFrame = '';
  private currentView = new View();
  private lastView: View | null = null;
  private dirty = false;
  private altScreen = false;
  private started = false;
  private linesRendered = 0;
  private useAltScreen = false;
  private synchronizedOutput = false;
  constructor(output: NodeJS.WritableStream, width: number, height: number) {
    this.output = output;
    this.width = width;
    this.height = height;
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    if (!this.started) return;
    const view = this.lastView;
    let out = '';
    if (view) {
      out += ansi.resetModifyOtherKeys + ansi.kittyKeyboard(0);
      if (!view.disableBracketedPasteMode) out += ansi.disableBracketedPaste;
      if (view.reportFocus) out += ansi.disableFocusReporting;
      if (view.mouseMode === MouseMode.CellMotion) {
        out += ansi.disableMouseCellMotion + ansi.disableMouseSGR;
      } else if (view.mouseMode === MouseMode.AllMotion) {
        out += ansi.disableMouseAllMotion + ansi.disableMouseSGR;
      }
      if (view.cursor?.color) out += ansi.resetCursorColor;
      if (view.cursor) out += ansi.resetCursorShape;
      if (view.progressBar) out += ansi.resetProgressBar;
      if (view.windowTitle) out += ansi.resetWindowTitle;
      if (view.foregroundColor) out += ansi.resetForegroundColor;
      if (view.backgroundColor) out += ansi.resetBackgroundColor;
      out += ansi.showCursor;
    }
    if (this.altScreen) out += ansi.exitAltScreen;
    this.write(out);
    this.altScreen = false;
    this.useAltScreen = false;
    this.lastFrame = '';
    this.lastLines = [];
    this.linesRendered = 0;
    this.lastView = null;
    this.dirty = true;
    this.started = false;
  }

  render(view: string | View): void {
    if (!this.started) return;
    const normalized = typeof view === 'string' ? new View(view) : view.clone();
    if (typeof view === 'string') normalized.altScreen = this.useAltScreen;
    this.currentView = normalized;
    this.currentFrame = normalized.content;
    this.dirty = true;
  }

  flush(closing: boolean): void {
    if (!this.started && !closing) return;
    if (!this.dirty && !closing) return;
    this.dirty = false;

    const view = this.currentView;
    const frame = view.content;
    let out = this.renderViewTransitions(view, closing);

    if (
      frame === this.lastFrame &&
      this.lastView !== null &&
      viewRenderStateEquals(view, this.lastView) &&
      !closing
    ) {
      if (view.cursor) out += ansi.moveCursor(view.cursor.x, view.cursor.y);
      out += view.cursor ? ansi.showCursor : ansi.hideCursor;
      this.writeUpdate(out);
      this.lastView = view.clone();
      return;
    }

    const newLines = frame.split('\n');

    // Truncate to terminal height if in alt screen
    if (this.altScreen && newLines.length > this.height) {
      newLines.length = this.height;
    }

    // Frame updates follow any declarative terminal state transitions.

    if (this.altScreen) {
      // Alt screen mode: position cursor and write full frame
      out += view.cursor ? ansi.hideCursor : '';
      out += ansi.moveCursor(0, 0);

      for (let i = 0; i < newLines.length; i++) {
        if (i > 0) out += '\r\n';
        out += ansi.clearLine;
        out += newLines[i];
      }

      // Clear remaining lines
      for (let i = newLines.length; i < this.height; i++) {
        out += '\r\n' + ansi.clearLine;
      }

      if (view.cursor) out += ansi.moveCursor(view.cursor.x, view.cursor.y);
      out += view.cursor ? ansi.showCursor : ansi.hideCursor;
    } else {
      // Inline mode: diff against previous frame
      if (view.cursor) out += ansi.hideCursor;

      // Move cursor up to the start of the previously rendered content
      if (this.linesRendered > 0) {
        out += `\r${ansi.cursorUp(this.linesRendered)}`;
      }

      for (let i = 0; i < newLines.length; i++) {
        if (i > 0) out += '\r\n';
        out += ansi.clearLine;
        out += newLines[i];
      }

      // Clear any extra lines from the previous render
      if (newLines.length < this.linesRendered) {
        for (let i = newLines.length; i < this.linesRendered; i++) {
          out += '\r\n' + ansi.clearLine;
        }
        // Move back up to the end of the new content
        const extra = this.linesRendered - newLines.length;
        if (extra > 0) {
          out += ansi.cursorUp(extra);
        }
      }

      this.linesRendered = newLines.length;
      if (view.cursor) out += ansi.moveCursor(view.cursor.x, view.cursor.y);
      out += view.cursor ? ansi.showCursor : ansi.hideCursor;
    }

    this.writeUpdate(out);
    this.lastFrame = frame;
    this.lastLines = newLines;
    this.lastView = view.clone();
  }

  reset(): void {
    this.lastFrame = '';
    this.lastLines = [];
    this.currentFrame = '';
    this.currentView = new View();
    this.lastView = null;
    this.dirty = false;
    this.linesRendered = 0;
  }

  insertAbove(s: string): void {
    if (this.altScreen) return; // no-op in alt screen

    let out = '';

    // Move to start of rendered area
    if (this.linesRendered > 0) {
      out += `\r${ansi.cursorUp(this.linesRendered)}`;
    }

    // Insert the line
    out += ansi.insertLines(1);
    out += s;
    out += '\r\n';

    // Move back down to where we were
    if (this.linesRendered > 0) {
      out += ansi.cursorDown(this.linesRendered);
    }

    this.write(out);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // Force a full repaint on resize
    this.repaint();
  }

  clearScreen(): void {
    this.write(ansi.clearScreen);
    this.lastFrame = '';
    this.lastLines = [];
    this.linesRendered = 0;
  }

  repaint(): void {
    this.lastFrame = '';
    this.lastLines = [];
    this.dirty = true;
  }

  onMouse(msg: MouseMsg): Cmd {
    return this.currentView.onMouse?.(msg) ?? null;
  }

  setSynchronizedOutput(enabled: boolean): void {
    this.synchronizedOutput = enabled;
  }

  /** Enter alt screen buffer. */
  enterAltScreen(): void {
    if (this.altScreen) return;
    this.altScreen = true;
    this.useAltScreen = true;
    this.write(ansi.enterAltScreen);
    this.clearScreen();
  }

  /** Exit alt screen buffer. */
  exitAltScreen(): void {
    if (!this.altScreen) return;
    this.altScreen = false;
    this.useAltScreen = false;
    this.write(ansi.exitAltScreen);
    this.linesRendered = 0;
    this.lastFrame = '';
    this.lastLines = [];
  }

  get isAltScreen(): boolean {
    return this.altScreen;
  }

  private renderViewTransitions(view: View, closing: boolean): string {
    const previous = this.lastView;
    let out = '';

    if (view.altScreen !== this.altScreen) {
      if (view.altScreen) {
        this.altScreen = true;
        this.useAltScreen = true;
        out += ansi.enterAltScreen + ansi.clearScreen;
      } else {
        this.altScreen = false;
        this.useAltScreen = false;
        this.linesRendered = 0;
        out += ansi.exitAltScreen;
      }
    }

    if (!previous || previous.disableBracketedPasteMode !== view.disableBracketedPasteMode) {
      out += view.disableBracketedPasteMode
        ? ansi.disableBracketedPaste
        : ansi.enableBracketedPaste;
    }

    if (!previous || previous.reportFocus !== view.reportFocus) {
      if (view.reportFocus) out += ansi.enableFocusReporting;
      else if (previous) out += ansi.disableFocusReporting;
    }

    if (!previous || previous.mouseMode !== view.mouseMode) {
      out += ansi.disableMouseCellMotion + ansi.disableMouseAllMotion + ansi.disableMouseSGR;
      if (view.mouseMode === MouseMode.CellMotion) {
        out += ansi.enableMouseCellMotion + ansi.enableMouseSGR;
      } else if (view.mouseMode === MouseMode.AllMotion) {
        out += ansi.enableMouseAllMotion + ansi.enableMouseSGR;
      }
    }

    if (!previous || previous.windowTitle !== view.windowTitle) {
      if (previous || view.windowTitle) out += ansi.setWindowTitle(view.windowTitle);
    }

    if (
      !previous ||
      JSON.stringify(previous.keyboardEnhancements) !== JSON.stringify(view.keyboardEnhancements) ||
      previous.altScreen !== view.altScreen
    ) {
      let flags = KittyKeyboardFlag.DisambiguateEscapeCodes;
      if (view.keyboardEnhancements.reportEventTypes) flags |= KittyKeyboardFlag.ReportEventTypes;
      if (view.keyboardEnhancements.reportAlternateKeys) flags |= KittyKeyboardFlag.ReportAlternateKeys;
      if (view.keyboardEnhancements.reportAllKeysAsEscapeCodes) {
        flags |= KittyKeyboardFlag.ReportAllKeysAsEscapeCodes;
      }
      if (view.keyboardEnhancements.reportAssociatedText) flags |= KittyKeyboardFlag.ReportAssociatedText;
      out += ansi.setModifyOtherKeys2 + ansi.kittyKeyboard(flags);
      if (!closing) out += ansi.requestKittyKeyboard;
    }

    out += this.colorTransition(
      previous?.cursor?.color ?? null,
      view.cursor?.color ?? null,
      ansi.setCursorColor,
      ansi.resetCursorColor,
    );
    out += this.colorTransition(
      previous?.foregroundColor ?? null,
      view.foregroundColor,
      ansi.setForegroundColor,
      ansi.resetForegroundColor,
    );
    out += this.colorTransition(
      previous?.backgroundColor ?? null,
      view.backgroundColor,
      ansi.setBackgroundColor,
      ansi.resetBackgroundColor,
    );

    const oldCursorStyle = previous?.cursor
      ? ansi.setCursorShape(previous.cursor.shape, previous.cursor.blink)
      : '';
    const cursorStyle = view.cursor ? ansi.setCursorShape(view.cursor.shape, view.cursor.blink) : '';
    if (oldCursorStyle !== cursorStyle) {
      out += cursorStyle || ansi.resetCursorShape;
    }

    const oldProgress = previous?.progressBar;
    const progress = view.progressBar;
    if (
      (!oldProgress && progress) ||
      (oldProgress && !progress) ||
      (oldProgress && progress && (oldProgress.state !== progress.state || oldProgress.value !== progress.value))
    ) {
      out += progress
        ? ansi.setProgressBar(progress.state, progress.value)
        : ansi.setProgressBar(ProgressBarState.None, 0);
    }

    return out;
  }

  private colorTransition(
    previous: TerminalColor | null,
    current: TerminalColor | null,
    setter: (color: string) => string,
    reset: string,
  ): string {
    const oldColor = previous === null ? null : normalizeColor(previous);
    const newColor = current === null ? null : normalizeColor(current);
    if (oldColor === newColor) return '';
    return newColor === null ? reset : setter(newColor);
  }

  private writeUpdate(s: string): void {
    this.write(
      this.synchronizedOutput && s
        ? ansi.beginSynchronizedUpdate + s + ansi.endSynchronizedUpdate
        : s,
    );
  }

  private write(s: string): void {
    if (s.length > 0) {
      this.output.write(s);
    }
  }
}

function normalizeColor(color: TerminalColor): string {
  if (typeof color === 'string') return color;
  const hex = (channel: number) =>
    Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}


function viewRenderStateEquals(left: View, right: View): boolean {
  return (
    left.altScreen === right.altScreen &&
    left.disableBracketedPasteMode === right.disableBracketedPasteMode &&
    left.reportFocus === right.reportFocus &&
    left.mouseMode === right.mouseMode &&
    left.windowTitle === right.windowTitle &&
    JSON.stringify(left.keyboardEnhancements) === JSON.stringify(right.keyboardEnhancements) &&
    JSON.stringify(left.cursor) === JSON.stringify(right.cursor) &&
    JSON.stringify(left.foregroundColor) === JSON.stringify(right.foregroundColor) &&
    JSON.stringify(left.backgroundColor) === JSON.stringify(right.backgroundColor) &&
    JSON.stringify(left.progressBar) === JSON.stringify(right.progressBar)
  );
}