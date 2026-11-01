/**
 * Snapshots with @oakoliver/freeze: a frame of the station (a string with ANSI
 * colours, after bubblezone has taken its markers out) becomes an SVG in a
 * window, and a PNG when the optional @resvg/resvg-js binding is installed.
 *
 * Measured on a 120×34 frame (Apple M5 Max, Bun 1.4.4, medians): the SVG
 * takes about 7 ms; a PNG at freeze's default 4x scale about 1.2 s, at 1x
 * about 0.28 s. The synchronous renderPNG holds up the event loop for that
 * long, which is fine for the one person who pressed `s` in their own
 * terminal. A server shared by many uses snapshotPNGAsync (freeze 1.1's
 * renderPNGAsync): resvg draws on a worker thread and only the PNG encoding
 * of the finished pixels (about 150 ms at 4x) runs on the main thread.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FreezeOptions, hasResvg, render, renderPNG, renderPNGAsync, renderSVG } from '@oakoliver/freeze';

const options = (frame: string): FreezeOptions => ({
  code: frame,
  language: 'ansi', // terminal output: the escape sequences are the colours
  config: 'full', // window controls, rounded corners, a shadow
  background: '#1E1E2E', // Catppuccin Mocha's base, like the station
  font: { size: 14 },
});

export function snapshotSVG(frame: string): string {
  return renderSVG(options(frame));
}

/** The options for a PNG at `scale`: 4 is freeze's default; 1 is a fixed size, which freeze draws at 1x. */
function pngOptions(frame: string, scale: 1 | 4): FreezeOptions {
  if (scale === 4) return options(frame);
  // A fixed size is drawn at 1x: ask for the image's own size.
  const { width, height } = render(options(frame));
  return { ...options(frame), width: Math.ceil(width), height: Math.ceil(height) };
}

/** PNG bytes, drawn synchronously (blocks the event loop), or null without @resvg/resvg-js. */
export function snapshotPNG(frame: string, scale: 1 | 4 = 4): Uint8Array | null {
  if (!hasResvg()) return null;
  return renderPNG(pngOptions(frame, scale));
}

/** PNG bytes without blocking the event loop, or null without @resvg/resvg-js. Safe in a server. */
export async function snapshotPNGAsync(frame: string, scale: 1 | 4 = 4): Promise<Uint8Array | null> {
  if (!hasResvg()) return null;
  return renderPNGAsync(pngOptions(frame, scale));
}

/** Writes station-HHMMSS.svg (and .png) into `dir`; returns the file names and how long it took. */
export function writeSnapshot(frame: string, dir: string, stamp: string): { files: string[]; ms: number } {
  const started = performance.now();
  mkdirSync(dir, { recursive: true });
  const files = [join(dir, `station-${stamp}.svg`)];
  writeFileSync(files[0], snapshotSVG(frame));
  const png = snapshotPNG(frame);
  if (png) {
    files.push(join(dir, `station-${stamp}.png`));
    writeFileSync(files[1], png);
  }
  return { files, ms: Math.round(performance.now() - started) };
}
