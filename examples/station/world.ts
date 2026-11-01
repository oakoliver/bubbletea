/**
 * The station's world: six invented services, their metrics, alerts, deploys,
 * a log, and the people looking at it.
 *
 * One World is shared by every viewer (the local terminal, or every SSH
 * session), so an acknowledgement or a selection made by one person is seen by
 * all of them. NOTHING HERE IS REAL: a seeded PRNG makes every number, and the
 * incidents follow a fixed script, so a seed always gives the same history and
 * the same screen. That is what makes the golden-file tests possible.
 *
 * Time is simulated. One step is five seconds of station time; the program
 * decides how often to step (main.ts does it every 800 ms, so the station runs
 * at 6.25x). Tests step it by hand.
 */

export interface ServiceDef {
  name: string;
  /** Usual p95 latency in ms, and how much it wanders. */
  p95: number;
  jitter: number;
  /** Usual requests per second. */
  rps: number;
  /** Usual error rate in percent. */
  err: number;
  /** Latency objective: an alert opens above it. */
  slo: number;
  color: string;
}

export const SERVICES: ServiceDef[] = [
  { name: 'checkout', p95: 140, jitter: 14, rps: 340, err: 0.4, slo: 250, color: '#89B4FA' },
  { name: 'search', p95: 92, jitter: 10, rps: 910, err: 0.3, slo: 200, color: '#A6E3A1' },
  { name: 'payments', p95: 228, jitter: 20, rps: 120, err: 0.5, slo: 400, color: '#F9E2AF' },
  { name: 'catalog', p95: 61, jitter: 6, rps: 1480, err: 0.1, slo: 150, color: '#94E2D5' },
  { name: 'auth', p95: 38, jitter: 4, rps: 2150, err: 0.1, slo: 100, color: '#F5C2E7' },
  { name: 'notify', p95: 310, jitter: 30, rps: 75, err: 0.8, slo: 600, color: '#FAB387' },
];

/** An error-rate alert opens above this, in percent. */
export const ERROR_SLO = 2;
export const STEP_MS = 5_000;
/** Steps of history kept, and made before the first frame: 15 minutes. */
export const HISTORY = 180;
/** Station time of the first live step. */
export const START = Date.UTC(2026, 10, 1, 14, 15, 0);

export interface Sample {
  t: number;
  p95: number;
  rps: number;
  /** Error rate, percent. */
  err: number;
}

export interface Alert {
  id: number;
  service: number;
  kind: 'latency' | 'errors';
  opened: number;
  /** The worst value seen while open. */
  peak: number;
  ackedBy: string | null;
  ackedAt: number | null;
  resolved: number | null;
}

export interface Deploy {
  t: number;
  service: number;
  version: string;
  by: string;
  rollback: boolean;
}

export interface LogLine {
  t: number;
  kind: 'req' | 'deploy' | 'alert' | 'ack' | 'resolve' | 'people';
  service: number | null;
  text: string;
}

/** Where someone's pointer is: a zone ID and the cell inside that zone. */
export interface Hover {
  zone: string;
  dx: number;
  dy: number;
}

export interface Viewer {
  id: number;
  name: string;
  color: string;
  /** The selected service, an index into SERVICES. */
  selected: number;
  tab: string;
  hover: Hover | null;
}

const VIEWER_COLORS = ['#CBA6F7', '#F38BA8', '#74C7EC', '#A6E3A1', '#FAB387', '#F5C2E7'];

/** mulberry32: a small seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATHS: string[][] = [
  ['POST /cart', 'GET /cart', 'POST /checkout'],
  ['GET /search', 'GET /suggest'],
  ['POST /charge', 'POST /refund', 'GET /charge/:id'],
  ['GET /item/:id', 'GET /list'],
  ['POST /token', 'GET /session'],
  ['POST /email', 'POST /push'],
];

/**
 * The incident script, in steps since the first live step. It repeats every
 * CYCLE steps (12.5 minutes of station time, two minutes of real time), so a
 * server left running keeps having incidents.
 */
const CYCLE = 150;
const SCRIPT = {
  paymentsSlow: [2, 30] as const, // a slow database: payments p95 climbs past 400 ms
  searchDeploy: 10, // a bad search release: errors jump two steps later
  searchRollback: 22,
};

export class World {
  readonly rand: () => number;
  readonly samples: Sample[][] = SERVICES.map(() => []);
  readonly alerts: Alert[] = [];
  readonly deploys: Deploy[] = [];
  readonly log: LogLine[] = [];
  readonly viewers = new Map<number, Viewer>();
  /** Steps since the first history sample. */
  step = 0;
  now = START - HISTORY * STEP_MS;
  paused = false;
  private nextAlert = 1;
  private nextViewer = 1;
  private streak = SERVICES.map(() => ({ latency: 0, errors: 0, latencyOk: 0, errorsOk: 0 }));
  private listeners = new Set<() => void>();
  private pending = false;
  private versions = ['v7.1.2', 'v2.13.9', 'v5.1.8', 'v4.2.0', 'v1.9.3', 'v0.3.1'];
  private previous: string[] = [...this.versions];

