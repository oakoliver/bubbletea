/**
 * Countdown — commands in action: Tick drives the timer, Sequence prints a
 * line above the program with Println and then quits.
 *
 * Run:  bun examples/countdown.ts
 */

import { type Msg, type Cmd, type Model, Program, KeyPressMsg, Println, Quit, Sequence, Tick } from '../src/index.js';

class TickMsg {}

const tick: Cmd = Tick(1000, () => new TickMsg());
const green = (s: string) => `\x1b[38;2;166;227;161m${s}\x1b[39m`;
const faint = (s: string) => `\x1b[2m${s}\x1b[22m`;

class Countdown implements Model {
  constructor(readonly remaining = 5) {}

  init(): Cmd {
    return tick;
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof KeyPressMsg && (msg.toString() === 'q' || msg.toString() === 'ctrl+c')) {
      return [this, Quit];
    }
    if (msg instanceof TickMsg) {
      const next = new Countdown(this.remaining - 1);
      if (next.remaining > 0) return [next, Sequence(Println(faint(`tick… ${next.remaining} left`)), tick)];
      return [next, Sequence(Println(green('🚀 Liftoff!')), Quit)];
    }
    return [this, null];
  }

  view(): string {
    if (this.remaining <= 0) return '';
    const bar = '█'.repeat(this.remaining) + faint('░'.repeat(5 - this.remaining));
    return `Launching in ${this.remaining}s  ${bar}\n${faint('q to abort')}\n`;
  }
}

await new Program(new Countdown()).run();
