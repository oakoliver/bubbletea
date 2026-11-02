/**
 * Snapshots: a frame of the canary as a PNG, drawn by @oakoliver/freeze.
 *
 * freeze draws PNGs at 4x by default. With renderPNG, resvg rasterizes on the
 * calling thread, which for a 100×30 frame takes most of a second, and the
 * program can't draw, read keys or step the pipeline meanwhile. freeze 1.1's
 * renderPNGAsync rasterizes on a worker thread; only the PNG encoding of the
 * finished pixels stays on the main thread.
 *
 * Every snapshot measures how long the event loop was held up while it was
 * drawn (the longest gap between ticks of a 10 ms timer), so the difference is
 * on screen: run with --sync-snapshots to compare.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Cmd } from '@oakoliver/bubbletea';
import { renderPNG, renderPNGAsync } from '@oakoliver/freeze';

export interface Snapshot {
  file: string;
  bytes: number;
  ms: number;
  /** The longest the event loop went without running a 10 ms timer, while drawing. */
  longestGapMs: number;
  error?: string;
}

export class SnapshotDone {
  readonly _tag = 'SnapshotDone';
  readonly snapshot: Snapshot;
  constructor(snapshot: Snapshot) {
    this.snapshot = snapshot;
  }
}

const options = (frame: string) => ({
  code: frame,
  language: 'ansi', // terminal output: the escape sequences are the colours
  config: 'full', // window controls, rounded corners, a shadow
  background: '#1E1E2E',
});

/** Watches the event loop: the longest time between two ticks of a 10 ms timer. */
export function watchEventLoop(): () => number {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  return () => {
    clearInterval(timer);
    longest = Math.max(longest, performance.now() - last);
    return Math.round(longest);
  };
}

/** Draws a frame as a 4x PNG and measures what it cost the event loop. */
export async function drawPNG(frame: string, sync = false): Promise<{ png: Uint8Array; ms: number; longestGapMs: number }> {
  const stop = watchEventLoop();
  await new Promise((r) => setTimeout(r, 20)); // let the watcher take a first tick
  const t0 = performance.now();
  const png = sync ? renderPNG(options(frame)) : await renderPNGAsync(options(frame));
  const ms = Math.round(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 20)); // and a tick after the drawing
  return { png, ms, longestGapMs: stop() };
}

/** A command that writes the frame to dir/file and reports back with SnapshotDone. */
export function snapshotCmd(frame: string, dir: string, file: string, sync: boolean): Cmd {
  return async () => {
    try {
      const { png, ms, longestGapMs } = await drawPNG(frame, sync);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), png);
      return new SnapshotDone({ file, bytes: png.length, ms, longestGapMs });
    } catch (e) {
      return new SnapshotDone({ file, bytes: 0, ms: 0, longestGapMs: 0, error: (e as Error).message });
    }
  };
}
