/**
 * sysmon — an htop-style system monitor built with @oakoliver/bubbletea,
 * @oakoliver/bubbles and @oakoliver/lipgloss: per-core CPU bars, a CPU history
 * chart, memory and load, and a live process table you can sort, filter and
 * fold into a tree.
 *
 * READ-ONLY BY DESIGN: sysmon only observes. It has no kill, signal or renice
 * feature, and the only commands it ever runs are `ps` (and, on macOS,
 * `vm_stat`) to read the process list.
 *
 * Usage:
 *   bun examples/sysmon.ts          real data from this machine
 *   bun examples/sysmon.ts --demo   deterministic synthetic data (invented
 *                                   processes, seeded PRNG, nothing is read
 *                                   from this machine)
 *
 * CPU, memory, load and uptime come from `node:os` and work on macOS, Linux
 * and Windows. The process list needs `ps` (macOS and Linux); without it the
 * table is replaced by a note and the rest keeps working. `ps` runs as an
 * async child process every 2 s, so the UI never blocks.
 *
 * Keys: ↑/↓ (k/j, pgup/pgdn, g/G) select · enter details · / filter by name
 *       (enter keeps it, esc clears it) · c cpu · m memory · p pid · n name
 *       (press again to reverse) · t tree view · esc close/clear · q quit
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { basename } from 'node:path';
import { NewProgram, View, Quit, Batch, Tick, WindowSizeMsg, KeyPressMsg } from '../src/index.ts';
import type { Cmd, Msg, Program } from '../src/index.ts';
import {
  newStyle, joinHorizontal, joinVertical, place, normalBorder, truncate, stringWidth,
  Top, Left, Center, blend1D, colorToRGB, fgColor,
} from '@oakoliver/lipgloss';
import {
  newTable, withColumns, withTableHeight, withTableWidth, withTableFocused, withTableStyles,
  newTextInput, newHelp, newBinding, withKeys, withHelp, helpDefaultDarkStyles,
} from '@oakoliver/bubbles';

// ── data model ─────────────────────────────────────────────────────────────
interface Proc { pid: number; ppid: number; cpu: number; mem: number; rss: number; etime: number; name: string }
/** One reading of the machine: per-core CPU %, memory in bytes, load average (null if unsupported). */
interface Sample { cores: number[]; total: number; memUsed: number; memTotal: number; load: number[] | null; uptime: number }
interface Source {
  host: string;
  platform: string;
  hasPs: boolean;
  /** Samples taken before the first frame, so the charts do not start empty. */
  warm: Sample[];
  sample(): Sample;
  procs(): Promise<{ procs: Proc[]; memUsed?: number }>;
  args(pid: number): Promise<string | null>;
}

const C = {
  violet: '#7D56F4', pink: '#EE6FF8', cyan: '#3EE6D2', green: '#04D98B',
  amber: '#FFB454', red: '#FF5F87', dim: '#7C7C98', text: '#D6D6E7', faint: '#3A3A4E', blue: '#5A8DEE',
};

const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: bun examples/sysmon.ts [--demo]');
  console.log('  (default)  real data: CPU/memory from node:os, processes from `ps`');
  console.log('  --demo     deterministic synthetic data (invented processes, nothing read from this machine)');
  process.exit(0);
}
if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error('sysmon needs an interactive terminal.');
  process.exit(1);
}

const SAMPLE_MS = 750; // CPU / memory sampling interval
const PS_MS = 2000; // process list refresh interval
const HISTORY = 400; // samples kept for the charts

// ── demo source: invented data, seeded PRNG ────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoProc {
  pid: number; ppid: number; name: string; args: string;
  base: number; // typical CPU %
  rssMb: number;
  age: number; // seconds already running at step 0
  spike?: [number, number]; // CPU % range when this process bursts
  cpu: number; rss: number; burst: number; level: number;
}

const DEMO_CORES = 8;
const DEMO_TOTAL_MEM = 16 * 1024 ** 3;
const DEMO_LOAD = 3; // scales the typical CPU use of every invented process

class DemoSource implements Source {
  host = 'demo-box';
  platform = 'linux 6.8 x64';
  hasPs = true;
  warm: Sample[] = [];
  private rng = mulberry32(20260610);
  private step = 0;
  private weights = Array.from({ length: DEMO_CORES }, () => 1);
  private mem = 11.1 * 1024 ** 3;
  private load = [1.4, 1.2, 1.0];
  private list: DemoProc[];

