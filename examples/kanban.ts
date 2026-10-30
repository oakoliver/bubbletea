/**
 * Kanban — a full-screen board built with @oakoliver/bubbletea, @oakoliver/bubbles
 * and @oakoliver/lipgloss: three columns of cards, a live filter, modal dialogs
 * drawn as Lip Gloss layers over the dimmed board, and mouse support (click,
 * wheel, and drag a card to another column).
 *
 * Usage:
 *   bun examples/kanban.ts                  in-memory board with twelve invented cards
 *   bun examples/kanban.ts --file board.json  load board.json if it exists and save it
 *                                           after every change (nothing is ever written
 *                                           without --file)
 *
 * Keys:
 *   ←/→ h/l   column               ↑/↓ k/j   card
 *   shift+←/→ or </>  move the card to the next column
 *   shift+↑/↓         reorder within the column
 *   n new · e/enter edit · d delete (asks first) · / filter (live) · ? help · q quit
 * In the new/edit dialog: tab or ↑/↓ next field · ←/→ choose a tag or assignee ·
 * enter saves · esc cancels.
 * Mouse: click a card to select it, click a column header to focus it, wheel
 * scrolls a column, press-and-drag a card to move it (a ghost follows the pointer).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  NewProgram, View, Quit, Batch, Tick, WindowSizeMsg, KeyPressMsg, MouseClickMsg, MouseReleaseMsg,
  MouseMotionMsg, MouseWheelMsg, MouseButton, MouseMode,
} from '../src/index.ts';
import type { Cmd, Msg } from '../src/index.ts';
import {
  newStyle, joinHorizontal, joinVertical, place, Top, Left, Center, stringWidth, truncate,
  newLayer, newCompositor, blend1D, colorToRGB, fgColor,
} from '@oakoliver/lipgloss';
import {
  newTextInput, textInputDefaultDarkStyles, newHelp, newBinding, withKeys, withHelp, matches,
} from '@oakoliver/bubbles';
import type { Binding } from '@oakoliver/bubbles';

// ── data ───────────────────────────────────────────────────────────────────
interface Card { id: number; title: string; tag: string; who: string }

const C = {
  violet: '#7D56F4', pink: '#EE6FF8', cyan: '#3EE6D2', green: '#04D98B', amber: '#FFB454',
  red: '#FF5F87', blue: '#5A8DEE', dim: '#6C6C88', text: '#D6D6E7', faint: '#3A3A4E', ink: '#0B0B14',
  white: '#FFFFFF', selBg: '#2B2347',
};
const COLUMNS = [
  { name: 'To do', color: C.blue },
  { name: 'In progress', color: C.amber },
  { name: 'Done', color: C.green },
];
const TAGS = [
  { name: 'bug', color: C.red }, { name: 'feature', color: '#9B7DFF' },
  { name: 'docs', color: C.cyan }, { name: 'chore', color: C.amber },
];
const PEOPLE = ['MK', 'JR', 'SL', 'AT', 'NP', 'ZB'];
const PEOPLE_COLORS = ['#F78FB3', '#7BED9F', '#70A1FF', '#FFD166', '#C39BFF', '#5EEAD4'];
const tagColor = (t: string) => TAGS.find((x) => x.name === t)?.color ?? C.dim;
const personColor = (w: string) => PEOPLE_COLORS[Math.max(0, PEOPLE.indexOf(w))] ?? C.text;

const DEMO: Array<Array<Omit<Card, 'id'>>> = [
  [
    { title: 'Retry failed uploads', tag: 'feature', who: 'JR' },
    { title: 'Write the migration guide', tag: 'docs', who: 'SL' },
    { title: 'Fix flicker on resize', tag: 'bug', who: 'MK' },
    { title: 'Bump dependencies', tag: 'chore', who: 'AT' },
    { title: 'Dark mode for settings', tag: 'feature', who: 'NP' },
  ],
  [
    { title: 'Rate limiter for the API', tag: 'feature', who: 'ZB' },
    { title: 'Crash on empty config', tag: 'bug', who: 'MK' },
    { title: 'Document plugin hooks', tag: 'docs', who: 'SL' },
    { title: 'Speed up the CI cache', tag: 'chore', who: 'JR' },
  ],
  [
    { title: 'Release v0.9.0', tag: 'chore', who: 'AT' },
    { title: 'Fix typo in install docs', tag: 'docs', who: 'NP' },
    { title: 'Support Windows paths', tag: 'feature', who: 'ZB' },
  ],
];

// ── arguments and persistence ──────────────────────────────────────────────
const args = process.argv.slice(2);
let FILE: string | null = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--help' || a === '-h') {
    console.log('usage: bun examples/kanban.ts [--file board.json]');
    console.log('  (default)         in-memory board with invented demo cards; nothing is written');
    console.log('  --file PATH       load PATH if it exists and save it after every change');
    process.exit(0);
  } else if (a === '--file') {
    FILE = args[++i] ?? null;
    if (!FILE) { console.error('kanban: --file needs a path'); process.exit(2); }
  } else if (a.startsWith('--file=')) {
    FILE = a.slice('--file='.length);
    if (!FILE) { console.error('kanban: --file needs a path'); process.exit(2); }
  } else {
    console.error(`kanban: unknown argument ${a} (try --help)`);
    process.exit(2);
  }
}

let nextId = 1;
const fresh = (c: Omit<Card, 'id'>): Card => ({ id: nextId++, ...c });

/** Reads the board file; throws a readable Error if it is not a valid board. */
function readBoard(path: string): Card[][] {
  let data: any;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`cannot read ${path}: ${(e as Error).message}`); }
  const cols = data?.columns;
  if (!Array.isArray(cols) || cols.length !== COLUMNS.length) throw new Error(`${path}: expected { "columns": [ {cards}, {cards}, {cards} ] }`);
  return cols.map((col: any, ci: number) => {
    if (!Array.isArray(col?.cards)) throw new Error(`${path}: columns[${ci}].cards must be an array`);
    return col.cards.map((c: any, i: number): Card => {
      if (typeof c?.title !== 'string' || !c.title.trim()) throw new Error(`${path}: columns[${ci}].cards[${i}] needs a title`);
      return fresh({
        title: c.title.trim(),
        tag: TAGS.some((t) => t.name === c.tag) ? c.tag : 'chore',
        who: typeof c.who === 'string' && c.who.trim() ? c.who.trim().slice(0, 2).toUpperCase() : PEOPLE[0]!,
      });
    });
  });
}

