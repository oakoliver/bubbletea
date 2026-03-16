/**
 * Input parser — reads raw bytes from stdin and produces Msg events.
 * Parses ANSI escape sequences for keys, mouse, paste, focus, etc.
 * Zero-dependency implementation.
 */

import {
  type Msg,
  KeyPressMsg,
  KeyCode,
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

      // Alt+Ctrl combo: ESC followed by control char
      if (next >= 1 && next <= 26) {
        msgs.push(
          new KeyPressMsg({
            text: '',
            mod: KeyMod.Alt | KeyMod.Ctrl,
            code: next + 0x60, // convert to lowercase letter
          }),
        );
        i += 2;
        continue;
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
  if (final === 0x52) {
    // R = CPR
    const parts = params.split(';').map(Number);
    if (parts.length >= 2) {
      return {
        msg: new CursorPositionMsg(parts[1] - 1, parts[0] - 1),
        next: i,
      };
    }
    return { msg: null, next: i };
  }

  // ─── Bracketed paste ─────────────────────────────────────────────
  if (final === 0x7e) {
    // ~ = tilde
    if (params === '200') {
      // Paste start — collect until ESC [ 201 ~
      const pasteEnd = findPasteEnd(data, i);
      if (pasteEnd >= 0) {
        const content = Buffer.from(data.slice(i, pasteEnd)).toString('utf-8');
        return {
          msg: new PasteMsg(content),
          next: pasteEnd + 6, // skip ESC [ 201 ~
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
    case 0x0a: // Ctrl+J (Line Feed / Enter in some terminals)
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
function findPasteEnd(data: Buffer | Uint8Array, offset: number): number {
  for (let i = offset; i < data.length - 5; i++) {
    if (
      data[i] === 0x1b &&
      data[i + 1] === 0x5b &&
      data[i + 2] === 0x32 && // '2'
      data[i + 3] === 0x30 && // '0'
      data[i + 4] === 0x31 && // '1'
      data[i + 5] === 0x7e // '~'
    ) {
      return i;
    }
  }
  return -1;
}