  constructor() {
    // [pid, ppid, name, args, typical cpu %, rss MB, age s, spike range]
    type Row = [number, number, string, string, number, number, number, [number, number]?];
    const rows: Row[] = [
      [1, 0, 'systemd', '/sbin/init splash', 0.1, 12, 1_040_000],
      [2, 0, 'kthreadd', '[kthreadd]', 0, 0, 1_040_000],
      [14, 2, 'ksoftirqd/0', '[ksoftirqd/0]', 0.3, 0, 1_040_000],
      [19, 2, 'kworker/2:1', '[kworker/2:1-events]', 0.9, 0, 1_039_000, [6, 14]],
      [23, 2, 'kworker/u16:3', '[kworker/u16:3-flush]', 0.5, 0, 1_039_000],
      [27, 2, 'kswapd0', '[kswapd0]', 0.2, 0, 1_040_000],
      [312, 1, 'systemd-journald', '/lib/systemd/systemd-journald', 0.4, 58, 1_040_000],
      [340, 1, 'systemd-udevd', '/lib/systemd/systemd-udevd', 0, 14, 1_040_000],
      [611, 1, 'dbus-daemon', '/usr/bin/dbus-daemon --system --nofork', 0, 6, 1_040_000],
      [620, 1, 'NetworkManager', '/usr/sbin/NetworkManager --no-daemon', 0.1, 24, 1_040_000],
      [702, 1, 'sshd', '/usr/sbin/sshd -D', 0, 9, 1_040_000],
      [811, 1, 'cron', '/usr/sbin/cron -f', 0, 4, 1_040_000],
      [905, 1, 'nginx', 'nginx: master process /usr/sbin/nginx', 0.1, 14, 600_000],
      [906, 905, 'nginx', 'nginx: worker process', 2.4, 22, 600_000],
      [907, 905, 'nginx', 'nginx: worker process', 1.8, 21, 600_000],
      [908, 905, 'nginx', 'nginx: worker process', 1.1, 21, 600_000],
      [909, 905, 'nginx', 'nginx: worker process', 0.7, 20, 600_000],
      [1022, 1, 'postgres', '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main', 0.6, 160, 590_000],
      [1040, 1022, 'postgres', 'postgres: checkpointer', 0.1, 30, 590_000],
      [1041, 1022, 'postgres', 'postgres: background writer', 0.1, 24, 590_000],
      [1042, 1022, 'postgres', 'postgres: walwriter', 0.1, 18, 590_000],
      [1043, 1022, 'postgres', 'postgres: autovacuum launcher', 0.2, 20, 590_000],
      [1090, 1022, 'postgres', 'postgres: app app 10.0.0.12(53110) SELECT', 7.5, 210, 8_200],
      [1091, 1022, 'postgres', 'postgres: app app 10.0.0.12(53144) idle', 3.2, 260, 7_900],
      [1092, 1022, 'postgres', 'postgres: app app 10.0.0.13(41872) UPDATE', 1.6, 185, 6_100],
      [1190, 1, 'redis-server', 'redis-server *:6379', 1.5, 48, 590_000],
      [1260, 1, 'dockerd', '/usr/bin/dockerd -H fd://', 1.8, 142, 480_000],
      [1330, 1260, 'containerd-shim', 'containerd-shim-runc-v2 -namespace moby', 0.2, 24, 300_000],
      [1360, 1330, 'node', 'node /app/worker.js --queue emails', 9, 310, 300_000, [35, 70]],
      [2301, 1, 'node', 'node /srv/api/server.js --port 8080', 15, 520, 172_800, [45, 90]],
      [2340, 2301, 'node', 'node /srv/api/worker.js', 6, 290, 172_700],
      [2341, 2301, 'node', 'node /srv/api/worker.js', 4.5, 280, 172_700],
      [2402, 1, 'tmux', 'tmux new-session -s dev', 0.1, 8, 80_000],
      [9134, 2402, 'zsh', '-zsh', 0, 7, 80_000],
      [2500, 9134, 'bun', 'bun run dev', 11, 410, 5_400],
      [2522, 2500, 'esbuild', 'esbuild --service=0.21.5 --ping', 3.5, 120, 5_400],
      [4210, 9134, 'tsc', 'tsc --noEmit --watch', 1.5, 280, 3_100, [70, 130]],
      [4300, 9134, 'ffmpeg', 'ffmpeg -i in.mov -c:v libx264 -crf 22 out.mp4', 0.3, 190, 900, [170, 260]],
      [3100, 1, 'chrome', '/opt/chrome/chrome --type=browser', 6, 780, 41_000],
      [3140, 3100, 'chrome_helper', '/opt/chrome/chrome --type=gpu-process', 16, 460, 41_000, [30, 60]],
      [3141, 3100, 'chrome_helper', '/opt/chrome/chrome --type=renderer', 7, 380, 40_000],
      [3152, 3100, 'chrome_helper', '/opt/chrome/chrome --type=renderer', 3, 330, 39_000],
      [4100, 1, 'python3', 'python3 /opt/jobs/nightly_report.py', 2.2, 95, 7_200, [35, 60]],
      [4400, 1, 'rsync', 'rsync -a /data/ backup:/srv/data/', 0.4, 12, 2_400, [10, 25]],
      [5001, 1, 'prometheus', '/usr/bin/prometheus --config.file=/etc/prometheus.yml', 3.1, 340, 400_000],
      [5100, 1, 'node_exporter', '/usr/bin/node_exporter', 0.5, 28, 400_000],
      [6100, 1, 'rsyslogd', '/usr/sbin/rsyslogd -n', 0.1, 9, 1_040_000],
    ];
    this.list = rows.map(([pid, ppid, name, cmd, base, rssMb, age, spike]) => ({
      pid, ppid, name, args: cmd, base: base * DEMO_LOAD, rssMb, age, spike, cpu: base * DEMO_LOAD, rss: rssMb * 1024, burst: 0, level: 0,
    }));
    for (let i = 0; i < 90; i++) this.warm.push(this.advance());
  }

  private advance(): Sample {
    const rnd = this.rng;
    this.step++;
    // a spike now and then: a few scripted ones (two while warming up, one soon after start), then at random
    const spiky = this.list.filter((p) => p.spike);
    if (!spiky.some((p) => p.burst > 0)) {
      const scripted: Record<number, string> = { 28: 'tsc', 63: 'ffmpeg', [90 + 9]: 'ffmpeg', [90 + 45]: 'tsc' };
      const named = spiky.find((p) => p.name === scripted[this.step]);
      if (named || rnd() < 0.025) {
        const p = named ?? spiky[Math.floor(rnd() * spiky.length)]!;
        const [lo, hi] = p.spike!;
        p.burst = 7 + Math.floor(rnd() * 6);
        p.level = lo + rnd() * (hi - lo);
      }
    }
    // the workload swells and ebbs
    const wave = 1 + 0.4 * Math.sin(this.step / 8) + 0.2 * Math.sin(this.step / 2.7);
    let busy = 0;
    for (const p of this.list) {
      const target = p.burst > 0 ? p.level : p.base * wave;
      if (p.burst > 0) p.burst--;
      const noise = (rnd() - 0.5) * 2 * Math.max(0.4, p.base * 0.55);
      p.cpu = Math.max(0, p.cpu + (target - p.cpu) * 0.45 + noise);
      p.rss = Math.max(0, p.rss * (1 + (rnd() - 0.5) * 0.004));
      busy += p.cpu;
    }
    // spread the busy time over the cores, with slowly drifting affinity
    const noisy = this.weights.map((w) => Math.min(1.45, Math.max(0.5, w + (rnd() - 0.5) * 0.5)));
    const mean = noisy.reduce((a, b) => a + b, 0) / DEMO_CORES;
    this.weights = noisy.map((w) => w / mean);
    const share = busy / DEMO_CORES + 5; // + background load the process list does not show
    const cores = this.weights.map((w) => Math.min(100, Math.max(1, share * w + (rnd() - 0.5) * 10)));
    const total = cores.reduce((a, b) => a + b, 0) / DEMO_CORES;
    // memory drifts slowly, grows a little while a spike runs
    const ffmpeg = this.list.find((p) => p.name === 'ffmpeg')!;
    const wantMem = (11.1 + (ffmpeg.burst > 0 ? 0.9 : 0)) * 1024 ** 3;
    this.mem += (wantMem - this.mem) * 0.05 + (rnd() - 0.5) * 0.04 * 1024 ** 3;
    // load averages chase the busy cores at different speeds
    const run = (total / 100) * DEMO_CORES * 1.1;
    this.load = this.load.map((l, i) => l + (run - l) * [0.12, 0.03, 0.01][i]!);
    return {
      cores, total, memUsed: this.mem, memTotal: DEMO_TOTAL_MEM, load: [...this.load],
      uptime: 12 * 86400 + 4 * 3600 + 17 * 60 + this.step * (SAMPLE_MS / 1000),
    };
  }

  sample(): Sample { return this.advance(); }

  async procs() {
    await new Promise((r) => setTimeout(r, 40)); // pretend `ps` takes a moment
    const procs: Proc[] = this.list.map((p) => ({
      pid: p.pid, ppid: p.ppid, name: p.name, cpu: Math.round(p.cpu * 10) / 10,
      rss: Math.round(p.rss), mem: Math.round((p.rss * 1024 / DEMO_TOTAL_MEM) * 1000) / 10,
      etime: Math.floor(p.age + this.step * (SAMPLE_MS / 1000)),
    }));
    return { procs };
  }

