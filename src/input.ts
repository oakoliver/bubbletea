/**
 * Input parser — reads raw bytes from stdin and produces Msg events.
 * Parses ANSI escape sequences for keys, mouse, paste, focus, etc.
 * Zero-dependency implementation.
 */

import {
  type Msg,
  KeyPressMsg,
  KeyReleaseMsg,
  KeyCode,
  ExtendedKeyCode,
  KeyMod,
  MouseButton,
  MouseClickMsg,
  MouseReleaseMsg,
  MouseWheelMsg,
  MouseMotionMsg,
  FocusMsg,
  BlurMsg,
  PasteMsg,
  PasteStartMsg,
  PasteEndMsg,
  CursorPositionMsg,
  WindowSizeMsg,
  KeyboardEnhancementsMsg,
  ModeReportMsg,
  ModeSetting,
  ForegroundColorMsg,
  BackgroundColorMsg,
  CursorColorMsg,
  ClipboardMsg,
  CapabilityMsg,
  TerminalVersionMsg,
} from './types.js';

/**
 * Parse raw input data into an array of messages.
 * Handles ANSI escape sequences, UTF-8 characters, and special key combos.
 */
export function parseInput(data: Buffer | Uint8Array): Msg[] {
  const msgs: Msg[] = [];
  let i = 0;
  const len = data.length;

  while (i < len) {
    const byte = data[i];

    // ESC sequence
    if (byte === 0x1b) {
      // Check if it's just a bare ESC (no more data or timeout)
      if (i + 1 >= len) {
        msgs.push(
          new KeyPressMsg({
            text: '',
            mod: KeyMod.None,
            code: KeyCode.Escape,
          }),
        );
        i++;
        continue;
      }

      const next = data[i + 1];

      // CSI sequence: ESC [
      if (next === 0x5b) {
        const result = parseCSI(data, i + 2);
        if (result.msg) msgs.push(result.msg);
        i = result.next;
        continue;
      }

      // SS3 sequence: ESC O (used for some function keys)
      if (next === 0x4f) {
        const result = parseSS3(data, i + 2);
        if (result.msg) msgs.push(result.msg);
        i = result.next;
        continue;
      }

      // OSC: colors, clipboard and other operating-system reports.
      if (next === 0x5d) {
        const result = parseOSC(data, i + 2);
        if (result.msg) msgs.push(result.msg);
        i = result.next;
        continue;
      }

      // DCS: termcap and terminal-version reports.
      if (next === 0x50) {
        const result = parseDCS(data, i + 2);
        if (result.msg) msgs.push(result.msg);
        i = result.next;
        continue;
      }

      // Bracketed paste start: ESC [ 200 ~
      // (handled in CSI parser)

      // Alt+key: ESC followed by a regular character
      if (next >= 0x20 && next < 0x7f) {
        const ch = String.fromCharCode(next);
        msgs.push(
          new KeyPressMsg({
            text: ch,
            mod: KeyMod.Alt,
            code: next,
          }),
        );
        i += 2;
        continue;
      }

      if (next >= 0x80) {
        const decoded = parseUTF8(data, i + 1);
        msgs.push(
          new KeyPressMsg({
            text: decoded.char,
            mod: KeyMod.Alt,
            code: decoded.char.codePointAt(0) ?? next,
          }),
        );
        i = decoded.next;
        continue;
      }

      // Alt plus a control/special key: decode the key first, then add Alt.
      if (next < 0x20 || next === 0x7f) {
        const key = next === 0x7f
          ? new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Backspace })
          : parseControlChar(next);
        if (key instanceof KeyPressMsg) {
          msgs.push(new KeyPressMsg({ ...key.key(), mod: key.mod | KeyMod.Alt }));
          i += 2;
          continue;
        }
      }

      // Just bare ESC
      msgs.push(
        new KeyPressMsg({
          text: '',
          mod: KeyMod.None,
          code: KeyCode.Escape,
        }),
      );
      i++;
      continue;
    }

    // 8-bit C1 forms of CSI, OSC, DCS and SS3.
    if (byte === 0x9b) {
      const result = parseCSI(data, i + 1);
      if (result.msg) msgs.push(result.msg);
      i = result.next;
      continue;
    }
    if (byte === 0x9d) {
      const result = parseOSC(data, i + 1);
      if (result.msg) msgs.push(result.msg);
      i = result.next;
      continue;
    }
    if (byte === 0x90) {
      const result = parseDCS(data, i + 1);
      if (result.msg) msgs.push(result.msg);
      i = result.next;
      continue;
    }
    if (byte === 0x8f) {
      const result = parseSS3(data, i + 1);
      if (result.msg) msgs.push(result.msg);
      i = result.next;
      continue;
    }

    // C0 control characters
    if (byte < 0x20) {
      const msg = parseControlChar(byte);
      if (msg) msgs.push(msg);
      i++;
      continue;
    }

    // DEL (backspace on many terminals)
    if (byte === 0x7f) {
      msgs.push(
        new KeyPressMsg({
          text: '',
          mod: KeyMod.None,
          code: KeyCode.Backspace,
        }),
      );
      i++;
      continue;
    }

    // UTF-8 multi-byte sequences or ASCII printable
    if (byte >= 0x20) {
      const result = parseUTF8(data, i);
      msgs.push(
        new KeyPressMsg({
          text: result.char,
          mod: KeyMod.None,
          code: result.char.codePointAt(0) || byte,
        }),
      );
      i = result.next;
      continue;
    }

    // Unknown byte, skip
    i++;
  }

  return msgs;
}

