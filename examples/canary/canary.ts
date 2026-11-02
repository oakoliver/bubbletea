/**
 * The canary's Bubble Tea model: one release going through its pipeline.
 *
 * What it shows from today's releases:
 *
 * - Bubble Tea 1.4: `view.programStatus` tells the terminal (OSC 7501) whether
 *   the release is working (with its progress), blocked on your approval,
 *   done, or rolled back. The STATUS box shows the report as it was sent.
 * - Bubble Tea 1.3/1.4: frames are written in the terminal's colour profile;
 *   nothing here picks colours per profile.
 * - huh 1.1.3: the approval form's ticket and notes are bound to values that
 *   are already filled in, and they show up before you reach those fields.
 * - ntcharts 1.1: the stage-time bars and the metric chart have fixed zone IDs,
 *   and one sparkline is reused for every stage with clear() + resetMax().
 * - freeze 1.1: `s` saves a 4x PNG of the screen without stopping the program
 *   (see snapshot.ts).
 */
import {
  Batch,
  type Cmd,
  KeyPressMsg,
  type Model,
  MouseButton,
  MouseMode,
  MouseReleaseMsg,
  type Msg,
  type ProgramStatus,
  ProgramState,
  ProgramStatusKind,
  ProgramStatusSupportMsg,
  Quit,
  RequestProgramStatusSupport,
  View,
  WindowSizeMsg,
} from '@oakoliver/bubbletea';
import * as zone from '@oakoliver/bubblezone';
import { type Form, FormState, NewConfirm, NewForm, NewGroup, NewInput, NewText, ThemeCatppuccin, ThemeFunc } from '@oakoliver/huh';
import { joinHorizontal, joinVertical, Left, newStyle, roundedBorder, Top, truncate, width as cells } from '@oakoliver/lipgloss';
import * as barchart from '@oakoliver/ntcharts/barchart';
import * as runes from '@oakoliver/ntcharts/canvas/runes';
import * as tslc from '@oakoliver/ntcharts/linechart/timeserieslinechart';
import * as sparkline from '@oakoliver/ntcharts/sparkline';
import { ERROR_LIMIT, GATE, type Pipeline, STAGES, type Stage } from './pipeline.ts';
import { type Snapshot, snapshotCmd, SnapshotDone } from './snapshot.ts';

/** Sent to the program when the pipeline changes. */
export class PipelineChanged {
  readonly _tag = 'PipelineChanged';
}

export const MIN_W = 100;
export const MIN_H = 30;

/** Zone IDs. The two charts get theirs from ntcharts' WithZoneID: the same in every program. */
export const Z = {
  stageTime: 'canary/stage-time',
  metric: 'canary/metric',
  stage: (i: number) => `canary/stage/${i}`,
} as const;