  constructor(readonly seed = 7) {
    this.rand = mulberry32(seed);
    // Deploys from earlier in the day, for the bar chart.
    const earlier: [hour: number, minute: number, service: number][] = [
      [8, 12, 1], [8, 40, 0], [9, 5, 4], [9, 31, 1], [10, 2, 3], [10, 47, 0], [11, 15, 1], [11, 58, 5], [12, 20, 2], [12, 44, 4], [13, 9, 1], [13, 36, 0], [13, 51, 3],
    ];
    for (const [h, m, s] of earlier) this.deploys.push({ t: Date.UTC(2026, 10, 1, h, m), service: s, version: this.version(s), by: 'ci', rollback: false });
    for (let i = 0; i < HISTORY; i++) this.advance();
  }

  // ── reading ───────────────────────────────────────────────────────────────

  last(service: number): Sample {
    const xs = this.samples[service];
    return xs[xs.length - 1];
  }

  /** Samples of one service newer than `since`. */
  since(service: number, since: number): Sample[] {
    return this.samples[service].filter((s) => s.t > since);
  }

  /** The open alerts first (newest first), then the resolved ones. */
  alertList(): Alert[] {
    const open = this.alerts.filter((a) => a.resolved === null).reverse();
    const done = this.alerts.filter((a) => a.resolved !== null).reverse();
    return [...open, ...done];
  }

  openAlert(service: number): Alert | undefined {
    return this.alerts.find((a) => a.service === service && a.resolved === null);
  }

  deploysToday(service: number): number {
    const day = new Date(this.now);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    return this.deploys.filter((d) => d.service === service && d.t >= midnight).length;
  }

  // ── changing ──────────────────────────────────────────────────────────────

  /** One step of station time: new samples, alerts, deploys and log lines. */
  advance(): void {
    this.step++;
    this.now += STEP_MS;
    const live = this.step - HISTORY; // steps since the first live one; <= 0 is history
    const k = live > 0 ? (live - 1) % CYCLE : -1;
    const r = this.rand;

    // Earlier in the history: a checkout slowdown that someone already handled.
    const checkoutSlow = this.step > 70 && this.step < 96 ? Math.sin(((this.step - 70) / 26) * Math.PI) : 0;
    const [from, to] = SCRIPT.paymentsSlow;
    const paymentsSlow = k >= from && k < to ? Math.min(1, (k - from) / 6, (to - k) / 5) : 0;
    const searchBad = k >= SCRIPT.searchDeploy + 2 && k < SCRIPT.searchRollback + 2;

    if (k === SCRIPT.searchDeploy) this.deploy(1, 'ci', false);
    if (k === SCRIPT.searchRollback) this.deploy(1, 'ci', true);
    if (this.step === 64) this.deploy(3, 'ci', false);
    if (this.step === 90) this.deploy(0, 'kim', false);
    if (this.step === 150) this.deploy(4, 'ci', false);

    SERVICES.forEach((def, s) => {
      const noise = () => r() + r() + r() - 1.5;
      const wave = Math.sin((this.step + s * 17) / 23);
      let p95 = def.p95 + def.jitter * (noise() * 1.4 + wave * 0.8);
      let rps = def.rps * (1 + 0.06 * wave + 0.03 * noise());
      let err = Math.max(0, def.err * (1 + 0.5 * noise()));
      if (s === 0) p95 += 165 * checkoutSlow;
      if (s === 2) {
        p95 += 250 * paymentsSlow + 25 * paymentsSlow * noise();
        rps *= 1 - 0.25 * paymentsSlow;
      }
      if (s === 1 && searchBad) err += 3.6 + 1.2 * noise();
      if (r() < 0.01) p95 *= 1.6; // the odd spike
      this.samples[s].push({ t: this.now, p95: Math.max(1, p95), rps: Math.max(0, rps), err: Math.min(100, err) });
      if (this.samples[s].length > HISTORY) this.samples[s].shift();
      this.check(s);
    });

    // One request line per step, from a random service.
    const s = Math.floor(r() * SERVICES.length);
    const sample = this.last(s);
    const path = PATHS[s][Math.floor(r() * PATHS[s].length)];
    const failed = r() * 100 < sample.err * 4;
    const ms = Math.round(sample.p95 * (0.35 + 0.6 * r()));
    this.addLog('req', s, `${path} ${failed ? (r() < 0.5 ? '503' : '500') : '200'} ${ms}ms`);
    this.changed();
  }

