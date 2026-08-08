/**
 * ANSI escape sequences for terminal control.
 * Zero-dependency — all sequences built from scratch.
 */

export const ESC = '\x1b';
export const CSI = `${ESC}[`;
export const OSC = `${ESC}]`;
export const DCS = `${ESC}P`;
export const ST = `${ESC}\\`;

// ─── Cursor ─────────────────────────────────────────────────────────────────

export const hideCursor = `${CSI}?25l`;
export const showCursor = `${CSI}?25h`;

export function moveCursor(x: number, y: number): string {
  return `${CSI}${y + 1};${x + 1}H`;
}

export const cursorUp = (n = 1) => `${CSI}${n}A`;
export const cursorDown = (n = 1) => `${CSI}${n}B`;
export const cursorForward = (n = 1) => `${CSI}${n}C`;
export const cursorBack = (n = 1) => `${CSI}${n}D`;

export const saveCursorPosition = `${ESC}7`;
export const restoreCursorPosition = `${ESC}8`;

export const requestCursorPosition = `${CSI}6n`;

// Cursor shapes: 0 = default, 1 = blinking block, 2 = steady block,
// 3 = blinking underline, 4 = steady underline, 5 = blinking bar, 6 = steady bar
export function setCursorShape(shape: number, blink: boolean): string {
  let code = shape * 2 + 1;
  if (!blink) code++;
  return `${CSI}${code} q`;
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export const clearScreen = `${CSI}2J${CSI}1;1H`;
export const clearLine = `${CSI}2K`;
export const clearToEndOfLine = `${CSI}K`;
export const clearToEndOfScreen = `${CSI}J`;
export const clearToStartOfLine = `${CSI}1K`;

// ─── Alternate Screen Buffer ────────────────────────────────────────────────

export const enterAltScreen = `${CSI}?1049h`;
export const exitAltScreen = `${CSI}?1049l`;

// ─── Scrolling ──────────────────────────────────────────────────────────────

export const scrollUp = (n = 1) => `${CSI}${n}S`;
export const scrollDown = (n = 1) => `${CSI}${n}T`;

// Set scroll region (top and bottom are 1-indexed)
export function setScrollRegion(top: number, bottom: number): string {
  return `${CSI}${top};${bottom}r`;
}

export const resetScrollRegion = `${CSI}r`;

// ─── Mouse ──────────────────────────────────────────────────────────────────

// X10 mouse tracking (click only)
export const enableMouseClick = `${CSI}?1000h`;
export const disableMouseClick = `${CSI}?1000l`;

// Cell motion mouse tracking (click + drag)
export const enableMouseCellMotion = `${CSI}?1002h`;
export const disableMouseCellMotion = `${CSI}?1002l`;

// All motion mouse tracking (click + drag + hover)
export const enableMouseAllMotion = `${CSI}?1003h`;
export const disableMouseAllMotion = `${CSI}?1003l`;

// SGR extended mouse mode (supports coordinates > 223)
export const enableMouseSGR = `${CSI}?1006h`;
export const disableMouseSGR = `${CSI}?1006l`;

// ─── Bracketed Paste ────────────────────────────────────────────────────────

export const enableBracketedPaste = `${CSI}?2004h`;
export const disableBracketedPaste = `${CSI}?2004l`;

// ─── Focus ──────────────────────────────────────────────────────────────────

export const enableFocusReporting = `${CSI}?1004h`;
export const disableFocusReporting = `${CSI}?1004l`;

// ─── Line Wrapping ──────────────────────────────────────────────────────────

export const enableLineWrap = `${CSI}?7h`;
export const disableLineWrap = `${CSI}?7l`;

// ─── Synchronized Output (Mode 2026) ────────────────────────────────────────

export const beginSynchronizedUpdate = `${CSI}?2026h`;
export const endSynchronizedUpdate = `${CSI}?2026l`;

// ─── Terminal Queries ───────────────────────────────────────────────────────

export const requestSyncOutputMode = `${CSI}?2026$p`;
export const requestUnicodeCoreMode = `${CSI}?2027$p`;

// ─── Insert/Delete Lines ────────────────────────────────────────────────────

export const insertLines = (n = 1) => `${CSI}${n}L`;
export const deleteLines = (n = 1) => `${CSI}${n}M`;

// ─── Erase Characters ──────────────────────────────────────────────────────

export const eraseChars = (n = 1) => `${CSI}${n}X`;

// ─── Color / Style Reset ───────────────────────────────────────────────────

export const resetStyle = `${CSI}0m`;

// ─── View state and terminal reports ────────────────────────────────────────

export const requestWindowSize = `${CSI}18t`;
export const requestBackgroundColor = `${OSC}11;?${ST}`;
export const requestForegroundColor = `${OSC}10;?${ST}`;
export const requestCursorColor = `${OSC}12;?${ST}`;
export const requestTerminalVersion = `${CSI}>q`;

export const setWindowTitle = (title: string) => `${OSC}2;${title}${ST}`;
export const setForegroundColor = (color: string) => `${OSC}10;${color}${ST}`;
export const setBackgroundColor = (color: string) => `${OSC}11;${color}${ST}`;
export const setCursorColor = (color: string) => `${OSC}12;${color}${ST}`;
export const resetForegroundColor = `${OSC}110${ST}`;
export const resetBackgroundColor = `${OSC}111${ST}`;
export const resetCursorColor = `${OSC}112${ST}`;
export const resetCursorShape = `${CSI}0 q`;
export const resetWindowTitle = setWindowTitle('');

export const requestClipboard = (selection: 'c' | 'p') => `${OSC}52;${selection};?${ST}`;
export const setClipboard = (selection: 'c' | 'p', content: string) =>
  `${OSC}52;${selection};${Buffer.from(content).toString('base64')}${ST}`;

export const requestTermcap = (capability: string) => {
  const hex = Buffer.from(capability).toString('hex').toUpperCase();
  return `${DCS}+q${hex}${ST}`;
};

export const setModifyOtherKeys2 = `${CSI}>4;2m`;
export const resetModifyOtherKeys = `${CSI}>4m`;
export const requestKittyKeyboard = `${CSI}?u`;
export const kittyKeyboard = (flags: number, mode = 1) => `${CSI}>${flags};${mode}u`;

export const setProgressBar = (state: number, value: number) =>
  `${OSC}9;4;${state};${value}${ST}`;
export const resetProgressBar = `${OSC}9;4;0;0${ST}`;
