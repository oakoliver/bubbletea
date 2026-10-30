/**
 * Blocks — a falling-blocks game built with @oakoliver/bubbletea and
 * @oakoliver/lipgloss. A 10×20 well drawn two columns per cell, the seven
 * tetrominoes with SRS rotation and wall kicks, a 7-bag randomiser, lock delay,
 * ghost piece, hold, a three-piece preview, scoring and levels, and a flash
 * animation on cleared lines. The game is driven by a single Tick command; the
 * model decides how much game time each tick is worth.
 *
 * Usage:
 *   bun examples/blocks.ts                    play
 *   bun examples/blocks.ts --seed 7           same piece order every game
 *   bun examples/blocks.ts --autoplay         watch a small heuristic AI play
 *
 * The AI tries every rotation and column for the current piece and the next one,
 * scores the boards (aggregate height, holes, bumpiness, completed lines) and
 * then moves, rotates and drops the piece one visible step at a time.
 *
 * Keys: ←/→ h/l move · ↓ soft drop · space hard drop · ↑/x rotate clockwise
 *       z rotate counter-clockwise · c hold · p pause · r restart · q quit
 */
import { NewProgram, View, Quit, Tick, KeyPressMsg, WindowSizeMsg } from '../src/index.ts';
import type { Cmd, Model, Msg } from '../src/index.ts';
import {
  newStyle, roundedBorder, joinHorizontal, joinVertical, place, stringWidth, Top, Left, Center,
} from '@oakoliver/lipgloss';

// ── palette ────────────────────────────────────────────────────────────────
// Catppuccin Mocha, with the seven piece colours kept close to the usual
// cyan / yellow / purple / green / red / blue / orange.
const C = {
  I: '#89dceb', O: '#f9e2af', T: '#cba6f7', S: '#a6e3a1', Z: '#f38ba8', J: '#89b4fa', L: '#fab387',
  text: '#cdd6f4', sub: '#a6adc8', dim: '#6c7086', faint: '#45475a', grid: '#313244',
  base: '#1e1e2e', mantle: '#181825', flash: '#ffffff', pink: '#f5c2e7', teal: '#94e2d5',
};
const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
const COLORS = KINDS.map((k) => C[k]);

// ── pieces: SRS rotation states and wall kicks ─────────────────────────────
// Rows of each piece's bounding box in its spawn orientation. Rotating a box
// of size n clockwise sends the cell at (row y, column x) to (row x, column n-1-y).
const SPAWN: string[][] = [
  ['....', 'XXXX', '....', '....'], // I
  ['.XX.', '.XX.', '....', '....'], // O
  ['.X.', 'XXX', '...'], // T
  ['.XX', 'XX.', '...'], // S
  ['XX.', '.XX', '...'], // Z
  ['X..', 'XXX', '...'], // J
  ['..X', 'XXX', '...'], // L
];
type Cells = Array<[number, number]>; // [x, y] offsets inside the box, y down

function buildStates(rows: string[], isO: boolean): Cells[] {
  const n = rows.length;
  let grid = rows.map((r) => [...r].map((ch) => ch === 'X'));
  const states: Cells[] = [];
  for (let r = 0; r < 4; r++) {
    const cells: Cells = [];
    grid.forEach((row, y) => row.forEach((on, x) => on && cells.push([x, y])));
    states.push(cells);
    // SRS draws the O piece in the same place in every orientation.
    if (!isO) grid = grid.map((row, y) => row.map((_, x) => grid[n - 1 - x][y]));
  }
  return states;
}
const SHAPES: Cells[][] = SPAWN.map((rows, k) => buildStates(rows, k === 1));

