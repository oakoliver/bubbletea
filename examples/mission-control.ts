/**
 * Mission control — a dashboard built with @oakoliver/bubbletea,
 * @oakoliver/bubbles and @oakoliver/lipgloss: a ports table, test runs with
 * streaming progress bars, before/after and lines-changed bar charts, and an
 * event log.
 *
 * Usage:
 *   bun examples/mission-control.ts               demo mode (invented dataset)
 *   bun examples/mission-control.ts --live [ROOT] real git checkouts of the Charm ports
 *
 * Demo mode needs nothing but this repo: six fictional packages with made-up
 * versions, commits and test counts, and a simulated test run. Live mode reads
 * the checkouts in ROOT (default $PORTS_ROOT, then the parent directory of this
 * repository) and actually runs their test suites; see examples/README.md.
 *
 * Keys: ↑/k ↓/j select a row · q quit
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NewProgram, View, Quit, Batch, Tick, WindowSizeMsg } from '../src/index.ts';
import type { Cmd, Msg, Program } from '../src/index.ts';
import {
  truncate, newStyle, roundedBorder, normalBorder, joinHorizontal, joinVertical, Top, Left,
  blend1D, colorToRGB, fgColor, stringWidth,
} from '@oakoliver/lipgloss';
import {
  newTable, withColumns, withTableHeight, withTableWidth, withTableFocused, withTableStyles,
  newProgress, withProgressColors, withProgressWidth, withFillCharacters, withoutPercentage,
  newSpinner, withSpinner, withSpinnerStyle, Dot, Points,
  newViewport, newHelp, newBinding, withKeys, withHelp, matches,
} from '@oakoliver/bubbles';

// ── shared model data ──────────────────────────────────────────────────────
interface Port {
  name: string; up: string; version: string; tip: string; hasSync: boolean; branch: string;
  ins: number; del: number;
  base: number | null; // tests passing on main
  baseDone: boolean;
  cwd: string | null; // live mode: export of the sync tip (or HEAD without a sync branch)
  pass: number; fail: number; skip: number; expects: number; ms: number;
  running: boolean; runs: number; live: number; lastKey: string;
}
interface LogLine { date: string; time: string; tag: string; color: string; what: string; detail: string }
interface Result { pass: number; fail: number; skip: number; expects: number; ms: number }

const C = {
  violet: '#7D56F4', pink: '#EE6FF8', cyan: '#3EE6D2', green: '#04D98B',
  amber: '#FFB454', red: '#FF5F87', dim: '#5C5C74', text: '#D6D6E7', faint: '#3A3A4E', blue: '#5A8DEE',
};

const newPort = (p: Partial<Port> & Pick<Port, 'name' | 'up' | 'version' | 'tip' | 'hasSync' | 'branch' | 'ins' | 'del'>): Port => ({
  base: null, baseDone: false, cwd: null,
  pass: 0, fail: 0, skip: 0, expects: 0, ms: 0, running: false, runs: 0, live: 0, lastKey: '',
  ...p,
});

let program: Program | null = null;
let stopped = false;
let runNo = 0;
const send = (m: Msg) => program?.send(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── arguments ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const liveAt = args.indexOf('--live');
const LIVE = liveAt >= 0;
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: bun examples/mission-control.ts [--live [ROOT]]');
  console.log('  (default)      demo mode: invented packages and a simulated test run');
  console.log('  --live [ROOT]  read real git checkouts of the Charm ports in ROOT (default: $PORTS_ROOT,');
  console.log('                 then the parent directory of this repository) and run their test suites');
  console.log('  SYNC_BRANCH    branch compared against main in live mode (default sync/upstream-2026-09)');
  process.exit(0);
}

let ports: Port[];
let log: LogLine[];
let BRANCH: string;
let SUBTITLE: string;
let startSource: () => void;
let cleanup = () => {};

if (!LIVE) {
  // ── demo mode: an invented dataset ───────────────────────────────────────
  // Six fictional libraries being synced with their (equally fictional)
  // upstreams. Nothing here is read from disk; the test run is simulated.
  BRANCH = 'sync/upstream';
  SUBTITLE = '6 packages · demo data (--live for real repos)';
  const demo = [
    { name: 'quartz', up: 'v3.4.2', version: '2.3.0', tip: '4f1c9ae', ins: 2840, del: 311, base: 512, pass: 734, skip: 0, expects: 1466 },
    { name: 'nimbus', up: 'v1.9.0', version: '1.6.0', tip: 'b73e02d', ins: 1215, del: 486, base: 288, pass: 341, skip: 3, expects: 902 },
    { name: 'fennel', up: 'v0.18.1', version: '0.9.2', tip: '09da6f4', ins: 402, del: 57, base: 131, pass: 149, skip: 0, expects: 377 },
    { name: 'orbit', up: 'v2.2.0', version: '1.4.0', tip: 'e5b8c31', ins: 3690, del: 902, base: 406, pass: 588, skip: 2, expects: 1731 },
    { name: 'pebble', up: 'v4.0.3', version: '3.0.1', tip: '7c2a9f0', ins: 968, del: 144, base: 57, pass: 96, skip: 0, expects: 260 },
    { name: 'lantern', up: 'v1.1.5', version: '1.1.0', tip: 'a1e47b6', ins: 1777, del: 1203, base: 203, pass: 262, skip: 4, expects: 655 },
  ];
  const subjects: Record<string, string[]> = {
    quartz: ['Port Quartz v3.4.2 parity (2.3.0)'],
    nimbus: ['Port Nimbus v1.9.0 retry policies (1.6.0)'],
    fennel: ['Fix locale fallback in formatters (0.9.2)'],
    orbit: ['Port Orbit v2.2.0 scheduler rewrite (1.4.0)', 'Replace polling with event streams'],
    pebble: ['Port Pebble v4.0.3 codec fixes (3.0.1)'],
    lantern: ['Port Lantern v1.1.5 (1.1.0)'],
  };
  ports = demo.map((d) => newPort({ ...d, hasSync: true, branch: BRANCH, base: d.base, baseDone: true }));
  const t0 = Date.now() - 95 * 60_000;
  log = demo.flatMap((d, i) => (subjects[d.name] ?? []).map((subject, j) => {
    const date = new Date(t0 + (i * 13 + j * 4) * 60_000);
    return { date: date.toISOString(), time: date.toTimeString().slice(0, 8), tag: 'COMMIT', color: C.violet, what: `${d.name} ${d.tip}`, detail: subject };
  }));

  // Simulated `bun test`: tests finish at a jittered rate and report the dataset's counts.
  const simulate = async (i: number): Promise<Result> => {
    const d = demo[i]!;
    const total = d.pass + d.skip;
    const rate = 900 + ((i * 377) % 500); // tests per second
    const started = performance.now();
    let done = 0;
    while (done < total && !stopped) {
      await sleep(40);
      const n = Math.min(total - done, Math.max(1, Math.round((rate * 0.04) * (0.6 + Math.random() * 0.8))));
      done += n;
      send({ type: 'suite.dots', i, n });
    }
    return { pass: d.pass, fail: 0, skip: d.skip, expects: d.expects, ms: Math.round(performance.now() - started) };
  };
  startSource = () => {
    void (async () => {
      while (!stopped) {
        runNo++;
        for (let i = 0; i < ports.length && !stopped; i++) {
          send({ type: 'suite.start', i });
          send({ type: 'suite.done', i, ...(await simulate(i)) });
        }
        await sleep(600);
      }
    })();
  };
} else {
  // ── live mode: real git checkouts ────────────────────────────────────────
  // Reads the six Charm ports from ROOT: git branch tips, commit subjects,
  // `diff --shortstat main...<branch>` and package.json versions, and runs
  // `bun test` on `git archive` exports in a temp directory, so uncommitted
  // edits never leak in and the repos are only read. The main export installs
  // the dependencies pinned by its lockfile (the published versions it was
  // released against), falling back to the repo's node_modules. The sync-tip
  // export links the repo's node_modules, so it runs against whatever you have
  // installed for the branch (see README).
  const REPO_DIR = fileURLToPath(new URL('..', import.meta.url));
  const rootArg = args[liveAt + 1] && !args[liveAt + 1]!.startsWith('-') ? args[liveAt + 1] : undefined;
  const ROOT = resolve(rootArg ?? process.env.PORTS_ROOT ?? join(REPO_DIR, '..'));
  BRANCH = process.env.SYNC_BRANCH ?? 'sync/upstream-2026-09';
  const NAMES = ['lipgloss', 'glamour', 'bubbletea', 'bubbles', 'huh', 'glow'];
  // The upstream release each port tracks in this sync.
  const UPSTREAM: Record<string, string> = {
    lipgloss: 'v2.0.6', glamour: 'v2.0.1', bubbletea: 'v2.0.10', bubbles: 'v2.2.1', huh: 'v2.0.3+', glow: 'v3.0.0',
  };

  const found = NAMES.filter((n) => existsSync(join(ROOT, n, '.git')) && existsSync(join(ROOT, n, 'package.json')));
  const missing = NAMES.filter((n) => !found.includes(n));
  if (found.length === 0) {
    console.error(`mission-control: none of ${NAMES.join(', ')} were found as git checkouts in ${ROOT}.`);
    console.error('Pass the directory that contains them: bun examples/mission-control.ts --live /path/to/ports');
    process.exit(1);
  }
  if (missing.length) console.error(`mission-control: not found in ${ROOT} (skipped): ${missing.join(', ')}`);
  SUBTITLE = `${found.length} TypeScript ports of charmbracelet`;

  const git = (repo: string, ...a: string[]): string =>
    spawnSync('git', ['-C', join(ROOT, repo), ...a], { encoding: 'utf8' }).stdout?.trim() ?? '';

  // Exports of each port's main and sync tip live here and are removed on exit.
  const TMP = mkdtempSync(join(tmpdir(), 'mission-control-'));
  cleanup = () => rmSync(TMP, { recursive: true, force: true });
  process.on('exit', cleanup);

  const exportTo = (name: string, rev: string): string | null => {
    const dir = join(TMP, `${name}@${rev.replace(/\W+/g, '_')}`);
    const r = spawnSync('sh', ['-c', `mkdir -p "${dir}" && git -C "${join(ROOT, name)}" archive "${rev}" | tar -x -C "${dir}"`]);
    return r.status === 0 ? dir : null;
  };
  /** Exports `rev` of a port and links the repo's own node_modules into it. */
  const exportLinked = (name: string, rev: string): string | null => {
    const dir = exportTo(name, rev);
    if (dir && existsSync(join(ROOT, name, 'node_modules'))) symlinkSync(join(ROOT, name, 'node_modules'), join(dir, 'node_modules'));
    return dir;
  };
  const install = (dir: string, ...flags: string[]): Promise<boolean> => new Promise((done) => {
    const child = spawn('bun', ['install', ...flags], { cwd: dir, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', () => done(false));
    child.on('close', (code) => { clearTimeout(timer); done(code === 0); });
  });
  /**
   * Exports `rev` and installs the dependencies pinned by its lockfile. When the
   * lockfile is out of date (or npm is unreachable) it falls back to linking the
   * repo's own node_modules.
   */
  const exportInstalled = async (name: string, rev: string): Promise<string | null> => {
    const dir = exportTo(name, rev);
    if (!dir) return null;
    if (await install(dir, '--frozen-lockfile')) return dir;
    if (existsSync(join(ROOT, name, 'node_modules'))) symlinkSync(join(ROOT, name, 'node_modules'), join(dir, 'node_modules'));
    return dir;
  };

  ports = found.map((name) => {
    const hasSync = git(name, 'rev-parse', '--verify', '--quiet', BRANCH) !== '';
    const stat = hasSync ? git(name, 'diff', '--shortstat', `main...${BRANCH}`) : '';
    const num = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0);
    const rev = hasSync ? BRANCH : 'HEAD';
    return newPort({
      name, up: UPSTREAM[name] ?? '?',
      version: JSON.parse(git(name, 'show', `${rev}:package.json`) || '{}').version ?? '?',
      tip: git(name, 'rev-parse', '--short', rev), hasSync, branch: git(name, 'branch', '--show-current'),
      ins: num(/(\d+) insertion/), del: num(/(\d+) deletion/), cwd: exportLinked(name, rev),
    });
  });
  log = ports.filter((p) => p.hasSync).flatMap((p) =>
    git(p.name, 'log', '--format=%h|%cI|%s', `main..${BRANCH}`).split('\n').filter(Boolean).map((l) => {
      const [hash, date, ...s] = l.split('|');
      return { date: date!, time: date!.slice(11, 19), tag: 'COMMIT', color: C.violet, what: `${p.name} ${hash}`, detail: s.join('|') };
    })).sort((a, b) => a.date.localeCompare(b.date));

  /** Runs `bun test --dots` in dir; onDots receives how many tests just finished. */
  const bunTest = (dir: string, onDots?: (n: number) => void): Promise<Result> => new Promise((done) => {
    const t0 = performance.now();
    const child = spawn('bun', ['test', '--dots'], { cwd: dir, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    let out = '';
    const onData = (b: Buffer) => {
      const t = b.toString();
      out += t;
      const dots = (t.match(/\./g) ?? []).length;
      if (dots && onDots && !/pass|fail/.test(t)) onDots(dots);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', () => done({ pass: 0, fail: 1, skip: 0, expects: 0, ms: 0 }));
    child.on('close', () => {
      const n = (re: RegExp) => Number(out.match(re)?.[1] ?? 0);
      done({
        pass: n(/(\d+) pass/), fail: n(/(\d+) fail/) + n(/(\d+) errors?\b/), skip: n(/(\d+) skip/),
        expects: n(/(\d+) expect\(\) calls/),
        ms: Math.round(Number(out.match(/Ran .*\[(\d+(?:\.\d+)?)ms\]/)?.[1] ?? performance.now() - t0)),
      });
    });
  });

  startSource = () => {
    // baselines: every port's main, in parallel
    void Promise.all(ports.map(async (p, i) => {
      if (!p.hasSync) return;
      const dir = await exportInstalled(p.name, 'main');
      const r = dir && !stopped ? await bunTest(dir) : null;
      send({ type: 'base.done', i, pass: r && !r.fail ? r.pass : null });
    }));
    // the live loop over the sync tips
    void (async () => {
      while (!stopped) {
        runNo++;
        for (let i = 0; i < ports.length && !stopped; i++) {
          if (!ports[i]!.cwd) continue;
          send({ type: 'suite.start', i });
          const r = await bunTest(ports[i]!.cwd!, (n) => send({ type: 'suite.dots', i, n }));
          send({ type: 'suite.done', i, ...r });
        }
        await sleep(400);
      }
    })();
  };
}

// ── rendering helpers ──────────────────────────────────────────────────────
const st = () => newStyle();
const dim = st().foreground(C.dim);
const txt = st().foreground(C.text);
const now = () => new Date().toTimeString().slice(0, 8);
const fmt = (n: number) => n.toLocaleString('en-US');
const padRight = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const padLeft = (s: string, w: number) => ' '.repeat(Math.max(0, w - stringWidth(s))) + s;

function gradientText(s: string, ...stops: string[]): string {
  const chars = [...s];
  const cols = blend1D(Math.max(2, chars.length), ...stops);
  return chars.map((ch, i) => {
    const c = colorToRGB(cols[i]!)!;
    return ch === ' ' ? ' ' : fgColor(c.r, c.g, c.b) + '\x1b[1m' + ch + '\x1b[0m';
  }).join('');
}

/** A rounded panel with the title set into the top border. */
function panel(title: string, body: string, w: number, color: string, right = '', h = 0): string {
  const raw = body.split('\n');
  while (raw.length < h) raw.push('');
  const lines = raw.map((l) => padRight(l, w - 4));
  const b = st().foreground(color);
  const t = ' ' + st().bold(true).foreground(color).render(title) + ' ';
  const r = right ? ' ' + right + ' ' : '';
  const fill = w - 3 - stringWidth(t) - stringWidth(r) - 1;
  const top = b.render('╭─') + t + b.render('─'.repeat(Math.max(0, fill))) + r + b.render('─╮');
  return top + '\n' + st().border(roundedBorder()).borderTop(false).borderForeground(color).padding(0, 1).render(lines.join('\n'));
}

/** A horizontal bar; the first `dimUntil` cells are drawn in a muted tone. */
function gbar(n: number, max: number, width: number, stops: string[], dimUntil = 0): string {
  const cells = Math.round((n / max) * width * 8);
  const parts = ' ▏▎▍▌▋▊▉';
  const full = Math.floor(cells / 8);
  const cols = blend1D(Math.max(2, width), ...stops);
  let s = '';
  for (let x = 0; x < full; x++) {
    const c = colorToRGB(x < dimUntil ? '#4A3C8C' : cols[x]!)!;
    s += fgColor(c.r, c.g, c.b) + '█';
  }
  if (cells % 8) { const c = colorToRGB(cols[Math.min(full, width - 1)]!)!; s += fgColor(c.r, c.g, c.b) + parts[cells % 8]; }
  return s + '\x1b[0m' + ' '.repeat(Math.max(0, width - full - (cells % 8 ? 1 : 0)));
}

const keys = {
  up: newBinding(withKeys('up', 'k'), withHelp('↑/k', 'up')),
  down: newBinding(withKeys('down', 'j'), withHelp('↓/j', 'down')),
  quit: newBinding(withKeys('q', 'ctrl+c'), withHelp('q', 'quit')),
};
const keyMap = { shortHelp: () => [keys.up, keys.down, keys.quit], fullHelp: () => [[keys.up, keys.down, keys.quit]] };

const LEFT_W = 80; // the right-hand column takes the rest (needs a terminal ≥ 120 columns)
const tick = (): Cmd => Tick(250, () => ({ type: 'clock' }));

// ── model ──────────────────────────────────────────────────────────────────
class Dashboard {
  width = 132;
  table = newTable(
    withColumns([
      { title: 'PORT', width: 10 }, { title: 'UPSTREAM', width: 9 }, { title: 'VERSION', width: 8 },
      { title: 'COMMITTED', width: 16 }, { title: 'TESTS main→sync', width: 15 }, { title: 'DELTA', width: 6 },
    ]),
    withTableStyles({
      header: st().bold(true).foreground(C.violet).padding(0, 1)
        .border(normalBorder()).borderTop(false).borderLeft(false).borderRight(false).borderForeground(C.faint),
      cell: st().padding(0, 1),
      selected: st().bold(true).foreground('#FFFFFF').background('#4B2FA8'),
    }),
    // after the styles: the header height (with its border) is subtracted from this
    withTableHeight(ports.length + 2),
    withTableWidth(LEFT_W - 4),
    withTableFocused(true),
  );
  bars = ports.map(() => newProgress(withProgressColors('#7D56F4', '#EE6FF8', '#3EE6D2'), withFillCharacters('█', '░'), withoutPercentage()));
  spin = newSpinner(withSpinner(Dot), withSpinnerStyle(st().foreground(C.pink)));
  live = newSpinner(withSpinner(Points), withSpinnerStyle(st().foreground(C.green)));
  logVp = newViewport();
  help = newHelp();
  maxTests = Math.max(1, ...ports.map((p) => p.base ?? 0));

  constructor() {
    this.logVp.setHeight(9);
    this.resize(this.width);
    this.refreshRows();
  }

  get rightW(): number { return this.width - LEFT_W - 1; }

  resize(width: number): void {
    this.width = Math.max(120, width);
    this.logVp.setWidth(this.width - 4);
    this.help.setWidth(this.width);
    for (const b of this.bars) b.setWidth(this.rightW - 4 - 12 - 17);
  }

  refreshRows(): void {
    const cur = this.table.cursor();
    this.table.setRows(ports.map((p, i) => {
      const after = p.runs ? p.pass : null;
      const base = !p.hasSync ? '—' : p.base ?? (p.baseDone ? '?' : '…');
      const tests = `${base} → ${after ?? '…'}`;
      const delta = p.base != null && after != null ? `+${after - p.base}` : '';
      const state = p.hasSync ? `tip ${p.tip}` : `${p.branch} ${p.tip}`;
      if (i === cur) return [p.name, p.up, p.version, state, tests, delta];
      return [
        st().bold(true).foreground(C.text).render(p.name),
        dim.render(p.up),
        txt.render(p.version),
        st().foreground(p.hasSync ? C.green : C.amber).render((p.hasSync ? '● ' : '◆ ') + state),
        dim.render(`${base} → `) + st().bold(true).foreground(after == null ? C.dim : p.fail ? C.red : C.green).render(String(after ?? '…')),
        st().foreground(C.cyan).render(delta),
      ];
    }));
  }

  init(): Cmd {
    setTimeout(() => startSource(), 50);
    return Batch(tick(), () => this.spin.tick(), () => this.live.tick());
  }

  update(msg: Msg): [Dashboard, Cmd] {
    const cmds: Cmd[] = [];
    if (msg instanceof WindowSizeMsg) this.resize(msg.width);
    if (msg?._tag === 'KeyPressMsg') {
      if (matches(msg, keys.quit)) { stopped = true; return [this, Quit]; }
      this.table.update(msg);
      this.refreshRows();
      return [this, null];
    }
    switch (msg?.type) {
      case 'clock':
        cmds.push(tick());
        break;
      case 'base.done': {
        const p = ports[msg.i]!;
        p.base = msg.pass;
        p.baseDone = true;
        if (msg.pass != null) this.maxTests = Math.max(this.maxTests, msg.pass);
        else log.push({ date: '', time: now(), tag: 'BASE', color: C.amber, what: p.name, detail: 'could not install or run the main branch' });
        this.refreshRows();
        break;
      }
      case 'suite.start': {
        const p = ports[msg.i]!;
        p.running = true;
        p.live = 0;
        break;
      }
      case 'suite.dots': {
        const p = ports[msg.i]!;
        p.live += msg.n;
        cmds.push(this.bars[msg.i]!.setPercent(Math.min(1, p.live / this.maxTests)));
        break;
      }
      case 'suite.done': {
        const p = ports[msg.i]!;
        Object.assign(p, { pass: msg.pass, fail: msg.fail, skip: msg.skip, expects: msg.expects, ms: msg.ms, running: false });
        p.runs++;
        this.maxTests = Math.max(this.maxTests, p.pass + p.skip);
        cmds.push(this.bars[msg.i]!.setPercent(Math.min(1, (p.pass + p.skip) / this.maxTests)));
        // log a suite's result on its first run, and whenever it changes
        const key = `${p.pass}/${p.fail}/${p.skip}`;
        if (p.lastKey !== key) {
          log.push({
            date: '', time: now(), tag: p.fail ? 'FAIL' : 'TEST', color: p.fail ? C.red : C.green, what: p.name,
            detail: `${LIVE ? "bun test" : "test run"}: ${p.pass} pass, ${p.fail} fail${p.skip ? `, ${p.skip} skip` : ''}, ${fmt(p.expects)} expect() calls [${p.ms}ms]`,
          });
        }
        p.lastKey = key;
        this.refreshRows();
        break;
      }
    }
    for (const s of [this.spin, this.live]) { const [, c] = s.update(msg); if (c) cmds.push(c); }
    for (const b of this.bars) { const [, c] = b.update(msg); if (c) cmds.push(c); }
    return [this, Batch(...cmds)];
  }

  header(): string {
    const brand = gradientText('▌ MISSION CONTROL', '#7D56F4', '#EE6FF8', '#3EE6D2');
    const sub = dim.render(`  upstream sync  ·  ${SUBTITLE}`);
    const pill = st().bold(true).foreground('#0B0B14').background(LIVE ? C.green : C.amber).padding(0, 1).render(LIVE ? 'LIVE' : 'DEMO');
    const right = this.live.view() + ' ' + st().foreground(C.pink).render(BRANCH) + dim.render(`  ${now()}  `) + pill;
    return brand + sub + ' '.repeat(Math.max(1, this.width - stringWidth(brand) - stringWidth(sub) - stringWidth(right))) + right;
  }

  runsView(): string {
    const rows = ports.map((p, i) => {
      const icon = p.running ? this.spin.view()
        : p.runs ? st().foreground(p.fail ? C.red : C.green).render(p.fail ? '✗' : '✓') : dim.render('○');
      const label = (p.running ? st().bold(true).foreground('#FFFFFF') : txt).render(padRight(p.name, 10));
      const stat = p.running ? st().foreground(C.pink).render(padLeft(`${p.live} running`, 16))
        : p.runs ? txt.render(padLeft(String(p.pass), 4)) + dim.render(padLeft(`pass ${p.ms}ms`, 12))
          : dim.render(padLeft(p.cwd ? 'queued' : 'no export', 16));
      // the Dot spinner's frames carry a trailing space; pad the icon to a fixed width
      return `${padRight(icon, 2)}${label}${this.bars[i]!.view()} ${stat}`;
    });
    const done = ports.filter((p) => p.runs);
    const sum = (f: (p: Port) => number) => done.reduce((a, p) => a + f(p), 0);
    const fails = sum((p) => p.fail);
    rows.push('');
    rows.push(dim.render('pass ') + st().bold(true).foreground(C.green).render(fmt(sum((p) => p.pass))) +
      dim.render('  fail ') + st().bold(true).foreground(fails ? C.red : C.green).render(String(fails)) +
      dim.render('  expect() ') + txt.render(fmt(sum((p) => p.expects))) + dim.render(`  run ${runNo}`));
    return rows.join('\n');
  }

  growthView(): string {
    const barW = LEFT_W - 4 - 11 - 23;
    const rows = ports.map((p) => {
      const after = p.runs ? p.pass : null;
      const b = p.base ?? 0;
      const bar = gbar(after ?? b, this.maxTests, barW, ['#7D56F4', '#EE6FF8', '#3EE6D2'], Math.round((b / this.maxTests) * barW));
      const label = !p.hasSync
        ? dim.render('no sync branch ') + st().bold(true).foreground(C.text).render(String(after ?? '…'))
        : dim.render(padLeft(String(p.base ?? (p.baseDone ? '?' : '…')), 4) + ' → ') + st().bold(true).foreground(C.text).render(padRight(String(after ?? '…'), 4)) +
          st().foreground(C.cyan).render(after != null && p.base != null ? padLeft(`+${after - p.base}`, 5) : '');
      return txt.render(padRight(p.name, 11)) + bar + ' ' + label;
    });
    rows.push('');
    rows.push(st().foreground('#4A3C8C').render('█') + dim.render(' tests on main   ') +
      gradientText('███', '#7D56F4', '#EE6FF8', '#3EE6D2') + dim.render(LIVE ? ' added on the sync branch (live bun test)' : ' added on the sync branch'));
    return rows.join('\n');
  }

  churnView(): string {
    const max = Math.max(1, ...ports.filter((p) => p.hasSync).map((p) => p.ins + p.del));
    const barW = this.rightW - 4 - 10 - 15;
    return ports.map((p) => {
      if (!p.hasSync) return txt.render(padRight(p.name, 10)) + dim.render('no sync branch yet');
      const iw = Math.round((p.ins / max) * barW);
      const dw = Math.max(p.del ? 1 : 0, Math.round((p.del / max) * barW));
      return txt.render(padRight(p.name, 10)) + st().foreground(C.green).render('█'.repeat(iw)) + st().foreground(C.red).render('█'.repeat(dw)) +
        ' '.repeat(Math.max(0, barW - iw - dw)) + st().foreground(C.green).render(padLeft(`+${p.ins}`, 7)) + st().foreground(C.red).render(padLeft(`-${p.del}`, 6));
    }).join('\n') + '\n\n' + dim.render('git diff --shortstat main...sync');
  }

  logView(): string {
    const detailW = this.width - 4 - 8 - 2 - 7 - 18;
    const lines = log.map((l) => dim.render(l.time) + '  ' + st().bold(true).foreground(l.color).render(padRight(l.tag, 7)) +
      st().bold(true).foreground(C.text).render(padRight(l.what, 18)) + dim.render(truncate(l.detail, detailW)));
    this.logVp.setContent(lines.join('\n'));
    this.logVp.gotoBottom();
    return this.logVp.view();
  }

  view(): View {
    const sel = ports[this.table.cursor()]!;
    const tbl = panel('PORTS', this.table.view(), LEFT_W, C.violet,
      dim.render('selected ') + st().bold(true).foreground(C.pink).render(sel.name), 8);
    const runs = panel('TEST RUNS', this.runsView(), this.rightW, C.pink, dim.render(LIVE ? 'bun test, live' : 'simulated'), 8);
    const growth = panel('TESTS PER PORT', this.growthView(), LEFT_W, C.cyan, dim.render('main → sync'), 8);
    const churn = panel('LINES CHANGED', this.churnView(), this.rightW, C.amber, dim.render('+ins  -del'), 8);
    const logp = panel('EVENT LOG', this.logView(), this.width, C.blue, dim.render('git log + test runs'));
    const view = new View(joinVertical(Left,
      this.header(), '',
      joinHorizontal(Top, tbl, ' ', runs),
      joinHorizontal(Top, growth, ' ', churn),
      logp,
      ' ' + this.help.view(keyMap),
    ));
    view.altScreen = true;
    return view;
  }
}

program = NewProgram(new Dashboard());
await program.run();
stopped = true;
cleanup();
process.exit(0);
