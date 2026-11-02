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
/** Sets the flags of the topmost Kitty keyboard stack entry in place (CSI = flags ; mode u). */
export const kittyKeyboard = (flags: number, mode = 1) => `${CSI}=${flags};${mode}u`;
/** Pushes a new entry onto the Kitty keyboard stack (CSI > flags u). */
export const pushKittyKeyboard = (flags: number) => `${CSI}>${flags > 0 ? flags : ''}u`;
/** Pops n entries from the Kitty keyboard stack (CSI < n u). */
export const popKittyKeyboard = (n: number) => `${CSI}<${n > 0 ? n : ''}u`;

export const setProgressBar = (state: number, value: number) =>
  `${OSC}9;4;${state};${value}${ST}`;
export const resetProgressBar = `${OSC}9;4;0;0${ST}`;

// ─── Program Status Protocol (OSC 7501) ────────────────────────────────────
// Ports x/ansi's programstatus.go. The sequences end in BEL, as upstream's do.

/** The fields of a Program Status Protocol report; see `ProgramStatus`. */
interface ProgramStatusFields {
  state: string;
  id?: string;
  app?: string;
  kind?: string;
  progress?: number;
  hasProgress?: boolean;
  title?: string;
  message?: string;
}

const programStatusMaxTitle = 192;
const programStatusMaxMessage = 2048;

/**
 * Removes every program status record on the terminal.
 *
 *     OSC 7501 ; state=clear BEL
 */
export const clearProgramStatus = `${OSC}7501;state=clear\x07`;

/**
 * Asks the terminal whether it supports the Program Status Protocol. A
 * supporting terminal replies with `OSC 7501 ; ? ST`.
 *
 *     OSC 7501 ; ? BEL
 */
export const requestProgramStatusSupport = `${OSC}7501;?\x07`;

/**
 * Removes the record with the given id and every record beneath it. An empty
 * id removes every record. Returns an empty string if the id is invalid.
 *
 *     OSC 7501 ; state=clear:id=Id BEL
 */
export function clearProgramStatusID(id: string): string {
  return setProgramStatus({ state: 'clear', id });
}

/**
 * Reports a program status with the Program Status Protocol (OSC 7501).
 *
 *     OSC 7501 ; key=value:key=value BEL
 *
 * Terminals discard a whole report when any part of it is invalid, so the
 * report is sanitized: control characters in the title and message are
 * replaced with spaces and the text is truncated to the protocol limits, and
 * an invalid app, or a kind or progress used with the wrong state, is omitted.
 * Returns an empty string if the state is unknown or the id is invalid.
 *
 * See: https://www.superlogical.com/rex/docs/build/program-status
 */
export function setProgramStatus(s: ProgramStatusFields): string {
  switch (s.state) {
    case 'idle':
    case 'working':
    case 'done':
    case 'blocked':
    case 'error':
    case 'clear':
      break;
    default:
      return '';
  }
  const id = s.id ?? '';
  if (id !== '' && !validProgramStatusID(id)) return '';

  const pairs = [`state=${s.state}`];
  if (id !== '') pairs.push(`id=${id}`);
  if (s.state === 'clear') return programStatusSequence(pairs);
  if (s.state === 'blocked' && (s.kind === 'permission' || s.kind === 'question' || s.kind === 'auth')) {
    pairs.push(`kind=${s.kind}`);
  }
  if (s.hasProgress && (s.state === 'working' || s.state === 'blocked')) {
    // Go's int field: truncate, then clamp to 0–100.
    const progress = Math.trunc(Number(s.progress ?? 0)) || 0;
    pairs.push(`progress=${Math.min(Math.max(progress, 0), 100)}`);
  }
  if (validProgramStatusSegment(s.app ?? '')) pairs.push(`app=${s.app}`);
  const title = programStatusText(s.title ?? '', programStatusMaxTitle);
  if (title) pairs.push(`title=${title}`);
  const message = programStatusText(s.message ?? '', programStatusMaxMessage);
  if (message) pairs.push(`msg=${message}`);
  return programStatusSequence(pairs);
}

function programStatusSequence(pairs: string[]): string {
  return `${OSC}7501;${pairs.join(':')}\x07`;
}

/**
 * Sanitizes, truncates (to `limit` UTF-8 bytes, on a character boundary) and
 * base64-encodes free text.
 */
function programStatusText(s: string, limit: number): string {
  // Lone surrogates become U+FFFD, as Go's strings.ToValidUTF8 does with
  // invalid bytes.
  s = s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
  let sanitized = '';
  let space = false;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
      if (!space) {
        sanitized += ' ';
        space = true;
      }
      continue;
    }
    space = false;
    sanitized += ch;
  }
  let bytes = Buffer.from(trimGoSpace(sanitized), 'utf8');
  if (bytes.length > limit) {
    let end = limit;
    // Step back to the start of a character (never cut a UTF-8 sequence).
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
    bytes = Buffer.from(trimGoSpace(bytes.subarray(0, end).toString('utf8')), 'utf8');
  }
  if (bytes.length === 0) return '';
  return bytes.toString('base64');
}

/** Go's strings.TrimSpace: trims Unicode White_Space (JS's \s also has U+FEFF, which Go keeps). */
function trimGoSpace(s: string): string {
  return s.replace(goSpaceEdges, '');
}

const goSpaceEdges =
  /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

function validProgramStatusID(id: string): boolean {
  if (Buffer.byteLength(id) > 128) return false;
  const segments = id.split('/');
  if (segments.length > 8) return false;
  return segments.every(validProgramStatusSegment);
}

function validProgramStatusSegment(s: string): boolean {
  return /^[A-Za-z0-9_.+-]{1,32}$/.test(s);
}
