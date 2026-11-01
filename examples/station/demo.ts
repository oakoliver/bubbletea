/**
 * --demo: a scripted mouse, for recordings. A terminal recorder (VHS) cannot
 * click, so the script sends real MouseMotionMsg, MouseClickMsg,
 * MouseReleaseMsg and MouseWheelMsg values to the running program. The
 * targets are zone IDs: each step asks the viewer's zone manager where the
 * zone is now and aims inside it, so a scripted click goes through the same
 * bubblezone hit-testing as a real one. The pointer is drawn as a yellow cell
 * and a badge in the last row says that it is scripted.
 *
 * Over SSH (--serve --demo) the script is picked by the SSH user name: alice
 * and bob have one each, anyone else gets a normal session.
 */
import {
  KeyCode,
  KeyPressMsg,
  MouseButton,
  MouseClickMsg,
  MouseMotionMsg,
  MouseReleaseMsg,
  MouseWheelMsg,
  type Program,
} from '@oakoliver/bubbletea';
import { newStyle, sliceAnsi, stringWidth, stripAnsi } from '@oakoliver/lipgloss';
import type { Station } from './station.ts';
import { SERVICES, type World } from './world.ts';

/** A zone ID, or a function that finds one when the step runs (an alert's button, say). */
type Target = string | ((st: Station) => string | null);
type Step =
  | { sleep: number }
  | { until: (world: World) => boolean; max?: number }
  | { move: Target; dx?: number; dy?: number }
  | { click: Target; dx?: number; dy?: number }
  | { wheel: Target; dir: 'up' | 'down'; n?: number }
  | { key: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const svc = (name: string) => `svc:${SERVICES.findIndex((d) => d.name === name)}`;
const alertOf = (name: string, kind: 'latency' | 'errors') => (w: World) =>
  w.alerts.some((a) => SERVICES[a.service].name === name && a.kind === kind && a.resolved === null);
const ackOf = (name: string) => (st: Station) => {
  const a = st.world.openAlert(SERVICES.findIndex((d) => d.name === name));
  return a && !a.ackedBy ? `ack:${a.id}` : null;
};
const acked = (name: string) => (w: World) => !!w.openAlert(SERVICES.findIndex((d) => d.name === name))?.ackedBy;

export const SCRIPTS: Record<string, Step[]> = {
  // The SSH recording's main user. Paced against the World's incident script.
  alice: [
    { sleep: 1600 },
    { move: svc('checkout'), dx: 4 },
    { sleep: 500 },
    { click: svc('payments'), dx: 6 },
    { until: alertOf('payments', 'latency'), max: 9000 },
    { sleep: 700 },
    { click: ackOf('payments') },
    { sleep: 1400 },
    { click: 'zoom:latency' },
    { sleep: 900 },
    { wheel: 'chart:latency', dir: 'down', n: 1 },
    { sleep: 1000 },
    { wheel: 'chart:latency', dir: 'up', n: 2 },
    { sleep: 900 },
    { click: 'zoom:latency' },
    { until: acked('search'), max: 12000 },
    { sleep: 500 },
    { click: 'heat', dx: 6, dy: 1 },
    { sleep: 1100 },
    { click: 'tab:deploys' },
    { sleep: 1500 },
    { click: 'tab:overview' },
    { sleep: 600 },
    { click: 'btn:snapshot' },
  ],
  // The second SSH user, driven from the server while a bot keeps the session open.
  bob: [
    { sleep: 1200 },
    { move: svc('catalog'), dx: 8 },
    { sleep: 700 },
    { move: svc('search'), dx: 5 },
    { sleep: 500 },
    { click: svc('search'), dx: 5 },
    { sleep: 1500 },
    { move: 'chart:latency', dx: 30, dy: 4 },
    { sleep: 1500 },
    { move: 'heat', dx: 20, dy: 1 },
    { until: alertOf('search', 'errors'), max: 15000 },
    { sleep: 900 },
    { move: ackOf('search') },
    { sleep: 900 },
    { click: ackOf('search') },
    { sleep: 1600 },
    { move: 'zoom:errors' },
    { sleep: 1200 },
    { move: 'log', dx: 20, dy: 6 },
    { sleep: 2500 },
    { move: svc('notify'), dx: 3 },
  ],
  // bun examples/station/main.ts --demo: one person, the same story.
  solo: [
    { sleep: 1200 },
    { click: svc('payments'), dx: 6 },
    { until: alertOf('payments', 'latency'), max: 9000 },
    { sleep: 700 },
    { click: ackOf('payments') },
    { sleep: 1200 },
    { click: 'zoom:latency' },
    { sleep: 1200 },
    { wheel: 'chart:latency', dir: 'down', n: 1 },
    { sleep: 1500 },
    { click: 'zoom:latency' },
    { until: alertOf('search', 'errors'), max: 12000 },
    { sleep: 800 },
    { click: 'heat', dx: 6, dy: 1 },
    { sleep: 900 },
    { click: ackOf('search') },
    { sleep: 1500 },
    { click: 'tab:deploys' },
    { sleep: 2000 },
    { click: 'tab:errors' },
    { sleep: 2000 },
    { key: 'esc' },
  ],
};

const KEYS: Record<string, number> = { esc: KeyCode.Escape, enter: KeyCode.Enter, tab: KeyCode.Tab, up: KeyCode.Up, down: KeyCode.Down };

export class Demo {
  pointer: { x: number; y: number } | null = null;
  /** Targets the script could not find on screen; printed after exit. */
  missed: string[] = [];
  private station: Station | null = null;

  constructor(private readonly steps: Step[]) {}

  private resolve(t: Target, dx = 0, dy = 0): { x: number; y: number } | null {
    const st = this.station!;
    const id = typeof t === 'string' ? t : t(st);
    if (!id) return null;
    const z = st.zm.get(id);
    if (z.isZero()) {
      this.missed.push(id);
      return null;
    }
    // dx from the zone's start, or its middle when no dx is given
    const x = z.startX + Math.min(z.width - 1, dx || Math.floor((z.width - 1) / 2));
    return { x, y: z.startY + Math.min(z.height - 1, dy) };
  }

  /** Runs the script against a station and the program that runs it. */
  async run(station: Station, program: Program): Promise<void> {
    this.station = station;
    type MouseClass = typeof MouseMotionMsg | typeof MouseClickMsg | typeof MouseReleaseMsg | typeof MouseWheelMsg;
    const mouse = (Msg: MouseClass, p: { x: number; y: number }, button: MouseButton) =>
      program.send(new Msg({ x: p.x, y: p.y, button, mod: 0 }));
    for (const step of this.steps) {
      if ('sleep' in step) await wait(step.sleep);
      else if ('until' in step) {
        const end = Date.now() + (step.max ?? 10_000);
        while (!step.until(station.world) && Date.now() < end) await wait(100);
      } else if ('move' in step || 'click' in step) {
        const p = this.resolve('move' in step ? step.move : step.click, step.dx, step.dy);
        if (!p) continue;
        // glide there in a few motion events, so the other viewers see it travel
        const from = this.pointer ?? p;
        for (let i = 1; i <= 4; i++) {
          const q = { x: Math.round(from.x + ((p.x - from.x) * i) / 4), y: Math.round(from.y + ((p.y - from.y) * i) / 4) };
          this.pointer = q;
          mouse(MouseMotionMsg, q, MouseButton.None);
          await wait(70);
        }
        if ('click' in step) {
          await wait(350);
          mouse(MouseClickMsg, p, MouseButton.Left);
          await wait(70);
          mouse(MouseReleaseMsg, p, MouseButton.Left);
        }
      } else if ('wheel' in step) {
        const p = this.resolve(step.wheel, 20, 3);
        if (!p) continue;
        this.pointer = p;
        mouse(MouseMotionMsg, p, MouseButton.None);
        await wait(300);
        for (let i = 0; i < (step.n ?? 1); i++) {
          mouse(MouseWheelMsg, p, step.dir === 'up' ? MouseButton.WheelUp : MouseButton.WheelDown);
          await wait(450);
        }
      } else if ('key' in step) {
        const code = KEYS[step.key] ?? step.key.codePointAt(0)!;
        program.send(new KeyPressMsg({ text: KEYS[step.key] ? '' : step.key, code, mod: 0 }));
      }
    }
  }

  /** Draws the scripted pointer and the badge onto a frame that has been through scan(). */
  overlay(frame: string): string {
    const lines = frame.split('\n');
    const yellow = newStyle().inline(true).background('#F9E2AF').foreground('#11111B').bold(true);
    if (this.pointer && this.pointer.y < lines.length) {
      const { x, y } = this.pointer;
      const line = lines[y];
      const under = stripAnsi(sliceAnsi(line, x, x + 1)) || ' ';
      lines[y] = sliceAnsi(line, 0, x) + yellow.render(under) + sliceAnsi(line, x + 1);
    }
    // the badge goes over the start of the help line, clear of the buttons on the right
    const label = ' demo: scripted mouse ';
    const last = lines.length - 1;
    if (stringWidth(lines[last]) > label.length + 1) lines[last] = ' ' + yellow.bold(false).render(label) + sliceAnsi(lines[last], label.length + 1);
    return lines.join('\n');
  }
}
