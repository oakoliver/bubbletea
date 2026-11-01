/**
 * Snapshots with @oakoliver/freeze: a frame of the station (a string with ANSI
 * colours, after bubblezone has taken its markers out) becomes an SVG in a
 * window, and a PNG when the optional @resvg/resvg-js binding is installed.
 *
 * Measured on a 120×34 frame (Apple M5 Max, Bun 1.4): the SVG takes about
 * 11 ms; a PNG at freeze's default 4x scale about 1.2 s, at 1x about 0.3 s.
 * resvg runs synchronously, so a PNG holds up the event loop for that long:
 * fine for the one person who pressed `s`, not for a server shared by many,
 * which is why the SSH `snapshot` command draws PNGs at 1x.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FreezeOptions, hasResvg, render, renderPNG, renderSVG } from '@oakoliver/freeze';

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

/** PNG bytes, or null without @resvg/resvg-js. `scale` 4 is freeze's default; 1 is four times faster. */
export function snapshotPNG(frame: string, scale: 1 | 4 = 1): Uint8Array | null {
  if (!hasResvg()) return null;
  if (scale === 4) return renderPNG(options(frame));
  // A fixed size is drawn at 1x: ask for the image's own size.
  const { width, height } = render(options(frame));
  return renderPNG({ ...options(frame), width: Math.ceil(width), height: Math.ceil(height) });
}

/** Writes station-HHMMSS.svg (and .png) into `dir`; returns the file names and how long it took. */
export function writeSnapshot(frame: string, dir: string, stamp: string): { files: string[]; ms: number } {
  const started = performance.now();
  mkdirSync(dir, { recursive: true });
  const files = [join(dir, `station-${stamp}.svg`)];
  writeFileSync(files[0], snapshotSVG(frame));
  const png = snapshotPNG(frame, 4);
  if (png) {
    files.push(join(dir, `station-${stamp}.png`));
    writeFileSync(files[1], png);
  }
  return { files, ms: Math.round(performance.now() - started) };
}
