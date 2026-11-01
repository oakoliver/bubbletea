/**
 * Colour profiles: detection and downsampling.
 *
 * Ports the parts of github.com/charmbracelet/colorprofile (v0.4.3), x/ansi
 * (`Convert256`, `Convert16`) and go-colorful (HSLuv distance) that Bubble
 * Tea v2 uses. In Go the renderer parses each frame into cells and converts
 * every cell's style to the program's profile (ultraviolet `ConvertStyle`);
 * this renderer works on strings, so the same conversion is applied to the
 * SGR sequences of the frame instead.
 */

import { ColorProfile } from './types.js';

// ─── Profiles ───────────────────────────────────────────────────────────────

const RANK: Record<ColorProfile, number> = {
  [ColorProfile.NoTTY]: 1,
  [ColorProfile.Ascii]: 2,
  [ColorProfile.ANSI]: 3,
  [ColorProfile.ANSI256]: 4,
  [ColorProfile.TrueColor]: 5,
};

function maxProfile(a: ColorProfile, b: ColorProfile): ColorProfile {
  return RANK[a] >= RANK[b] ? a : b;
}

// ─── Detection (colorprofile.Detect) ────────────────────────────────────────

/** Go's strconv.ParseBool, which is what colorprofile uses for every flag. */
function parseBool(value: string | undefined): boolean {
  return value !== undefined && ['1', 't', 'T', 'TRUE', 'true', 'True'].includes(value);
}

function toMap(environment: readonly string[]): Map<string, string> {
  const env = new Map<string, string>();
  for (const entry of environment) {
    const i = entry.indexOf('=');
    if (i < 0) env.set(entry, '');
    else env.set(entry.slice(0, i), entry.slice(i + 1));
  }
  return env;
}

/** The Windows console's capabilities when TERM is not set (colorprofile's windowsColorProfile). */
function windowsColorProfile(env: Map<string, string>, platform: string, osRelease: string): ColorProfile | null {
  if (platform !== 'win32') return null;
  if (env.get('ConEmuANSI') === 'ON') return ColorProfile.TrueColor;
  const [major = 0, , build = 0] = osRelease.split('.').map((n) => Number.parseInt(n, 10) || 0);
  if (build < 10586 || major < 10) {
    if ((env.get('ANSICON') ?? '').length > 0) {
      const version = Number.parseInt(env.get('ANSICON_VER') ?? '', 10);
      return Number.isNaN(version) || version < 181 ? ColorProfile.ANSI : ColorProfile.ANSI256;
    }
    return ColorProfile.NoTTY;
  }
  return build < 14931 ? ColorProfile.ANSI256 : ColorProfile.TrueColor;
}

function colorTerm(env: Map<string, string>): boolean {
  const value = (env.get('COLORTERM') ?? '').toLowerCase();
  return value === 'truecolor' || value === '24bit' || value === 'yes' || value === 'true';
}

function envColorProfile(env: Map<string, string>, platform: string, osRelease: string): ColorProfile {
  const term = env.get('TERM') ?? '';
  let p: ColorProfile;
  if (term.length === 0 || term === 'dumb') {
    p = windowsColorProfile(env, platform, osRelease) ?? ColorProfile.NoTTY;
  } else {
    p = ColorProfile.ANSI;
  }

  if (['alacritty', 'contour', 'foot', 'ghostty', 'kitty', 'rio', 'st', 'wezterm'].some((t) => term.includes(t))) {
    return ColorProfile.TrueColor;
  }
  if (term.startsWith('tmux') || term.startsWith('screen')) {
    p = maxProfile(p, ColorProfile.ANSI256);
  } else if (term.startsWith('xterm')) {
    p = maxProfile(p, ColorProfile.ANSI);
  }

  if ((env.get('WT_SESSION') ?? '').length > 0) return ColorProfile.TrueColor;
  if (parseBool(env.get('GOOGLE_CLOUD_SHELL'))) return ColorProfile.TrueColor;
  // GNU Screen doesn't support TrueColor, and tmux doesn't set $COLORTERM.
  if (colorTerm(env) && !term.startsWith('screen') && !term.startsWith('tmux')) return ColorProfile.TrueColor;
  if (term.endsWith('256color')) p = maxProfile(p, ColorProfile.ANSI256);
  if (term.endsWith('direct')) return ColorProfile.TrueColor;
  return p;
}

