/**
 * Window Size — a full-screen program in the alternate screen. The frame
 * fills the terminal using the size from WindowSizeMsg, and a Tick
 * command keeps a clock running. Press q to quit.
 *
 * Run:  bun examples/window-size.ts
 */

import {
  type Msg,
  type Cmd,
  type Model,
  Program,
  KeyPressMsg,
  Quit,
  Tick,
  WindowSizeMsg,
  WithAltScreen,
} from '../src/index.js';

class TickMsg {
  constructor(readonly time: Date) {}
}

const tick: Cmd = Tick(1000, (t) => new TickMsg(t));
const mauve = (s: string) => `\x1b[38;2;203;166;247m${s}\x1b[39m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const faint = (s: string) => `\x1b[2m${s}\x1b[22m`;

function center(text: string, visible: number, width: number): string {
  const left = Math.max(0, Math.floor((width - visible) / 2));
  return ' '.repeat(left) + text + ' '.repeat(Math.max(0, width - visible - left));
}

class Fullscreen implements Model {
  constructor(readonly width = 0, readonly height = 0, readonly time = new Date()) {}

  init(): Cmd {
    return tick;
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof KeyPressMsg && (msg.toString() === 'q' || msg.toString() === 'ctrl+c')) {
      return [this, Quit];
    }
    if (msg instanceof WindowSizeMsg) return [new Fullscreen(msg.width, msg.height, this.time), null];
    if (msg instanceof TickMsg) return [new Fullscreen(this.width, this.height, msg.time), tick];
    return [this, null];
  }

  view(): string {
    if (!this.width || !this.height) return '';
    const inner = this.width - 2;
    const lines = [
      bold('Alt screen'),
      `WindowSizeMsg: ${this.width} × ${this.height}`,
      this.time.toLocaleTimeString('en-GB'),
      faint('q to quit'),
    ];
    const visible = [10, `WindowSizeMsg: ${this.width} × ${this.height}`.length, 8, 9];
    const top = Math.max(0, Math.floor((this.height - 2 - lines.length) / 2));
    const rows: string[] = [];
    for (let y = 0; y < this.height - 2; y++) {
      const i = y - top;
      const content = i >= 0 && i < lines.length ? center(lines[i], visible[i], inner) : ' '.repeat(inner);
      rows.push(mauve('│') + content + mauve('│'));
    }
    return [mauve('╭' + '─'.repeat(inner) + '╮'), ...rows, mauve('╰' + '─'.repeat(inner) + '╯')].join('\n');
  }
}

await new Program(new Fullscreen(), WithAltScreen()).run();