  async args(pid: number) {
    await new Promise((r) => setTimeout(r, 90));
    return this.list.find((p) => p.pid === pid)?.args ?? null;
  }
}

// ── real source: node:os + ps ──────────────────────────────────────────────
function run(cmd: string, argv: string[], timeoutMs = 4000): Promise<{ out: string; code: number | null; missing: boolean }> {
  return new Promise((done) => {
    let out = '';
    let settled = false;
    const finish = (code: number | null, missing: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ out, code, missing });
    };
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); finish(null, false); }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('error', (e: NodeJS.ErrnoException) => finish(null, e.code === 'ENOENT'));
    child.on('close', (code) => finish(code, false));
  });
}

/** `ps` elapsed time `[[dd-]hh:]mm:ss` in seconds. */
function parseEtime(s: string): number {
  const [d, rest] = s.includes('-') ? s.split('-') as [string, string] : ['0', s];
  const p = rest.split(':').map(Number).reverse();
  return Number(d) * 86400 + (p[2] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[0] ?? 0);
}

function parsePs(text: string, skipPid: number): Proc[] {
  const procs: Proc[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
    if (!m || Number(m[1]) === skipPid) continue;
    const comm = m[7]!;
    procs.push({
      pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]!.replace(',', '.')), mem: Number(m[4]!.replace(',', '.')),
      rss: Number(m[5]), etime: parseEtime(m[6]!),
      // macOS prints the full executable path; Linux prints the bare name (which may contain '/')
      name: comm.startsWith('/') ? basename(comm) : comm,
    });
  }
  return procs;
}

class RealSource implements Source {
  host = os.hostname();
  platform = `${os.platform()} ${os.arch()}`;
  hasPs = process.platform !== 'win32';
  warm: Sample[] = [];
  private prev = os.cpus().map((c) => c.times);
  private darwinUsed: number | null = null;

  sample(): Sample {
    const now = os.cpus();
    const usage = now.map((c, i) => {
      const a = this.prev[i]; const b = c.times;
      if (!a) return { busy: 0, all: 0 };
      const all = b.user + b.nice + b.sys + b.idle + b.irq - (a.user + a.nice + a.sys + a.idle + a.irq);
      return { busy: all - (b.idle - a.idle), all };
    });
    this.prev = now.map((c) => c.times);
    const sum = usage.reduce((t, u) => ({ busy: t.busy + u.busy, all: t.all + u.all }), { busy: 0, all: 0 });
    const memTotal = os.totalmem();
    return {
      cores: usage.map((u) => (u.all > 0 ? (u.busy / u.all) * 100 : 0)),
      total: sum.all > 0 ? (sum.busy / sum.all) * 100 : 0,
      memTotal, memUsed: this.darwinUsed ?? memTotal - os.freemem(),
      load: process.platform === 'win32' ? null : os.loadavg(),
      uptime: os.uptime(),
    };
  }