function envProfile(isatty: boolean, env: Map<string, string>, platform: string, osRelease: string): ColorProfile {
  const term = env.get('TERM');
  const isDumb = (term === undefined && platform !== 'win32') || term === 'dumb';
  const envp = envColorProfile(env, platform, osRelease);
  let p = !isatty || isDumb ? ColorProfile.NoTTY : envp;

  if (parseBool(env.get('NO_COLOR')) && isatty) {
    // NO_COLOR disables colours but not text decoration (bold, italic...).
    return RANK[p] > RANK[ColorProfile.Ascii] ? ColorProfile.Ascii : p;
  }
  if (parseBool(env.get('CLICOLOR_FORCE'))) {
    p = maxProfile(p, ColorProfile.ANSI);
    return maxProfile(p, envp);
  }
  if (parseBool(env.get('CLICOLOR')) && isatty && !isDumb) {
    p = maxProfile(p, ColorProfile.ANSI);
  }
  return p;
}

/** Where a profile is detected: the output (is it a terminal?) and the platform. */
export interface ColorProfileTarget {
  isTTY?: boolean;
}

/**
 * Detects the colour profile of an output from the environment, as Go's
 * `colorprofile.Detect` does:
 *
 * - An output that is not a terminal is `NoTTY` (no styling at all), unless
 *   `TTY_FORCE` is true or `CLICOLOR_FORCE` is set. `TERM=dumb` is `NoTTY` too.
 * - `NO_COLOR` (a true value: `1`, `true`...) caps a terminal at `Ascii`:
 *   no colours, but bold, italic and so on stay.
 * - `CLICOLOR_FORCE` forces at least `ANSI`, and `CLICOLOR` turns on `ANSI` for
 *   a terminal without a colour `TERM`.
 * - Otherwise `COLORTERM`, `TERM` (`*-256color`, `*-direct`, kitty, ghostty...),
 *   `WT_SESSION` and `GOOGLE_CLOUD_SHELL` decide, and `TMUX` means at least 256 colours.
 *
 * Unlike Go, the terminfo database and `tmux info` are not read: a terminal
 * whose only TrueColor hint is its terminfo `Tc`/`RGB` capability is detected
 * from its environment alone (pass `WithColorProfile` to force a profile).
 */
export function detectColorProfile(
  output: ColorProfileTarget | null | undefined,
  environment: readonly string[],
  platform: string = typeof process !== 'undefined' ? process.platform : '',
  osRelease = '',
): ColorProfile {
  const env = toMap(environment);
  const isatty = parseBool(env.get('TTY_FORCE')) || output?.isTTY === true;
  const term = env.get('TERM');
  const isDumb = term === undefined || term === 'dumb';
  const envp = envProfile(isatty, env, platform, osRelease);
  if (envp === ColorProfile.TrueColor || parseBool(env.get('NO_COLOR'))) return envp;

  if (isatty && !isDumb) {
    // Go also takes the maximum with terminfo (at least ANSI for any TERM)
    // and `tmux info` (at least 256 colours inside tmux).
    let p = maxProfile(envp, ColorProfile.ANSI);
    if ((env.get('TMUX') ?? '').length > 0) p = maxProfile(p, ColorProfile.ANSI256);
    return p;
  }
  return envp;
}

// ─── Colour conversion (x/ansi Convert256 / Convert16) ──────────────────────

