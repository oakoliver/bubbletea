/**
 * How long a 4x PNG of the canary's screen takes with freeze's renderPNG and
 * renderPNGAsync, and how long the event loop goes without running a 10 ms timer
 * meanwhile. Medians of 7 runs each, after one warm-up.
 *
 *   bun examples/canary/bench-snapshot.ts
 */
import { WindowSizeMsg } from '@oakoliver/bubbletea';
import { Canary } from './canary.ts';
import { Pipeline } from './pipeline.ts';
import { drawPNG } from './snapshot.ts';

const p = new Pipeline({ seed: 7 });
while (p.current < 4) p.step();
const c = new Canary(p);
c.update(new WindowSizeMsg(100, 30));
const frame = c.frame();

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
for (const sync of [true, false]) {
  await drawPNG(frame, sync); // warm-up
  const runs = [];
  for (let i = 0; i < 7; i++) runs.push(await drawPNG(frame, sync));
  const ms = runs.map((r) => r.ms);
  const gap = runs.map((r) => r.longestGapMs);
  console.log(
    `${sync ? 'renderPNG     ' : 'renderPNGAsync'}  ${median(ms)} ms (${Math.min(...ms)}–${Math.max(...ms)})` +
      `  longest event-loop gap ${median(gap)} ms (${Math.min(...gap)}–${Math.max(...gap)})  ${runs[0]!.png.length} bytes`,
  );
}
