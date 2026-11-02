/**
 * The Program Status Protocol (OSC 7501) from the terminal's side: finding the
 * reports in a program's output, decoding them, and drawing one as a status
 * line. host.ts uses it, and so do the tests.
 */

export interface StatusRecord {
  id: string;
  state: string;
  kind?: string;
  progress?: number;
  app?: string;
  title?: string;
  message?: string;
}

/**
 * Parses the payload of an OSC 7501 report (what comes after "7501;"):
 * `state=working:progress=40:app=canary:title=<base64>:msg=<base64>`.
 * Returns null for the support query ("?") and for anything without a state.
 */
export function parseReport(payload: string): StatusRecord | null {
  if (payload.startsWith('?')) return null;
  const rec: StatusRecord = { id: '', state: '' };
  for (const pair of payload.split(':')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const [k, v] = [pair.slice(0, eq), pair.slice(eq + 1)];
    if (k === 'state') rec.state = v;
    else if (k === 'id') rec.id = v;
    else if (k === 'kind') rec.kind = v;
    else if (k === 'progress') rec.progress = Number(v);
    else if (k === 'app') rec.app = v;
    else if (k === 'title') rec.title = Buffer.from(v, 'base64').toString('utf8');
    else if (k === 'msg') rec.message = Buffer.from(v, 'base64').toString('utf8');
  }
  return rec.state ? rec : null;
}

/**
 * Splits a program's output into what goes to the screen and OSC 7501
 * sequences, across chunk boundaries. `ground` says whether the last chunk
 * ended outside any escape sequence, so something can be drawn between chunks.
 */
export class OscFilter {
  private state: 'ground' | 'esc' | 'csi' | 'osc' | 'osc-esc' | 'str' | 'str-esc' = 'ground';
  private osc = '';

  private readonly onOsc7501: (payload: string) => void;

  constructor(onOsc7501: (payload: string) => void) {
    this.onOsc7501 = onOsc7501;
  }

  get ground(): boolean {
    return this.state === 'ground';
  }

  /** Returns the bytes to pass on to the screen. */
  write(chunk: string): string {
    let out = '';
    for (const ch of chunk) {
      switch (this.state) {
        case 'ground':
          if (ch === '\x1b') this.state = 'esc';
          else out += ch;
          break;
        case 'esc':
          if (ch === ']') {
            this.state = 'osc';
            this.osc = '';
          } else {
            out += `\x1b${ch}`;
            this.state = ch === '[' ? 'csi' : ch === 'P' || ch === '_' || ch === '^' || ch === 'X' ? 'str' : 'ground';
          }
          break;
        case 'csi':
          out += ch;
          if (ch >= '@' && ch <= '~') this.state = 'ground';
          break;
        case 'str': // DCS, APC, PM, SOS: passed on, ends with ST
          out += ch;
          if (ch === '\x1b') this.state = 'str-esc';
          break;
        case 'str-esc':
          out += ch;
          this.state = ch === '\\' ? 'ground' : 'str';
          break;
        case 'osc':
          if (ch === '\x07') this.endOsc('\x07', (s) => (out += s));
          else if (ch === '\x1b') this.state = 'osc-esc';
          else this.osc += ch;
          break;
        case 'osc-esc':
          if (ch === '\\') this.endOsc('\x1b\\', (s) => (out += s));
          else {
            this.osc += `\x1b${ch}`;
            this.state = 'osc';
          }
          break;
      }
    }
    return out;
  }

  private endOsc(terminator: string, pass: (s: string) => void): void {
    this.state = 'ground';
    if (this.osc.startsWith('7501;')) this.onOsc7501(this.osc.slice(5));
    else pass(`\x1b]${this.osc}${terminator}`);
    this.osc = '';
  }
}

const COLOURS: Record<string, string> = { working: '38;2;137;180;250', idle: '38;2;108;112;134', blocked: '38;2;249;226;175', done: '38;2;166;227;161', error: '38;2;243;139;168' };
const ICONS: Record<string, string> = { working: '◐', idle: '○', blocked: '◆', done: '✓', error: '✗' };

/** The status line for a record, `cols` wide. */
export function statusLine(rec: StatusRecord | undefined, reports: number, cols: number): string {
  const right = ` OSC 7501 · ${reports} report${reports === 1 ? '' : 's'} `;
  let left = ' no status reported';
  let colour = '38;2;108;112;134';
  if (rec) {
    colour = COLOURS[rec.state] ?? colour;
    const what = [rec.state, rec.kind ? `(${rec.kind})` : '', rec.progress !== undefined ? `${rec.progress}%` : ''].filter(Boolean).join(' ');
    left = ` ${ICONS[rec.state] ?? '•'} ${rec.app ?? 'program'}${rec.title ? ` · ${rec.title}` : ''} · ${what}${rec.message ? ` · ${rec.message}` : ''}`;
  }
  const room = cols - right.length;
  if ([...left].length > room) left = `${[...left].slice(0, room - 1).join('')}…`;
  left = left.padEnd(room);
  return `\x1b[0;7;${colour}m${left}\x1b[0;2;7m${right}\x1b[0m`;
}