/** x/ansi's ansi256To16: the 16-colour equivalent of each xterm 256-colour index. */
const ANSI256_TO_16: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 4, 4, 4, 12, 12, 2, 6, 4, 4, 12, 12, 2, 2, 6, 4,
  12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 5, 4, 4, 12, 12, 3, 8, 4, 4, 12, 12,
  2, 2, 6, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 5, 4, 12, 12,
  1, 1, 5, 4, 12, 12, 3, 3, 8, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1,
  1, 5, 12, 12, 1, 1, 1, 5, 12, 12, 1, 1, 1, 5, 12, 12, 3, 3, 3, 7, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10,
  10, 14, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 11, 11, 11, 11, 7, 12,
  10, 10, 10, 10, 10, 14, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9, 9,
  9, 9, 9, 13, 11, 11, 11, 11, 11, 15, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 15, 15, 15, 15,
  15, 15,
];

// go-colorful's HSLuv, used by Convert256 to choose between the cube and the greys.
const HSLUV_D65 = [0.95045592705167, 1.0, 1.089057750759878] as const;
const HSLUV_M = [
  [3.2409699419045214, -1.5373831775700935, -0.49861076029300328],
  [-0.96924363628087983, 1.8759675015077207, 0.041555057407175613],
  [0.055630079696993609, -0.20397695888897657, 1.0569715142428786],
] as const;
const KAPPA = 903.2962962962963;
const EPSILON = 0.0088564516790356308;

const sq = (v: number) => v * v;
const clamp01 = (v: number) => Math.max(0, Math.min(v, 1));

function linearize(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function xyzToUv(x: number, y: number, z: number): [number, number] {
  const denom = x + 15.0 * y + 3.0 * z;
  return denom === 0 ? [0, 0] : [(4.0 * x) / denom, (9.0 * y) / denom];
}

function maxChromaForLH(l: number, h: number): number {
  const hRad = (h / 360.0) * Math.PI * 2.0;
  const sub1 = Math.pow(l + 16.0, 3.0) / 1560896.0;
  const sub2 = sub1 > EPSILON ? sub1 : l / KAPPA;
  let minLength = Number.MAX_VALUE;
  for (const m of HSLUV_M) {
    for (let k = 0; k < 2; k++) {
      const top1 = (284517.0 * m[0] - 94839.0 * m[2]) * sub2;
      const top2 = (838422.0 * m[2] + 769860.0 * m[1] + 731718.0 * m[0]) * l * sub2 - 769860.0 * k * l;
      const bottom = (632260.0 * m[2] - 126452.0 * m[1]) * sub2 + 126452.0 * k;
      const length = top2 / bottom / (Math.sin(hRad) - (top1 / bottom) * Math.cos(hRad));
      if (length > 0.0 && length < minLength) minLength = length;
    }
  }
  return minLength;
}

/** HSLuv of an sRGB colour with channels in [0, 1]. */
function hsluv(r: number, g: number, b: number): [number, number, number] {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);
  const x = 0.41239079926595948 * lr + 0.35758433938387796 * lg + 0.18048078840183429 * lb;
  const y = 0.21263900587151036 * lr + 0.71516867876775593 * lg + 0.072192315360733715 * lb;
  const z = 0.019330818715591851 * lr + 0.11919477979462599 * lg + 0.95053215224966058 * lb;

  // XYZ to Luv with the HSLuv white reference.
  const [wx, wy, wz] = HSLUV_D65;
  // Go folds the constants exactly: (6/29)³ = 216/24389 and (29/3)³ = 24389/27.
  const L = y / wy <= 216 / 24389 ? ((y / wy) * (24389 / 27)) / 100.0 : 1.16 * Math.cbrt(y / wy) - 0.16;
  const [ubis, vbis] = xyzToUv(x, y, z);
  const [un, vn] = xyzToUv(wx, wy, wz);
  const u = 13.0 * L * (ubis - un);
  const v = 13.0 * L * (vbis - vn);

  // Luv to LCh.
  const h = Math.abs(v - u) > 1e-4 && Math.abs(u) > 1e-4 ? (57.29577951308232087721 * Math.atan2(v, u) + 360.0) % 360.0 : 0.0;
  const c = Math.sqrt(sq(u) + sq(v));

  // LCh to HSLuv.
  const c100 = c * 100.0;
  const l100 = L * 100.0;
  const s = l100 > 99.9999999 || l100 < 0.00000001 ? 0.0 : (c100 / maxChromaForLH(l100, h)) * 100.0;
  return [h, clamp01(s / 100.0), clamp01(l100 / 100.0)];
}