function writeBoard(path: string, cols: Card[][]): void {
  const body = { columns: cols.map((cards, i) => ({ name: COLUMNS[i]!.name, cards: cards.map(({ title, tag, who }) => ({ title, tag, who })) })) };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n');
  renameSync(tmp, path); // never leaves a half-written board behind
}

let initial: Card[][];
let loaded = false;
if (FILE && existsSync(FILE)) {
  try { initial = readBoard(FILE); loaded = true; } catch (e) {
    console.error(`kanban: ${(e as Error).message}`);
    process.exit(1);
  }
} else {
  initial = DEMO.map((col) => col.map(fresh));
}

// ── rendering helpers ──────────────────────────────────────────────────────
interface Sty { fg?: string; bg?: string; b?: boolean; i?: boolean }
/** Styled text; every segment that sits on a tinted background carries the background itself. */
const S = (text: string, o: Sty = {}): string => {
  if (!text) return '';
  let s = newStyle().inline(true);
  if (o.fg) s = s.foreground(o.fg);
  if (o.bg) s = s.background(o.bg);
  if (o.b) s = s.bold(true);
  if (o.i) s = s.italic(true);
  return s.render(text);
};
const padRight = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const fit = (s: string, w: number) => (stringWidth(s) > w ? truncate(s, w) : s);

/** Shortens plain text to `w` cells, ending with an ellipsis. */
function ellipsize(t: string, w: number): string {
  if (stringWidth(t) <= w) return t;
  let out = '';
  for (const ch of t) {
    if (stringWidth(out + ch) > w - 1) break;
    out += ch;
  }
  return out + '…';
}

function gradientText(s: string, ...stops: string[]): string {
  const chars = [...s];
  const cols = blend1D(Math.max(2, chars.length), ...stops);
  return chars.map((ch, i) => {
    const c = colorToRGB(cols[i]!)!;
    return ch === ' ' ? ' ' : fgColor(c.r, c.g, c.b) + '\x1b[1m' + ch + '\x1b[m';
  }).join('');
}

/**
 * Mutes every colour of an ANSI string by blending it towards a dark base, so a
 * dialog drawn over it stands out. Truecolor sequences are rewritten; a reset also
 * re-applies the muted default text colour.
 */
