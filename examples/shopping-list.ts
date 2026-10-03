/**
 * Shopping List — a port of the Bubble Tea basics tutorial
 * (charmbracelet/bubbletea/tutorials/basics).
 *
 * Run:  bun examples/shopping-list.ts
 */

import { type Msg, type Cmd, type Model, Program, KeyPressMsg, Quit } from '../src/index.js';

const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const pink = (s: string) => `\x1b[38;2;245;194;231m${s}\x1b[39m`;
const faint = (s: string) => `\x1b[2m${s}\x1b[22m`;

class ShoppingList implements Model {
  constructor(
    readonly choices: string[] = ['Buy carrots', 'Buy celery', 'Buy kohlrabi'],
    readonly cursor = 0,
    readonly selected: ReadonlySet<number> = new Set(),
  ) {}

  init(): Cmd {
    return null;
  }

  update(msg: Msg): [Model, Cmd] {
    if (!(msg instanceof KeyPressMsg)) return [this, null];

    switch (msg.toString()) {
      case 'ctrl+c':
      case 'q':
        return [this, Quit];
      case 'up':
      case 'k':
        return [new ShoppingList(this.choices, Math.max(0, this.cursor - 1), this.selected), null];
      case 'down':
      case 'j':
        return [new ShoppingList(this.choices, Math.min(this.choices.length - 1, this.cursor + 1), this.selected), null];
      case 'enter':
      case 'space': {
        const selected = new Set(this.selected);
        if (selected.has(this.cursor)) selected.delete(this.cursor);
        else selected.add(this.cursor);
        return [new ShoppingList(this.choices, this.cursor, selected), null];
      }
    }
    return [this, null];
  }

  view(): string {
    let s = bold('What should we buy at the market?') + '\n\n';
    this.choices.forEach((choice, i) => {
      const cursor = this.cursor === i ? pink('>') : ' ';
      const checked = this.selected.has(i) ? pink('x') : ' ';
      const label = this.cursor === i ? pink(choice) : choice;
      s += `${cursor} [${checked}] ${label}\n`;
    });
    return s + '\n' + faint('↑/↓ move • space select • q quit') + '\n';
  }
}

await new Program(new ShoppingList()).run();