function distanceHSLuv(a: [number, number, number], b: [number, number, number]): number {
  const [h1, s1, l1] = hsluv(...a);
  const [h2, s2, l2] = hsluv(...b);
  return Math.sqrt(sq((h1 - h2) / 100.0) + sq(s1 - s2) + sq(l1 - l2));
}

function to6Cube(v: number): number {
  if (v < 48) return 0;
  if (v < 115) return 1;
  return Math.trunc((v - 35) / 40);
}

/**
 * Converts a 24-bit colour to the xterm 256-colour palette, as x/ansi's
 * `Convert256`: the nearest of the 6×6×6 cube and the 24 greys, compared by
 * HSLuv distance.
 */
export function convert256(r8: number, g8: number, b8: number): number {
  // colorful.MakeColor: 8-bit channels widened to 16 bits, then scaled to [0, 1].
  const col: [number, number, number] = [(r8 * 257) / 65535, (g8 * 257) / 65535, (b8 * 257) / 65535];
  const r = col[0] * 255;
  const g = col[1] * 255;
  const b = col[2] * 255;

  const q2c = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  const qr = to6Cube(r);
  const qg = to6Cube(g);
  const qb = to6Cube(b);
  const cr = q2c[qr]!;
  const cg = q2c[qg]!;
  const cb = q2c[qb]!;

  const ci = 36 * qr + 6 * qg + qb;
  if (cr === Math.trunc(r) && cg === Math.trunc(g) && cb === Math.trunc(b)) return 16 + ci;

  const greyAvg = Math.trunc(Math.trunc(r + g + b) / 3);
  const greyIdx = greyAvg > 238 ? 23 : Math.trunc((greyAvg - 3) / 10);
  const grey = 8 + 10 * greyIdx;

  const colorDist = distanceHSLuv(col, [cr / 255.0, cg / 255.0, cb / 255.0]);
  const grayDist = distanceHSLuv(col, [grey / 255.0, grey / 255.0, grey / 255.0]);
  return colorDist <= grayDist ? 16 + ci : 232 + greyIdx;
}

/** Converts an xterm 256-colour index to the 16 ANSI colours, as x/ansi's `Convert16`. */
export function convert16(index: number): number {
  return ANSI256_TO_16[index] ?? 0;
}

// ─── SGR downsampling ───────────────────────────────────────────────────────

/** A colour as Go's colour types see it: basic (0–15), indexed (0–255) or RGB. */
type Color =
  | { kind: 'basic'; index: number }
  | { kind: 'indexed'; index: number }
  | { kind: 'rgb'; r: number; g: number; b: number }
  | null;

/** colorprofile's Profile.Convert. */
function convertColor(c: Color, profile: ColorProfile): Color {
  if (c === null || profile === ColorProfile.TrueColor || c.kind === 'basic') return c;
  if (c.kind === 'indexed') {
    return profile === ColorProfile.ANSI ? { kind: 'basic', index: convert16(c.index) } : c;
  }
  const index = convert256(c.r, c.g, c.b);
  return profile === ColorProfile.ANSI ? { kind: 'basic', index: convert16(index) } : { kind: 'indexed', index };
}

/** x/ansi's foreground/background/underline colour attribute for a colour. */
function colorAttr(target: 38 | 48 | 58, c: Color): string {
  if (c === null) return String(target + 1);
  if (c.kind === 'basic') {
    if (target === 58) return `58;5;${c.index}`; // no 3/4-bit underline colours
    const base = target === 38 ? 30 : 40;
    return String(c.index < 8 ? base + c.index : base + 60 + c.index - 8);
  }
  if (c.kind === 'indexed') return `${target};5;${c.index}`;
  return `${target};2;${c.r};${c.g};${c.b}`;
}

