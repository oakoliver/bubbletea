/**
 * Renderer — manages terminal output, diffing, and redrawing.
 * Ports Go bubbletea's renderer interface and cursed renderer.
 */

import * as ansi from './ansi.js';

/**
 * Renderer interface for Bubble Tea.
 */
export interface Renderer {
  start(): void;
  close(): void;
  render(view: string): void;
  flush(closing: boolean): void;
  reset(): void;
  insertAbove(s: string): void;
  resize(width: number, height: number): void;
  clearScreen(): void;
  repaint(): void;
}

/**
 * A no-op renderer for headless/daemon programs.
 */
export class NilRenderer implements Renderer {
  start(): void {}
  close(): void {}
  render(_view: string): void {}
  flush(_closing: boolean): void {}
  reset(): void {}
  insertAbove(_s: string): void {}
  resize(_w: number, _h: number): void {}
  clearScreen(): void {}
  repaint(): void {}
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
  private dirty = false;
  private altScreen = false;
  private started = false;
  private linesRendered = 0;
  private useAltScreen = false;

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
    this.started = false;
  }

  render(view: string): void {
    if (!this.started) return;
    this.currentFrame = view;
    this.dirty = true;
  }

  flush(closing: boolean): void {
    if (!this.started && !closing) return;
    if (!this.dirty && !closing) return;
    this.dirty = false;

    const frame = this.currentFrame;

    if (frame === this.lastFrame && !closing) {
      return; // No change
    }

    const newLines = frame.split('\n');

    // Truncate to terminal height if in alt screen
    if (this.altScreen && newLines.length > this.height) {
      newLines.length = this.height;
    }

    let out = '';

    if (this.altScreen) {
      // Alt screen mode: position cursor and write full frame
      out += ansi.hideCursor;
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

      out += ansi.showCursor;
    } else {
      // Inline mode: diff against previous frame
      out += ansi.hideCursor;

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
      out += ansi.showCursor;
    }

    this.write(out);
    this.lastFrame = frame;
    this.lastLines = newLines;
  }

  reset(): void {
    this.lastFrame = '';
    this.lastLines = [];
    this.currentFrame = '';
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

  private write(s: string): void {
    if (s.length > 0) {
      this.output.write(s);
    }
  }
}
