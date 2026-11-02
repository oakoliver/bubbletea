/**
 * Tests of the canary with @oakoliver/teatest 1.1: real keys, real mouse
 * reports, raw input a terminal would send, and the OSC 7501 reports the
 * program writes. Every check comes right after `await tm.settle()`, which
 * resolves once the program has handled everything sent so far and written the
 * frame for it, so no test waits on a timer. The pipeline only moves when a
 * test steps it.
 *
 *   bun test ./examples/canary/canary.test.ts
 *   UPDATE_GOLDEN=1 bun test ./examples/canary/canary.test.ts   after a change you want
 */
import { afterEach, expect, test } from 'bun:test';
import { ColorProfile, WithColorProfile } from '@oakoliver/bubbletea';
import { hasResvg } from '@oakoliver/freeze';
import { stripAnsi } from '@oakoliver/lipgloss';
import { NewTestModel, RequireEqualOutput, type TestModel, WithInitialTermSize, WithProgramOptions } from '@oakoliver/teatest';
import { Canary, PipelineChanged, Z } from './canary.ts';
import { OscFilter, parseReport, type StatusRecord } from './protocol.ts';
import { GATE, Pipeline, STAGES } from './pipeline.ts';
import { drawPNG } from './snapshot.ts';

const running: TestModel[] = [];
afterEach(() => {
  for (const tm of running.splice(0)) tm.quit();
});

function open(p: Pipeline, ...opts: Parameters<typeof WithProgramOptions>): [TestModel, Canary] {
  const c = new Canary(p, { user: 'ana', snapshotDir: null });
  const tm = NewTestModel(c, WithInitialTermSize(100, 30), WithProgramOptions(...opts));
  p.subscribe(() => tm.send(new PipelineChanged()));
  running.push(tm);
  return [tm, c];
}

function stepTo(p: Pipeline, stage: number): void {
  while (p.current < stage && p.phase === 'running') p.step();
}

/** The screen text written so far (the whole output, without escape sequences). */
const screen = (tm: TestModel) => stripAnsi(tm.output().all().toString());

/** Every OSC 7501 report in the output, decoded the way host.ts decodes them. */
function reports(tm: TestModel): StatusRecord[] {
  const out: StatusRecord[] = [];
  new OscFilter((payload) => {
    const r = parseReport(payload);
    if (r) out.push(r);
  }).write(tm.output().all().toString());
  return out;
}