interface Param {
  /** The value, or -1 when it is missing (an empty parameter). */
  value: number;
  /** Whether a sub-parameter follows (the parameter ends with ':'). */
  more: boolean;
}

function parseParams(body: string): Param[] {
  const params: Param[] = [];
  let current = '';
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === undefined || ch === ';' || ch === ':') {
      params.push({ value: current === '' ? -1 : Number.parseInt(current, 10), more: ch === ':' });
      current = '';
    } else {
      current += ch;
    }
  }
  return params;
}

const paramValue = (p: Param | undefined) => (p === undefined || p.value < 0 ? 0 : p.value);
const clampByte = (v: number) => Math.max(0, Math.min(255, v)) & 0xff;

/**
 * Reads a 38/48/58 colour, as x/ansi's ReadStyleColor: `38;5;n`, `38;2;r;g;b`,
 * `38:5:n`, `38:2::r:g:b` and `38:2:r:g:b`. Returns how many parameters it read
 * (0 when the colour is malformed) and the colour.
 */
function readStyleColor(params: Param[], i: number): [number, Color] {
  if (params.length - i < 2) return [0, null];
  const s = params[i]!;
  const p = params[i + 1]!;
  const at = (k: number) => params[i + k];
  const type = paramValue(p);
  switch (type) {
    case 0:
      return [2, null];
    case 1: // transparent: RGBA 0,0,0,0, which Convert256 cannot place and maps to index 0
      return [2, { kind: 'indexed', index: 0 }];
    case 5:
      if (params.length - i < 3) return [0, null];
      return [3, { kind: 'indexed', index: clampByte(paramValue(at(2))) }];
    case 2:
    case 3:
    case 4:
    case 6: {
      const n = params.length - i;
      if (n < 5) return [0, null];
      let consumed = 2;
      let values: [number, number, number, number];
      if (s.more && p.more && n > 6 && at(2)!.more && at(3)!.more && at(4)!.more && at(5)!.more) {
        consumed += 5;
        values = [paramValue(at(3)), paramValue(at(4)), paramValue(at(5)), paramValue(at(6))];
      } else if (s.more && p.more && n > 5 && at(2)!.more && at(3)!.more && at(4)!.more && !at(5)!.more) {
        consumed += 4;
        values = [paramValue(at(3)), paramValue(at(4)), paramValue(at(5)), -1];
      } else if (
        (s.more && p.more && type === 2 && at(2)!.more && at(3)!.more && !at(4)!.more) ||
        (!s.more && !p.more && type === 2 && !at(2)!.more && !at(3)!.more && !at(4)!.more)
      ) {
        consumed += 3;
        values = [paramValue(at(2)), paramValue(at(3)), paramValue(at(4)), -1];
      } else {
        return [0, null];
      }
      const [a, b, c, d] = values;
      if (type === 3 || type === 4) {
        // CMY(K) direct colour, through Go's color.CMYK.
        const k = type === 4 && d >= 0 ? clampByte(d) : 0;
        const w = 0xffff - k * 0x101;
        const ch = (v: number) => Math.trunc((((0xffff - clampByte(v) * 0x101) * w) / 0xffff) / 257);
        return [consumed, { kind: 'rgb', r: ch(a), g: ch(b), b: ch(c) }];
      }
      return [consumed, { kind: 'rgb', r: clampByte(a), g: clampByte(b), b: clampByte(c) }];
    }
    default:
      return [0, null];
  }
}

/**
 * Downsamples the parameters of one SGR sequence (colorprofile's handleSgr).
 * Returns the new parameter list, or null when nothing changes.
 */