  /** Acknowledges an alert for everyone. Returns false if it was already acknowledged or is gone. */
  ack(alertId: number, who: Viewer): boolean {
    const a = this.alerts.find((x) => x.id === alertId);
    if (!a || a.ackedBy || a.resolved !== null) return false;
    a.ackedBy = who.name;
    a.ackedAt = this.now;
    this.addLog('ack', a.service, `${who.name} acknowledged ${describe(a)}`);
    this.changed();
    return true;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.changed();
  }

  join(name: string): Viewer {
    const taken = new Set([...this.viewers.values()].map((v) => v.name));
    let unique = name;
    for (let n = 2; taken.has(unique); n++) unique = `${name}${n}`;
    const v: Viewer = {
      id: this.nextViewer,
      name: unique,
      color: VIEWER_COLORS[(this.nextViewer - 1) % VIEWER_COLORS.length],
      selected: 0,
      tab: 'overview',
      hover: null,
    };
    this.nextViewer++;
    this.viewers.set(v.id, v);
    if (this.viewers.size > 1) this.addLog('people', null, `${v.name} joined`);
    this.changed();
    return v;
  }

  leave(v: Viewer): void {
    if (!this.viewers.delete(v.id)) return;
    this.addLog('people', null, `${v.name} left`);
    this.changed();
  }

  /** Calls `fn` after anything changed, at most once per microtask. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Tells the listeners, once, after the current burst of changes. */
  changed(): void {
    if (this.pending || this.listeners.size === 0) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const fn of this.listeners) fn();
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The next patch version of a service, which becomes its current one. */
  private version(s: number): string {
    const [major, minor, patch] = this.versions[s].slice(1).split('.').map(Number);
    this.previous[s] = this.versions[s];
    this.versions[s] = `v${major}.${minor}.${patch + 1}`;
    return this.versions[s];
  }

  private deploy(s: number, by: string, rollback: boolean): void {
    let version: string;
    if (rollback) {
      version = this.previous[s];
      this.versions[s] = version;
    } else version = this.version(s);
    this.deploys.push({ t: this.now, service: s, version, by, rollback });
    this.addLog('deploy', s, `${rollback ? 'rolled back to' : 'deployed'} ${version} (${by})`);
  }

  /** Opens an alert after three bad samples in a row, resolves it after three good ones. */
  private check(s: number): void {
    const x = this.last(s);
    const st = this.streak[s];
    for (const kind of ['latency', 'errors'] as const) {
      const value = kind === 'latency' ? x.p95 : x.err;
      const bad = value > (kind === 'latency' ? SERVICES[s].slo : ERROR_SLO);
      const open = this.alerts.find((a) => a.service === s && a.kind === kind && a.resolved === null);
      if (bad) {
        st[kind]++;
        st[`${kind}Ok`] = 0;
        if (open) open.peak = Math.max(open.peak, value);
        else if (st[kind] >= 3) {
          const a: Alert = { id: this.nextAlert++, service: s, kind, opened: this.now, peak: value, ackedBy: null, ackedAt: null, resolved: null };
          // The checkout incident in the history was handled before you arrived.
          if (this.step < HISTORY) [a.ackedBy, a.ackedAt] = ['kim', this.now + 2 * STEP_MS];
          this.alerts.push(a);
          this.addLog('alert', s, `ALERT ${describe(a)}`);
        }
      } else {
        st[kind] = 0;
        st[`${kind}Ok`]++;
        if (open && st[`${kind}Ok`] >= 3) {
          open.resolved = this.now;
          this.addLog('resolve', s, `resolved ${describe(open)}`);
        }
      }
    }
    // Keep the last few resolved alerts, and every open one.
    while (this.alerts.length > 12) {
      const i = this.alerts.findIndex((a) => a.resolved !== null);
      if (i < 0) break;
      this.alerts.splice(i, 1);
    }
  }

  private addLog(kind: LogLine['kind'], service: number | null, text: string): void {
    this.log.push({ t: this.now, kind, service, text });
    if (this.log.length > 300) this.log.shift();
  }
}

/** "payments p95 431 ms > 400" or "search errors 4.2% > 2%". */
export function describe(a: Alert): string {
  const def = SERVICES[a.service];
  return a.kind === 'latency' ? `${def.name} p95 ${Math.round(a.peak)}ms > ${def.slo}` : `${def.name} errors ${a.peak.toFixed(1)}% > ${ERROR_SLO}%`;
}

/** 14:02:05, in station time (UTC, so it is the same on every machine). */
export function clock(t: number, seconds = true): string {
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, '0');
  return seconds ? `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}` : `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