// Kick offsets are the SRS tables as published (x right, y up); `tryRotate` flips y.
const KICKS_JLSTZ: Record<string, Array<[number, number]>> = {
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I: Record<string, Array<[number, number]>> = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

// ── board geometry and tuning ──────────────────────────────────────────────
const W = 10;
const VISIBLE = 20;
const HIDDEN = 2; // rows above the well where pieces spawn
const H = VISIBLE + HIDDEN;
const SPAWN_Y = 1;
const LOCK_MS = 500; // lock delay once the piece rests on something
const LOCK_RESETS = 15; // moves that may restart the lock delay
const FLASH_MS = 340; // line-clear animation
const FRAME_MS = 33; // game tick
const AI_STEP_MS = 80; // time between the AI's visible moves
const AI_THINK_MS = 160; // pause before the AI starts on a new piece
const LINE_SCORE = [0, 100, 300, 500, 800];

type Board = number[][]; // 0 empty, otherwise piece index + 1
const emptyBoard = (): Board => Array.from({ length: H }, () => new Array<number>(W).fill(0));

// ── random numbers: mulberry32 and a 7-bag ─────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newBag(rng: () => number): number[] {
  const bag = [0, 1, 2, 3, 4, 5, 6];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// ── game rules (no I/O) ────────────────────────────────────────────────────
interface Piece { k: number; r: number; x: number; y: number }

function collides(board: Board, k: number, r: number, x: number, y: number): boolean {
  for (const [dx, dy] of SHAPES[k][r]) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cx >= W || cy >= H) return true;
    if (cy >= 0 && board[cy][cx]) return true;
  }
  return false;
}

const dropY = (board: Board, p: Piece): number => {
  let y = p.y;
  while (!collides(board, p.k, p.r, p.x, y + 1)) y++;
  return y;
};

const fullRows = (board: Board): number[] => board.flatMap((row, y) => (row.every(Boolean) ? [y] : []));

function stamp(board: Board, k: number, r: number, x: number, y: number): Board {
  const next = board.map((row) => row.slice());
  for (const [dx, dy] of SHAPES[k][r]) if (y + dy >= 0) next[y + dy][x + dx] = k + 1;
  return next;
}

function removeRows(board: Board, rows: number[]): Board {
  const keep = board.filter((_, y) => !rows.includes(y));
  return [...Array.from({ length: rows.length }, () => new Array<number>(W).fill(0)), ...keep];
}

const gravityMs = (level: number): number =>
  Math.max(20, 1000 * Math.pow(0.8 - (level - 1) * 0.007, level - 1));

// ── the AI: classic height / holes / bumpiness / lines weights ─────────────
const WEIGHTS = { height: -0.510066, lines: 0.760666, holes: -0.35663, bumpiness: -0.184483 };

function evaluate(board: Board, lines: number): number {
  const heights = new Array<number>(W).fill(0);
  let holes = 0;
  for (let x = 0; x < W; x++) {
    let seen = false;
    for (let y = 0; y < H; y++) {
      if (board[y][x]) {
        if (!seen) { heights[x] = H - y; seen = true; }
      } else if (seen) holes++;
    }
  }
  let bumpiness = 0;
  for (let x = 0; x < W - 1; x++) bumpiness += Math.abs(heights[x] - heights[x + 1]);
  const total = heights.reduce((a, b) => a + b, 0);
  return WEIGHTS.height * total + WEIGHTS.lines * lines + WEIGHTS.holes * holes + WEIGHTS.bumpiness * bumpiness;
}

interface Placement { r: number; x: number; board: Board; lines: number }

/** Every distinct way to drop piece `k` straight down from the top of `board`. */
function placements(board: Board, k: number): Placement[] {
  const out: Placement[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < 4; r++) {
    const key = SHAPES[k][r].map(([x, y]) => `${x},${y}`).sort().join(';');
    if (seen.has(key)) continue; // O, and the symmetric rotations of I, S and Z
    seen.add(key);
    for (let x = -2; x < W; x++) {
      if (collides(board, k, r, x, SPAWN_Y)) continue;
      const y = dropY(board, { k, r, x, y: SPAWN_Y });
      const placed = stamp(board, k, r, x, y);
      const rows = fullRows(placed);
      out.push({ r, x, board: rows.length ? removeRows(placed, rows) : placed, lines: rows.length });
    }
  }
  return out;
}