interface ParseResult {
  msg: Msg | null;
  next: number;
}

/**
 * Parse a CSI sequence (ESC [ ...).
 * offset points to the byte AFTER "ESC [".
 */
function parseCSI(data: Buffer | Uint8Array, offset: number): ParseResult {
  const len = data.length;
  let i = offset;

  // Collect parameter bytes (0x30-0x3F)
  let params = '';
  while (i < len && data[i] >= 0x30 && data[i] <= 0x3f) {
    params += String.fromCharCode(data[i]);
    i++;
  }

  // Collect intermediate bytes (0x20-0x2F)
  let intermediates = '';
  while (i < len && data[i] >= 0x20 && data[i] <= 0x2f) {
    intermediates += String.fromCharCode(data[i]);
    i++;
  }

  // Final byte (0x40-0x7E)
  if (i >= len) {
    return { msg: null, next: i };
  }

  const final = data[i];
  i++; // consume final byte

  // ─── Mouse: SGR format ESC [ < Cb ; Cx ; Cy M/m ─────────────────
  if (params.startsWith('<') && (final === 0x4d || final === 0x6d)) {
    // SGR mouse: < button ; x ; y M (press) or m (release)
    const parts = params.slice(1).split(';').map(Number);
    if (parts.length >= 3) {
      const [cb, cx, cy] = parts;
      const isRelease = final === 0x6d; // 'm'
      return {
        msg: parseSGRMouse(cb, cx - 1, cy - 1, isRelease),
        next: i,
      };
    }
    return { msg: null, next: i };
  }

  // ─── Normal mouse: ESC [ M Cb Cx Cy (3 bytes after M) ──────────
  if (final === 0x4d && params === '' && i + 2 < len) {
    // X10 mouse: M followed by 3 bytes
    // Actually this is handled when final=M and there are 3 raw bytes following
    // We need to check if this was a CSI M (no params) with 3 following bytes
    const cb = data[i] - 32;
    const cx = data[i + 1] - 33; // 0-indexed
    const cy = data[i + 2] - 33;
    i += 3;
    return { msg: parseX10Mouse(cb, cx, cy), next: i };
  }

  // ─── Focus events ─────────────────────────────────────────────────
  if (final === 0x49 && params === '') {
    // CSI I = focus gained
    return { msg: new FocusMsg(), next: i };
  }
  if (final === 0x4f && params === '') {
    // CSI O = focus lost
    return { msg: new BlurMsg(), next: i };
  }

  // ─── Cursor position report: ESC [ Py ; Px R ─────────────────────
  if (final === 0x52 && params.includes(';') && !params.startsWith('?')) {
    const parts = params.split(';').map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      return {
        msg: new CursorPositionMsg(parts[1] - 1, parts[0] - 1),
        next: i,
      };
    }
    return { msg: null, next: i };
  }

  // ─── DEC/ANSI mode reports ────────────────────────────────────────
  if (final === 0x79 && intermediates === '$') {
    const values = params.replace(/^\?/, '').split(';').map(Number);
    if (values.length >= 2 && values.every(Number.isFinite)) {
      return { msg: new ModeReportMsg(values[0], ModeSetting.from(values[1])), next: i };
    }
  }

  // ─── Kitty keyboard enhancement report ────────────────────────────
  if (final === 0x75 && params.startsWith('?')) {
    return {
      msg: new KeyboardEnhancementsMsg(Number(params.slice(1)) || 0),
      next: i,
    };
  }

  // ─── Kitty keyboard / CSI-u protocol ──────────────────────────────
  if (final === 0x75 && params.length > 0) {
    return { msg: parseKittyKey(params), next: i };
  }

  // ─── Bracketed paste ─────────────────────────────────────────────
  if (final === 0x7e) {
    // ~ = tilde
    if (params === '200') {
      // Paste start — collect until ESC [ 201 ~
      const pasteEnd = findPasteEnd(data, i);
      if (pasteEnd) {
        const content = Buffer.from(data.slice(i, pasteEnd.start)).toString('utf-8');
        return {
          msg: new PasteMsg(content),
          next: pasteEnd.next,
        };
      }
      return { msg: new PasteStartMsg(), next: i };
    }
    if (params === '201') {
      return { msg: new PasteEndMsg(), next: i };
    }
  }

  // ─── Special keys with tilde ──────────────────────────────────────
  if (final === 0x7e) {
    const paramParts = params.split(';');
    const num = parseInt(paramParts[0], 10);
    const modParam = paramParts.length > 1 ? parseInt(paramParts[1], 10) : 0;
    const mod = modParam > 0 ? decodeModifier(modParam) : KeyMod.None;

    const tildeKey = tildeKeys[num];
    if (tildeKey !== undefined) {
      return {
        msg: new KeyPressMsg({ text: '', mod, code: tildeKey }),
        next: i,
      };
    }
    return { msg: null, next: i };
  }

  // ─── Arrow keys and navigation ────────────────────────────────────
  const paramParts = params.split(';');
  const modParam = paramParts.length > 1 ? parseInt(paramParts[1], 10) : 0;
  const mod = modParam > 0 ? decodeModifier(modParam) : KeyMod.None;

  switch (final) {
    case 0x41: // A = Up
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.Up }), next: i };
    case 0x42: // B = Down
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.Down }), next: i };
    case 0x43: // C = Right
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.Right }), next: i };
    case 0x44: // D = Left
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.Left }), next: i };
    case 0x46: // F = End
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.End }), next: i };
    case 0x48: // H = Home
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.Home }), next: i };
    case 0x52: // R = F3 when this is not a cursor report
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.F3 }), next: i };
    case 0x50: // P = F1 (in some terminals)
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.F1 }), next: i };
    case 0x51: // Q = F2
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.F2 }), next: i };
    case 0x53: // S = F4
      return { msg: new KeyPressMsg({ text: '', mod, code: KeyCode.F4 }), next: i };
    case 0x5a: // Z = Shift+Tab
      return {
        msg: new KeyPressMsg({ text: '', mod: KeyMod.Shift, code: KeyCode.Tab }),
        next: i,
      };
  }

  // ─── Window size report (from dtterm) ─────────────────────────────
  if (final === 0x74) {
    // t
    const parts = params.split(';').map(Number);
    if (parts[0] === 8 && parts.length >= 3) {
      return {
        msg: new WindowSizeMsg(parts[2], parts[1]),
        next: i,
      };
    }
  }

  return { msg: null, next: i };
}