const C = {
  text: '#CDD6F4',
  dim: '#6C7086',
  line: '#45475A',
  title: '#CBA6F7',
  green: '#A6E3A1',
  yellow: '#F9E2AF',
  red: '#F38BA8',
  blue: '#89B4FA',
  peach: '#FAB387',
  crust: '#11111B',
};
const dim = newStyle().foreground(C.dim);
const title = newStyle().foreground(C.title).bold(true);
const box = (name: string, body: string, w: number, h?: number) => {
  let s = newStyle().border(roundedBorder()).borderForeground(C.line).padding(0, 1).width(w);
  if (h) s = s.height(h);
  return s.render(`${title.render(name)}\n${body}`);
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export interface CanaryOptions {
  /** Who approves (shown in the notes and in the outcome). */
  user?: string;
  /** Where `s` writes snapshots; null turns snapshots off. */
  snapshotDir?: string | null;
  /** Draw snapshots with the synchronous renderPNG, to compare. */
  syncSnapshots?: boolean;
}

export class Canary implements Model {
  zm = zone.New();
  width = MIN_W;
  height = MIN_H;
  /** The stage whose numbers are shown; null follows the running stage. */
  selected: number | null = null;
  metric: 'errors' | 'p95' = 'errors';
  /** Set when the terminal answers the OSC 7501 support query. */
  statusSupported = false;
  form: Form | null = null;
  ticket = '';
  notes = '';
  promote = true;
  snapshot: Snapshot | null = null;
  snapshots = 0;
  note = '';

  private spark = sparkline.New(30, 3, sparkline.WithStyle(newStyle().foreground(C.blue)));
  private sparkStage = -1;
  stageTime: barchart.Model | null = null;
  chart: tslc.Model | null = null;

  readonly pipeline: Pipeline;
  readonly opts: CanaryOptions;

  constructor(pipeline: Pipeline, opts: CanaryOptions = {}) {
    this.pipeline = pipeline;
    this.opts = opts;
  }

  init(): Cmd {
    return Batch(RequestProgramStatusSupport, this.maybeOpenForm());
  }

  /** At the gate, the approval form opens, already filled in. */
  private maybeOpenForm(): Cmd {
    if (this.form || this.pipeline.phase !== 'waiting') return null;
    const p = this.pipeline;
    this.ticket = `CHG-${4100 + (p.version.length * 7) % 100}`;
    this.notes = p.summary();
    this.promote = true;
    this.form = NewForm(
      NewGroup(
        NewConfirm()
          .title(`Promote ${p.service} ${p.version} to 100%?`)
          .affirmative('Promote')
          .negative('Roll back')
          .value(() => this.promote, (v) => { this.promote = v; }),
        NewInput().title('Change ticket').value(() => this.ticket, (v) => { this.ticket = v; }),
        NewText().title('Notes').lines(3).value(() => this.notes, (v) => { this.notes = v; }),
      ),
    )
      .withTheme(ThemeFunc(ThemeCatppuccin))
      .withShowHelp(false)
      .withWidth(56);
    return this.form.init();
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof WindowSizeMsg) [this.width, this.height] = [msg.width, msg.height];
    if (msg instanceof ProgramStatusSupportMsg) this.statusSupported = true;
    if (msg instanceof SnapshotDone) {
      this.snapshot = msg.snapshot;
      this.note = msg.snapshot.error
        ? `snapshot failed: ${msg.snapshot.error}`
        : `wrote ${msg.snapshot.file} in ${msg.snapshot.ms} ms; longest pause of the program: ${msg.snapshot.longestGapMs} ms`;
      return [this, null];
    }
    // At the gate, the form gets everything but ctrl+c: keys, and its own follow-up messages.
    if (this.form && !(msg instanceof KeyPressMsg && msg.toString() === 'ctrl+c')) return this.updateForm(msg);
    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();
      if (key === 'ctrl+c' || key === 'q') return [this, Quit];
      if (key !== 's') this.note = '';
      if (key === 'space') this.pipeline.togglePause();
      if (key === 'm') this.metric = this.metric === 'errors' ? 'p95' : 'errors';
      if (key === 'up') this.select(Math.max(0, this.shown() - 1));
      if (key === 'down') this.select(Math.min(STAGES.length - 1, this.shown() + 1));
      if (key === 'esc') this.selected = null;
      if (key === 's') return [this, this.takeSnapshot()];
    }
    if (msg instanceof MouseReleaseMsg && msg.button === MouseButton.Left) this.click(msg);
    return [this, this.maybeOpenForm()];
  }

  private updateForm(msg: Msg): [Model, Cmd] {
    const form = this.form!;
    const [, cmd] = form.update(msg);
    // huh completes a form on a message its last field sends back, not on the key itself.
    if (form.State === FormState.Completed) {
      this.form = null;
      this.pipeline.decide(this.promote, this.opts.user ?? 'you', this.ticket, this.notes);
      return [this, null];
    }
    return [this, cmd];
  }

  private takeSnapshot(): Cmd {
    if (this.opts.snapshotDir == null) {
      this.note = 'snapshots are off here';
      return null;
    }
    this.snapshots++;
    this.note = `drawing canary-${this.snapshots}.png at 4x…`;
    return snapshotCmd(this.frame(), this.opts.snapshotDir, `canary-${this.snapshots}.png`, this.opts.syncSnapshots ?? false);
  }

  /** The stage the charts show. */
  shown(): number {
    if (this.selected !== null) return this.selected;
    // At the gate, show the canary it is asking about.
    return this.pipeline.current === GATE ? GATE - 1 : this.pipeline.current;
  }

  select(i: number): void {
    this.selected = i;
  }

  click(msg: MouseReleaseMsg): void {
    STAGES.forEach((_, i) => {
      if (this.zm.get(Z.stage(i)).inBounds(msg)) this.select(i);
    });
    // The bar chart's zone has a fixed ID, so there is no need to ask the chart for it.
    const bars = this.zm.get(Z.stageTime);
    if (bars.inBounds(msg) && this.stageTime) {
      const [x, y] = bars.pos(msg);
      const i = STAGES.findIndex((s) => s.name === this.stageTime!.barDataFromPoint({ x, y }).label);
      if (i >= 0) this.select(i);
    }
    if (this.zm.get(Z.metric).inBounds(msg)) this.metric = this.metric === 'errors' ? 'p95' : 'errors';
  }

  /** What the program reports to the terminal with OSC 7501. */
  status(): ProgramStatus {
    const p = this.pipeline;
    const base = { app: 'canary', title: `${p.service} ${p.version}` };
    switch (p.phase) {
      case 'running':
        return { ...base, state: ProgramState.Working, progress: p.progress(), hasProgress: true, message: `${p.stage().def.name}: ${p.stage().done} of ${p.stage().steps} steps` };
      case 'paused':
        return { ...base, state: ProgramState.Idle, message: `paused at ${p.stage().def.name}` };
      case 'waiting':
        return { ...base, state: ProgramState.Blocked, kind: ProgramStatusKind.Permission, progress: p.progress(), hasProgress: true, message: `promote ${p.service} ${p.version} to 100%? ${p.summary()}` };
      case 'live':
        return { ...base, state: ProgramState.Done, message: p.outcome };
      case 'rolled-back':
        return { ...base, state: ProgramState.Error, message: p.outcome };
    }
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  private header(): string {
    const p = this.pipeline;
    const badge: Record<string, [string, string]> = {
      running: [`WORKING ${p.progress()}%`, C.blue],
      paused: ['PAUSED', C.dim],
      waiting: ['WAITING FOR YOU', C.yellow],
      live: ['LIVE', C.green],
      'rolled-back': ['ROLLED BACK', C.red],
    };
    const [text, bg] = badge[p.phase]!;
    return `${title.render(' CANARY')} ${p.service} ${p.version} → production  ${dim.render('simulated ·')} ${newStyle().background(bg).foreground(C.crust).bold(true).render(` ${text} `)}`;
  }

  private stageRows(): string {
    const p = this.pipeline;
    return p.stages
      .map((st, i) => {
        const shown = i === this.shown() ? newStyle().foreground(C.title).render('▸') : ' ';
        let mark = dim.render('·');
        let right = '';
        if (i < p.current || p.phase === 'live') [mark, right] = [newStyle().foreground(C.green).render('✓'), dim.render(mmss(st.seconds).padStart(5))];
        else if (i === p.current) {
          const failed = p.phase === 'rolled-back';
          mark = newStyle().foreground(failed ? C.red : C.yellow).render(failed ? '✗' : '●');
          if (st.steps > 0) {
            const k = Math.min(1, st.done / st.steps);
            const filled = Math.round(k * 8);
            right = newStyle().foreground(failed ? C.red : C.blue).render('█'.repeat(filled)) + dim.render('░'.repeat(8 - filled));
          } else right = newStyle().foreground(C.yellow).render('approve?');
        }
        return this.zm.mark(Z.stage(i), `${shown}${mark} ${st.def.name.padEnd(12)}${right}`);
      })
      .join('\n');
  }

  /** The OSC 7501 report, as text: what a supporting terminal shows in its tab or status bar. */
  private statusBox(): string {
    const s = this.status();
    const colour: Record<string, string> = { working: C.blue, idle: C.dim, blocked: C.yellow, done: C.green, error: C.red };
    const head = newStyle().foreground(colour[s.state]!).bold(true).render(s.state) + (s.kind ? dim.render(` (${s.kind})`) : '') + (s.hasProgress ? ` ${s.progress}%` : '');
    const support = this.statusSupported ? newStyle().foreground(C.green).render('terminal supports it') : dim.render('no reply from the terminal');
    const msg = (s.message ?? '').length > 28 ? `${s.message!.slice(0, 27)}…` : s.message;
    return `${head}\n${msg}\n${support}`;
  }

  private metricChart(st: Stage, w: number, h: number): string {
    if (st.samples.length < 2) {
      this.chart = null;
      const why = st.def.traffic > 0
        ? `\n  Waiting for the first samples of ${st.def.name}.\n `
        : `\n  ${st.def.name} sends no traffic to the new version.\n  The canary stages do.`;
      return this.zm.mark(Z.metric, dim.render(why) + '\n'.repeat(h - 3));
    }
    const pick = this.metric === 'errors' ? (s: Stage['samples'][0]) => [s.err, s.baseErr] : (s: Stage['samples'][0]) => [s.p95, s.baseP95];
    const xs = st.samples;
    const t0 = new Date(xs[0]!.t * 1000);
    const t1 = new Date(xs.at(-1)!.t * 1000);
    const values = xs.flatMap(pick);
    const top = Math.max(...values, this.metric === 'errors' ? ERROR_LIMIT : 0) * 1.25;
    const chart = tslc.New(w, h,
      tslc.WithZoneManager(this.zm),
      tslc.WithZoneID(Z.metric), // fixed: the click handler and the tests know it
      tslc.WithAxesStyles(newStyle().foreground(C.line), newStyle().foreground(C.dim)),
      tslc.WithXLabelFormatter((_i, v) => mmss(Math.round(v))),
      tslc.WithYLabelFormatter((_i, v) => v.toFixed(this.metric === 'errors' ? 1 : 0)),
      tslc.WithXYSteps(3, 2),
    );
    for (const s of xs) {
      const [now, old] = pick(s);
      chart.push({ time: new Date(s.t * 1000), value: now! });
      chart.pushDataSet('old', { time: new Date(s.t * 1000), value: old! });
    }
    const sets = ['old', 'default'];
    if (this.metric === 'errors') {
      // The limit the pipeline rolls back at, as a flat red line.
      chart.pushDataSet('limit', { time: t0, value: ERROR_LIMIT });
      chart.pushDataSet('limit', { time: t1, value: ERROR_LIMIT });
      chart.setDataSetStyle('limit', newStyle().foreground(C.red));
      sets.unshift('limit');
    }
    chart.setTimeRange(t0, t1);
    chart.setViewTimeRange(t0, t1);
    chart.setYRange(0, top);
    chart.setViewYRange(0, top);
    chart.setStyle(newStyle().foreground(this.metric === 'errors' ? C.peach : C.blue));
    chart.setDataSetStyle('old', newStyle().foreground(C.dim));
    chart.setLineStyle(runes.ArcLineStyle);
    chart.drawDataSets(sets);
    this.chart = chart;
    return chart.view();
  }

  /** One sparkline, reused for whichever stage is shown. */
  private requests(st: Stage, i: number): string {
    this.spark.clear();
    if (i !== this.sparkStage) {
      // clear() keeps the maximum, as in Go. Without resetMax() the scale would stay at the
      // busiest stage shown so far, and after production the 5% canary would be a flat line.
      this.spark.resetMax();
      this.sparkStage = i;
    }
    this.spark.pushAll(st.samples.slice(-30).map((s) => s.rps));
    this.spark.draw();
    const last = st.samples.at(-1);
    const line = last ? `${last.rps} req/s now, ${st.def.traffic}% of traffic` : 'no traffic';
    return `${this.spark.view()}\n${dim.render(line)}`;
  }

  private stageTimeChart(w: number): string {
    const p = this.pipeline;
    const bc = barchart.New(w, STAGES.length,
      barchart.WithHorizontalBars(),
      barchart.WithBarGap(0),
      barchart.WithStyles(newStyle().foreground(C.line), newStyle().foreground(C.dim)),
      barchart.WithZoneManager(this.zm),
      barchart.WithZoneID(Z.stageTime), // fixed, instead of the process-wide counter
    );
    bc.pushAll(
      p.stages.map((st, i) => ({
        label: st.def.name,
        values: [{ name: st.def.name, value: Math.max(st.seconds, 0.01), style: newStyle().foreground(i === this.shown() ? C.title : C.line) }],
      })),
    );
    bc.setHorizontal(true);
    bc.draw();
    this.stageTime = bc;
    return bc.view();
  }

  /** The screen, after scan(): no zone markers left, every zone's position recorded. */
  frame(): string {
    const p = this.pipeline;
    const i = this.shown();
    const st = p.stages[i]!;
    const leftW = 34;
    const rightW = Math.max(MIN_W, this.width) - leftW;

    const left = joinVertical(Left,
      box('PIPELINE', this.stageRows(), leftW),
      box('OSC 7501 STATUS', this.statusBox(), leftW),
      box('STAGE TIME', this.stageTimeChart(leftW - 4), leftW),
    );
    const leftH = left.split('\n').length;
    const topH = leftH - 7;

    let top: string;
    if (this.form) {
      top = box('APPROVAL', this.form.view(), rightW, topH);
    } else {
      const label = this.metric === 'errors' ? 'error rate, %' : 'p95 latency, ms';
      const legend = `${newStyle().foreground(this.metric === 'errors' ? C.peach : C.blue).render('━ new')} ${dim.render(this.metric === 'errors' ? '━ old' : '━ old · click to switch')}${this.metric === 'errors' ? newStyle().foreground(C.red).render(' ━ rollback limit') + dim.render(' · click to switch') : ''}`;
      top = box(`${st.def.name.toUpperCase()} · ${label}`, `${legend}\n${this.metricChart(st, rightW - 4, topH - 4)}`, rightW, topH);
    }
    const bottom = box(`REQUESTS/S · ${st.def.name}`, this.requests(st, i), rightW, 7);
    const body = joinHorizontal(Top, left, joinVertical(Left, top, bottom));

    const outcome = p.outcome ? newStyle().foreground(p.phase === 'live' ? C.green : C.red).render(` ${p.outcome}`) : '';
    const keys = this.form
      ? ' ←/→ choose · tab next field · enter submit · ctrl+c quit'
      : ' click a stage, a bar or the chart · ↑/↓ stage · m metric · space pause · s snapshot · q quit';
    // One line, never wider than the screen: a wrapped line would push the header off the top.
    const foot = truncate(this.note ? newStyle().foreground(C.peach).render(` ${this.note}`) : dim.render(keys), Math.max(MIN_W, this.width));
    return this.zm.scan([this.header(), body, outcome || dim.render(' '), foot].join('\n'));
  }

  view(): View {
    const tooSmall = this.width < MIN_W || this.height < MIN_H;
    const v = new View(tooSmall ? `The canary needs ${MIN_W}×${MIN_H}; this terminal is ${this.width}×${this.height}.` : this.frame());
    v.altScreen = true;
    v.mouseMode = MouseMode.CellMotion;
    v.programStatus = this.status();
    return v;
  }
}

/** The text width of a frame's widest line; used by the tests. */
export function frameWidth(frame: string): number {
  return Math.max(...frame.split('\n').map((l) => cells(l)));
}