/** Best placement of `k`, looking one piece ahead (`next`) when it is known. */
function bestPlacement(board: Board, k: number, next: number | null): { r: number; x: number; score: number } | null {
  let best: { r: number; x: number; score: number } | null = null;
  for (const p of placements(board, k)) {
    let score = evaluate(p.board, p.lines);
    if (next !== null) {
      let ahead = -Infinity;
      for (const q of placements(p.board, next)) ahead = Math.max(ahead, evaluate(q.board, q.lines));
      if (ahead > -Infinity) score += ahead;
    }
    if (!best || score > best.score) best = { r: p.r, x: p.x, score };
  }
  return best;
}

// ── messages and arguments ─────────────────────────────────────────────────
class FrameMsg {
  constructor(readonly time: Date) {}
}
const frame: Cmd = Tick(FRAME_MS, (t) => new FrameMsg(t));

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: bun examples/blocks.ts [--autoplay] [--seed N]');
  console.log('  --autoplay  a small heuristic AI plays, one visible move at a time');
  console.log('  --seed N    deterministic piece order (restarting replays the same game)');
  process.exit(0);
}
const AUTOPLAY = argv.includes('--autoplay');
const seedArg = argv.find((a) => a.startsWith('--seed='))?.slice(7) ?? argv[argv.indexOf('--seed') + 1];
const FIXED_SEED = argv.some((a) => a === '--seed' || a.startsWith('--seed=')) ? Number.parseInt(seedArg ?? '', 10) : NaN;
if ((argv.includes('--seed') || argv.some((a) => a.startsWith('--seed='))) && !Number.isFinite(FIXED_SEED)) {
  console.error('--seed needs an integer, e.g. --seed 7');
  process.exit(1);
}

// ── rendering helpers ──────────────────────────────────────────────────────
const st = () => newStyle();
const fg = (color: string, s: string, bold = false) => st().foreground(color).bold(bold).render(s);

const mix = (a: string, b: string, t: number): string => {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0')).join('');
};

const cellCache = new Map<string, string>();
function memo(key: string, make: () => string): string {
  let s = cellCache.get(key);
  if (s === undefined) cellCache.set(key, (s = make()));
  return s;
}
// Each cell is two half-blocks: a lighter top edge over the piece colour, so neighbouring cells stay readable.
const solid = (color: string) =>
  memo('s' + color, () => st().foreground(mix(color, C.flash, 0.22)).background(color).render('▀▀'));
const ghost = (color: string) => memo('g' + color, () => st().foreground(mix(color, C.base, 0.45)).render('▒▒'));
const empty = () => memo('e', () => st().foreground(C.grid).render('· '));

const padTo = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const centre = (s: string, w: number): string => {
  const left = Math.max(0, Math.floor((w - stringWidth(s)) / 2));
  return ' '.repeat(left) + s + ' '.repeat(Math.max(0, w - left - stringWidth(s)));
};
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const grouped = (n: number) => n.toLocaleString('en-US');

/** A titled rounded panel: `w` is the outer width, `lines` are padded to the inner width. */
function panel(title: string, lines: string[], w: number, color: string): string {
  const b = st().foreground(color);
  const t = ' ' + st().bold(true).foreground(color).render(title) + ' ';
  const top = b.render('╭─') + t + b.render('─'.repeat(Math.max(0, w - 3 - stringWidth(t) - 1))) + b.render('─╮');
  const body = lines.map((l) => padTo(l, w - 4)).join('\n');
  return top + '\n' + st().border(roundedBorder()).borderTop(false).borderForeground(color).padding(0, 1).render(body);
}