/**
 * Parse SS3 sequences (ESC O ...).
 */
function parseSS3(data: Buffer | Uint8Array, offset: number): ParseResult {
  if (offset >= data.length) {
    return { msg: null, next: offset };
  }

  const final = data[offset];

  switch (final) {
    case 0x41: // A = Up
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Up }), next: offset + 1 };
    case 0x42: // B = Down
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Down }), next: offset + 1 };
    case 0x43: // C = Right
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Right }), next: offset + 1 };
    case 0x44: // D = Left
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Left }), next: offset + 1 };
    case 0x46: // F = End
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.End }), next: offset + 1 };
    case 0x48: // H = Home
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Home }), next: offset + 1 };
    case 0x50: // P = F1
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.F1 }), next: offset + 1 };
    case 0x51: // Q = F2
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.F2 }), next: offset + 1 };
    case 0x52: // R = F3
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.F3 }), next: offset + 1 };
    case 0x53: // S = F4
      return { msg: new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.F4 }), next: offset + 1 };
    default:
      return { msg: null, next: offset + 1 };
  }
}

/**
 * Parse a C0 control character.
 */
function parseControlChar(byte: number): Msg | null {
  switch (byte) {
    case 0x00: // Ctrl+Space or Ctrl+@
      return new KeyPressMsg({ text: '', mod: KeyMod.Ctrl, code: KeyCode.Space });
    case 0x08: // Ctrl+H (Backspace in some terminals)
      return new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Backspace });
    case 0x09: // Tab
      return new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Tab });
    case 0x0a: // Line Feed is Ctrl+J; only carriage return is Enter.
      return new KeyPressMsg({ text: '', mod: KeyMod.Ctrl, code: 0x6a });
    case 0x0d: // Enter
      return new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Enter });
    case 0x1b: // Escape
      return new KeyPressMsg({ text: '', mod: KeyMod.None, code: KeyCode.Escape });
    default:
      // Ctrl+letter: 0x01-0x1a maps to Ctrl+a through Ctrl+z
      if (byte >= 1 && byte <= 26) {
        return new KeyPressMsg({
          text: '',
          mod: KeyMod.Ctrl,
          code: byte + 0x60, // 'a' = 0x61
        });
      }
      if (byte >= 0x1c && byte <= 0x1f) {
        return new KeyPressMsg({
          text: '',
          mod: KeyMod.Ctrl,
          code: byte + 0x40,
        });
      }
      return null;
  }
}

