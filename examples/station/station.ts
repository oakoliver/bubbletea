/**
 * The station's Bubble Tea model: one per viewer. Every viewer has their own
 * size, tab, zone manager and charts; the World underneath is shared.
 *
 *  - ntcharts draws: a time series of the selected service's p95 latency, a
 *    streaming line of its requests per second, a sparkline per service, a
 *    heatmap of error rates and a bar chart of today's deploys.
 *  - bubblezone answers "what is under the mouse": tabs, service rows, alert
 *    buttons, chart panels, heatmap rows and bars are zones. The same zone IDs
 *    in everyone's view are what lets one viewer's pointer be drawn on another
 *    viewer's screen, even when their windows are different sizes.
 *  - freeze turns the current frame into an SVG (and PNG) with `s`.
 */
import {
  type Cmd,
  KeyPressMsg,
  type Model,
  MouseButton,
  MouseMode,
  MouseMotionMsg,
  MouseReleaseMsg,
  MouseWheelMsg,
  type Msg,
  Quit,
  Tick,
  View,
  WindowSizeMsg,
} from '@oakoliver/bubbletea';
import * as zone from '@oakoliver/bubblezone';
import { Center, Left, Top, joinHorizontal, joinVertical, newStyle, place, roundedBorder, sliceAnsi, stringWidth, stripAnsi, truncate } from '@oakoliver/lipgloss';
import * as barchart from '@oakoliver/ntcharts/barchart';
import * as runes from '@oakoliver/ntcharts/canvas/runes';
import * as heatmap from '@oakoliver/ntcharts/heatmap';
import * as streamlinechart from '@oakoliver/ntcharts/linechart/streamlinechart';
import * as tslc from '@oakoliver/ntcharts/linechart/timeserieslinechart';
import * as sparkline from '@oakoliver/ntcharts/sparkline';
import { writeSnapshot } from './snapshot.ts';
import { type Alert, ERROR_SLO, SERVICES, STEP_MS, type Viewer, type World, clock, describe } from './world.ts';

// ── palette (Catppuccin Mocha) ─────────────────────────────────────────────
export const C = {
  base: '#1E1E2E', mantle: '#181825', crust: '#11111B', surface0: '#313244', surface1: '#45475A', surface2: '#585B70',
  overlay: '#6C7086', subtext: '#A6ADC8', text: '#CDD6F4', red: '#F38BA8', peach: '#FAB387', yellow: '#F9E2AF',
  green: '#A6E3A1', mauve: '#CBA6F7', blue: '#89B4FA',
};

interface Sty {
  fg?: string;
  bg?: string;
  b?: boolean;
  i?: boolean;
}
/** Styled text on one line. */
const S = (text: string, o: Sty = {}): string => {
  if (!text) return '';
  let s = newStyle().inline(true);
  if (o.fg) s = s.foreground(o.fg);
  if (o.bg) s = s.background(o.bg);
  if (o.b) s = s.bold(true);
  if (o.i) s = s.italic(true);
  return s.render(text);
};
/** Pads or cuts plain or styled text to exactly `w` cells. */
const cell = (s: string, w: number): string => {
  const sw = stringWidth(s);
  return sw > w ? truncate(s, w) : s + ' '.repeat(w - sw);
};
const right = (s: string, w: number): string => ' '.repeat(Math.max(0, w - stringWidth(s))) + s;

// ── messages ───────────────────────────────────────────────────────────────

/** The World changed: new samples, an acknowledgement, someone's pointer moved. */
export class WorldChanged {
  readonly _tag = 'WorldChanged';
}
class ToastEnd {
  readonly _tag = 'ToastEnd';
  constructor(readonly n: number) {}
}

export const TABS = ['overview', 'latency', 'errors', 'deploys'] as const;
export type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', latency: 'Latency', errors: 'Errors', deploys: 'Deploys' };
/** Latency windows, in steps of five seconds: 2, 5 and 15 minutes. */
export const WINDOWS = [24, 60, 180];
const WINDOW_LABEL = ['2m', '5m', '15m'];
export const MIN_W = 100;
/** The heatmap's colours, from 0% errors to 4% and more: the alert threshold, 2%, is yellow. */
const HEAT_SCALE = ['#313244', '#45475A', '#F9E2AF', '#FAB387', '#F38BA8'];
/** Height of the overview's bottom row: a heatmap of six services, its labels, a legend and a border. */
const BOTTOM_H = 13;
export const MIN_H = 28;

