/**
 * The station over SSH, with @oakoliver/wish. One process, one World, one
 * Bubble Tea program per session: everyone who connects sees the same
 * services, the same alerts and each other's pointers.
 *
 *   ssh -p 2323 alice@localhost                   the dashboard
 *   ssh -p 2323 localhost snapshot > station.svg  an image of it, no terminal needed
 *   ssh -p 2323 localhost snapshot png > station.png
 *   ssh -p 2323 localhost snapshot 160x44 > big.svg
 *
 * It listens on 127.0.0.1 and lets every client in: the user name is only a
 * name. Do not bind it to another address without adding authentication
 * (WithAuthorizedKeys, for example).
 */
import { NewProgram, type Program, WindowSizeMsg } from '@oakoliver/bubbletea';
import { type Middleware, NewServer, type Server, type Session, WithAddress, WithHostKeyPath, WithIdleTimeout, WithMiddleware, log, logging, ratelimiter } from '@oakoliver/wish';
import * as bubbletea from '@oakoliver/wish/bubbletea';
import { Demo, SCRIPTS } from './demo.ts';
import { snapshotPNGAsync, snapshotSVG } from './snapshot.ts';
import { MIN_H, MIN_W, Station, WorldChanged } from './station.ts';
import type { Viewer, World } from './world.ts';

export interface ServeOptions {
  port: number;
  hostKeyPath: string;
  /** Scripted pointers for the users called alice and bob (recordings). */
  demo?: boolean;
}

/** Removes escape sequences and control characters: a user name is shown to everyone. */
const clean = (s: string) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b./g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 12);

export function newStationServer(world: World, opts: ServeOptions): Server {
  const hint = `snapshots over SSH: ssh -p ${opts.port} localhost snapshot > station.svg`;

  // One Program per session, built here so that it can be kept: the World
  // tells every program when something changed.
  function programFor(s: Session): Program | null {
    const [pty, , ok] = s.pty();
    if (!ok) return null; // no terminal: the next handler answers
    const me = world.join(clean(s.user()) || 'anon');
    const demo = opts.demo && SCRIPTS[me.name] ? new Demo(SCRIPTS[me.name]) : null;
    const station = new Station(world, me, { snapshotDir: null, snapshotHint: hint, overlay: demo ? (f) => demo.overlay(f) : undefined });
    station.update(new WindowSizeMsg(pty.window.width, pty.window.height));
    const program = NewProgram(station, ...bubbletea.MakeOptions(s));
    const off = world.subscribe(() => program.send(new WorldChanged()));
    if (demo) void demo.run(station, program).then(() => demo.missed.length && log.warn('demo: not on screen', 'user', me.name, 'zones', demo.missed.join(',')));
    void program.wait().finally(() => {
      off();
      world.leave(me);
    });
    return program;
  }

  // `ssh host snapshot`: no terminal, no Bubble Tea. Renders the shared state
  // into an SVG (or PNG) and writes it to the client's stdout.
  const commands: Middleware = (next) => async (s) => {
    const [cmd, ...args] = s.command();
    if (cmd === undefined) return next(s);
    if (cmd !== 'snapshot') {
      s.stderr().write(`unknown command ${JSON.stringify(cmd)}; try: ssh -p ${opts.port} localhost snapshot > station.svg\n`);
      await s.exit(2);
      return;
    }
    if (s.pty()[2]) {
      s.stderr().write('snapshot writes an image: run it without -t, and redirect it to a file\n');
      await s.exit(2);
      return;
    }
    const png = args.includes('png');
    const size = args.find((a) => /^\d+x\d+$/.test(a));
    const [w, h] = size ? size.split('x').map(Number) : [120, 34];
    if (w < MIN_W || h < MIN_H || w > 300 || h > 100) {
      s.stderr().write(`size must be between ${MIN_W}x${MIN_H} and 300x100\n`);
      await s.exit(2);
      return;
    }
    const frame = snapshotFrame(world, w, h);
    // PNGs are drawn at freeze's normal 4x on a worker thread, so other sessions keep running.
    const bytes = png ? await snapshotPNGAsync(frame) : snapshotSVG(frame);
    if (!bytes) {
      s.stderr().write('PNG needs @resvg/resvg-js on the server; ask for an SVG instead\n');
      await s.exit(2);
      return;
    }
    s.write(bytes);
  };

  return NewServer(
    WithAddress(`127.0.0.1:${opts.port}`),
    WithHostKeyPath(opts.hostKeyPath),
    WithIdleTimeout(30 * 60_000),
    WithMiddleware(
      bubbletea.MiddlewareWithProgramHandler(programFor),
      commands,
      ratelimiter.Middleware(ratelimiter.NewRateLimiter(2, 10, 1000)),
      logging.Middleware(),
    ),
  );
}

/** The overview of the shared state at a given size, as a frame: what `snapshot` renders. */
export function snapshotFrame(world: World, width: number, height: number): string {
  // A viewer that is not in the World: it draws, but nobody sees its pointer.
  // It looks at the service with the newest alert that nobody has acknowledged yet.
  const alert = world.alertList().find((a) => a.resolved === null && !a.ackedBy);
  const watcher: Viewer = { id: 0, name: 'snapshot', color: '#CDD6F4', selected: alert?.service ?? 2, tab: 'overview', hover: null };
  const st = new Station(world, watcher, { snapshotDir: null });
  st.update(new WindowSizeMsg(width, height));
  return st.frame();
}
