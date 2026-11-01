/**
 * station — an ops dashboard that several people can share over SSH. It
 * combines five TypeScript ports of Charm-ecosystem Go libraries with each
 * other and with Bubble Tea and Lip Gloss:
 *
 *   @oakoliver/ntcharts    latency, throughput, error and deploy charts
 *   @oakoliver/bubblezone  every click: tabs, rows, buttons, chart panels, bars
 *   @oakoliver/wish        --serve: one shared station for every SSH session
 *   @oakoliver/freeze      `s` (or `ssh ... snapshot`) saves the screen as SVG/PNG
 *   @oakoliver/teatest     station.test.ts: golden-file tests of the main flows
 *
 * THE DATA IS INVENTED. Six made-up services follow a seeded random walk with
 * a scripted incident every two minutes (a slow payments database, a bad search
 * release and its rollback). The header says SIMULATED. Nothing is read from
 * this machine or the network.
 *
 * Usage:
 *   bun examples/station/main.ts                  run it in this terminal
 *   bun examples/station/main.ts --serve          serve it on ssh://127.0.0.1:2323
 *   ssh -p 2323 alice@localhost                   join (any name; no password)
 *   ssh -p 2323 localhost snapshot > station.svg  an image of the current state
 *
 * Flags: --serve · --port N (2323) · --seed N (7) · --out DIR (where `s`
 * writes, default .) · --demo (a scripted mouse for recordings: locally, and
 * over SSH for the users alice and bob).
 *
 * Keys: ↑/↓ service · tab or 1-4 view · esc overview · a acknowledge the
 * selected service's alert · w latency window · space pause for everyone ·
 * s snapshot · pgup/pgdn log · q quit. Mouse: click tabs, rows, ack, zoom,
 * the heatmap's rows and the bars; the wheel scrolls the log and zooms the
 * latency chart.
 */
import { userInfo } from 'node:os';
import { NewProgram } from '@oakoliver/bubbletea';
import { ErrServerClosed, log } from '@oakoliver/wish';
import { Demo, SCRIPTS } from './demo.ts';
import { newStationServer } from './serve.ts';
import { Station, WorldChanged } from './station.ts';
import { World } from './world.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: bun examples/station/main.ts [--serve] [--port 2323] [--seed 7] [--out DIR] [--demo]');
  process.exit(0);
}
const SERVE = argv.includes('--serve');
const DEMO = argv.includes('--demo');
const port = Number(flag('--port', '2323'));
const seed = Number(flag('--seed', '7'));
const out = flag('--out', '.');
const PACE_MS = 800; // one step of station time (5 s) every 800 ms

const world = new World(seed);

// One clock for everyone. Over SSH it only runs while somebody is connected.
setInterval(() => {
  if (!world.paused && (!SERVE || world.viewers.size > 0)) world.advance();
}, PACE_MS).unref();

if (SERVE) {
  const server = newStationServer(world, { port, hostKeyPath: '.ssh/station_ed25519', demo: DEMO });
  const stop = async () => {
    await server.shutdown(AbortSignal.timeout(5000)).catch(() => server.close());
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  log.info('Station listening', 'address', `127.0.0.1:${port}`, 'join', `ssh -p ${port} you@localhost`, 'snapshot', `ssh -p ${port} localhost snapshot > station.svg`);
  server.listenAndServe().catch((err) => {
    if (err !== ErrServerClosed) {
      log.error('Could not start the server', 'error', err);
      process.exit(1);
    }
  });
} else {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('station needs an interactive terminal (or --serve).');
    process.exit(1);
  }
  const me = world.join(userInfo().username || 'you');
  const demo = DEMO ? new Demo(SCRIPTS.solo) : null;
  const station = new Station(world, me, { snapshotDir: out, overlay: demo ? (f) => demo.overlay(f) : undefined });
  const program = NewProgram(station);
  world.subscribe(() => program.send(new WorldChanged()));
  if (demo) void demo.run(station, program);
  await program.run();
  if (demo?.missed.length) console.error(`demo: not on screen: ${demo.missed.join(', ')}`);
  if (station.snapshots.length) console.log(`snapshots: ${station.snapshots.join(', ')}`);
  process.exit(0);
}