export interface StationOptions {
  /** Where `s` writes snapshots. null: not here (over SSH), `snapshotHint` is shown instead. */
  snapshotDir: string | null;
  snapshotHint?: string;
  /** Draws a scripted pointer over the frame (--demo). */
  overlay?: (frame: string) => string;
}

export class Station implements Model {
  width = 0;
  height = 0;
  readonly zm = zone.New();
  tab: Tab = 'overview';
  window = 1;
  /** Log lines scrolled up from the newest. */
  logOffset = 0;
  toast: { text: string; n: number } | null = null;
  /** The zone under this viewer's pointer. */
  hover: string | null = null;
  /** The files `s` has written. */
  snapshots: string[] = [];

  private marked: string[] = [];
  private heatRowH = 1;
  private toasts = 0;
  private drawnKey = '';
  private sparks: sparkline.Model[] = [];
  private latency: tslc.Model | null = null;
  private rps: streamlinechart.Model | null = null;
  private heat: heatmap.Model | null = null;
  private bars: barchart.Model | null = null;

  constructor(
    readonly world: World,
    readonly me: Viewer,
    readonly opts: StationOptions = { snapshotDir: '.' },
  ) {}

  init(): Cmd {
    return null;
  }

  // ── update ───────────────────────────────────────────────────────────────

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof WindowSizeMsg) {
      this.width = msg.width;
      this.height = msg.height;
      this.layout();
      return [this, null];
    }
    if (msg instanceof WorldChanged) return [this, null]; // the view reads the world
    if (msg instanceof ToastEnd) {
      if (this.toast?.n === msg.n) this.toast = null;
      return [this, null];
    }
    if (msg instanceof KeyPressMsg) return this.key(msg.toString());
    if (msg instanceof MouseMotionMsg) {
      this.pointAt(msg);
      return [this, null];
    }
    if (msg instanceof MouseWheelMsg) return this.wheel(msg);
    if (msg instanceof MouseReleaseMsg && msg.button === MouseButton.Left) return this.click(msg);
    return [this, null];
  }

  private key(k: string): [Model, Cmd] {
    switch (k) {
      case 'q':
      case 'ctrl+c':
        return [this, Quit];
      case 'up':
      case 'k':
        this.select((this.me.selected + SERVICES.length - 1) % SERVICES.length);
        break;
      case 'down':
      case 'j':
        this.select((this.me.selected + 1) % SERVICES.length);
        break;
      case 'tab':
        this.setTab(TABS[(TABS.indexOf(this.tab) + 1) % TABS.length]);
        break;
      case 'shift+tab':
        this.setTab(TABS[(TABS.indexOf(this.tab) + TABS.length - 1) % TABS.length]);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        this.setTab(TABS[Number(k) - 1]);
        break;
      case 'esc':
        this.setTab('overview');
        break;
      case 'w':
        this.window = (this.window + 1) % WINDOWS.length;
        break;
      case 'a': {
        const a = this.world.openAlert(this.me.selected);
        if (a && !a.ackedBy) this.world.ack(a.id, this.me);
        break;
      }
      case 'space':
        this.world.togglePause();
        break;
      case 'pgup':
        this.logOffset += 5;
        break;
      case 'pgdown':
        this.logOffset = Math.max(0, this.logOffset - 5);
        break;
      case 's':
        return [this, this.snapshot()];
    }
    return [this, null];
  }

  /** The smallest zone under the mouse: a button inside a row wins over the row. */
  private zoneAt(msg: { x: number; y: number }): string | null {
    let best: string | null = null;
    let area = Infinity;
    for (const id of this.marked) {
      const z = this.zm.get(id);
      if (!z.inBounds(msg)) continue;
      const a = z.width * z.height;
      if (a < area) [best, area] = [id, a];
    }
    return best;
  }

  /** Records where this viewer's pointer is, as a zone and a cell inside it, for the others to draw. */
  private pointAt(msg: MouseMotionMsg | MouseReleaseMsg): void {
    const id = this.zoneAt(msg);
    this.hover = id;
    const [dx, dy] = id ? this.zm.get(id).pos(msg) : [0, 0];
    const h = this.me.hover;
    if (h?.zone === id && h.dx === dx && h.dy === dy) return;
    this.me.hover = id ? { zone: id, dx, dy } : null;
    this.world.changed();
  }

  private click(msg: MouseReleaseMsg): [Model, Cmd] {
    this.pointAt(msg);
    const id = this.zoneAt(msg);
    if (!id) return [this, null];
    const [kind, arg] = id.split(':');
    switch (kind) {
      case 'tab':
        this.setTab(arg as Tab);
        break;
      case 'svc':
        this.select(Number(arg));
        break;
      case 'ack':
        this.world.ack(Number(arg), this.me);
        break;
      case 'zoom':
        this.setTab(this.tab === arg ? 'overview' : (arg as Tab));
        break;
      case 'win':
        this.window = Number(arg);
        break;
      case 'btn':
        if (arg === 'pause') this.world.togglePause();
        if (arg === 'snapshot') return [this, this.snapshot()];
        break;
      case 'heat': {
        // Rows of the heatmap are services, top to bottom: the row under the pointer is the service.
        const [, y] = this.zm.get(id).pos(msg);
        const s = Math.floor(y / this.heatRowH);
        if (s < SERVICES.length) this.select(s);
        break;
      }
      default:
        if (this.bars && id === this.bars.zoneID()) {
          // ntcharts marks its own zone; it can tell which bar a cell of its canvas belongs to.
          const [x, y] = this.zm.get(id).pos(msg);
          const bar = this.bars.barDataFromPoint({ x, y });
          const s = SERVICES.findIndex((d) => d.name === bar.label);
          if (s >= 0) this.select(s);
        }
    }
    return [this, null];
  }

  private wheel(msg: MouseWheelMsg): [Model, Cmd] {
    const up = msg.button === MouseButton.WheelUp;
    const id = this.zoneAt(msg);
    if (id === 'log') this.logOffset = Math.max(0, this.logOffset + (up ? 2 : -2));
    if (id === 'chart:latency') this.window = Math.max(0, Math.min(WINDOWS.length - 1, this.window + (up ? -1 : 1)));
    return [this, null];
  }

  private select(s: number): void {
    this.me.selected = s;
    this.world.changed();
  }

  private setTab(t: Tab): void {
    this.tab = t;
    this.me.tab = t;
    this.layout();
    this.world.changed();
  }

  private say(text: string): Cmd {
    const n = ++this.toasts;
    this.toast = { text, n };
    return Tick(4000, () => new ToastEnd(n));
  }

  private snapshot(): Cmd {
    if (this.opts.snapshotDir === null) return this.say(this.opts.snapshotHint ?? 'snapshots are not available here');
    const stamp = clock(this.world.now).replaceAll(':', '');
    const { files, ms } = writeSnapshot(this.frame(), this.opts.snapshotDir, stamp);
    this.snapshots.push(...files);
    return this.say(`wrote station-${stamp}.svg${files.length > 1 ? ' and .png' : ''} in ${ms} ms`);
  }

  // ── layout and charts ──────────────────────────────────────────────────

  /** Width of the left column. */
  private leftW(): number {
    return this.width >= 112 ? 50 : 46;
  }

  /** Width of the overview's errors panel: a 15-minute heatmap, two cells a minute when there is room. */
  private heatW(): number {
    const rw = this.width - this.leftW();
    return Math.min(rw - 22, 2 + 9 + 1 + 15 * 2);
  }

  private layout(): void {
    if (this.width < MIN_W || this.height < MIN_H) return;
    const rightW = this.width - this.leftW();
    const bodyH = this.height - 2;
    const zoomed = this.tab !== 'overview';
    const latH = zoomed ? bodyH : bodyH - BOTTOM_H;
    const bottomH = bodyH - latH;
    const heatW = this.heatW();
    const axes = [newStyle().foreground(C.surface2), newStyle().foreground(C.overlay)] as const;

    // Boxes have a border (2) and a title line (1).
    const latChartH = zoomed ? Math.floor((bodyH - 3) * 0.62) : latH - 3;
    this.latency = tslc.New(rightW - 2, latChartH,
      tslc.WithAxesStyles(...axes),
      tslc.WithXLabelFormatter((_i, v) => clock(v * 1000, false)),
      tslc.WithYLabelFormatter((_i, v) => v.toFixed(0)),
      tslc.WithXYSteps(2, 2),
    );
    this.latency.setDataSetStyle('slo', newStyle().foreground(C.red));
    this.latency.setDataSetLineStyle('slo', runes.ThinLineStyle);
    this.rps = zoomed
      ? streamlinechart.New(rightW - 2, bodyH - 3 - latChartH - 1, streamlinechart.WithAxesStyles(...axes), streamlinechart.WithXYSteps(0, 2))
      : null;
    const heatH = zoomed ? bodyH - 3 : bottomH - 3;
    this.heatRowH = zoomed ? 2 : 1;
    // The heatmap's width is its labels (8 + 1) and the cells: make it a whole number of cells per minute.
    const cellW = Math.max(1, Math.floor(((zoomed ? rightW : heatW) - 2 - 9) / 15));
    this.heat = heatmap.New(9 + 15 * cellW, Math.min(heatH, this.heatRowH * SERVICES.length + 2),
      heatmap.WithValueRange(0, 4),
      heatmap.WithCellSize(cellW, this.heatRowH),
      heatmap.WithColorScale(HEAT_SCALE),
    );
    this.heat.setYLabels(SERVICES.map((d) => d.name).reverse()); // rows count up from the bottom
    this.bars = barchart.New(zoomed ? rightW - 2 : rightW - heatW - 2, SERVICES.length * (zoomed ? 2 : 1),
      barchart.WithHorizontalBars(),
      barchart.WithBarWidth(1),
      barchart.WithBarGap(zoomed ? 1 : 0),
      barchart.WithStyles(...axes),
      barchart.WithZoneManager(this.zm),
    );
    this.drawnKey = '';
  }

  /** Feeds the charts. Only when something they show has changed. */
  private draw(): void {
    const w = this.world;
    const sel = this.me.selected;
    const key = `${w.step}|${sel}|${this.window}|${this.tab}|${this.width}x${this.height}`;
    if (key === this.drawnKey || !this.latency || !this.heat || !this.bars) return;
    this.drawnKey = key;
    const def = SERVICES[sel];
    const span = WINDOWS[this.window] * STEP_MS;
    const from = w.now - span;

    // p95 of the selected service against its objective
    const lat = this.latency;
    lat.clearAllData();
    // from the sample at `from` itself: a column with no sample would draw as zero
    const xs = w.since(sel, from - 1);
    let peak = def.slo;
    for (const s of xs) {
      lat.push({ time: new Date(s.t), value: s.p95 });
      peak = Math.max(peak, s.p95);
    }
    lat.pushDataSet('slo', { time: new Date(from), value: def.slo });
    lat.pushDataSet('slo', { time: new Date(w.now), value: def.slo });
    lat.setStyle(newStyle().foreground(def.color));
    lat.setLineStyle(runes.ArcLineStyle);
    lat.setTimeRange(new Date(from), new Date(w.now));
    lat.setViewTimeRange(new Date(from), new Date(w.now));
    const top = Math.ceil((peak * 1.15) / 50) * 50;
    lat.setYRange(0, top);
    lat.setViewYRange(0, top);
    lat.drawDataSets(['slo', 'default']);

    // requests per second, streaming in from the right (zoomed latency tab)
    if (this.rps) {
      const r = this.rps;
      r.clearAllData();
      r.setDataSetStyles('default', runes.ArcLineStyle, newStyle().foreground(def.color));
      const vals = w.since(sel, from).map((s) => s.rps);
      const lo = Math.floor(Math.min(...vals) * 0.9);
      const hi = Math.ceil(Math.max(...vals) * 1.05);
      r.setYRange(lo, hi);
      r.setViewYRange(lo, hi);
      // one value per column: the stream keeps the newest graphWidth() values
      const n = r.graphWidth();
      for (let c = 0; c < n; c++) r.push(vals[Math.floor((c * vals.length) / n)] ?? vals[vals.length - 1]);
      r.draw();
    }

    // a sparkline of requests per second for every service, the last two minutes. A service
    // row is 33 cells of text, the sparkline, and 3 cells for the other viewers' marks.
    // New sparklines each time: a sparkline's automatic maximum only ever grows.
    const width = this.leftW() - 2 - 36;
    this.sparks = SERVICES.map((d, s) => {
      const last = w.samples[s].slice(-2 * width);
      const per: number[] = [];
      for (let i = 0; i < last.length; i += 2) per.push((last[i].rps + (last[i + 1]?.rps ?? last[i].rps)) / 2);
      const floor = Math.min(...per) * 0.97; // so that small changes show
      const sp = sparkline.New(width, 1, sparkline.WithStyle(newStyle().foreground(d.color)));
      sp.pushAll(per.map((v) => v - floor));
      sp.draw();
      return sp;
    });

    // error rate per service and minute: the last 15 minutes
    const heat = this.heat;
    heat.clearData();
    const cols = 15;
    const minute = 60_000;
    const labels: string[] = [];
    for (let c = 0; c < cols; c++) {
      const t0 = w.now - (cols - c) * minute;
      labels.push(c % 5 === 0 ? clock(t0 + minute, false) : '');
      SERVICES.forEach((_, s) => {
        const xs = w.samples[s].filter((x) => x.t > t0 && x.t <= t0 + minute);
        const avg = xs.length ? xs.reduce((a, x) => a + x.err, 0) / xs.length : 0;
        heat.push(heatmap.NewHeatPointInt(c, SERVICES.length - 1 - s, Math.min(4, avg)));
      });
    }
    heat.setXLabels(labels);
    heat.draw();

    // deploys today, per service
    const bars = this.bars;
    bars.clear();
    bars.pushAll(SERVICES.map((d, s) => ({
      label: d.name,
      values: [{ name: d.name, value: w.deploysToday(s), style: newStyle().foreground(s === sel ? d.color : C.surface2) }],
    })));
    bars.setHorizontal(true); // measures the label space, as upstream
    bars.draw();
  }

  // ── view ─────────────────────────────────────────────────────────────────

  /** The zone ID the bar chart marks itself with. */
  barsZone(): string {
    return this.bars?.zoneID() ?? '';
  }

  /** Wraps `s` in a zone and remembers its ID for hit-testing. */
  private mark(id: string, s: string): string {
    this.marked.push(id);
    return this.zm.mark(id, s);
  }

  private box(body: string, w: number, h: number, color = C.surface1): string {
    return newStyle().border(roundedBorder()).borderForeground(color).width(w).height(h).render(body);
  }

  /** A panel title line: a label, details, and a zoom button at the right. */
  private title(panel: Tab | null, label: string, detail: string, w: number): string {
    const name = S(label, { fg: C.mauve, b: true });
    let btn = '';
    if (panel) {
      const zoomed = this.tab === panel;
      const hot = this.hover === `zoom:${panel}`;
      btn = this.mark(`zoom:${panel}`, S(zoomed ? ' back ' : ' zoom ', { fg: hot ? C.crust : C.subtext, bg: hot ? C.mauve : C.surface0 }));
    }
    const left = ` ${name} ${detail}`;
    return cell(left, w - stringWidth(btn)) + btn;
  }

  private header(): string {
    const w = this.world;
    const brand = S(' ◆ STATION ', { fg: C.crust, bg: C.mauve, b: true }) + ' ' + S(' SIMULATED ', { fg: C.crust, bg: C.peach, b: true });
    const tabs = TABS.map((t) => {
      const active = t === this.tab;
      const hot = this.hover === `tab:${t}`;
      return this.mark(`tab:${t}`, S(` ${TAB_LABEL[t]} `, { fg: active ? C.crust : hot ? C.text : C.subtext, bg: active ? C.blue : hot ? C.surface1 : C.surface0, b: active }));
    }).join(' ');
    const people = [...w.viewers.values()].map((v) => S(v === this.me ? ` ${v.name} (you) ` : ` ${v.name} `, { fg: C.crust, bg: v.color })).join(' ');
    const status = w.paused ? S(' PAUSED ', { fg: C.crust, bg: C.yellow, b: true }) : S(clock(w.now) + ' UTC', { fg: C.subtext });
    const lhs = `${brand}  ${tabs}`;
    const rhs = `${people}  ${status} `;
    return lhs + ' '.repeat(Math.max(1, this.width - stringWidth(lhs) - stringWidth(rhs))) + rhs;
  }

  private services(w: number): string {
    const inner = w - 2;
    const world = this.world;
    const head = S(cell('  service', 12) + right('p95', 7) + right('req/s', 6) + right('err', 6) + '  req/s, 2m', { fg: C.overlay });
    const rows = SERVICES.map((d, s) => {
      const x = world.last(s);
      const alert = world.openAlert(s);
      const selected = s === this.me.selected;
      const dot = alert ? S('●', { fg: alert.ackedBy ? C.peach : C.red }) : S('●', { fg: C.green });
      const hot = this.hover === `svc:${s}`;
      const bg = selected ? C.surface1 : hot ? C.surface0 : undefined;
      const fg = selected ? C.text : C.subtext;
      const slow = x.p95 > d.slo;
      const errs = x.err > ERROR_SLO;
      const text =
        S(selected ? '▸' : ' ', { fg: this.me.color, bg }) +
        dot +
        S(' ' + cell(d.name, 9), { fg: selected ? d.color : fg, bg, b: selected }) +
        S(right(`${Math.round(x.p95)}ms`, 7), { fg: slow ? C.red : fg, bg }) +
        S(right(x.rps >= 1000 ? `${(x.rps / 1000).toFixed(1)}k` : `${Math.round(x.rps)}`, 6), { fg, bg }) +
        S(right(`${x.err.toFixed(1)}%`, 6), { fg: errs ? C.red : fg, bg }) +
        S('  ', { bg }) +
        this.sparks[s].view();
      // Who else has this service selected: a dot in their colour.
      const others = [...world.viewers.values()].filter((v) => v !== this.me && v.selected === s);
      const marks = others.map((v) => S('◆', { fg: v.color })).join('');
      return this.mark(`svc:${s}`, cell(text, inner - 3) + right(marks, 3));
    });
    return this.box([this.title(null, 'SERVICES', S('click a row', { fg: C.overlay }), inner), head, ...rows].join('\n'), w, SERVICES.length + 4);
  }

  private alerts(w: number, h: number): string {
    const inner = w - 2;
    const list = this.world.alertList().slice(0, h - 3);
    const people = new Map([...this.world.viewers.values()].map((v) => [v.name, v.color]));
    const line = (a: Alert): string => {
      const when = clock(a.opened, false);
      if (a.resolved !== null) return S(cell(`✓ ${when} ${describe(a)}`, inner), { fg: C.overlay });
      const text = S(`▲ ${when} `, { fg: C.red, b: true }) + S(describe(a), { fg: a.ackedBy ? C.peach : C.red });
      let tail: string;
      if (a.ackedBy) tail = S('✓ ', { fg: C.green }) + S(a.ackedBy, { fg: people.get(a.ackedBy) ?? C.subtext, b: true });
      else {
        const hot = this.hover === `ack:${a.id}`;
        tail = this.mark(`ack:${a.id}`, S(' ack ', { fg: C.crust, bg: hot ? C.yellow : C.red, b: true }));
      }
      return cell(text, inner - stringWidth(tail) - 1) + ' ' + tail;
    };
    const open = this.world.alerts.filter((a) => a.resolved === null);
    const unacked = open.filter((a) => !a.ackedBy).length;
    const detail = S(`${open.length} open${unacked ? `, ${unacked} not acknowledged` : ''}`, { fg: unacked ? C.red : C.overlay });
    return this.box([this.title(null, 'ALERTS', detail, inner), ...list.map(line)].join('\n'), w, h);
  }

  private logPanel(w: number, h: number): string {
    const inner = w - 2;
    const n = h - 3;
    const all = this.world.log;
    this.logOffset = Math.min(this.logOffset, Math.max(0, all.length - n));
    const end = all.length - this.logOffset;
    const lines = all.slice(Math.max(0, end - n), end).map((l) => {
      const svc = l.service === null ? '' : SERVICES[l.service];
      const name = svc ? S(cell(svc.name, 9), { fg: svc.color }) : ' '.repeat(9);
      const color = { req: / 5\d\d /.test(l.text) ? C.red : C.subtext, deploy: C.blue, alert: C.red, ack: C.mauve, resolve: C.green, people: C.overlay }[l.kind];
      return cell(S(clock(l.t) + ' ', { fg: C.surface2 }) + name + S(l.text, { fg: color, b: l.kind === 'alert' }), inner);
    });
    const detail = this.logOffset ? S(`scrolled · ${this.logOffset} newer below`, { fg: C.yellow }) : S('wheel scrolls', { fg: C.overlay });
    return this.mark('log', this.box([this.title(null, 'LOG', detail, inner), ...lines].join('\n'), w, h));
  }

  private latencyPanel(w: number, h: number): string {
    const inner = w - 2;
    const def = SERVICES[this.me.selected];
    const wins = WINDOW_LABEL.map((l, i) => {
      const on = i === this.window;
      return this.mark(`win:${i}`, S(` ${l} `, { fg: on ? C.crust : C.subtext, bg: on ? C.blue : C.surface0 }));
    }).join('');
    const detail = S(def.name, { fg: def.color, b: true }) + S(' p95 ms · ', { fg: C.overlay }) + S(`objective ${def.slo}`, { fg: C.red }) + '  ' + wins;
    const body = [this.title('latency', 'LATENCY', detail, inner), this.mark('chart:latency', this.latency!.view())];
    if (this.rps) body.push(S(' requests per second', { fg: C.overlay }), this.rps.view());
    return this.box(body.join('\n'), w, h);
  }

  private errorsPanel(w: number, h: number): string {
    const inner = w - 2;
    const detail = S(`% a minute · alert > ${ERROR_SLO}%`, { fg: C.overlay });
    // A legend of the colour scale under the heatmap.
    const legend = ' ' + S('0%', { fg: C.overlay }) + ' ' + HEAT_SCALE.map((c) => S('  ', { bg: c })).join('') + ' ' + S('4%+', { fg: C.overlay });
    return this.box([this.title('errors', 'ERRORS', detail, inner), this.mark('heat', this.heat!.view()), legend].join('\n'), w, h);
  }

  private deploysPanel(w: number, h: number): string {
    const inner = w - 2;
    this.marked.push(this.bars!.zoneID()); // the bar chart marks its own zone
    const body = [this.title('deploys', 'DEPLOYS', S('today', { fg: C.overlay }), inner), this.bars!.view()];
    // The latest deploys under the bars: as many as fit.
    const zoomed = this.tab === 'deploys';
    body.push(S(zoomed ? '\n latest' : '', { fg: C.overlay }));
    const recent = [...this.world.deploys].sort((a, b) => b.t - a.t).slice(0, h - body.join('\n').split('\n').length - 2);
    for (const d of recent) {
      const svc = SERVICES[d.service];
      const what = d.rollback ? S('↩ ', { fg: C.peach }) : S('↑ ', { fg: C.blue });
      const line = ' ' + S(clock(d.t, zoomed) + ' ', { fg: C.surface2 }) + what + S(cell(svc.name, 9), { fg: svc.color }) + S(d.version, { fg: C.text });
      body.push(zoomed ? line + S(`${d.rollback ? '  rollback' : ''}  by ${d.by}`, { fg: C.overlay }) : cell(line, inner));
    }
    return this.box(body.join('\n'), w, h);
  }

  private footer(): string {
    const key = (k: string, what: string) => S(k, { fg: C.subtext, b: true }) + S(` ${what}`, { fg: C.overlay });
    const help = ' ' + [key('↑↓', 'service'), key('tab', 'view'), key('a', 'ack'), key('w', 'window'), key('s', 'snapshot'), key('q', 'quit')].join(S(' · ', { fg: C.surface1 }));
    const btn = (id: string, label: string) => {
      const hot = this.hover === `btn:${id}`;
      return this.mark(`btn:${id}`, S(` ${label} `, { fg: hot ? C.crust : C.text, bg: hot ? C.mauve : C.surface1 }));
    };
    const buttons = `${btn('pause', this.world.paused ? 'resume' : 'pause')} ${btn('snapshot', 'snapshot')} `;
    const mid = this.toast ? S(' ' + this.toast.text + ' ', { fg: C.crust, bg: C.green }) : '';
    const left = cell(help, this.width - stringWidth(buttons) - stringWidth(mid) - 2);
    return left + mid + '  ' + buttons;
  }

  /**
   * The screen without overlays, after zone.scan(): what snapshots and the
   * other viewers' pointer positions are based on.
   */
  frame(): string {
    this.marked = [];
    if (this.width < MIN_W || this.height < MIN_H) {
      return place(this.width, this.height, Center, Center, S(`The station needs at least ${MIN_W}×${MIN_H} cells (this is ${this.width}×${this.height}).`, { fg: C.red }));
    }
    this.draw();
    const lw = this.leftW();
    const rw = this.width - lw;
    const bodyH = this.height - 2;
    const svcH = SERVICES.length + 4;
    const alertH = 7;
    const left = joinVertical(Left, this.services(lw), this.alerts(lw, alertH), this.logPanel(lw, bodyH - svcH - alertH));
    let rightCol: string;
    if (this.tab === 'overview') {
      const latH = bodyH - BOTTOM_H;
      const heatW = this.heatW();
      rightCol = joinVertical(Left, this.latencyPanel(rw, latH), joinHorizontal(Top, this.errorsPanel(heatW, bodyH - latH), this.deploysPanel(rw - heatW, bodyH - latH)));
    } else if (this.tab === 'latency') rightCol = this.latencyPanel(rw, bodyH);
    else if (this.tab === 'errors') rightCol = this.errorsPanel(rw, bodyH);
    else rightCol = this.deploysPanel(rw, bodyH);
    // scan() at the root: it strips the markers and records where every zone landed
    return this.zm.scan([this.header(), joinHorizontal(Top, left, rightCol), this.footer()].join('\n'));
  }

  view(): View {
    let content = this.frame();
    if (this.width >= MIN_W && this.height >= MIN_H) content = this.pointers(content);
    if (this.opts.overlay) content = this.opts.overlay(content);
    const v = new View(content);
    v.altScreen = true;
    v.mouseMode = MouseMode.AllMotion; // hover, and the pointers of the other viewers, need motion
    v.windowTitle = 'Station';
    return v;
  }

  /**
   * Draws the other viewers' pointers. A pointer is stored as a zone ID and a
   * cell inside that zone, so it lands on the same button or row here even if
   * this window has another size or layout. Zones not on this screen: no pointer.
   */
  private pointers(frame: string): string {
    const lines = frame.split('\n');
    for (const v of this.world.viewers.values()) {
      if (v === this.me || !v.hover) continue;
      const z = this.zm.get(v.hover.zone);
      if (z.isZero()) continue;
      const x = z.startX + Math.min(v.hover.dx, z.width - 1);
      const y = z.startY + Math.min(v.hover.dy, z.height - 1);
      if (y >= lines.length) continue;
      const line = lines[y];
      const under = stripAnsi(sliceAnsi(line, x, x + 1)) || ' ';
      const tag = ` ${v.name}`;
      const after = stringWidth(line) - x - 1;
      const label = after >= tag.length ? S(tag, { fg: v.color, b: true }) : '';
      lines[y] = sliceAnsi(line, 0, x) + S(under === ' ' ? '▌' : under, { fg: C.crust, bg: v.color, b: true }) + label + sliceAnsi(line, x + 1 + stringWidth(label));
    }
    return lines.join('\n');
  }
}