/**
 * Parse a UTF-8 encoded character.
 */
function parseUTF8(
  data: Buffer | Uint8Array,
  offset: number,
): { char: string; next: number } {
  const byte = data[offset];

  // ASCII
  if (byte < 0x80) {
    return { char: String.fromCharCode(byte), next: offset + 1 };
  }

  // Determine byte count from leading byte
  let byteCount = 1;
  if ((byte & 0xe0) === 0xc0) byteCount = 2;
  else if ((byte & 0xf0) === 0xe0) byteCount = 3;
  else if ((byte & 0xf8) === 0xf0) byteCount = 4;

  if (offset + byteCount > data.length) {
    // Incomplete sequence — return replacement char
    return { char: '\ufffd', next: data.length };
  }

  const bytes = data.slice(offset, offset + byteCount);
  const str = Buffer.from(bytes).toString('utf-8');
  return { char: str || '\ufffd', next: offset + byteCount };
}

// ─── Mouse Parsing ──────────────────────────────────────────────────────────

/**
 * Parse SGR mouse event.
 * Cb encodes button + modifiers + motion flag.
 */
function parseSGRMouse(
  cb: number,
  x: number,
  y: number,
  isRelease: boolean,
): Msg {
  const { button, mod, motion } = decodeCb(cb);

  const mouse = { x, y, button, mod };

  if (isRelease) {
    return new MouseReleaseMsg(mouse);
  }
  if (motion) {
    return new MouseMotionMsg(mouse);
  }
  if (
    button === MouseButton.WheelUp ||
    button === MouseButton.WheelDown ||
    button === MouseButton.WheelLeft ||
    button === MouseButton.WheelRight
  ) {
    return new MouseWheelMsg(mouse);
  }
  return new MouseClickMsg(mouse);
}

/**
 * Parse X10 mouse event.
 */
function parseX10Mouse(cb: number, x: number, y: number): Msg {
  const { button, mod, motion } = decodeCb(cb);
  const mouse = { x, y, button, mod };

  if (button === MouseButton.None) {
    return new MouseReleaseMsg(mouse);
  }
  if (motion) {
    return new MouseMotionMsg(mouse);
  }
  if (
    button === MouseButton.WheelUp ||
    button === MouseButton.WheelDown ||
    button === MouseButton.WheelLeft ||
    button === MouseButton.WheelRight
  ) {
    return new MouseWheelMsg(mouse);
  }
  return new MouseClickMsg(mouse);
}

/**
 * Decode the Cb byte from mouse tracking.
 * Bits: 0-1 = button low, 2 = motion, 3 = unused, 4 = shift, 5 = meta, 6 = ctrl, 7+ = button high
 */