function dimAnsi(s: string): string {
  const K = 0.62;
  const base = [0x1e, 0x1e, 0x2e];
  const mix = (r: number, g: number, b: number) => [r, g, b].map((v, i) => Math.round(v + (base[i]! - v) * K));
  const fallback = `38;2;${mix(0xA8, 0xA8, 0xC0).join(';')}`;
  const out = s.replace(/\x1b\[([0-9;]*)m/g, (_, p: string) => {
    if (p === '' || p === '0') return `\x1b[0;${fallback}m`;
    const t = p.split(';');
    const o: string[] = [];
    for (let i = 0; i < t.length; i++) {
      if ((t[i] === '38' || t[i] === '48') && t[i + 1] === '2') {
        o.push(t[i]!, '2', ...mix(+t[i + 2]!, +t[i + 3]!, +t[i + 4]!).map(String));
        i += 4;
      } else if ((t[i] === '38' || t[i] === '48') && t[i + 1] === '5') {
        o.push(t[i]!, '5', t[i + 2]!);
        i += 2;
      } else o.push(t[i]!);
    }
    return `\x1b[${o.join(';')}m`;
  });
  return out.split('\n').map((l) => `\x1b[${fallback}m${l}`).join('\n') + '\x1b[m';
}

/** A rounded frame with the title set into the top border. Lines are padded to `w` cells. */
function frame(title: string, body: string[], w: number, color: string): string {
  const b = (t: string) => S(t, { fg: color });
  const t = title ? ' ' + S(title, { fg: color, b: true }) + ' ' : '';
  const top = b('╭─') + t + b('─'.repeat(Math.max(0, w - 3 - stringWidth(t))) + '╮');
  const rows = body.map((l) => b('│') + padRight(fit(l, w - 2), w - 2) + b('│'));
  return [top, ...rows, b('╰' + '─'.repeat(w - 2) + '╯')].join('\n');
}

// ── key bindings ───────────────────────────────────────────────────────────
const bind = (keys: string[], key: string, desc: string): Binding => newBinding(withKeys(...keys), withHelp(key, desc));
const keys = {
  left: bind(['left', 'h'], '←/h', 'column left'),
  right: bind(['right', 'l'], '→/l', 'column right'),
  up: bind(['up', 'k'], '↑/k', 'card up'),
  down: bind(['down', 'j'], '↓/j', 'card down'),
  moveLeft: bind(['shift+left', '<'], 'shift+←/<', 'to left column'),
  moveRight: bind(['shift+right', '>'], 'shift+→/>', 'to right column'),
  moveUp: bind(['shift+up'], 'shift+↑', 'reorder up'),
  moveDown: bind(['shift+down'], 'shift+↓', 'reorder down'),
  add: bind(['n'], 'n', 'new card'),
  edit: bind(['e', 'enter'], 'e/enter', 'edit card'),
  del: bind(['d', 'delete'], 'd', 'delete card'),
  filter: bind(['/'], '/', 'filter cards'),
  help: bind(['?'], '?', 'toggle help'),
  quit: bind(['q', 'ctrl+c'], 'q', 'quit'),
};
const mouseHelp = [
  bind(['click'], 'click', 'select a card'), bind(['click'], 'click header', 'focus a column'),
  bind(['drag'], 'drag', 'move a card'), bind(['wheel'], 'wheel', 'scroll a column'),
];
const otherHelp = [bind(['esc'], 'esc', 'cancel / clear filter'), keys.help, keys.quit];
const shortKeys = [
  bind([], '←/→', 'column'), bind([], '↑/↓', 'card'), bind([], 'shift+←/→', 'move'),
  bind([], 'n', 'new'), bind([], 'e', 'edit'), bind([], 'd', 'delete'), bind([], '/', 'filter'),
  bind([], '?', 'help'), bind([], 'q', 'quit'),
];

// ── model ──────────────────────────────────────────────────────────────────
const CARD_H = 4; // a card is four rows: border, title, tag + assignee, border
const MIN_W = 78;
const MIN_H = 18;
const MAX_COL = 50;

type Mode = 'board' | 'filter' | 'edit' | 'confirm' | 'help';
interface Hit { row: number; x0: number; x1: number; act: (cmds: Cmd[]) => void }

class Kanban {
  width = 110;
  height = 30;
  ready = false; // nothing is drawn until the first WindowSizeMsg: a frame of the wrong width would wrap
  cols: Card[][] = initial;
  focus = 0;
  sel = [0, 0, 0];
  scroll = [0, 0, 0];
  filter = '';
  mode: Mode = 'board';
  flash: { id: number; n: number } | null = null;
  toast: { text: string; color: string; n: number } | null = null;
  press: { col: number; id: number; x: number; y: number; offX: number; offY: number } | null = null;
  drag: { id: number; x: number; y: number; offX: number; offY: number; col: number } | null = null;
  edit = { id: null as number | null, col: 0, field: 0, tag: 1, who: 0, err: '' };
  confirm = { col: 0, id: 0, yes: false };
  hits: Hit[] = []; // clickable spots of the open dialog, in screen coordinates
  tickN = 0;

  titleInput = newTextInput();
  filterInput = newTextInput();
  help = newHelp();

  constructor() {
    // plain white text, pink prompt and cursor; the defaults carry colours of their own
    const textStyle = newStyle().foreground(C.white);
    const phStyle = newStyle().foreground(C.dim);
    const promptStyle = newStyle().foreground(C.pink).bold(true);
    for (const input of [this.titleInput, this.filterInput]) {
      const s = textInputDefaultDarkStyles();
      for (const state of [s.focused, s.blurred]) { state.text = textStyle; state.placeholder = phStyle; state.prompt = promptStyle; }
      s.cursor = { ...s.cursor, color: C.pink, blink: false };
      input.setStyles(s);
    }
    this.titleInput.prompt = '› ';
    this.titleInput.charLimit = 60;
    this.titleInput.placeholder = 'What needs doing?';
    this.filterInput.prompt = '';
    this.filterInput.placeholder = 'title, tag or initials';
    this.filterInput.setWidth(34);
    this.help.styles.shortKey = newStyle().foreground(C.text).bold(true);
    this.help.styles.shortDesc = newStyle().foreground(C.dim);
    this.help.styles.shortSeparator = newStyle().foreground(C.faint);
    this.help.styles.ellipsis = newStyle().foreground(C.faint);
    this.help.styles.fullKey = newStyle().foreground(C.pink).bold(true);
    this.help.styles.fullDesc = newStyle().foreground(C.text);
    this.help.styles.fullSeparator = newStyle().foreground(C.faint);
  }

  // ── geometry (shared by drawing and mouse hit testing) ──────────────────
  get colW(): number[] {
    const total = Math.min(this.width - 2, 3 * MAX_COL + 2);
    const room = total - 2;
    const base = Math.floor(room / 3);
    const extra = room - base * 3;
    return [base + (extra > 0 ? 1 : 0), base + (extra > 1 ? 1 : 0), base];
  }
  get colX(): number[] {
    const w = this.colW;
    const total = w[0]! + w[1]! + w[2]! + 2;
    const x0 = Math.floor((this.width - total) / 2);
    return [x0, x0 + w[0]! + 1, x0 + w[0]! + w[1]! + 2];
  }
  get tooSmall(): boolean { return this.width < MIN_W || this.height < MIN_H; }
  readonly top = 1; // the header takes row 0
  get boxH(): number { return this.height - 2; } // and the footer takes the last row
  get listTop(): number { return this.top + 3; } // border, header, divider
  get perPage(): number { return Math.max(1, Math.floor((this.boxH - 4) / CARD_H)); }

  colAt(x: number): number {
    const xs = this.colX, ws = this.colW;
    for (let c = 0; c < 3; c++) if (x >= xs[c]! && x < xs[c]! + ws[c]!) return c;
    return -1;
  }

  // ── board state ────────────────────────────────────────────────────────
  cardMatches(card: Card, q: string): boolean {
    return !q || `${card.title} ${card.tag} ${card.who}`.toLowerCase().includes(q);
  }
  /** Indices (into cols[c]) of the cards that pass the filter. */
  visible(c: number): number[] {
    const q = this.filter.trim().toLowerCase();
    const out: number[] = [];
    this.cols[c]!.forEach((card, i) => { if (this.cardMatches(card, q)) out.push(i); });
    return out;
  }
  total(): number { return this.cols.reduce((n, c) => n + c.length, 0); }

  current(): { c: number; i: number; card: Card } | null {
    const v = this.visible(this.focus);
    const i = v[this.sel[this.focus]!];
    return i === undefined ? null : { c: this.focus, i, card: this.cols[this.focus]![i]! };
  }
  find(id: number): { c: number; i: number; card: Card } | null {
    for (let c = 0; c < 3; c++) {
      const i = this.cols[c]!.findIndex((x) => x.id === id);
      if (i >= 0) return { c, i, card: this.cols[c]![i]! };
    }
    return null;
  }

  clamp(c: number): void {
    const n = this.visible(c).length;
    this.sel[c] = n ? Math.min(Math.max(this.sel[c]!, 0), n - 1) : 0;
    this.scroll[c] = Math.min(Math.max(this.scroll[c]!, 0), Math.max(0, n - this.perPage));
  }
  /** Scrolls column c just enough for its selected card to be on screen. */
  reveal(c: number): void {
    this.clamp(c);
    if (this.sel[c]! < this.scroll[c]!) this.scroll[c] = this.sel[c]!;
    else if (this.sel[c]! >= this.scroll[c]! + this.perPage) this.scroll[c] = this.sel[c]! - this.perPage + 1;
    this.clamp(c);
  }
  clampAll(): void { for (let c = 0; c < 3; c++) this.reveal(c); }

  select(id: number): void {
    const f = this.find(id);
    if (!f) return;
    this.focus = f.c;
    this.sel[f.c] = Math.max(0, this.visible(f.c).indexOf(f.i));
    this.reveal(f.c);
  }

  /** Moves a card to column `toC` before the card now at visible position `at` (-1: to the end). */
  moveTo(fromC: number, id: number, toC: number, at: number): void {
    const i = this.cols[fromC]!.findIndex((c) => c.id === id);
    if (i < 0) return;
    const fromVis = this.visible(fromC).indexOf(i);
    const [card] = this.cols[fromC]!.splice(i, 1);
    const dv = this.visible(toC);
    let pos = at < 0 ? dv.length : at;
    if (fromC === toC && at >= 0 && fromVis < at) pos -= 1;
    pos = Math.min(Math.max(pos, 0), dv.length);
    this.cols[toC]!.splice(pos < dv.length ? dv[pos]! : this.cols[toC]!.length, 0, card!);
    this.select(id);
    this.clampAll();
  }

  // ── messages ───────────────────────────────────────────────────────────
  init(): Cmd { return null; }

  setToast(text: string, color: string): Cmd {
    const n = ++this.tickN;
    this.toast = { text, color, n };
    return Tick(2600, () => ({ type: 'toast.end', n }));
  }
  flashCard(id: number): Cmd {
    const n = ++this.tickN;
    this.flash = { id, n };
    return Tick(650, () => ({ type: 'flash.end', n }));
  }
  /** Saves after a change (only with --file); the status shows up in the header. */
  changed(cmds: Cmd[], toast?: string, color = C.green): void {
    if (FILE) {
      try { writeBoard(FILE, this.cols); } catch (e) { cmds.push(this.setToast(`save failed: ${(e as Error).message}`, C.red)); return; }
    }
    if (toast) cmds.push(this.setToast(toast, color));
  }

  update(msg: Msg): [Kanban, Cmd] {
    const cmds: Cmd[] = [];
    if (msg instanceof WindowSizeMsg) {
      this.width = msg.width;
      this.height = msg.height;
      this.ready = true;
      this.clampAll();
      return [this, null];
    }
    if (msg?.type === 'toast.end') { if (this.toast?.n === msg.n) this.toast = null; return [this, null]; }
    if (msg?.type === 'flash.end') { if (this.flash?.n === msg.n) this.flash = null; return [this, null]; }
    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();
      if (key === 'ctrl+c') return [this, Quit];
      const dragging = this.drag !== null;
      this.press = null;
      this.drag = null; // any key abandons a drag in progress; esc is just that
      if (dragging && key === 'esc') return [this, null];
      if (this.tooSmall) return [this, key === 'q' ? Quit : null]; // the board is hidden: don't act on it
      switch (this.mode) {
        case 'board': return this.boardKey(msg, cmds);
        case 'filter': return this.filterKey(msg, cmds);
        case 'edit': return this.editKey(msg, cmds);
        case 'confirm': return this.confirmKey(msg, cmds);
        case 'help':
          if (key === '?' || key === 'esc' || key === 'q' || key === 'enter') this.mode = 'board';
          return [this, null];
      }
    }
    if (msg instanceof MouseClickMsg || msg instanceof MouseMotionMsg || msg instanceof MouseReleaseMsg || msg instanceof MouseWheelMsg) {
      return this.tooSmall ? [this, null] : this.mouse(msg, cmds);
    }
    // anything else (cursor blink, paste...) goes to the focused text input
    if (this.mode === 'edit' && this.edit.field === 0) { const [, c] = this.titleInput.update(msg); if (c) cmds.push(c); }
    if (this.mode === 'filter') { const [, c] = this.filterInput.update(msg); if (c) cmds.push(c); }
    return [this, Batch(...cmds)];
  }

  boardKey(msg: KeyPressMsg, cmds: Cmd[]): [Kanban, Cmd] {
    const key = msg.toString();
    const cur = this.current();
    if (matches(msg, keys.quit)) return [this, Quit];
    if (key === 'esc') {
      if (this.filter) { this.filter = ''; this.filterInput.reset(); this.clampAll(); }
    } else if (matches(msg, keys.left)) { this.focus = Math.max(0, this.focus - 1); this.reveal(this.focus); }
    else if (matches(msg, keys.right)) { this.focus = Math.min(2, this.focus + 1); this.reveal(this.focus); }
    else if (matches(msg, keys.up)) { this.sel[this.focus] = Math.max(0, this.sel[this.focus]! - 1); this.reveal(this.focus); }
    else if (matches(msg, keys.down)) { this.sel[this.focus] = this.sel[this.focus]! + 1; this.reveal(this.focus); }
    else if (matches(msg, keys.moveLeft) || matches(msg, keys.moveRight)) {
      const to = this.focus + (matches(msg, keys.moveLeft) ? -1 : 1);
      if (cur && to >= 0 && to <= 2) {
        this.moveTo(this.focus, cur.card.id, to, this.sel[this.focus]!);
        cmds.push(this.flashCard(cur.card.id));
        this.changed(cmds, `Moved “${ellipsize(cur.card.title, 28)}” to ${COLUMNS[to]!.name}`);
      }
    } else if (matches(msg, keys.moveUp) || matches(msg, keys.moveDown)) {
      const up = matches(msg, keys.moveUp);
      const at = this.sel[this.focus]!;
      const n = this.visible(this.focus).length;
      if (cur && (up ? at > 0 : at < n - 1)) {
        this.moveTo(this.focus, cur.card.id, this.focus, up ? at - 1 : at + 2);
        cmds.push(this.flashCard(cur.card.id));
        this.changed(cmds);
      }
    } else if (matches(msg, keys.add)) this.openEdit(null);
    else if (matches(msg, keys.edit)) { if (cur) this.openEdit(cur.card); }
    else if (matches(msg, keys.del)) {
      if (cur) { this.confirm = { col: cur.c, id: cur.card.id, yes: false }; this.mode = 'confirm'; }
    } else if (matches(msg, keys.filter)) {
      this.mode = 'filter';
      const c = this.filterInput.focus();
      if (c) cmds.push(c);
    } else if (matches(msg, keys.help)) this.mode = 'help';
    return [this, Batch(...cmds)];
  }

  filterKey(msg: KeyPressMsg, cmds: Cmd[]): [Kanban, Cmd] {
    const key = msg.toString();
    if (key === 'esc') {
      this.filter = '';
      this.filterInput.reset();
      this.filterInput.blur();
      this.mode = 'board';
      this.clampAll();
    } else if (key === 'enter') {
      this.filterInput.blur();
      this.mode = 'board';
    } else if (key === 'up' || key === 'down') {
      this.sel[this.focus] = Math.max(0, this.sel[this.focus]! + (key === 'up' ? -1 : 1));
      this.reveal(this.focus);
    } else {
      const [, c] = this.filterInput.update(msg);
      if (c) cmds.push(c);
      if (this.filterInput.value() !== this.filter) {
        this.filter = this.filterInput.value();
        // keep the focus on a column that still has matches
        if (!this.visible(this.focus).length) {
          const other = [0, 1, 2].find((c2) => this.visible(c2).length);
          if (other !== undefined) this.focus = other;
        }
        for (let c2 = 0; c2 < 3; c2++) { this.sel[c2] = 0; this.scroll[c2] = 0; }
        this.clampAll();
      }
    }
    return [this, Batch(...cmds)];
  }

  openEdit(card: Card | null): void {
    this.edit = { id: card?.id ?? null, col: this.focus, field: 0, tag: card ? Math.max(0, TAGS.findIndex((t) => t.name === card.tag)) : 1, who: card ? Math.max(0, PEOPLE.indexOf(card.who)) : 0, err: '' };
    this.titleInput.setValue(card?.title ?? '');
    this.titleInput.cursorEnd();
    this.titleInput.focus();
    this.mode = 'edit';
  }

  editKey(msg: KeyPressMsg, cmds: Cmd[]): [Kanban, Cmd] {
    const key = msg.toString();
    const e = this.edit;
    if (key === 'esc') { this.titleInput.blur(); this.mode = 'board'; return [this, null]; }
    if (key === 'enter') return this.saveEdit(cmds);
    if (key === 'tab' || key === 'down' || key === 'shift+tab' || key === 'up') {
      e.field = (e.field + (key === 'tab' || key === 'down' ? 1 : 2)) % 3;
      if (e.field === 0) { const c = this.titleInput.focus(); if (c) cmds.push(c); } else this.titleInput.blur();
    } else if (e.field === 0) {
      const [, c] = this.titleInput.update(msg);
      if (c) cmds.push(c);
      e.err = '';
    } else if (key === 'left' || key === 'right') {
      const d = key === 'left' ? -1 : 1;
      if (e.field === 1) e.tag = (e.tag + d + TAGS.length) % TAGS.length;
      else e.who = (e.who + d + PEOPLE.length) % PEOPLE.length;
    }
    return [this, Batch(...cmds)];
  }

  saveEdit(cmds: Cmd[]): [Kanban, Cmd] {
    const e = this.edit;
    const title = this.titleInput.value().trim();
    if (!title) { e.err = 'Give the card a title first.'; return [this, null]; }
    const tag = TAGS[e.tag]!.name, who = PEOPLE[e.who]!;
    let card: Card;
    if (e.id === null) {
      card = fresh({ title, tag, who });
      this.cols[e.col]!.push(card);
    } else {
      card = this.find(e.id)!.card;
      Object.assign(card, { title, tag, who });
    }
    // a card the filter would hide is confusing: clear the filter instead
    if (!this.cardMatches(card, this.filter.trim().toLowerCase())) { this.filter = ''; this.filterInput.reset(); }
    this.titleInput.blur();
    this.mode = 'board';
    this.select(card.id);
    this.clampAll();
    cmds.push(this.flashCard(card.id));
    this.changed(cmds, `${e.id === null ? 'Added' : 'Saved'} “${ellipsize(title, 28)}”`);
    return [this, Batch(...cmds)];
  }

  confirmKey(msg: KeyPressMsg, cmds: Cmd[]): [Kanban, Cmd] {
    const key = msg.toString();
    if (key === 'esc' || key === 'n' || key === 'q') this.mode = 'board';
    else if (key === 'y') this.doDelete(cmds);
    else if (key === 'left' || key === 'right' || key === 'tab' || key === 'h' || key === 'l') this.confirm.yes = !this.confirm.yes;
    else if (key === 'enter') { if (this.confirm.yes) this.doDelete(cmds); else this.mode = 'board'; }
    return [this, Batch(...cmds)];
  }

  doDelete(cmds: Cmd[]): void {
    const f = this.find(this.confirm.id);
    this.mode = 'board';
    if (!f) return;
    this.cols[f.c]!.splice(f.i, 1);
    this.clampAll();
    this.changed(cmds, `Deleted “${ellipsize(f.card.title, 28)}”`, C.amber);
  }

  // ── mouse ──────────────────────────────────────────────────────────────
  /**
   * The terminal reports presses, drags and releases as separate messages
   * (MouseClickMsg, MouseMotionMsg, MouseReleaseMsg), with 0-based cell
   * coordinates that match the rows and columns of the view. The board is drawn
   * from the top-left corner, so they map straight onto the layout above.
   */
  mouse(msg: MouseClickMsg | MouseMotionMsg | MouseReleaseMsg | MouseWheelMsg, cmds: Cmd[]): [Kanban, Cmd] {
    const { x, y } = msg;
    if (this.mode === 'confirm' || this.mode === 'edit') {
      if (msg instanceof MouseClickMsg && msg.button === MouseButton.Left) {
        this.hits.find((k) => k.row === y && x >= k.x0 && x < k.x1)?.act(cmds);
      }
      return [this, Batch(...cmds)];
    }
    if (this.mode === 'help') {
      if (msg instanceof MouseClickMsg) this.mode = 'board';
      return [this, null];
    }

    if (msg instanceof MouseWheelMsg) {
      const c = this.colAt(x) >= 0 ? this.colAt(x) : this.focus;
      const d = msg.button === MouseButton.WheelUp ? -1 : msg.button === MouseButton.WheelDown ? 1 : 0;
      this.scroll[c] = this.scroll[c]! + d;
      this.clamp(c);
      return [this, null];
    }

    if (msg instanceof MouseClickMsg && msg.button === MouseButton.Left) {
      const c = this.colAt(x);
      this.press = null;
      this.drag = null;
      if (c < 0) return [this, null];
      this.focus = c;
      if (y >= this.listTop) {
        const k = Math.floor((y - this.listTop) / CARD_H);
        const vis = this.visible(c);
        const vi = this.scroll[c]! + k;
        if (k < this.perPage && vi < vis.length) {
          this.sel[c] = vi;
          const card = this.cols[c]![vis[vi]!]!;
          this.press = { col: c, id: card.id, x, y, offX: x - (this.colX[c]! + 2), offY: y - (this.listTop + k * CARD_H) };
        }
      }
      this.clamp(c);
      return [this, null];
    }

    if (msg instanceof MouseMotionMsg && this.press && msg.button === MouseButton.Left) {
      const p = this.press;
      if (!this.drag && Math.abs(x - p.x) + Math.abs(y - p.y) >= 2) {
        this.drag = { id: p.id, x, y, offX: p.offX, offY: p.offY, col: p.col };
      } else if (this.drag) {
        this.drag.x = x;
        this.drag.y = y;
      }
      return [this, null];
    }

    if (msg instanceof MouseReleaseMsg) {
      const d = this.drag;
      this.press = null;
      this.drag = null;
      if (!d) return [this, null];
      const to = this.colAt(x);
      if (to < 0) return [this, null]; // dropped outside the columns: nothing happens
      const dv = this.visible(to);
      const at = y < this.listTop ? this.scroll[to]! : Math.min(dv.length, this.scroll[to]! + Math.floor((y - this.listTop) / CARD_H));
      const sig = () => this.cols.map((c) => c.map((k) => k.id).join()).join('|');
      const before = sig();
      this.moveTo(d.col, d.id, to, at >= dv.length && to !== d.col ? -1 : at);
      const moved = sig() !== before;
      cmds.push(this.flashCard(d.id));
      if (moved) {
        const f = this.find(d.id)!;
        this.changed(cmds, to === d.col ? undefined : `Moved “${ellipsize(f.card.title, 28)}” to ${COLUMNS[to]!.name}`);
      }
      return [this, Batch(...cmds)];
    }
    return [this, null];
  }

  // ── drawing ────────────────────────────────────────────────────────────
  /** One card as CARD_H rows of exactly `w` cells. */
  cardLines(card: Card, w: number, state: 'normal' | 'selected' | 'selectedBlur' | 'flash' | 'lifted' | 'ghost', query: string): string[] {
    const bc = { normal: '#4A4A66', selected: C.pink, selectedBlur: '#6B58B8', flash: C.amber, lifted: C.faint, ghost: C.cyan }[state];
    const bg = { normal: undefined, selected: C.selBg, selectedBlur: '#211C38', flash: '#4A3A14', lifted: undefined, ghost: '#16363F' }[state];
    const cw = w - 4; // inside the border and one cell of padding
    const lifted = state === 'lifted';
    const b = (t: string) => S(t, { fg: bc }); // borders sit outside the tint
    const sp = (n: number) => S(' '.repeat(n), { bg });

    let title = ellipsize(card.title, cw);
    let titleStr: string;
    const hl = query ? title.toLowerCase().indexOf(query) : -1;
    const tFg = lifted ? C.faint : state === 'normal' || state === 'selectedBlur' ? C.text : C.white;
    const tBold = state === 'selected' || state === 'flash' || state === 'ghost';
    if (hl >= 0 && !lifted) {
      titleStr = S(title.slice(0, hl), { fg: tFg, bg, b: tBold }) + S(title.slice(hl, hl + query.length), { fg: C.amber, bg, b: true }) +
        S(title.slice(hl + query.length), { fg: tFg, bg, b: tBold });
    } else titleStr = S(title, { fg: tFg, bg, b: tBold, i: lifted });
    const titleRow = titleStr + sp(cw - stringWidth(title));

    const tg = lifted ? ' '.repeat(card.tag.length + 2) : S(` ${card.tag} `, { fg: C.ink, bg: tagColor(card.tag), b: true });
    const tgW = card.tag.length + 2;
    const pc = lifted ? C.faint : personColor(card.who);
    const who = S('● ', { fg: pc, bg }) + S(card.who, { fg: pc, bg, b: true });
    const metaRow = tg + sp(cw - tgW - 4) + who;

    return [
      b('╭' + '─'.repeat(w - 2) + '╮'),
      b('│') + sp(1) + titleRow + sp(1) + b('│'),
      b('│') + sp(1) + metaRow + sp(1) + b('│'),
      b('╰' + '─'.repeat(w - 2) + '╯'),
    ];
  }

  /** One column as `boxH` rows of exactly its width. */
  column(c: number): string[] {
    const w = this.colW[c]!, iw = w - 2, cardW = w - 4;
    const accent = COLUMNS[c]!.color;
    const focused = this.focus === c && this.mode !== 'help';
    const target = this.drag !== null && this.colAt(this.drag.x) === c;
    const bcol = target ? C.green : focused ? accent : C.faint;
    const b = (t: string) => S(t, { fg: bcol });
    const vis = this.visible(c);
    const q = this.filter.trim().toLowerCase();
    const sc = this.scroll[c]!;
    const above = sc;
    const below = Math.max(0, vis.length - sc - this.perPage);
    const rows: string[] = [];

    rows.push(b('╭' + '─'.repeat(iw) + '╮'));
    const count = q ? `${vis.length}/${this.cols[c]!.length}` : String(this.cols[c]!.length);
    const chip = focused || target ? S(` ${count} `, { fg: C.ink, bg: bcol, b: true }) : S(` ${count} `, { fg: accent, bg: '#2A2A3C', b: true });
    const name = S(COLUMNS[c]!.name, { fg: focused || target ? bcol : accent, b: true });
    rows.push(b('│') + ' ' + S('●', { fg: accent }) + ' ' + name + ' '.repeat(Math.max(1, iw - 3 - stringWidth(COLUMNS[c]!.name) - stringWidth(chip) - 1)) + chip + ' ' + b('│'));
    const up = above ? ` ▲ ${above} more ` : '';
    rows.push(b('├') + b('─'.repeat(iw - up.length)) + S(up, { fg: C.dim }) + b('┤'));

    const listH = this.boxH - 4;
    const body: string[] = [];
    if (!vis.length) {
      const msg = q ? 'no matches' : focused ? 'press n to add a card' : 'no cards';
      body.push(...Array.from({ length: Math.floor(listH / 2) }, () => ''));
      body.push(' '.repeat(Math.max(0, Math.floor((iw - stringWidth(msg)) / 2))) + S(msg, { fg: C.dim, i: true }));
    } else {
      for (let k = 0; k < this.perPage; k++) {
        const vi = sc + k;
        if (vi >= vis.length) break;
        const card = this.cols[c]![vis[vi]!]!;
        const isSel = this.sel[c] === vi;
        const state = this.drag?.id === card.id ? 'lifted' : this.flash?.id === card.id ? 'flash'
          : isSel ? (focused ? 'selected' : 'selectedBlur') : 'normal';
        body.push(...this.cardLines(card, cardW, state, q).map((l) => ' ' + l + ' '));
      }
    }
    for (let r = 0; r < listH; r++) rows.push(b('│') + padRight(body[r] ?? '', iw) + b('│'));
    const dn = below ? ` ▼ ${below} more ` : '';
    rows.push(b('╰' + '─'.repeat(iw - dn.length)) + S(dn, { fg: C.dim }) + b('╯'));
    return rows;
  }

  header(): string {
    const x0 = this.colX[0]!;
    const total = this.colW[0]! + this.colW[1]! + this.colW[2]! + 2;
    const brand = gradientText('▌ KANBAN', '#7D56F4', '#EE6FF8', '#3EE6D2');
    const sub = S(`  ${this.total()} cards in 3 columns`, { fg: C.dim });
    const right = this.toast
      ? S('✓ ', { fg: this.toast.color, b: true }) + S(ellipsize(this.toast.text, Math.max(10, total - 40)), { fg: this.toast.color })
      : FILE ? S('● ', { fg: C.green }) + S(`saved to ${ellipsize(FILE, 30)}`, { fg: C.dim })
        : S('in memory · nothing is saved', { fg: C.dim });
    const gap = Math.max(1, total - stringWidth(brand) - stringWidth(sub) - stringWidth(right));
    return ' '.repeat(x0) + brand + sub + ' '.repeat(gap) + right;
  }

  footer(): string {
    const x0 = this.colX[0]!;
    const total = this.colW[0]! + this.colW[1]! + this.colW[2]! + 2;
    let left = '';
    if (this.drag) left = S('drop on a column to move the card', { fg: C.cyan }) + S('  ·  esc cancels', { fg: C.dim });
    else if (this.mode === 'filter') {
      left = S('/ ', { fg: C.pink, b: true }) + this.filterInput.view() + S(`  ${this.matchCount()}  ·  enter keeps · esc clears`, { fg: C.dim });
    } else if (this.filter) {
      left = S(` / ${this.filter} `, { fg: C.ink, bg: C.pink, b: true }) + S(`  ${this.matchCount()}  ·  esc clears   `, { fg: C.dim });
    }
    if (this.drag || this.mode === 'filter') return ' '.repeat(x0) + left;
    this.help.setWidth(Math.max(10, total - stringWidth(left)));
    return ' '.repeat(x0) + left + this.help.shortHelpView(shortKeys);
  }
  matchCount(): string {
    const n = [0, 1, 2].reduce((a, c) => a + this.visible(c).length, 0);
    return `${n} of ${this.total()} cards`;
  }

  board(): string[] {
    const cols = [0, 1, 2].map((c) => this.column(c));
    const x0 = this.colX[0]!;
    const lines = [this.header()];
    for (let r = 0; r < this.boxH; r++) lines.push(' '.repeat(x0) + cols[0]![r] + ' ' + cols[1]![r] + ' ' + cols[2]![r]);
    lines.push(this.footer());
    return lines;
  }

  /** A dialog's rows, its position and its clickable regions (registered in `hits`). */
  dialog(): { text: string; x: number; y: number } | null {
    this.hits = [];
    let title = '', body: string[] = [], w = 0, color = C.pink;
    const hits: Array<{ line: number; x0: number; x1: number; act: (cmds: Cmd[]) => void }> = [];

    if (this.mode === 'edit') {
      const e = this.edit;
      w = Math.min(60, this.width - 4);
      const tw = w - 6;
      const label = (t: string, on: boolean) => '  ' + S(t, { fg: on ? C.pink : C.dim, b: true });
      this.titleInput.setWidth(tw - 2);
      title = e.id === null ? `New card · ${COLUMNS[e.col]!.name}` : 'Edit card';
      const chips: string[] = [];
      let x = 2 + 2;
      TAGS.forEach((t, i) => {
        const on = e.tag === i;
        const s = on ? S(` ${t.name} `, { fg: C.ink, bg: t.color, b: true }) : S(` ${t.name} `, { fg: t.color });
        hits.push({ line: 6, x0: x + 1, x1: x + 1 + stringWidth(s), act: () => { e.tag = i; e.field = 1; this.titleInput.blur(); } });
        x += stringWidth(s) + 1;
        chips.push(s);
      });
      const people: string[] = [];
      x = 2 + 2;
      PEOPLE.forEach((p, i) => {
        const on = e.who === i;
        const s = on ? S(` ${p} `, { fg: C.ink, bg: personColor(p), b: true }) : S(` ${p} `, { fg: personColor(p) });
        hits.push({ line: 9, x0: x + 1, x1: x + 1 + stringWidth(s), act: () => { e.who = i; e.field = 2; this.titleInput.blur(); } });
        x += stringWidth(s) + 1;
        people.push(s);
      });
      const arrows = (on: boolean, s: string) => (on ? S('‹ ', { fg: C.pink }) + s + S(' ›', { fg: C.pink }) : '  ' + s);
      body = [
        '',
        label('TITLE', e.field === 0),
        '  ' + this.titleInput.view(),
        '  ' + S('─'.repeat(tw), { fg: e.field === 0 ? C.pink : C.faint }),
        '',
        label('TAG', e.field === 1),
        '  ' + arrows(e.field === 1, chips.join(' ')),
        '',
        label('ASSIGNEE', e.field === 2),
        '  ' + arrows(e.field === 2, people.join(' ')),
        '',
        e.err ? '  ' + S(e.err, { fg: C.red }) : '',
        '  ' + S('tab', { fg: C.text, b: true }) + S(' next field  ', { fg: C.dim }) + S('←/→', { fg: C.text, b: true }) + S(' choose  ', { fg: C.dim }) +
          S('enter', { fg: C.text, b: true }) + S(' save  ', { fg: C.dim }) + S('esc', { fg: C.text, b: true }) + S(' cancel', { fg: C.dim }),
      ];
    } else if (this.mode === 'confirm') {
      const f = this.find(this.confirm.id);
      if (!f) return null;
      w = Math.min(46, this.width - 4);
      color = C.red;
      title = 'Delete card';
      const btn = (label: string, on: boolean, col: string) => (on ? S(`  ${label}  `, { fg: C.ink, bg: col, b: true }) : S(`  ${label}  `, { fg: col }));
      const yes = btn('y  Delete', this.confirm.yes, C.red), no = btn('n  Cancel', !this.confirm.yes, C.green);
      const yesX = Math.floor((w - 2 - stringWidth(yes) - 2 - stringWidth(no)) / 2);
      hits.push({ line: 5, x0: yesX + 1, x1: yesX + 1 + stringWidth(yes), act: (cmds) => { this.doDelete(cmds); } });
      const noX = yesX + stringWidth(yes) + 2;
      hits.push({ line: 5, x0: noX + 1, x1: noX + 1 + stringWidth(no), act: () => { this.mode = 'board'; } });
      body = [
        '',
        '  ' + S('Delete this card?', { fg: C.white, b: true }),
        '  ' + S('“' + ellipsize(f.card.title, w - 8) + '”', { fg: C.text }),
        '  ' + S('This cannot be undone.', { fg: C.dim }),
        '',
        ' '.repeat(yesX) + yes + '  ' + no,
        '',
        '  ' + S('←/→ choose · enter confirm · esc cancel', { fg: C.dim }),
      ];
    } else if (this.mode === 'help') {
      const g = (heading: string, items: Binding[]) =>
        joinVertical(Left, S(heading, { fg: C.violet, b: true }), this.help.fullHelpView([items]));
      const navigate = [keys.left, keys.right, keys.up, keys.down];
      const move = [keys.moveLeft, keys.moveRight, keys.moveUp, keys.moveDown];
      const edit = [keys.add, keys.edit, keys.del, keys.filter];
      this.help.setWidth(0);
      const gap = '    ';
      const row1 = joinHorizontal(Top, g('NAVIGATE', navigate), gap, g('MOVE CARDS', move), gap, g('EDIT', edit));
      const row2 = joinHorizontal(Top, g('MOUSE', mouseHelp), gap, g('OTHER', otherHelp));
      const lines = [...row1.split('\n'), '', ...row2.split('\n'), '', S('press ? or esc to close', { fg: C.dim })];
      w = Math.min(Math.max(...lines.map((l) => stringWidth(l))) + 6, this.width - 2);
      title = 'Keyboard & mouse';
      body = ['', ...lines.map((l) => '  ' + l), ''];
    } else return null;

    const text = frame(title, body, w, color);
    const h = body.length + 2;
    const x = Math.floor((this.width - w) / 2), y = Math.max(0, Math.floor((this.height - h) / 2));
    this.hits = hits.map((k) => ({ row: y + 1 + k.line, x0: x + k.x0, x1: x + k.x1, act: k.act }));
    return { text, x, y };
  }

  view(): View {
    let out: string;
    if (!this.ready) out = '';
    else if (this.tooSmall) {
      out = place(this.width, this.height, Center, Center,
        S('Terminal too small', { fg: C.amber, b: true }) + '\n' +
        S(`kanban needs at least ${MIN_W}×${MIN_H}, this is ${this.width}×${this.height}`, { fg: C.dim }) + '\n' +
        S('resize the window, or press q to quit', { fg: C.dim }));
    } else {
      const board = this.board();
      const dlg = this.dialog();
      if (dlg) {
        const h = dlg.text.split('\n').length;
        const shadow = dlg.text.split('\n').map((l) => S(' '.repeat(stringWidth(l)), { bg: '#15151F' })).join('\n');
        out = newCompositor(
          newLayer(dimAnsi(board.join('\n'))).z(0),
          newLayer(shadow).x(dlg.x + 2).y(Math.min(dlg.y + 1, this.height - h)).z(1),
          newLayer(dlg.text).x(dlg.x).y(dlg.y).z(2),
        ).render();
      } else if (this.drag) {
        const f = this.find(this.drag.id);
        if (f) {
          const w = this.colW[this.drag.col]! - 4;
          const gx = Math.min(Math.max(0, this.drag.x - this.drag.offX), this.width - w);
          const gy = Math.min(Math.max(0, this.drag.y - this.drag.offY), this.height - CARD_H);
          out = newCompositor(
            newLayer(board.join('\n')).z(0),
            newLayer(this.cardLines(f.card, w, 'ghost', '').join('\n')).x(gx).y(gy).z(1),
          ).render();
        } else out = board.join('\n');
      } else out = board.join('\n');
    }
    const v = new View(out);
    v.altScreen = true;
    v.mouseMode = MouseMode.CellMotion;
    v.windowTitle = 'Kanban';
    return v;
  }
}

const program = NewProgram(new Kanban());
await program.run();
process.exit(0);
