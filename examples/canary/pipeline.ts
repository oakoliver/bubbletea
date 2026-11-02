/**
 * The canary's pipeline: an invented release of an invented service, from
 * build to production, with a canary at 5% and 25% of the traffic and a human
 * approval before 100%.
 *
 * NOTHING HERE IS REAL. A seeded PRNG makes every number, so a seed always
 * gives the same release and the same screens; that is what the tests rely on.
 * Nothing is built, deployed or read from this machine or the network.
 *
 * Time is simulated: one step is five seconds of pipeline time. The program
 * decides how often to step (main.ts: every 250 ms); tests step by hand.
 */

export const STEP_S = 5;

export interface StageDef {
  name: string;
  /** Steps the stage takes before the jitter; 0 for the approval gate. */
  steps: number;
  /** Share of the traffic the new version serves during the stage, percent. */
  traffic: number;
}

export const STAGES: StageDef[] = [
  { name: 'build', steps: 10, traffic: 0 },
  { name: 'test', steps: 18, traffic: 0 },
  { name: 'image', steps: 6, traffic: 0 },
  { name: 'canary 5%', steps: 24, traffic: 5 },
  { name: 'canary 25%', steps: 24, traffic: 25 },
  { name: 'approval', steps: 0, traffic: 25 },
  { name: 'production', steps: 16, traffic: 100 },
];

export const GATE = STAGES.findIndex((s) => s.steps === 0);
/** The canary rolls back after this many samples in a row over the limit. */
export const ERROR_LIMIT = 1.5;
const BAD_SAMPLES = 3;
/** Requests per second of the whole service. */
const RPS = 2400;

/** One sample of the new version and of the old one, taken during a stage. */
export interface Sample {
  t: number;
  /** Requests per second served by the new version. */
  rps: number;
  /** Error rate of the new version and of the old one, percent. */
  err: number;
  baseErr: number;
  /** p95 latency of the new version and of the old one, ms. */
  p95: number;
  baseP95: number;
}

export type Phase = 'running' | 'waiting' | 'paused' | 'live' | 'rolled-back';

export interface Stage {
  def: StageDef;
  /** Steps this stage takes in this run (the definition plus jitter). */
  steps: number;
  done: number;
  samples: Sample[];
  /** Pipeline seconds the stage took, or has taken so far. */
  seconds: number;
}

export interface PipelineOptions {
  seed?: number;
  /** The new version gets worse during the 25% canary, and the pipeline rolls it back. */
  faulty?: boolean;
  service?: string;
  version?: string;
}

export class Pipeline {
  readonly service: string;
  readonly version: string;
  readonly faulty: boolean;
  stages: Stage[];
  current = 0;
  phase: Phase = 'running';
  /** Why the pipeline stopped, for 'live' and 'rolled-back'. */
  outcome = '';
  /** Who approved, and the ticket and notes they gave. */
  approval: { by: string; ticket: string; notes: string } | null = null;
  t = 0;
  private seed: number;
  private bad = 0;
  private listeners = new Set<() => void>();

  constructor(opts: PipelineOptions = {}) {
    this.seed = opts.seed ?? 7;
    this.faulty = opts.faulty ?? false;
    this.service = opts.service ?? 'checkout';
    this.version = opts.version ?? '2.14.0';
    this.stages = STAGES.map((def) => ({
      def,
      steps: def.steps === 0 ? 0 : def.steps + Math.floor(this.rand() * 5) - 2,
      done: 0,
      samples: [],
      seconds: 0,
    }));
  }

  /** mulberry32: the same seed gives the same numbers. */
  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  stage(): Stage {
    return this.stages[this.current]!;
  }

  /** Done steps over all steps, 0 to 100. The gate counts for nothing. */
  progress(): number {
    const total = this.stages.reduce((a, s) => a + s.steps, 0);
    const done = this.stages.reduce((a, s) => a + s.done, 0);
    return Math.floor((100 * done) / total);
  }

  /** Five seconds pass. Only a running pipeline moves. */
  step(): void {
    if (this.phase !== 'running') return;
    this.t += STEP_S;
    const st = this.stage();
    st.done++;
    st.seconds += STEP_S;
    if (st.def.traffic > 0) st.samples.push(this.sample(st));
    if (this.phase === 'running' && st.done >= st.steps) this.advance();
    this.changed();
  }

  private sample(st: Stage): Sample {
    const share = st.def.traffic / 100;
    const r = () => this.rand();
    const baseErr = 0.35 + 0.25 * r();
    const baseP95 = 180 + 20 * r();
    let err = 0.3 + 0.25 * r();
    let p95 = 175 + 20 * r();
    // The faulty version: errors climb through the 25% canary.
    if (this.faulty && st.def.traffic === 25) {
      const k = st.done / st.steps;
      err += 4 * k * k;
      p95 += 120 * k;
    }
    const s: Sample = { t: this.t, rps: Math.round(RPS * share * (0.92 + 0.16 * r())), err, baseErr, p95, baseP95 };
    this.bad = err > ERROR_LIMIT ? this.bad + 1 : 0;
    if (this.bad >= BAD_SAMPLES) {
      this.phase = 'rolled-back';
      this.outcome = `${st.def.name}: error rate ${err.toFixed(1)}% over ${ERROR_LIMIT}% for ${BAD_SAMPLES} samples, rolled back`;
    }
    return s;
  }

  private advance(): void {
    this.current++;
    if (this.current === GATE) this.phase = 'waiting';
    if (this.current >= this.stages.length) {
      this.current = this.stages.length - 1;
      this.phase = 'live';
      this.outcome = `${this.service} ${this.version} is serving 100% of the traffic`;
    }
  }

  /** The approval: promote to production, or roll back. */
  decide(promote: boolean, by: string, ticket: string, notes: string): void {
    if (this.phase !== 'waiting') return;
    this.approval = { by, ticket, notes };
    if (promote) {
      this.current++;
      this.phase = 'running';
    } else {
      this.phase = 'rolled-back';
      this.outcome = `${by} declined the promotion, rolled back`;
    }
    this.changed();
  }

  /** Space: pause or resume. A paused pipeline doesn't step. */
  togglePause(): void {
    if (this.phase === 'running') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'running';
    else return;
    this.changed();
  }

  /** The canary's numbers, for the approval notes. */
  summary(): string {
    const xs = this.stages[GATE - 1]!.samples;
    if (xs.length === 0) return '';
    const avg = (f: (s: Sample) => number) => xs.reduce((a, s) => a + f(s), 0) / xs.length;
    return (
      `canary 25%: errors ${avg((s) => s.err).toFixed(2)}% (old ${avg((s) => s.baseErr).toFixed(2)}%), ` +
      `p95 ${avg((s) => s.p95).toFixed(0)} ms (old ${avg((s) => s.baseP95).toFixed(0)} ms)`
    );
  }
}
