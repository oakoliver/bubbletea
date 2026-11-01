/**
 * Tests of the station with @oakoliver/teatest: golden files of the screens
 * that matter, real key presses, and real mouse input. A click here is the
 * bytes a terminal sends (an SGR mouse report), written to the program's
 * input, so it goes through Bubble Tea's input parser and then bubblezone's
 * hit-testing, exactly like a click in a terminal.
 *
 * Everything is deterministic: the World is seeded and only moves when a test
 * calls advance(), and the one timer (the toast) is filtered out.
 *
 *   bun test ./examples/station/station.test.ts
 *   UPDATE_GOLDEN=1 bun test ./examples/station/station.test.ts   after a change you want
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Msg, WithFilter } from '@oakoliver/bubbletea';
import { stripAnsi } from '@oakoliver/lipgloss';
import { NewTestModel, RequireEqualOutput, type TestModel, WaitFor, WithDuration, WithInitialTermSize, WithProgramOptions } from '@oakoliver/teatest';
import * as testsession from '@oakoliver/wish/testsession';
import { newStationServer } from './serve.ts';
import { Station, WorldChanged } from './station.ts';
import { World } from './world.ts';

const W = 120;
const H = 34;

// The toast ends on a timer; a golden file must not depend on how long a test took.
const noTimers = WithProgramOptions(WithFilter((_m, msg: Msg) => ((msg as { _tag?: string })?._tag === 'ToastEnd' ? null : msg)));

const running: TestModel[] = [];
afterEach(async () => {
  for (const tm of running.splice(0)) tm.quit();
  await testsession.CloseAll();
});

/** A station for `name` on `world`, running in a test terminal of w×h. */
function open(world: World, name: string, w = W, h = H, snapshotDir: string | null = null): [TestModel, Station] {
  const st = new Station(world, world.join(name), { snapshotDir, snapshotHint: 'snapshots over SSH' });
  const tm = NewTestModel(st, WithInitialTermSize(w, h), noTimers);
  world.subscribe(() => tm.send(new WorldChanged()));
  running.push(tm);
  return [tm, st];
}

const has = (text: string) => (out: Buffer) => stripAnsi(out.toString()).includes(text);

/** Where a zone is on the screen, as a terminal counts (1-based), `dx` cells in. */
function cellOf(st: Station, id: string, dx?: number, dy = 0): [number, number] {
  const z = st.zm.get(id);
  if (z.isZero()) throw new Error(`zone ${id} is not on the screen`);
  return [z.startX + (dx ?? Math.floor((z.width - 1) / 2)) + 1, z.startY + dy + 1];
}

/** A left click as a terminal reports it: an SGR press, then a release. */
function click(tm: TestModel, st: Station, id: string, dx?: number, dy = 0): void {
  const [x, y] = cellOf(st, id, dx, dy);
  tm.writeInput(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
}

/** The pointer moving with no button held (SGR button 35). */
function hover(tm: TestModel, st: Station, id: string, dx?: number, dy = 0): void {
  const [x, y] = cellOf(st, id, dx, dy);
  tm.writeInput(`\x1b[<35;${x};${y}M`);
}

/** The visible text of a station's screen, one string per row. */
const screen = (st: Station) => stripAnsi(st.view().content).split('\n');

describe('the overview', () => {
  test('is a golden file at 120×34', async () => {
    const [tm, st] = open(new World(7), 'alice');
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'overview');
    expect(st.tab).toBe('overview');
  });

  test('a terminal that is too small gets a message instead', async () => {
    const [tm] = open(new World(7), 'alice', 90, 24);
    await WaitFor(tm.output(), has('needs at least 100×28'));
    tm.resize(W, H);
    await WaitFor(tm.output(), has('SERVICES'));
  });
});

describe('the keyboard', () => {
  test('↓ selects a service, tab zooms into its latency, w changes the window', async () => {
    const [tm, st] = open(new World(7), 'alice');
    await WaitFor(tm.output(), has('SERVICES'));
    tm.press('down');
    await WaitFor(tm.output(), has('search p95 ms'));
    tm.press('tab');
    await WaitFor(tm.output(), has('requests per second'));
    tm.press('w'); // 5 minutes to 15: the time axis starts at 14:00
    await WaitFor(tm.output(), has('14:00 14:01'));
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'latency-tab');
    expect([st.me.selected, st.tab, st.window]).toEqual([1, 'latency', 2]);
  });

  test('a acknowledges the alert of the selected service', async () => {
    const world = new World(7);
    const [tm, st] = open(world, 'alice');
    for (let i = 0; i < 14; i++) world.advance(); // the payments database slows down
    await WaitFor(tm.output(), has('payments p95'));
    st.me.selected = 2;
    tm.press('a');
    await WaitFor(tm.output(), has('alice acknowledged'));
    tm.press('q');
    expect(world.openAlert(2)?.ackedBy).toBe('alice');
  });
});