function downsampleSgrParams(body: string, profile: ColorProfile): string[] | null {
  const params = parseParams(body);
  const out: string[] = [];
  const noColor = RANK[profile] < RANK[ColorProfile.ANSI];
  let changed = false;
  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const v = paramValue(param);
    if (v === 38 || v === 48 || v === 58) {
      const [n, c] = readStyleColor(params, i);
      // A colour we cannot read leaves the sequence as it was written.
      if (n === 0) return null;
      const raw = params.slice(i, i + n);
      i += n - 1;
      if (noColor) {
        changed = true;
        continue;
      }
      const converted = convertColor(c, profile);
      if (converted === c) {
        // Unchanged (already within the profile): keep the original spelling.
        out.push(spell(raw));
      } else {
        out.push(colorAttr(v, converted));
        changed = true;
      }
      continue;
    }
    const isColor =
      (v >= 30 && v <= 37) || v === 39 || (v >= 40 && v <= 47) || v === 49 || v === 59 ||
      (v >= 90 && v <= 97) || (v >= 100 && v <= 107);
    if (isColor && noColor) {
      changed = true;
      continue;
    }
    // Attributes keep their sub-parameters (4:3 curly underline).
    let j = i;
    while (params[j]!.more && j + 1 < params.length) j++;
    out.push(spell(params.slice(i, j + 1)));
    i = j;
  }
  return changed ? out : null;
}

/** Writes parameters back as they were: ':' after one with sub-parameters, ';' otherwise. */
function spell(params: Param[]): string {
  let s = '';
  params.forEach((p, k) => {
    s += p.value < 0 ? '' : String(p.value);
    if (k < params.length - 1) s += p.more ? ':' : ';';
  });
  return s;
}

/**
 * Converts every escape sequence of a string for a colour profile, as Bubble
 * Tea's renderer does with each cell it draws:
 *
 * - `TrueColor` leaves the string as it is.
 * - `ANSI256` turns 24-bit colours into the nearest of the 256 colours.
 * - `ANSI` turns 24-bit and 256 colours into the 16 ANSI colours.
 * - `Ascii` removes colours but keeps attributes (bold, italic, underline...).
 * - `NoTTY` removes every escape sequence: no styles and no hyperlinks.
 */
export function convertForProfile(s: string, profile: ColorProfile): string {
  if (profile === ColorProfile.TrueColor || !s.includes('\x1b')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const esc = s.indexOf('\x1b', i);
    if (esc < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, esc);
    const end = sequenceEnd(s, esc);
    const seq = s.slice(esc, end);
    i = end;
    if (profile === ColorProfile.NoTTY) continue;
    const sgr = /^\x1b\[([0-9;:]*)m$/.exec(seq);
    if (!sgr) {
      out += seq;
      continue;
    }
    const params = downsampleSgrParams(sgr[1]!, profile);
    if (params === null) out += seq;
    // A sequence that only set colours has nothing left to say.
    else if (params.length > 0) out += `\x1b[${params.join(';')}m`;
  }
  return out;
}

/** The index just past the escape sequence that starts at `start`. */
function sequenceEnd(s: string, start: number): number {
  const kind = s[start + 1];
  if (kind === undefined) return s.length;
  if (kind === '[') {
    // CSI: parameter and intermediate bytes, then a final byte in 0x40–0x7e.
    for (let i = start + 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return i + 1;
      if (c < 0x20 || c > 0x3f) return i; // malformed: stop before it
    }
    return s.length;
  }
  if (kind === ']' || kind === 'P' || kind === '_' || kind === '^' || kind === 'X') {
    // OSC, DCS, APC, PM, SOS: a string terminated by ST (ESC \) or BEL.
    for (let i = start + 2; i < s.length; i++) {
      if (s[i] === '\x07') return i + 1;
      if (s[i] === '\x1b') return s[i + 1] === '\\' ? i + 2 : i;
    }
    return s.length;
  }
  // ESC, intermediate bytes, final byte.
  let i = start + 1;
  while (i < s.length && s.charCodeAt(i) >= 0x20 && s.charCodeAt(i) <= 0x2f) i++;
  return Math.min(i + 1, s.length);
}
