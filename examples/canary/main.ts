/**
 * canary — watch an (invented) release go from build to production, approve it
 * at the gate, and let your terminal know what it is doing.
 *
 * It combines what landed in today's releases of the TypeScript Charm ports:
 *
 *   @oakoliver/bubbletea 1.4  OSC 7501 program status; frames in the terminal's colour profile
 *   @oakoliver/huh 1.1.3      the approval form, with bound values filled in from the start
 *   @oakoliver/ntcharts 1.1   fixed zone IDs (WithZoneID) and a reused sparkline (resetMax)
 *   @oakoliver/freeze 1.1     `s` draws a 4x PNG with renderPNGAsync; the program keeps running
 *   @oakoliver/teatest 1.1    canary.test.ts, with settle()
 *
 * THE RELEASE IS INVENTED: a seeded PRNG makes every number, nothing is built
 * or deployed, nothing is read from this machine or the network.
 *
 * Usage:
 *   bun examples/canary/main.ts                 run it in this terminal
 *   bun examples/canary/host.ts                 run it under a host that shows its OSC 7501 reports
 *
 * Flags: --seed N (7) · --faulty (the new version fails in the 25% canary and is
 * rolled back) · --speed MS (250: one step of five pipeline seconds every MS)
 * · --out DIR (where `s` writes, default .) · --sync-snapshots (draw with the
 * blocking renderPNG, to compare) · --user NAME (who approves, default $USER)
 * · --start N (begin N steps in; with --faulty, 200 shows the rollback).
 *
 * Keys: ↑/↓ stage · esc follow the running stage · m error rate / p95 · space
 * pause · s snapshot · q quit. At the gate: ←/→ promote or roll back, tab to
 * the ticket and notes, enter to submit. Mouse: click a stage, a bar, or the chart.
 */
import { userInfo } from 'node:os';
import { NewProgram } from '@oakoliver/bubbletea';
import { Canary, PipelineChanged } from './canary.ts';
import { Pipeline } from './pipeline.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const pipeline = new Pipeline({ seed: Number(value('seed', '7')), faulty: flag('faulty') });
for (let i = Number(value('start', '0')); i > 0 && pipeline.phase === 'running'; i--) pipeline.step();
const canary = new Canary(pipeline, {
  user: value('user', process.env.USER ?? userInfo().username),
  snapshotDir: value('out', '.'),
  syncSnapshots: flag('sync-snapshots'),
});
const program = NewProgram(canary);
pipeline.subscribe(() => program.send(new PipelineChanged()));
setInterval(() => pipeline.step(), Number(value('speed', '250'))).unref();

await program.run();
const s = canary.status();
console.log(`${s.state}: ${s.message}`);
process.exit(0);