describe('the mouse', () => {
  test('clicks select rows, zoom panels and pick heatmap rows and bars', async () => {
    const [tm, st] = open(new World(7), 'alice');
    await WaitFor(tm.output(), has('SERVICES'));

    click(tm, st, 'svc:3', 4); // catalog's row
    await WaitFor(tm.output(), has('catalog p95 ms'));
    expect(st.me.selected).toBe(3);

    click(tm, st, 'heat', 12, 4); // the fifth row of the heatmap is auth
    await WaitFor(tm.output(), has('auth p95 ms'));
    expect(st.me.selected).toBe(4);

    click(tm, st, 'zoom:deploys');
    await WaitFor(tm.output(), has('latest'));
    expect(st.tab).toBe('deploys');

    // The bar chart marks its own zone and tells which bar a cell belongs to.
    // Zoomed, the bars have a gap between them: row 2 is the second bar, search.
    click(tm, st, st.barsZone(), 14, 2);
    await tm.settle();
    expect(st.me.selected).toBe(1);

    click(tm, st, 'zoom:deploys'); // the same button now says back
    await WaitFor(tm.output(), has('LATENCY'));
    tm.press('q');
    RequireEqualOutput((await tm.finalOutput()).read(), 'mouse-back-to-overview');
    expect(st.tab).toBe('overview');
  });

  test('the wheel zooms the latency chart and scrolls the log', async () => {
    const [tm, st] = open(new World(7), 'alice');
    await WaitFor(tm.output(), has('SERVICES'));
    const [x, y] = cellOf(st, 'chart:latency', 20, 3);
    tm.writeInput(`\x1b[<64;${x};${y}M`); // wheel up: a shorter window
    await tm.settle();
    expect(st.window).toBe(0);
    const [lx, ly] = cellOf(st, 'log', 10, 4);
    tm.writeInput(`\x1b[<64;${lx};${ly}M\x1b[<64;${lx};${ly}M`);
    await WaitFor(tm.output(), has('4 newer below'));
    expect(st.logOffset).toBe(4);
    tm.press('q');
  });
});

describe('two people, one world', () => {
  test('a pointer, a selection and an acknowledgement travel between screens of different sizes', async () => {
    const world = new World(7);
    const [alice, a] = open(world, 'alice', W, H);
    const [bob, b] = open(world, 'bob', 100, 28);
    for (let i = 0; i < 14; i++) world.advance();
    await WaitFor(alice.output(), has('bob'));
    await WaitFor(bob.output(), has('ack'));

    // bob points at search's row in his window, six cells in, and clicks it
    hover(bob, b, 'svc:1', 6);
    click(bob, b, 'svc:1', 6);
    await bob.settle();
    expect(b.me.selected).toBe(1);

    // alice sees bob's pointer on search's row, six cells in, in her own layout
    await WaitFor(alice.output(), has('◆'));
    const row = a.zm.get('svc:1');
    expect(screen(a)[row.startY].slice(row.startX + 6, row.startX + 11)).toBe('r bob');

    // bob acknowledges the payments alert; alice's alert list says so
    click(bob, b, `ack:${world.openAlert(2)!.id}`);
    await WaitFor(alice.output(), has('✓ bob'));
    alice.press('q');
    RequireEqualOutput((await alice.finalOutput()).read(), 'two-viewers');
    expect(world.openAlert(2)?.ackedBy).toBe('bob');
  });
});

describe('snapshots', () => {
  test('s writes the screen as an SVG (and a PNG when resvg is installed)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'station-'));
    try {
      const [tm, st] = open(new World(7), 'alice', W, H, dir);
      await WaitFor(tm.output(), has('SERVICES'));
      tm.press('s');
      // freeze draws the PNG at 4x, which takes about a second
      await WaitFor(tm.output(), has('wrote station-141500.svg'), WithDuration(5000));
      tm.press('q');
      const svg = readFileSync(join(dir, 'station-141500.svg'), 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('SERVICES');
      expect(st.snapshots[0]).toBe(join(dir, 'station-141500.svg'));
      if (st.snapshots[1]) expect([...readFileSync(st.snapshots[1]).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // PNG
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('over SSH, `snapshot` returns an SVG of the shared state', async () => {
    const world = new World(7);
    for (let i = 0; i < 14; i++) world.advance();
    const srv = newStationServer(world, { port: 0, hostKeyPath: join(tmpdir(), 'station-test-host-key') });
    const sess = await testsession.New(srv);
    const svg = (await sess.output('snapshot')).toString();
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/payments p95 \d+ms &gt; 400/);

    const other = await testsession.New(srv);
    await expect(other.output('reboot')).rejects.toThrow('status 2');
  });

  test('over SSH, a session with a terminal joins the shared world', async () => {
    const world = new World(7);
    const srv = newStationServer(world, { port: 0, hostKeyPath: join(tmpdir(), 'station-test-host-key') });
    const sess = await testsession.New(srv, { username: 'carol' });
    sess.requestPty('xterm-256color', H, W);
    const ch = await sess.start('');
    const seen: Buffer[] = [];
    ch.on('data', (d: Buffer) => seen.push(d));
    const deadline = Date.now() + 5000;
    while (!stripAnsi(Buffer.concat(seen).toString()).includes('carol (you)') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect([...world.viewers.values()].map((v) => v.name)).toEqual(['carol']);
    ch.write('q');
    while (world.viewers.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(world.viewers.size).toBe(0);
  });
});

describe('the world', () => {
  test('a seed always gives the same history', () => {
    const one = new World(7);
    const two = new World(7);
    for (let i = 0; i < 60; i++) [one, two].forEach((w) => w.advance());
    expect(one.log.map((l) => l.text)).toEqual(two.log.map((l) => l.text));
    expect(one.alerts.map((a) => [a.service, a.kind, a.opened, a.resolved])).toEqual(two.alerts.map((a) => [a.service, a.kind, a.opened, a.resolved]));
  });
});