/** A piece as rows of two-column cells, `width` columns wide. */
function miniature(k: number, width: number, dimmed = false): string[] {
  const cells = SHAPES[k][0];
  const minX = Math.min(...cells.map(([x]) => x));
  const maxX = Math.max(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  const rows: string[] = [];
  for (let y = 0; y < 2; y++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      const on = cells.some(([cx, cy]) => cx === x && cy - minY === y);
      row += on ? solid(dimmed ? C.faint : COLORS[k]) : '  ';
    }
    rows.push(centre(row, width));
  }
  return rows;
}

// ── the model ──────────────────────────────────────────────────────────────
type Phase = 'playing' | 'paused' | 'over';

const MIN_W = 62;
const MIN_H = 25;

class Blocks implements Model {
  width = 0;
  height = 0;
  board = emptyBoard();
  piece!: Piece;
  hold: number | null = null;
  holdUsed = false;
  queue: number[] = [];
  bag: number[] = [];
  rng: () => number = Math.random;
  seed = 0;
  games = 0;
  best = 0;
  phase: Phase = 'playing';
  score = 0;
  lines = 0;
  level = 1;
  elapsed = 0;
  last = Date.now();
  fallT = 0;
  lockT = 0;
  lockResets = 0;
  clearing: number[] | null = null;
  flashT = 0;
  overT = 0;
  aiT = 0;
  plan: { hold: boolean; r: number; x: number } | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.seed = Number.isFinite(FIXED_SEED) ? FIXED_SEED : (Date.now() + this.games * 7919) >>> 0;
    this.games++;
    this.rng = mulberry32(this.seed);
    this.board = emptyBoard();
    this.hold = null;
    this.holdUsed = false;
    this.bag = [];
    this.queue = [];
    this.phase = 'playing';
    this.score = this.lines = this.elapsed = this.fallT = this.lockT = this.lockResets = this.flashT = this.overT = 0;
    this.level = 1;
    this.clearing = null;
    this.spawn(this.draw());
  }

  /** Next kind from the queue, which always keeps at least five pieces ahead. */
  draw(): number {
    while (this.queue.length < 5) {
      if (!this.bag.length) this.bag = newBag(this.rng);
      this.queue.push(this.bag.pop()!);
    }
    return this.queue.shift()!;
  }

  spawn(k: number): void {
    this.piece = { k, r: 0, x: 3, y: SPAWN_Y };
    this.fallT = this.lockT = this.lockResets = 0;
    this.plan = null;
    this.aiT = -AI_THINK_MS;
    if (collides(this.board, k, 0, 3, SPAWN_Y)) this.gameOver();
  }

  gameOver(): void {
    this.phase = 'over';
    this.overT = 0;
    this.best = Math.max(this.best, this.score);
  }

  // ── moves ────────────────────────────────────────────────────────────────
  grounded(): boolean {
    const p = this.piece;
    return collides(this.board, p.k, p.r, p.x, p.y + 1);
  }

  /** A successful move or rotation restarts the lock delay, a limited number of times. */
  touched(): void {
    if (this.grounded() && this.lockResets < LOCK_RESETS) {
      this.lockT = 0;
      this.lockResets++;
    }
  }

  move(dx: number): boolean {
    const p = this.piece;
    if (collides(this.board, p.k, p.r, p.x + dx, p.y)) return false;
    p.x += dx;
    this.touched();
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    const p = this.piece;
    const to = (p.r + dir + 4) % 4;
    if (p.k === 1) { p.r = to; return true; }
    const kicks = (p.k === 0 ? KICKS_I : KICKS_JLSTZ)[`${p.r}${to}`];
    for (const [kx, ky] of kicks) {
      if (!collides(this.board, p.k, to, p.x + kx, p.y - ky)) {
        p.r = to; p.x += kx; p.y -= ky;
        this.touched();
        return true;
      }
    }
    return false;
  }

  softDrop(): void {
    const p = this.piece;
    if (collides(this.board, p.k, p.r, p.x, p.y + 1)) return;
    p.y++;
    this.score += 1;
    this.fallT = 0;
    if (this.grounded()) this.lockT = 0;
  }

  hardDrop(): void {
    const y = dropY(this.board, this.piece);
    this.score += 2 * (y - this.piece.y);
    this.piece.y = y;
    this.lock();
  }

  swapHold(): void {
    if (this.holdUsed) return;
    const k = this.piece.k;
    const next = this.hold ?? this.draw();
    this.hold = k;
    this.spawn(next);
    this.holdUsed = true;
  }

  lock(): void {
    const { k, r, x, y } = this.piece;
    if (SHAPES[k][r].every(([, dy]) => y + dy < HIDDEN)) {
      this.board = stamp(this.board, k, r, x, y);
      this.gameOver(); // locked entirely above the well
      return;
    }
    this.board = stamp(this.board, k, r, x, y);
    const rows = fullRows(this.board);
    this.holdUsed = false;
    if (!rows.length) {
      this.spawn(this.draw());
      return;
    }
    this.score += LINE_SCORE[rows.length] * this.level;
    this.lines += rows.length;
    this.level = 1 + Math.floor(this.lines / 10);
    this.clearing = rows;
    this.flashT = 0;
  }

  // ── time ─────────────────────────────────────────────────────────────────
  step(dt: number): void {
    this.elapsed += dt;
    if (this.clearing) {
      this.flashT += dt;
      if (this.flashT >= FLASH_MS) {
        this.board = removeRows(this.board, this.clearing);
        this.clearing = null;
        this.spawn(this.draw());
      }
      return;
    }
    if (AUTOPLAY) {
      this.aiT += dt;
      while (this.aiT >= AI_STEP_MS && !this.clearing && this.phase === 'playing') {
        this.aiT -= AI_STEP_MS;
        this.think();
      }
      if (this.clearing || this.phase !== 'playing') return;
    }
    if (this.grounded()) {
      this.lockT += dt;
      if (this.lockT >= LOCK_MS) this.lock();
      return;
    }
    this.lockT = 0;
    this.fallT += dt;
    const every = gravityMs(this.level);
    while (this.fallT >= every && !this.grounded()) {
      this.fallT -= every;
      this.piece.y++;
    }
    if (this.grounded()) this.fallT = 0;
  }

  /** One visible AI action: hold, rotate, shift a column, or finally drop. */
  think(): void {
    if (!this.plan) {
      const p = this.piece;
      const best = bestPlacement(this.board, p.k, this.queue[0]);
      let plan = best ? { hold: false, r: best.r, x: best.x } : null;
      if (!this.holdUsed) {
        const other = this.hold ?? this.queue[0];
        const after = this.hold === null ? this.queue[1] : this.queue[0];
        const alt = bestPlacement(this.board, other, after);
        if (alt && (!best || alt.score > best.score + 0.4)) plan = { hold: true, r: alt.r, x: alt.x };
      }
      this.plan = plan ?? { hold: false, r: p.r, x: p.x };
    }
    if (this.plan.hold) {
      this.swapHold();
      return; // spawn() cleared the plan, so the next step plans for the new piece
    }
    const p = this.piece;
    const { r, x } = this.plan;
    if (p.r !== r) {
      const dir = (r - p.r + 4) % 4 === 3 ? -1 : 1;
      if (!this.rotate(dir)) this.plan.r = p.r; // blocked: settle for this orientation
    } else if (p.x !== x) {
      if (!this.move(Math.sign(x - p.x))) this.hardDrop();
    } else {
      this.hardDrop();
    }
  }

  // ── Elm architecture ─────────────────────────────────────────────────────
  init(): Cmd {
    return frame;
  }

  tooSmall(): boolean {
    return this.width < MIN_W || this.height < MIN_H;
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof WindowSizeMsg) {
      this.width = msg.width;
      this.height = msg.height;
      return [this, null];
    }
    if (msg instanceof FrameMsg) {
      const now = msg.time.getTime();
      // Autoplay advances a fixed step per frame, so a given --seed always plays out the same game.
      const dt = AUTOPLAY ? FRAME_MS : Math.min(100, Math.max(0, now - this.last));
      this.last = now;
      if (this.phase === 'playing' && !this.tooSmall()) this.step(dt);
      else if (this.phase === 'over') {
        this.overT += dt;
        if (AUTOPLAY && this.overT > 4000) this.reset();
      }
      return [this, frame];
    }
    if (!(msg instanceof KeyPressMsg)) return [this, null];

    const key = msg.toString();
    if (key === 'q' || key === 'ctrl+c') return [this, Quit];
    if (key === 'r') {
      this.best = Math.max(this.best, this.score);
      this.reset();
      return [this, null];
    }
    if (key === 'p') {
      if (this.phase === 'playing') this.phase = 'paused';
      else if (this.phase === 'paused') this.phase = 'playing';
      return [this, null];
    }
    if (this.phase !== 'playing' || this.clearing || AUTOPLAY || this.tooSmall()) return [this, null];
    switch (key) {
      case 'left': case 'h': this.move(-1); break;
      case 'right': case 'l': this.move(1); break;
      case 'down': case 'j': this.softDrop(); break;
      case 'up': case 'x': this.rotate(1); break;
      case 'z': this.rotate(-1); break;
      case 'space': this.hardDrop(); break;
      case 'c': this.swapHold(); break;
    }
    return [this, null];
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  /** The well: 20 rows of 20 columns, with the ghost, the piece and the clear animation. */
  wellRows(): string[] {
    const grid: Array<Array<{ k: number; ghost: boolean }>> = this.board.map((row) =>
      row.map((v) => ({ k: v - 1, ghost: false })));
    const p = this.piece;
    if (this.phase !== 'over' && !this.clearing) {
      const gy = dropY(this.board, p);
      for (const [dx, dy] of SHAPES[p.k][p.r]) {
        if (gy + dy >= 0) grid[gy + dy][p.x + dx] = { k: p.k, ghost: true };
      }
      for (const [dx, dy] of SHAPES[p.k][p.r]) {
        if (p.y + dy >= 0) grid[p.y + dy][p.x + dx] = { k: p.k, ghost: false };
      }
    }
    const rows: string[] = [];
    for (let y = HIDDEN; y < H; y++) {
      const flashing = this.clearing?.includes(y) ?? false;
      let line = '';
      for (let x = 0; x < W; x++) {
        const c = grid[y][x];
        if (c.k < 0) { line += empty(); continue; }
        if (c.ghost) { line += ghost(COLORS[c.k]); continue; }
        if (flashing) {
          // a white flash, then the row dissolves outwards from the middle
          const t = this.flashT;
          const gone = t > 110 && Math.abs(x - 4.5) < ((t - 110) / (FLASH_MS - 110)) * 5.5;
          line += gone ? empty() : solid(t < 110 ? C.flash : mix(COLORS[c.k], C.flash, 0.6));
        } else {
          line += solid(this.phase === 'over' ? mix(COLORS[c.k], C.base, 0.65) : COLORS[c.k]);
        }
      }
      rows.push(line);
    }
    return rows;
  }

  view(): View {
    const v = new View('');
    v.altScreen = true;
    v.windowTitle = 'Blocks';
    if (!this.width || !this.height) return v;

    if (this.tooSmall()) {
      const text = joinVertical(Center,
        fg(C.pink, 'Terminal too small', true),
        fg(C.sub, `Blocks needs at least ${MIN_W}×${MIN_H}`),
        fg(C.dim, `this one is ${this.width}×${this.height}`));
      v.content = place(this.width, this.height, Center, Center, text);
      return v;
    }

    // well
    let rows = this.wellRows();
    const dimText = (s: string) => fg(C.sub, s);
    const boxed = (lines: string[]) => lines.map((l) => st().background(C.mantle).render(centre(l, W * 2)));
    const overlay = (lines: string[]) => {
      const top = Math.floor((VISIBLE - lines.length) / 2);
      const styled = boxed(lines);
      rows = rows.map((row, y) => (y >= top && y < top + lines.length ? styled[y - top] : row));
    };
    if (this.phase === 'paused') {
      rows = rows.map(() => empty().repeat(W));
      overlay(['', fg(C.text, 'PAUSED', true), '', dimText('p to resume'), '']);
    } else if (this.phase === 'over') {
      overlay([
        '',
        fg(C.Z, 'GAME OVER', true),
        '',
        fg(C.dim, 'score ') + fg(C.text, grouped(this.score), true),
        fg(C.dim, 'lines ') + fg(C.text, String(this.lines), true),
        '',
        fg(C.teal, 'r', true) + dimText(' to restart'),
        fg(C.teal, 'q', true) + dimText(' to quit'),
        '',
      ]);
    }
    const well = st().border(roundedBorder()).borderForeground(this.phase === 'over' ? C.Z : C.faint).render(rows.join('\n'));

    // left: hold and stats
    const LW = 14;
    const holdBody = this.hold === null ? ['', ''] : miniature(this.hold, LW - 4, this.holdUsed);
    const stat = (label: string, value: string, color = C.text) => [fg(C.dim, label), fg(color, value, true)];
    const stats = [
      ...stat('SCORE', grouped(this.score), C.pink), '',
      ...stat('LINES', String(this.lines)), '',
      ...stat('LEVEL', String(this.level), C.O), '',
      ...stat('TIME', mmss(this.elapsed)), '',
      ...stat('BEST', grouped(Math.max(this.best, this.score)), C.teal),
    ];
    const left = joinVertical(Left,
      panel('HOLD', ['', ...holdBody, ''], LW, C.T),
      panel('STATS', stats, LW, C.J));

    // right: next three and keys
    const RW = 22;
    const nextBody: string[] = [];
    this.queue.slice(0, 3).forEach((k, i) => {
      if (i) nextBody.push('');
      nextBody.push(...miniature(k, RW - 4));
    });
    const key = (k: string, what: string) => fg(C.teal, padTo(k, 8), true) + fg(C.sub, what);
    const right = joinVertical(Left,
      panel('NEXT', nextBody, RW, C.O),
      panel('KEYS', [
        key('← →', 'move'),
        key('↓', 'soft drop'),
        key('space', 'hard drop'),
        key('↑ x', 'rotate ↻'),
        key('z', 'rotate ↺'),
        key('c', 'hold'),
        key('p', 'pause'),
        key('r', 'restart'),
        key('q', 'quit'),
        '',
      ], RW, C.dim));

    const gap = '  ';
    const body = joinHorizontal(Top, left, gap, well, gap, right);
    const bodyW = stringWidth(body.split('\n')[0]);

    // title and footer
    const title = [...'B L O C K S'].map((ch, i) => (ch === ' ' ? ' ' : fg(COLORS[(i / 2) % 7], ch, true))).join('');
    const mode = AUTOPLAY ? fg(C.O, 'autoplay', true) : fg(C.teal, 'playing', true);
    const state = this.phase === 'paused' ? fg(C.O, 'paused', true) : this.phase === 'over' ? fg(C.Z, 'game over', true) : mode;
    const foot = fg(C.dim, `seed ${this.seed} · level ${this.level} · `) + state;
    const screen = joinVertical(Left,
      centre(title, bodyW),
      '',
      body,
      centre(foot, bodyW));
    v.content = place(this.width, this.height, Center, Center, screen);
    return v;
  }
}

await NewProgram(new Blocks()).run();