/** A left click as a terminal sends it (SGR mouse, 1-based), `dx`,`dy` cells into a zone. */
function click(tm: TestModel, c: Canary, id: string, dx = 0, dy = 0): void {
  const z = c.zm.get(id);
  const [x, y] = [z.startX + dx + 1, z.startY + dy + 1];
  tm.writeInput(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
}

test('reports working, blocked and done with OSC 7501', async () => {
  const p = new Pipeline({ seed: 7 });
  const [tm] = open(p);
  stepTo(p, 3);
  await tm.settle();
  expect(reports(tm).at(-1)).toMatchObject({ state: 'working', app: 'canary', title: 'checkout 2.14.0', progress: p.progress() });
  expect(tm.output().all().toString()).toContain('\x1b]7501;state=working:progress=');

  stepTo(p, GATE);
  await tm.settle();
  const blocked = reports(tm).at(-1)!;
  expect(blocked).toMatchObject({ state: 'blocked', kind: 'permission', progress: 83 });
  expect(blocked.message).toStartWith('promote checkout 2.14.0 to 100%? canary 25%: errors');

  tm.press('enter', 'enter', 'enter'); // Promote, keep the ticket, keep the notes
  await tm.settle();
  for (let i = 0; i < 30; i++) p.step();
  await tm.settle();
  expect(p.phase).toBe('live');
  expect(reports(tm).at(-1)).toMatchObject({ state: 'done', message: 'checkout 2.14.0 is serving 100% of the traffic' });
  // The renderer writes a report only when the status changes: one per step here, not one per frame.
  expect(reports(tm).length).toBeLessThan(120);
});

test('a faulty release is rolled back and reported as an error', async () => {
  const p = new Pipeline({ seed: 7, faulty: true });
  const [tm] = open(p);
  for (let i = 0; i < 200 && p.phase === 'running'; i++) p.step();
  await tm.settle();
  expect(p.phase).toBe('rolled-back');
  expect(reports(tm).at(-1)).toMatchObject({ state: 'error', message: p.outcome });
  expect(screen(tm)).toContain('ROLLED BACK');
});

test('the terminal answers the support query', async () => {
  const [tm, c] = open(new Pipeline());
  await tm.settle();
  expect(c.statusSupported).toBe(false);
  tm.writeInput('\x1b]7501;?\x1b\\'); // what host.ts answers
  await tm.settle();
  expect(c.statusSupported).toBe(true);
  expect(screen(tm)).toContain('terminal supports it');
});

test('the approval form is filled in before you reach its fields (huh 1.1.3)', async () => {
  const p = new Pipeline({ seed: 7 });
  stepTo(p, GATE);
  const summary = p.summary();
  const [tm] = open(p);
  await tm.settle();
  // The ticket and the notes are bound to values that are already set; they show
  // while the first field (the confirmation) has the focus.
  expect(screen(tm)).toContain('> CHG-4142');
  expect(screen(tm)).toContain('canary 25%: errors 0.43% (old 0.49%)');
  tm.press('enter', 'enter', 'enter');
  await tm.settle();
  // Passing through the fields kept them: they were not overwritten with empty strings.
  expect(p.approval).toEqual({ by: 'ana', ticket: 'CHG-4142', notes: summary });
});

test('clicking a bar selects its stage, through the chart’s fixed zone ID', async () => {
  const p = new Pipeline({ seed: 7 });
  stepTo(p, 4);
  const [tm, c] = open(p);
  await tm.settle();
  expect(c.zm.get(Z.stageTime).isZero()).toBe(false); // the ID we chose, not newPrefix()'s counter
  click(tm, c, Z.stageTime, 14, STAGES.findIndex((s) => s.name === 'test'));
  await tm.settle();
  expect(c.shown()).toBe(1);
  expect(stripAnsi(tm.output().read().toString())).toContain('TEST · error rate');

  click(tm, c, Z.stage(3), 4); // the 'canary 5%' row
  await tm.settle();
  expect(c.shown()).toBe(3);
  click(tm, c, Z.metric, 20, 4); // the chart
  await tm.settle();
  expect(c.metric).toBe('p95');
  expect(stripAnsi(tm.output().read().toString())).toContain('CANARY 5% · p95 latency, ms');
});

test('the reused sparkline gets its scale back with resetMax()', async () => {
  const p = new Pipeline({ seed: 7 });
  stepTo(p, GATE);
  p.decide(true, 'ana', 'CHG-1', '');
  for (let i = 0; i < 30; i++) p.step();
  const [tm, c] = open(p);
  await tm.settle();
  tm.press('up', 'up', 'up'); // production → canary 5%
  await tm.settle();
  expect(c.shown()).toBe(3);
  // The sparkline is three rows high; its top row has blocks only if the scale fits
  // the 5% canary (about 120 req/s), not production's 2,400.
  const lines = stripAnsi(c.frame()).split('\n').map((l) => [...l].slice(34).join('')); // the right column
  const top = lines.findIndex((l) => l.includes('REQUESTS/S · canary 5%')) + 1;
  expect(lines[top]).toMatch(/[▁▂▃▄▅▆▇█]/);
});

test('a forged window size report is ignored (GHSA-qc58-pfg9-7pph)', async () => {
  const [tm, c] = open(new Pipeline());
  await tm.settle();
  tm.writeInput('\x1b[8;99999;99999t'); // anything that can write to the input could claim this
  await tm.settle();
  expect([c.width, c.height]).toEqual([100, 30]);
  tm.writeInput('\x1b[8;34;120t'); // a plausible report still counts
  await tm.settle();
  expect([c.width, c.height]).toEqual([120, 34]);
});

test('frames are written in the terminal’s colour profile', async () => {
  const sgr = async (profile: ColorProfile) => {
    const p = new Pipeline({ seed: 7 });
    stepTo(p, 4);
    const [tm] = open(p, WithColorProfile(profile));
    await tm.settle();
    const out = tm.output().all().toString();
    tm.quit();
    return {
      truecolor: /\x1b\[[0-9;]*38;2;/.test(out),
      c256: /\x1b\[[0-9;]*38;5;/.test(out),
      c16: /\x1b\[[0-9;]*(3[0-7]|9[0-7])m/.test(out),
      bold: /\x1b\[;?1m/.test(out),
      text: stripAnsi(out).includes('CANARY 25%'),
    };
  };
  expect(await sgr(ColorProfile.TrueColor)).toMatchObject({ truecolor: true, text: true });
  expect(await sgr(ColorProfile.ANSI256)).toMatchObject({ truecolor: false, c256: true, text: true });
  expect(await sgr(ColorProfile.ANSI)).toMatchObject({ truecolor: false, c256: false, c16: true, text: true });
  expect(await sgr(ColorProfile.Ascii)).toMatchObject({ truecolor: false, c256: false, c16: false, bold: true, text: true });
  expect(await sgr(ColorProfile.NoTTY)).toMatchObject({ truecolor: false, c256: false, c16: false, bold: false, text: true });
});

test('the screen in the 25% canary', async () => {
  const p = new Pipeline({ seed: 7 });
  stepTo(p, 4);
  for (let i = 0; i < 12; i++) p.step();
  const [tm] = open(p);
  await tm.settle();
  tm.press('q');
  RequireEqualOutput((await tm.finalOutput()).read(), 'canary-25');
});

test.skipIf(!hasResvg())('a 4x snapshot is drawn off the event loop', async () => {
  const p = new Pipeline({ seed: 7 });
  stepTo(p, 4);
  const { png, ms, longestGapMs } = await drawPNG(new Canary(p).frame());
  expect(Buffer.from(png.subarray(1, 4)).toString()).toBe('PNG');
  // resvg draws on a worker thread; only the PNG encoding blocks, and it is a fraction of it.
  expect(longestGapMs).toBeLessThan(ms);
}, 20_000);

test('the host consumes OSC 7501 and passes everything else on', () => {
  const seen: string[] = [];
  const f = new OscFilter((payload) => seen.push(payload));
  // split across chunks, as a pseudo-terminal may deliver it
  const a = f.write('\x1b[1mhi\x1b]7501;state=wor');
  expect(f.ground).toBe(false);
  const b = f.write('king:app=x\x07\x1b]0;title\x1b\\ there');
  expect(a + b).toBe('\x1b[1mhi\x1b]0;title\x1b\\ there');
  expect(seen).toEqual(['state=working:app=x']);
  expect(parseReport(`state=blocked:kind=permission:msg=${Buffer.from('ok?').toString('base64')}`)).toEqual({ id: '', state: 'blocked', kind: 'permission', message: 'ok?' });
  expect(parseReport('?')).toBeNull();
});