function decodeCb(cb: number): {
  button: MouseButton;
  mod: KeyMod;
  motion: boolean;
} {
  let mod = KeyMod.None as number;
  if (cb & 4) mod |= KeyMod.Shift;
  if (cb & 8) mod |= KeyMod.Alt;
  if (cb & 16) mod |= KeyMod.Ctrl;

  const motion = !!(cb & 32);
  const low = cb & 3;
  const high = (cb >> 6) & 3;

  let button: MouseButton;
  if (high === 0) {
    switch (low) {
      case 0:
        button = MouseButton.Left;
        break;
      case 1:
        button = MouseButton.Middle;
        break;
      case 2:
        button = MouseButton.Right;
        break;
      case 3:
        button = MouseButton.None;
        break; // release
      default:
        button = MouseButton.None;
    }
  } else if (high === 1) {
    // Wheel events
    switch (low) {
      case 0:
        button = MouseButton.WheelUp;
        break;
      case 1:
        button = MouseButton.WheelDown;
        break;
      case 2:
        button = MouseButton.WheelLeft;
        break;
      case 3:
        button = MouseButton.WheelRight;
        break;
      default:
        button = MouseButton.None;
    }
  } else if (high === 2) {
    // Extended buttons
    switch (low) {
      case 0:
        button = MouseButton.Backward;
        break;
      case 1:
        button = MouseButton.Forward;
        break;
      case 2:
        button = MouseButton.Button10;
        break;
      case 3:
        button = MouseButton.Button11;
        break;
      default:
        button = MouseButton.None;
    }
  } else {
    button = MouseButton.None;
  }

  return { button, mod: mod as KeyMod, motion };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Tilde-terminated special keys: CSI <num> ~ */
const tildeKeys: Record<number, number> = {
  1: KeyCode.Home,
  2: KeyCode.Insert,
  3: KeyCode.Delete,
  4: KeyCode.End,
  5: KeyCode.PgUp,
  6: KeyCode.PgDown,
  7: KeyCode.Home,
  8: KeyCode.End,
  11: KeyCode.F1,
  12: KeyCode.F2,
  13: KeyCode.F3,
  14: KeyCode.F4,
  15: KeyCode.F5,
  17: KeyCode.F6,
  18: KeyCode.F7,
  19: KeyCode.F8,
  20: KeyCode.F9,
  21: KeyCode.F10,
  23: KeyCode.F11,
  24: KeyCode.F12,
  25: KeyCode.F13,
  26: KeyCode.F14,
  28: KeyCode.F15,
  29: KeyCode.F16,
  31: KeyCode.F17,
  32: KeyCode.F18,
  33: KeyCode.F19,
  34: KeyCode.F20,
};

/**
 * Decode CSI modifier parameter.
 * Modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0)
 */
function decodeModifier(param: number): KeyMod {
  const val = param - 1;
  let mod = KeyMod.None as number;
  if (val & 1) mod |= KeyMod.Shift;
  if (val & 2) mod |= KeyMod.Alt;
  if (val & 4) mod |= KeyMod.Ctrl;
  if (val & 8) mod |= KeyMod.Meta;
  return mod as KeyMod;
}

/**
 * Find the end of a bracketed paste sequence.
 * Searches for ESC [ 201 ~ starting from offset.
 */
function findPasteEnd(
  data: Buffer | Uint8Array,
  offset: number,
): { start: number; next: number } | null {
  for (let i = offset; i < data.length; i++) {
    if (
      i + 5 < data.length &&
      data[i] === 0x1b &&
      data[i + 1] === 0x5b &&
      data[i + 2] === 0x32 &&
      data[i + 3] === 0x30 &&
      data[i + 4] === 0x31 &&
      data[i + 5] === 0x7e
    ) {
      return { start: i, next: i + 6 };
    }
    if (
      i + 4 < data.length &&
      data[i] === 0x9b &&
      data[i + 1] === 0x32 &&
      data[i + 2] === 0x30 &&
      data[i + 3] === 0x31 &&
      data[i + 4] === 0x7e
    ) {
      return { start: i, next: i + 5 };
    }
  }
  return null;
}

function parseOSC(data: Buffer | Uint8Array, offset: number): ParseResult {
  const terminated = findStringTerminator(data, offset);
  if (!terminated) return { msg: null, next: data.length };
  const payload = Buffer.from(data.slice(offset, terminated.end)).toString('utf8');
  const separator = payload.indexOf(';');
  if (separator < 0) return { msg: null, next: terminated.next };

  const command = Number(payload.slice(0, separator));
  const value = payload.slice(separator + 1);
  if (command === 10) {
    return { msg: new ForegroundColorMsg(normalizeXtermColor(value)), next: terminated.next };
  }
  if (command === 11) {
    return { msg: new BackgroundColorMsg(normalizeXtermColor(value)), next: terminated.next };
  }
  if (command === 12) {
    return { msg: new CursorColorMsg(normalizeXtermColor(value)), next: terminated.next };
  }
  if (command === 52) {
    const split = value.indexOf(';');
    if (split < 1) return { msg: null, next: terminated.next };
    const selection = value.slice(0, split);
    const encoded = value.slice(split + 1);
    let content = encoded;
    try {
      content = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      // Ultraviolet preserves malformed clipboard responses as their raw content.
    }
    return { msg: new ClipboardMsg(content, selection), next: terminated.next };
  }
  return { msg: null, next: terminated.next };
}

function parseDCS(data: Buffer | Uint8Array, offset: number): ParseResult {
  const terminated = findStringTerminator(data, offset);
  if (!terminated) return { msg: null, next: data.length };
  const payload = Buffer.from(data.slice(offset, terminated.end)).toString('ascii');
  if (payload.startsWith('>|')) {
    return { msg: new TerminalVersionMsg(payload.slice(2)), next: terminated.next };
  }
  if (payload.startsWith('1+r')) {
    const capabilities = payload
      .slice(3)
      .split(';')
      .map((entry) => {
        const [name, value] = entry.split('=', 2);
        const decodedName = decodeHex(name);
        const decodedValue = value === undefined ? '' : decodeHex(value);
        return decodedValue ? `${decodedName}=${decodedValue}` : decodedName;
      })
      .filter(Boolean)
      .join(';');
    return { msg: new CapabilityMsg(capabilities), next: terminated.next };
  }
  return { msg: null, next: terminated.next };
}

function parseKittyKey(params: string): Msg {
  const [codeParam = '1', modifierParam = '1', textParam = ''] = params.split(';');
  const [codeText, shiftedText, baseText] = codeParam.split(':');
  const [modifierText, eventText] = modifierParam.split(':');
  const kittyCode = parseKittyPrimaryCode(codeText);
  const code = decodeKittyCode(kittyCode);
  const shiftedCode = validCodepoint(shiftedText);
  const baseCode = validCodepoint(baseText);
  let mod = decodeKittyModifier((Number(modifierText) || 1) - 1);
  if (
    kittyCode === 0 ||
    (kittyCode >= 1 && kittyCode <= 26 && kittyCode !== 8 && kittyCode !== 9 && kittyCode !== 13) ||
    (kittyCode >= 28 && kittyCode <= 31)
  ) {
    mod |= KeyMod.Ctrl;
  }
  let text = textParam
    .split(':')
    .filter(Boolean)
    .map(Number)
    .filter(isUnicodeScalar)
    .map((value) => String.fromCodePoint(value))
    .join('');

  const printableModifiers = mod & ~(KeyMod.Shift | KeyMod.CapsLock | KeyMod.NumLock);
  if (
    !text &&
    printableModifiers === 0 &&
    kittyCode >= 0x20 &&
    isUnicodeScalar(kittyCode) &&
    (kittyCode < 57344 || kittyCode > 57454)
  ) {
    const printableCode =
      shiftedCode && (mod & (KeyMod.Shift | KeyMod.CapsLock)) !== 0
        ? shiftedCode
        : kittyCode;
    text = String.fromCodePoint(printableCode);
  }

  const key = {
    text,
    mod,
    code,
    shiftedCode,
    baseCode,
    isRepeat: eventText === '2',
  };
  return eventText === '3' ? new KeyReleaseMsg(key) : new KeyPressMsg(key);
}

function parseKittyPrimaryCode(value: string): number {
  if (value === '') return 1;
  const codepoint = Number(value);
  if (!Number.isInteger(codepoint)) return 1;
  return isUnicodeScalar(codepoint) ? codepoint : 0xfffd;
}

function validCodepoint(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const codepoint = Number(value);
  return isUnicodeScalar(codepoint) ? codepoint : undefined;
}

function isUnicodeScalar(codepoint: number): boolean {
  return (
    Number.isInteger(codepoint) &&
    codepoint >= 0 &&
    codepoint <= 0x10ffff &&
    (codepoint < 0xd800 || codepoint > 0xdfff)
  );
}

function decodeKittyModifier(value: number): KeyMod {
  let mod = KeyMod.None as number;
  if (value & 1) mod |= KeyMod.Shift;
  if (value & 2) mod |= KeyMod.Alt;
  if (value & 4) mod |= KeyMod.Ctrl;
  if (value & 8) mod |= KeyMod.Super;
  if (value & 16) mod |= KeyMod.Hyper;
  if (value & 32) mod |= KeyMod.Meta;
  if (value & 64) mod |= KeyMod.CapsLock;
  if (value & 128) mod |= KeyMod.NumLock;
  return mod as KeyMod;
}

function decodeKittyCode(code: number): number {
  if (code === 0) return KeyCode.Space;
  if (code === 8 || code === 127 || code === 57347) return KeyCode.Backspace;
  if (code === 9 || code === 57346) return KeyCode.Tab;
  if (code === 13 || code === 57345) return KeyCode.Enter;
  if (code >= 1 && code <= 26) return code + 0x60;
  if (code >= 28 && code <= 31) return code + 0x40;
  if (code === 27 || code === 57344) return KeyCode.Escape;
  if (code >= 57364 && code <= 57383) return KeyCode.F1 + code - 57364;
  if (code >= 57384 && code <= 57426) {
    if (code <= 57398) return ExtendedKeyCode.F21 + code - 57384;
    if (code >= 57399 && code <= 57408) return ExtendedKeyCode.Kp0 + code - 57399;
  }

  const special: Record<number, number> = {
    57348: KeyCode.Insert,
    57349: KeyCode.Delete,
    57350: KeyCode.Left,
    57351: KeyCode.Right,
    57352: KeyCode.Up,
    57353: KeyCode.Down,
    57354: KeyCode.PgUp,
    57355: KeyCode.PgDown,
    57356: KeyCode.Home,
    57357: KeyCode.End,
    57358: ExtendedKeyCode.CapsLock,
    57359: ExtendedKeyCode.ScrollLock,
    57360: ExtendedKeyCode.NumLock,
    57361: ExtendedKeyCode.PrintScreen,
    57362: ExtendedKeyCode.Pause,
    57363: ExtendedKeyCode.Menu,
    57409: ExtendedKeyCode.KpDecimal,
    57410: ExtendedKeyCode.KpDivide,
    57411: ExtendedKeyCode.KpMultiply,
    57412: ExtendedKeyCode.KpMinus,
    57413: ExtendedKeyCode.KpPlus,
    57414: ExtendedKeyCode.KpEnter,
    57415: ExtendedKeyCode.KpEqual,
    57416: ExtendedKeyCode.KpSeparator,
    57417: ExtendedKeyCode.KpLeft,
    57418: ExtendedKeyCode.KpRight,
    57419: ExtendedKeyCode.KpUp,
    57420: ExtendedKeyCode.KpDown,
    57421: ExtendedKeyCode.KpPgUp,
    57422: ExtendedKeyCode.KpPgDown,
    57423: ExtendedKeyCode.KpHome,
    57424: ExtendedKeyCode.KpEnd,
    57425: ExtendedKeyCode.KpInsert,
    57426: ExtendedKeyCode.KpDelete,
    57427: ExtendedKeyCode.KpBegin,
    57428: ExtendedKeyCode.MediaPlay,
    57429: ExtendedKeyCode.MediaPause,
    57430: ExtendedKeyCode.MediaPlayPause,
    57431: ExtendedKeyCode.MediaReverse,
    57432: ExtendedKeyCode.MediaStop,
    57433: ExtendedKeyCode.MediaFastForward,
    57434: ExtendedKeyCode.MediaRewind,
    57435: ExtendedKeyCode.MediaNext,
    57436: ExtendedKeyCode.MediaPrevious,
    57437: ExtendedKeyCode.MediaRecord,
    57438: ExtendedKeyCode.LowerVolume,
    57439: ExtendedKeyCode.RaiseVolume,
    57440: ExtendedKeyCode.Mute,
    57441: ExtendedKeyCode.LeftShift,
    57442: ExtendedKeyCode.LeftCtrl,
    57443: ExtendedKeyCode.LeftAlt,
    57444: ExtendedKeyCode.LeftSuper,
    57445: ExtendedKeyCode.LeftHyper,
    57446: ExtendedKeyCode.LeftMeta,
    57447: ExtendedKeyCode.RightShift,
    57448: ExtendedKeyCode.RightCtrl,
    57449: ExtendedKeyCode.RightAlt,
    57450: ExtendedKeyCode.RightSuper,
    57451: ExtendedKeyCode.RightHyper,
    57452: ExtendedKeyCode.RightMeta,
    57453: ExtendedKeyCode.IsoLevel3Shift,
    57454: ExtendedKeyCode.IsoLevel5Shift,
  };
  return special[code] ?? code;
}

function findStringTerminator(
  data: Buffer | Uint8Array,
  offset: number,
): { end: number; next: number } | null {
  for (let i = offset; i < data.length; i++) {
    if (data[i] === 0x07 || data[i] === 0x9c) return { end: i, next: i + 1 };
    if (data[i] === 0x1b && data[i + 1] === 0x5c) return { end: i, next: i + 2 };
  }
  return null;
}

function normalizeXtermColor(color: string): string {
  if (!color.startsWith('rgb:')) return color;
  const channels = color
    .slice(4)
    .split('/')
    .map((channel) => {
      const value = parseInt(channel, 16);
      const maximum = 16 ** channel.length - 1;
      return Math.round((value / maximum) * 255)
        .toString(16)
        .padStart(2, '0');
    });
  return channels.length === 3 && channels.every((channel) => channel !== 'NaN')
    ? `#${channels.join('')}`
    : color;
}

function decodeHex(value: string): string {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return '';
  return Buffer.from(value, 'hex').toString('utf8');
}


/**
 * Incremental decoder used by Program so escape sequences and UTF-8 code
 * points split across stream chunks are never misreported as standalone keys.
 */
export class InputDecoder {
  private pending = Buffer.alloc(0);

  feed(chunk: Buffer | Uint8Array): Msg[] {
    const incoming = Buffer.from(chunk);
    const data =
      this.pending.length === 0
        ? incoming
        : Buffer.concat([this.pending, incoming], this.pending.length + incoming.length);
    const complete = completeInputPrefix(data);
    this.pending = complete === data.length ? Buffer.alloc(0) : data.subarray(complete);
    return complete === 0 ? [] : parseInput(data.subarray(0, complete));
  }


  flush(): Msg[] {
    if (this.pending.length === 1 && this.pending[0] === 0x1b) {
      this.pending = Buffer.alloc(0);
      return parseInput(Buffer.from([0x1b]));
    }
    return [];
  }
  reset(): void {
    this.pending = Buffer.alloc(0);
  }
}

function completeInputPrefix(data: Buffer | Uint8Array): number {
  let i = 0;
  while (i < data.length) {
    const byte = data[i];
    if (byte === 0x1b) {
      if (i + 1 >= data.length) return i;
      const next = data[i + 1];
      if (next === 0x5d || next === 0x50) {
        const terminated = findStringTerminator(data, i + 2);
        if (!terminated) return i;
        i = terminated.next;
        continue;
      }
      if (next === 0x5b) {
        if (
          i + 6 <= data.length &&
          Buffer.from(data.slice(i, i + 6)).toString('ascii') === '\x1b[200~'
        ) {
          const pasteEnd = findPasteEnd(data, i + 6);
          if (!pasteEnd) return i;
          i = pasteEnd.next;
          continue;
        }
        let final = i + 2;
        while (final < data.length && (data[final] < 0x40 || data[final] > 0x7e)) final++;
        if (final >= data.length) return i;
        if (data[final] === 0x4d && final === i + 2 && final + 3 >= data.length) return i;
        i = data[final] === 0x4d && final === i + 2 ? final + 4 : final + 1;
        continue;
      }
      if (next === 0x4f) {
        if (i + 2 >= data.length) return i;
        i += 3;
        continue;
      }
      const width = utf8Width(next);
      if (i + 1 + width > data.length) return i;
      i += 1 + width;
      continue;
    }

    if (byte === 0x9d || byte === 0x90) {
      const terminated = findStringTerminator(data, i + 1);
      if (!terminated) return i;
      i = terminated.next;
      continue;
    }
    if (byte === 0x9b) {
      if (
        i + 5 <= data.length &&
        Buffer.from(data.slice(i, i + 5)).toString('latin1') === '\x9b200~'
      ) {
        const pasteEnd = findPasteEnd(data, i + 5);
        if (!pasteEnd) return i;
        i = pasteEnd.next;
        continue;
      }
      let final = i + 1;
      while (final < data.length && (data[final] < 0x40 || data[final] > 0x7e)) final++;
      if (final >= data.length) return i;
      if (data[final] === 0x4d && final === i + 1 && final + 3 >= data.length) return i;
      i = data[final] === 0x4d && final === i + 1 ? final + 4 : final + 1;
      continue;
    }
    if (byte === 0x8f) {
      if (i + 1 >= data.length) return i;
      i += 2;
      continue;
    }

    const width = utf8Width(byte);
    if (i + width > data.length) return i;
    i += width;
  }
  return i;
}

function utf8Width(firstByte: number): number {
  if (firstByte < 0x80) return 1;
  if ((firstByte & 0xe0) === 0xc0) return 2;
  if ((firstByte & 0xf0) === 0xe0) return 3;
  if ((firstByte & 0xf8) === 0xf0) return 4;
  return 1;
}