  /**
   * os.freemem() counts only never-touched pages on macOS and reads as "almost
   * full" all the time; vm_stat lets us add up what Activity Monitor calls used
   * memory (app + wired + compressed).
   */
  private async macMemory(): Promise<number | null> {
    const r = await run('vm_stat', []);
    if (r.code !== 0) return null;
    const page = Number(r.out.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
    const n = (label: string) => Number(r.out.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? NaN);
    const pages = n('Anonymous pages') - n('Pages purgeable') + n('Pages wired down') + n('Pages occupied by compressor');
    return Number.isFinite(pages) && pages > 0 ? pages * page : null;
  }

  async procs() {
    if (!this.hasPs) throw Object.assign(new Error('no ps'), { unavailable: true });
    const mem = process.platform === 'darwin' ? this.macMemory() : Promise.resolve(null);
    const pidBox = { pid: -1 };
    const r = await new Promise<Awaited<ReturnType<typeof run>>>((done) => {
      // `=` suppresses the header; same columns as `ps -Ao pid,ppid,pcpu,pmem,rss,etime,comm`
      const child = spawn('ps', ['-Ao', 'pid=,ppid=,pcpu=,pmem=,rss=,etime=,comm='], { stdio: ['ignore', 'pipe', 'ignore'] });
      pidBox.pid = child.pid ?? -1;
      let out = '';
      child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      child.on('error', (e: NodeJS.ErrnoException) => done({ out, code: null, missing: e.code === 'ENOENT' }));
      child.on('close', (code) => done({ out, code, missing: false }));
    });
    if (r.missing) throw Object.assign(new Error('ps not found'), { unavailable: true });
    if (r.code !== 0) throw new Error(`ps exited with ${r.code}`);
    const procs = parsePs(r.out, pidBox.pid);
    if (procs.length === 0) throw new Error('ps printed no processes');
    const used = await mem;
    if (used != null) this.darwinUsed = used;
    return { procs, memUsed: used ?? undefined };
  }

  async args(pid: number) {
    if (!this.hasPs) return null;
    const r = await run('ps', ['-o', 'args=', '-p', String(pid)]);
    return r.code === 0 ? r.out.trim() || null : null;
  }
}

const source: Source = DEMO ? new DemoSource() : new RealSource();

// ── formatting and drawing helpers ─────────────────────────────────────────
const R = '\x1b[0m';
const st = () => newStyle();
const dim = st().foreground(C.dim);
const txt = st().foreground(C.text);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const padRight = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const padLeft = (s: string, w: number) => ' '.repeat(Math.max(0, w - stringWidth(s))) + s;
/** Exactly w columns: truncated if too long, padded if too short, colours closed. */
const fit = (s: string, w: number) => (stringWidth(s) > w ? truncate(s, w) : s) + R + ' '.repeat(Math.max(0, w - Math.min(w, stringWidth(s))));
const fg = (hex: string) => { const c = colorToRGB(hex)!; return fgColor(c.r, c.g, c.b); };
const ramp = (n: number, ...stops: string[]) => blend1D(Math.max(2, n), ...stops).map((c) => fg(c as string));
const HEAT = ramp(101, C.green, C.amber, C.red);
const heat = (pct: number) => HEAT[Math.round(clamp(pct, 0, 100))]!;
const MEMRAMP = ramp(101, '#6E6E8E', C.amber, C.red);
const EMPTY = fg('#35364C');
const MEMCOLS = ramp(4, C.cyan, C.blue, C.violet); // chart row colours, bottom row first
const BOLD = '\x1b[1m';

const fmtPct = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
function fmtKB(kb: number): string {
  if (kb < 1024) return `${kb}K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}M`;
  return `${(mb / 1024).toFixed(1)}G`;
}
const fmtGiB = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GiB`;
const pad2 = (n: number) => String(n).padStart(2, '0');
function fmtElapsed(s: number): string {
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  if (d > 0) return `${d}d ${pad2(h)}h`;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}
function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
}

const rampCache = new Map<string, string[]>();
const cachedRamp = (key: string, n: number, ...stops: string[]) => {
  const k = `${key}:${n}`;
  if (!rampCache.has(k)) rampCache.set(k, ramp(n, ...stops));
  return rampCache.get(k)!;
};

/** A horizontal gauge: filled cells follow a green→amber→red ramp, the last cell is fractional. */
function gauge(frac: number, w: number, stops: string[] = [C.green, C.amber, C.red]): string {
  const cells = Math.round(clamp(frac, 0, 1) * w * 8);
  const full = Math.floor(cells / 8);
  const part = cells % 8;
  const colors = cachedRamp(stops.join(), w, ...stops);
  let s = '';
  for (let x = 0; x < full; x++) s += colors[x]! + '█';
  if (part) s += colors[full]! + ' ▏▎▍▌▋▊▉'[part];
  return s + EMPTY + '░'.repeat(Math.max(0, w - full - (part ? 1 : 0))) + R;
}

/** Column chart in block characters, `rows` tall, newest sample on the right. Row colour comes from `rowColor`. */
function chart(values: number[], w: number, rows: number, lo: number, hi: number, rowColor: (r: number, rows: number) => string): string[] {
  const shown = values.slice(-w);
  const lead = w - shown.length;
  const levels = shown.map((v) => Math.round(clamp((v - lo) / Math.max(1e-9, hi - lo), 0, 1) * rows * 8));
  const lines: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    let s = ' '.repeat(lead);
    for (const lv of levels) s += ' ▁▂▃▄▅▆▇█'[clamp(lv - r * 8, 0, 8)];
    lines.push(rowColor(r, rows) + s + R);
  }
  return lines;
}
const cpuRow = (r: number, rows: number) => heat(((r + 0.5) / rows) * 100);

function spark(values: number[], w: number, color: string): string {
  const v = values.slice(-w);
  const hi = Math.max(10, ...v);
  return color + v.map((x) => '▁▂▃▄▅▆▇█'[clamp(Math.round((x / hi) * 7), 0, 7)]).join('') + R;
}

/** A rounded panel with its title set into the top border; `lines` are padded to `h` body rows. */
function panel(title: string, lines: string[], w: number, color: string, right = '', h = lines.length): string {
  const b = fg(color);
  const t = ' ' + BOLD + b + title + R + ' ';
  const r = right ? ' ' + right + ' ' : '';
  const fill = Math.max(0, w - 3 - stringWidth(t) - stringWidth(r) - 1);
  const out = [b + '╭─' + R + t + b + '─'.repeat(fill) + R + r + b + '─╮' + R];
  for (let i = 0; i < h; i++) out.push(b + '│' + R + ' ' + fit(lines[i] ?? '', w - 4) + ' ' + b + '│' + R);
  out.push(b + '╰' + '─'.repeat(w - 2) + '╯' + R);
  return out.join('\n');
}

/** Wraps at spaces; words longer than the width are broken. */
function wrapWords(text: string, w: number): string[] {
  const rows: string[] = [];
  let cur = '';
  for (let word of text.split(' ')) {
    while ([...word].length > w) {
      if (cur) { rows.push(cur); cur = ''; }
      rows.push([...word].slice(0, w).join(''));
      word = [...word].slice(w).join('');
    }
    if (cur && [...cur].length + 1 + [...word].length > w) { rows.push(cur); cur = word; }
    else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) rows.push(cur);
  return rows;
}

function gradientText(s: string, ...stops: string[]): string {
  const chars = [...s];
  const cols = ramp(chars.length, ...stops);
  return chars.map((ch, i) => cols[i]! + BOLD + ch).join('') + R;
}

// ── keys (for the help line; matching is done on the key strings below) ────
const kb = {
  move: newBinding(withKeys('up', 'down'), withHelp('↑/↓', 'select')),
  enter: newBinding(withKeys('enter'), withHelp('enter', 'details')),
  filter: newBinding(withKeys('/'), withHelp('/', 'filter')),
  sort: newBinding(withKeys('c', 'm', 'p', 'n'), withHelp('c/m/p/n', 'sort')),
  tree: newBinding(withKeys('t'), withHelp('t', 'tree')),
  clear: newBinding(withKeys('esc'), withHelp('esc', 'clear')),
  accept: newBinding(withKeys('enter'), withHelp('enter', 'keep filter')),
  cancel: newBinding(withKeys('esc'), withHelp('esc', 'clear filter')),
  quit: newBinding(withKeys('q', 'ctrl+c'), withHelp('q', 'quit')),
  moveS: newBinding(withKeys('up', 'down'), withHelp('↑/↓', 'move')),
  enterS: newBinding(withKeys('enter'), withHelp('enter', 'info')),
  filterS: newBinding(withKeys('/'), withHelp('/', 'find')),
  interrupt: newBinding(withKeys('ctrl+c'), withHelp('ctrl+c', 'quit')),
};

// ── process table state ────────────────────────────────────────────────────
type SortKey = 'cpu' | 'mem' | 'pid' | 'name';
const SORTS: Record<SortKey, { title: string; desc: boolean; cmp: (a: Proc, b: Proc) => number }> = {
  cpu: { title: 'CPU%', desc: true, cmp: (a, b) => a.cpu - b.cpu || a.rss - b.rss },
  mem: { title: 'MEM%', desc: true, cmp: (a, b) => a.mem - b.mem || a.rss - b.rss },
  pid: { title: 'PID', desc: false, cmp: (a, b) => a.pid - b.pid },
  name: { title: 'COMMAND', desc: false, cmp: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.pid - b.pid },
};
type ColKey = 'pid' | 'ppid' | 'cpu' | 'mem' | 'rss' | 'time' | 'name';
const COLS: { key: ColKey; title: string; w: number }[] = [
  { key: 'pid', title: 'PID', w: 7 }, { key: 'ppid', title: 'PPID', w: 7 }, { key: 'cpu', title: 'CPU%', w: 6 },
  { key: 'mem', title: 'MEM%', w: 6 }, { key: 'rss', title: 'RSS', w: 6 }, { key: 'time', title: 'ELAPSED', w: 8 },
  { key: 'name', title: 'COMMAND', w: 0 },
];
interface Entry { p: Proc; guide: string; ghost: boolean }

interface Layout {
  wide: boolean; cr: number; ch: number; cols: number;
  cpuW: number; memW: number; bodyH: number; memBodyH: number;
  procW: number; procH: number; detailW: number; detailReplaces: boolean;
  tableRows: number; tableW: number; shown: ColKey[];
}

const MIN_W = 60;
const MIN_H = 20;

// ── the model ──────────────────────────────────────────────────────────────
class Sysmon {
  width = 0;
  height = 0;
  L: Layout | null = null;
  // machine
  cores: number[] = new Array(os.cpus().length).fill(0);
  total = 0;
  cpuHist: number[] = [];
  memHist: number[] = [];
  mem = { used: 0, total: os.totalmem() };
  load: number[] | null = null;
  uptime = os.uptime();
  // processes
  procs: Proc[] | null = null;
  psState: 'loading' | 'ok' | 'unavailable' | 'error' = source.hasPs ? 'loading' : 'unavailable';
  psError = '';
  procHist = new Map<number, number[]>();
  argsCache = new Map<number, string | null>();
  argsPending = new Set<number>();
  // view state
  sortKey: SortKey = 'cpu';
  sortDesc = true;
  tree = false;
  filtering = false;
  detail = false;
  list: Entry[] = [];
  sel = 0;
  selPid: number | null = null;
  top = 0;
  // components
  input = newTextInput();
  table = newTable(
    withColumns([{ title: 'PID', width: 7 }]),
    withTableStyles({
      header: st().bold(true).foreground(C.violet).padding(0, 1)
        .border(normalBorder()).borderTop(false).borderLeft(false).borderRight(false).borderForeground(C.faint),
      cell: st().padding(0, 1),
      selected: st().bold(true).foreground('#FFFFFF').background('#4B2FA8'),
    }),
    withTableHeight(8),
    withTableWidth(60),
    withTableFocused(true),
  );
  help = newHelp();

  constructor() {
    for (const s of source.warm) this.ingest(s);
    if (!DEMO) this.ingest(source.sample());
    this.input.prompt = '/ ';
    this.input.placeholder = 'filter by name';
    this.input.charLimit = 32;
    const s = this.input.styles();
    s.focused.prompt = st().bold(true).foreground(C.pink);
    s.focused.text = st().foreground('#FFFFFF');
    s.focused.placeholder = st().foreground(C.dim);
    s.cursor.color = C.pink;
    this.input.setStyles(s);
    const hs = helpDefaultDarkStyles();
    hs.shortKey = st().foreground(C.text).bold(true);
    hs.shortDesc = st().foreground(C.dim);
    hs.shortSeparator = st().foreground(C.faint);
    hs.ellipsis = st().foreground(C.faint);
    this.help.styles = hs;
  }

  // ── data in ──────────────────────────────────────────────────────────────
  private ingest(s: Sample): void {
    this.cores = s.cores;
    this.total = s.total;
    this.mem = { used: s.memUsed, total: s.memTotal };
    this.load = s.load;
    this.uptime = s.uptime;
    this.cpuHist.push(s.total);
    this.memHist.push((s.memUsed / s.memTotal) * 100);
    if (this.cpuHist.length > HISTORY) { this.cpuHist.shift(); this.memHist.shift(); }
  }

  // ── list building ────────────────────────────────────────────────────────
  get query(): string { return this.input.value().trim().toLowerCase(); }

  private build(): Entry[] {
    const all = this.procs ?? [];
    const q = this.query;
    const hit = (p: Proc) => !q || p.name.toLowerCase().includes(q);
    const cmp = (a: Proc, b: Proc) => (this.sortDesc ? -1 : 1) * SORTS[this.sortKey].cmp(a, b);
    if (!this.tree) {
      return all.filter(hit).sort(cmp).map((p) => ({ p, guide: '', ghost: false }));
    }
    // tree view: matches plus their ancestors (shown dimmed), children grouped under their PPID
    const byPid = new Map(all.map((p) => [p.pid, p]));
    const keep = new Set<number>();
    for (const p of all) {
      if (!hit(p)) continue;
      let cur: Proc | undefined = p;
      for (let hops = 0; cur && !keep.has(cur.pid) && hops < 64; hops++) {
        keep.add(cur.pid);
        cur = byPid.get(cur.ppid);
      }
    }
    const kids = new Map<number, Proc[]>();
    const roots: Proc[] = [];
    for (const p of all) {
      if (!keep.has(p.pid)) continue;
      if (p.ppid !== p.pid && keep.has(p.ppid)) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
      else roots.push(p);
    }
    const out: Entry[] = [];
    const seen = new Set<number>();
    // `prefix` is the drawing inherited from the ancestors; roots start at column 0
    const walk = (p: Proc, prefix: string, last: boolean, root: boolean) => {
      if (seen.has(p.pid)) return;
      seen.add(p.pid);
      out.push({ p, guide: root ? '' : prefix + (last ? '└─ ' : '├─ '), ghost: !hit(p) });
      const children = (kids.get(p.pid) ?? []).sort(cmp);
      const next = root ? '' : prefix + (last ? '   ' : '│  ');
      children.forEach((c, i) => walk(c, next, i === children.length - 1, false));
    };
    for (const r of roots.sort(cmp)) walk(r, '', true, true);
    return out;
  }

  /** Rebuilds the list and keeps the selection on the same PID if it is still there. */
  rebuild(): void {
    this.list = this.build();
    if (this.selPid != null) {
      const i = this.list.findIndex((e) => e.p.pid === this.selPid);
      if (i >= 0) this.sel = i;
    }
    this.sel = clamp(this.sel, 0, Math.max(0, this.list.length - 1));
    // until the user moves, the selection stays on the first row instead of following its PID
    if (this.selPid != null) this.selPid = this.list[this.sel]?.p.pid ?? null;
    this.syncTable();
  }

  /** The table only ever holds the visible window, so scrolling is exact and selection survives re-sorting. */
  syncTable(): void {
    const L = this.L;
    if (!L) return;
    const h = L.tableRows;
    this.top = clamp(this.top, 0, Math.max(0, this.list.length - h));
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + h) this.top = this.sel - h + 1;
    const arrow = this.sortDesc ? ' ▼' : ' ▲';
    const sortedCol: ColKey = this.sortKey === 'name' ? 'name' : this.sortKey;
    const nameW = L.tableW - L.shown.filter((k) => k !== 'name').reduce((t, k) => t + COLS.find((c) => c.key === k)!.w + 2, 0) - 2;
    const numeric = new Set<ColKey>(['pid', 'ppid', 'cpu', 'mem', 'rss', 'time']);
    // setColumns re-renders the old rows, which may have a different cell count: empty the table first
    this.table.setRows([]);
    this.table.setColumns(L.shown.map((k) => {
      const c = COLS.find((x) => x.key === k)!;
      const w = k === 'name' ? nameW : c.w;
      let title = c.title + (k === sortedCol ? arrow : '');
      if (numeric.has(k)) title = padLeft(title, w);
      if (k === sortedCol) title = fg(C.pink) + title + '\x1b[39m';
      return { title, width: w };
    }));
    this.table.setWidth(L.tableW);
    this.table.setHeight(h + 2);
    const q = this.query;
    const window = this.list.slice(this.top, this.top + h);
    this.table.setRows(window.map((e, i) => this.row(e, i + this.top === this.sel, nameW, q)));
    this.table.setCursor(this.sel - this.top);
  }

  private row(e: Entry, selected: boolean, nameW: number, q: string): string[] {
    const p = e.p;
    return this.L!.shown.map((k) => {
      switch (k) {
        case 'pid': return selected ? padLeft(String(p.pid), 7) : txt.render(padLeft(String(p.pid), 7));
        case 'ppid': return selected ? padLeft(String(p.ppid), 7) : dim.render(padLeft(String(p.ppid), 7));
        case 'cpu': { const s = padLeft(fmtPct(p.cpu), 6); return selected ? s : p.cpu < 0.05 ? dim.render(s) : heat(p.cpu) + s + R; }
        case 'mem': { const s = padLeft(fmtPct(p.mem), 6); return selected ? s : p.mem < 0.05 ? dim.render(s) : MEMRAMP[Math.round(clamp(p.mem * 4, 0, 100))]! + s + R; }
        case 'rss': { const s = padLeft(fmtKB(p.rss), 6); return selected ? s : p.rss === 0 ? dim.render(s) : txt.render(s); }
        case 'time': return selected ? padLeft(fmtElapsed(p.etime), 8) : dim.render(padLeft(fmtElapsed(p.etime), 8));
        default: {
          if (selected) return e.guide + p.name;
          const guide = e.guide ? dim.render(e.guide) : '';
          let name = p.name;
          const room = Math.max(1, nameW - stringWidth(e.guide));
          if (stringWidth(name) > room) name = truncate(name, room - 1) + '…';
          const at = q && !e.ghost ? name.toLowerCase().indexOf(q) : -1;
          const base = e.ghost ? dim : txt;
          if (at < 0) return guide + base.render(name);
          return guide + base.render(name.slice(0, at)) + st().bold(true).foreground(C.amber).render(name.slice(at, at + q.length)) + base.render(name.slice(at + q.length));
        }
      }
    });
  }

  // ── layout ───────────────────────────────────────────────────────────────
  relayout(): void {
    this.L = this.layout();
    this.syncTable();
  }

  private layout(): Layout | null {
    const W = this.width; const H = this.height;
    if (W < MIN_W || H < MIN_H) return null;
    const wide = W >= 100;
    const N = this.cores.length;
    const cpuW = wide ? Math.floor(W * 0.58) : W;
    const memW = wide ? W - cpuW - 1 : W;
    const inner = cpuW - 4;
    const gap = H >= 32 ? 1 : 0;
    const avail = H - 2 - gap;
    const configs: [number, number, number][] = [[4, 3, 4], [4, 2, 4], [3, 2, 4], [2, 2, 4], [2, 1, 3], [1, 1, 3]];
    let pick: { cr: number; ch: number; cols: number; bodyH: number; memBodyH: number; procH: number } | null = null;
    for (const [cr, ch, mh] of configs) {
      const cols = clamp(Math.ceil(N / cr), 1, Math.max(1, Math.floor((inner + 2) / 19)));
      const rows = Math.min(cr, Math.ceil(N / cols));
      const bodyH = rows + 1 + ch;
      const memBodyH = wide ? bodyH : mh;
      const procH = avail - (bodyH + 2) - (wide ? 0 : memBodyH + 2);
      const cand = { cr: rows, ch, cols, bodyH, memBodyH, procH };
      if (procH >= 8) pick = cand;
      if (procH >= 11) break;
    }
    if (!pick) return null;
    // details: beside the table on wide terminals, in place of it otherwise
    const detailW = this.detail && wide ? 40 : 0;
    const detailReplaces = this.detail && !wide;
    // when the details replace the table the charts make room too: the pane gets the whole screen
    const procW = W - (detailW ? detailW + 1 : 0);
    const tableW = procW - 4;
    // drop the least useful columns when the command column would get too narrow
    const order: ColKey[] = ['time', 'ppid', 'rss', 'mem'];
    let shown = COLS.map((c) => c.key);
    const nameRoom = () => tableW - shown.filter((k) => k !== 'name').reduce((t, k) => t + COLS.find((c) => c.key === k)!.w + 2, 0) - 2;
    for (const drop of order) { if (nameRoom() >= 18) break; shown = shown.filter((k) => k !== drop); }
    return {
      wide, ...pick, cpuW, memW, procW, detailW, detailReplaces, tableW, shown,
      procH: detailReplaces ? avail : pick.procH,
      tableRows: Math.max(1, pick.procH - 5),
    };
  }

  // ── commands ─────────────────────────────────────────────────────────────
  init(): Cmd {
    return Batch(
      this.fetchProcs(),
      Tick(DEMO ? SAMPLE_MS : 300, () => ({ type: 'sample' })),
    );
  }

  private fetchProcs(): Cmd {
    return async () => {
      try {
        return { type: 'procs', ...(await source.procs()) };
      } catch (e: any) {
        return { type: 'procs-error', unavailable: !!e?.unavailable, message: String(e?.message ?? e) };
      }
    };
  }

  private fetchArgs(): Cmd {
    const pid = this.list[this.sel]?.p.pid;
    if (!this.detail || pid == null || this.argsCache.has(pid) || this.argsPending.has(pid)) return null;
    this.argsPending.add(pid);
    return async () => ({ type: 'args', pid, args: await source.args(pid) });
  }

  update(msg: Msg): [Sysmon, Cmd] {
    if (msg instanceof WindowSizeMsg) {
      this.width = msg.width;
      this.height = msg.height;
      this.input.setWidth(Math.max(10, Math.min(30, msg.width - 40)));
      this.help.setWidth(msg.width - 1);
      this.help.shortSeparator = msg.width < 100 ? ' · ' : '  ·  ';
      this.relayout();
      return [this, null];
    }
    if (msg instanceof KeyPressMsg) return this.onKey(msg);
    switch (msg?.type) {
      case 'sample': {
        this.ingest(source.sample());
        return [this, Tick(SAMPLE_MS, () => ({ type: 'sample' }))];
      }
      case 'procs': {
        this.psState = 'ok';
        this.procs = msg.procs;
        if (msg.memUsed) { this.mem = { ...this.mem, used: msg.memUsed }; }
        const live = new Set<number>();
        for (const p of this.procs!) {
          live.add(p.pid);
          const h = this.procHist.get(p.pid) ?? [];
          h.push(p.cpu);
          if (h.length > 40) h.shift();
          this.procHist.set(p.pid, h);
        }
        for (const pid of [...this.procHist.keys()]) if (!live.has(pid)) this.procHist.delete(pid);
        this.rebuild();
        return [this, Batch(Tick(PS_MS, () => ({ type: 'refresh' })), this.fetchArgs())];
      }
      case 'procs-error': {
        this.psState = msg.unavailable ? 'unavailable' : 'error';
        this.psError = msg.message;
        this.procs = msg.unavailable ? null : this.procs;
        return [this, msg.unavailable ? null : Tick(PS_MS, () => ({ type: 'refresh' }))];
      }
      case 'refresh':
        return [this, this.fetchProcs()];
      case 'args':
        this.argsPending.delete(msg.pid);
        this.argsCache.set(msg.pid, msg.args);
        return [this, null];
    }
    // anything else (cursor blink, ...) belongs to the filter input
    if (this.filtering) { const [, cmd] = this.input.update(msg); return [this, cmd]; }
    return [this, null];
  }

  private move(to: number): Cmd {
    this.sel = clamp(to, 0, Math.max(0, this.list.length - 1));
    this.selPid = this.list[this.sel]?.p.pid ?? null;
    this.syncTable();
    return this.fetchArgs();
  }

  private resetView(): void {
    this.sel = 0; this.top = 0; this.selPid = null;
    this.rebuild();
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) this.sortDesc = !this.sortDesc;
    else { this.sortKey = key; this.sortDesc = SORTS[key].desc; }
    this.resetView();
  }

  private onKey(msg: KeyPressMsg): [Sysmon, Cmd] {
    const [, cmd] = this.handleKey(msg);
    // whatever the key did, make sure the details pane has the command line of the selected process
    return [this, Batch(cmd, this.fetchArgs())];
  }

  private handleKey(msg: KeyPressMsg): [Sysmon, Cmd] {
    const k = msg.toString();
    if (k === 'ctrl+c') return [this, Quit];
    const page = this.L?.tableRows ?? 10;
    const navigate = (): Cmd | undefined => {
      switch (k) {
        case 'up': return this.move(this.sel - 1);
        case 'down': return this.move(this.sel + 1);
        case 'pgup': return this.move(this.sel - page);
        case 'pgdown': return this.move(this.sel + page);
      }
      return undefined;
    };
    if (this.psState === 'unavailable') return [this, k === 'q' ? Quit : null]; // nothing to select, sort or filter
    if (this.filtering) {
      if (k === 'esc') { this.filtering = false; this.input.blur(); this.input.reset(); this.resetView(); return [this, null]; }
      if (k === 'enter') { this.filtering = false; this.input.blur(); return [this, null]; }
      const nav = navigate();
      if (nav !== undefined) return [this, nav];
      const before = this.input.value();
      const [, cmd] = this.input.update(msg);
      if (this.input.value() !== before) this.resetView();
      return [this, cmd];
    }
    switch (k) {
      case 'q': return [this, Quit];
      case '/': { this.filtering = true; return [this, this.input.focus()]; }
      case 'esc':
        if (this.query) { this.input.reset(); this.resetView(); } else if (this.detail) { this.detail = false; this.relayout(); }
        return [this, null];
      case 'c': this.setSort('cpu'); return [this, null];
      case 'm': this.setSort('mem'); return [this, null];
      case 'p': this.setSort('pid'); return [this, null];
      case 'n': this.setSort('name'); return [this, null];
      case 't': this.tree = !this.tree; this.resetView(); return [this, null];
      case 'enter': this.detail = !this.detail; this.relayout(); return [this, this.fetchArgs()];
      case 'k': return [this, this.move(this.sel - 1)];
      case 'j': return [this, this.move(this.sel + 1)];
      case 'home': case 'g': return [this, this.move(0)];
      case 'end': case 'G': return [this, this.move(this.list.length - 1)];
    }
    return [this, navigate() ?? null];
  }

  // ── views ────────────────────────────────────────────────────────────────
  private header(): string {
    const brand = gradientText('▌ SYSMON', C.violet, C.pink, C.cyan);
    const sub = dim.render(`  ${source.host} · ${source.platform}`);
    const pill = st().bold(true).foreground('#0B0B14').background(DEMO ? C.amber : C.green).padding(0, 1).render(DEMO ? 'DEMO' : 'LIVE');
    const right = dim.render(new Date().toTimeString().slice(0, 8) + '  ') + pill;
    return brand + sub + ' '.repeat(Math.max(1, this.width - stringWidth(brand) - stringWidth(sub) - stringWidth(right))) + right;
  }

  private cpuPanel(L: Layout): string {
    const inner = L.cpuW - 4;
    const N = this.cores.length;
    const cw = Math.floor((inner - 2 * (L.cols - 1)) / L.cols);
    const barW = Math.max(4, cw - 8);
    const shown = Math.min(N, L.cr * L.cols);
    const lines: string[] = [];
    for (let r = 0; r < L.cr; r++) {
      let line = '';
      for (let c = 0; c < L.cols; c++) {
        const i = c * L.cr + r; // fill column by column, like htop
        if (i >= shown) { line += ' '.repeat(cw + (c < L.cols - 1 ? 2 : 0)); continue; }
        const v = this.cores[i] ?? 0;
        line += dim.render(padLeft(String(i), 2) + ' ') + gauge(v / 100, barW) + ' ' + heat(v) + padLeft(Math.round(v) + '%', 4) + R + (c < L.cols - 1 ? '  ' : '');
      }
      lines.push(line);
    }
    const span = Math.round((inner * SAMPLE_MS) / 1000);
    lines.push(dim.render('▎total ') + heat(this.total) + BOLD + Math.round(this.total) + '%' + R + dim.render(`  ·  last ${Math.min(span, Math.round((this.cpuHist.length * SAMPLE_MS) / 1000))} s`));
    lines.push(...chart(this.cpuHist, inner, L.ch, 0, 100, cpuRow));
    const right = dim.render(`${N} cores`) + (shown < N ? dim.render(` (${shown} shown)`) : '');
    return panel('CPU', lines, L.cpuW, C.violet, right, L.bodyH);
  }

  private memPanel(L: Layout): string {
    const inner = L.memW - 4;
    const used = this.mem.used; const total = this.mem.total;
    const pct = total > 0 ? (used / total) * 100 : 0;
    const h = L.memBodyH;
    const lines: string[] = [];
    const pctColor = pct < 75 ? fg(C.cyan) : pct < 90 ? fg(C.amber) : fg(C.red);
    lines.push(dim.render('mem ') + gauge(pct / 100, inner - 4 - 5, [C.cyan, C.violet, C.pink]) + ' ' + pctColor + padLeft(Math.round(pct) + '%', 4) + R);
    if (h >= 6) {
      const full = `${fmtGiB(used)} used · ${fmtGiB(total - used)} free · ${fmtGiB(total)}`;
      lines.push(stringWidth(full) <= inner
        ? txt.render(fmtGiB(used)) + dim.render(' used · ') + txt.render(fmtGiB(total - used)) + dim.render(' free · ') + txt.render(fmtGiB(total))
        : txt.render(fmtGiB(used)) + dim.render(' of ') + txt.render(fmtGiB(total)));
    }
    const hasLoad = this.load != null;
    const others = lines.length + (hasLoad ? 1 : 0) + 1 + (h >= 8 ? 1 : 0);
    const chartRows = clamp(h - others, 1, 4);
    const hist = this.memHist.slice(-inner);
    const lo = Math.min(...hist, 100); const hi = Math.max(...hist, 0);
    // zoomed: the chart spans just the range seen (at least 2 points), so small changes stay visible
    const span = Math.max(hi - lo, 2);
    const cLo = lo - span * 0.3;
    const rows = chart(this.memHist, inner, chartRows, cLo, cLo + span * 1.4, (r, n) => MEMCOLS[Math.min(n - 1, r)]!);
    lines.push(...rows);
    if (this.load) {
      lines.push(dim.render('load ') + this.load.map((l) => heat((l / Math.max(1, this.cores.length)) * 100) + l.toFixed(2) + R).join(dim.render('  ')) + dim.render('   1 · 5 · 15 min'));
    }
    lines.push(dim.render('up   ') + txt.render(fmtUptime(this.uptime)));
    if (h >= 8) lines.push(dim.render('host ') + txt.render(`${source.host}`) + dim.render(` · ${source.platform}`));
    return panel('MEMORY', lines, L.memW, C.pink, dim.render(hist.length ? `zoom ${lo.toFixed(1)}–${hi.toFixed(1)}%` : ''), h);
  }

  private procPanel(L: Layout): string {
    const inner = L.procW - 4;
    const sortName = SORTS[this.sortKey].title;
    const right = dim.render('sort ') + st().bold(true).foreground(C.pink).render(`${sortName} ${this.sortDesc ? '▼' : '▲'}`) +
      (this.tree ? dim.render('  ·  ') + st().bold(true).foreground(C.cyan).render('tree') : '') +
      (this.procs ? dim.render(`  ·  ${this.list.length}/${this.procs.length}`) : '');
    const body: string[] = [];
    if (this.psState === 'unavailable') {
      body.push('', st().bold(true).foreground(C.amber).render('  No process list on this system'), '',
        dim.render('  sysmon reads processes with `ps -Ao pid,ppid,pcpu,pmem,rss,etime,comm`, which exists on'),
        dim.render(`  macOS and Linux but was not found here (${process.platform}).`),
        dim.render('  CPU, memory, load and uptime above come from node:os and keep working.'));
      return panel('PROCESSES', body, L.procW, C.cyan, '', L.procH - 2);
    }
    // filter line
    if (this.filtering) body.push(this.input.view() + dim.render('   enter keep · esc clear'));
    else if (this.query) body.push(fg(C.pink) + '/ ' + R + txt.render(this.input.value()) + dim.render('   esc to clear'));
    else body.push(dim.render('/ to filter by name'));
    if (this.psState === 'error') {
      body.push('', st().foreground(C.amber).render(`  ps failed: ${this.psError}`), dim.render('  retrying every 2 s'));
    } else if (!this.procs) {
      body.push('', dim.render('  reading the process list…'));
    } else if (this.list.length === 0) {
      body.push(this.table.view().split('\n').slice(0, 2).join('\n'), '', dim.render(`  no process matches "${this.input.value()}"`));
    } else {
      body.push(...this.table.view().split('\n'));
    }
    return panel('PROCESSES', body, L.procW, C.cyan, right, L.procH - 2);
  }

  private detailPanel(L: Layout): string {
    const w = L.detailReplaces ? L.procW : L.detailW;
    const inner = w - 4;
    const h = L.procH - 2;
    const e = this.list[this.sel];
    const lines: string[] = [];
    if (!e) {
      lines.push('', dim.render('  nothing selected'));
      return panel('DETAILS', lines, w, C.amber, '', h);
    }
    const p = e.p;
    const byPid = new Map((this.procs ?? []).map((x) => [x.pid, x]));
    const parent = byPid.get(p.ppid);
    const kids = (this.procs ?? []).filter((x) => x.ppid === p.pid && x.pid !== p.pid).length;
    const label = (s: string) => dim.render(padRight(s, 9));
    lines.push(BOLD + fg(C.pink) + p.name + R);
    lines.push(fg(C.faint) + '─'.repeat(inner) + R);
    lines.push(label('PID') + txt.render(String(p.pid)));
    lines.push(label('Parent') + txt.render(String(p.ppid)) + (parent ? dim.render(` · ${parent.name}`) : ''));
    lines.push(label('CPU') + heat(p.cpu) + fmtPct(p.cpu) + ' %' + R + '  ' + spark(this.procHist.get(p.pid) ?? [], Math.max(4, inner - 17), fg(C.violet)));
    lines.push(label('Memory') + txt.render(`${fmtPct(p.mem)} %`) + dim.render(' · ') + txt.render(`${fmtKB(p.rss)}B RSS`));
    lines.push(label('Elapsed') + txt.render(fmtElapsed(p.etime)));
    lines.push(label('Children') + txt.render(String(kids)));
    lines.push('');
    lines.push(BOLD + fg(C.cyan) + 'Command line' + R);
    const cmd = this.argsCache.get(p.pid);
    if (cmd === undefined) lines.push(dim.render('reading…'));
    else if (cmd === null) lines.push(dim.render('not available'));
    else {
      const room = Math.max(1, h - lines.length);
      const rows = wrapWords(cmd, inner);
      for (const row of rows.slice(0, room)) lines.push(txt.render(row));
      if (rows.length > room) lines[lines.length - 1] = txt.render(truncate(rows[room - 1]!, inner - 1) + '…');
    }
    return panel('DETAILS', lines, w, C.amber, dim.render('enter to close'), h);
  }

  private helpLine(): string {
    const short = this.psState === 'unavailable' ? [kb.quit] : this.filtering ? [kb.accept, kb.cancel, kb.move, kb.interrupt]
      : this.width < 78 ? [kb.moveS, kb.enterS, kb.filterS, kb.sort, kb.tree, kb.quit]
      : this.width < 100 ? [kb.move, kb.enter, kb.filter, kb.sort, kb.tree, kb.quit]
      : [kb.move, kb.enter, kb.filter, kb.sort, kb.tree, kb.clear, kb.quit];
    const map = { shortHelp: () => short, fullHelp: () => [short] };
    return ' ' + this.help.view(map);
  }

  view(): View {
    const view = new View(this.render());
    view.altScreen = true;
    view.windowTitle = 'sysmon';
    return view;
  }

  private render(): string {
    const L = this.L;
    if (this.width === 0) return '';
    if (!L) {
      const msg = BOLD + fg(C.amber) + 'Terminal too small' + R + '\n' + dim.render(`${this.width}×${this.height}, need at least ${MIN_W}×${MIN_H}`) + '\n\n' + dim.render('q to quit');
      return place(this.width, this.height, Center, Center, msg);
    }
    const parts: string[] = [this.header()];
    if (this.height >= 32) parts.push('');
    if (L.detailReplaces) {
      parts.push(this.detailPanel(L));
    } else {
      const cpu = this.cpuPanel(L);
      const mem = this.memPanel(L);
      parts.push(L.wide ? joinHorizontal(Top, cpu, ' ', mem) : joinVertical(Left, cpu, mem));
      parts.push(this.detail ? joinHorizontal(Top, this.procPanel(L), ' ', this.detailPanel(L)) : this.procPanel(L));
    }
    // the help line sits on the last row
    const body = parts.join('\n').split('\n');
    const lines = body.slice(0, this.height - 1);
    while (lines.length < this.height - 1) lines.push('');
    lines.push(this.helpLine());
    return lines.join('\n');
  }
}

// ── run ────────────────────────────────────────────────────────────────────
const program: Program = NewProgram(new Sysmon());
await program.run();
process.exit(0);
