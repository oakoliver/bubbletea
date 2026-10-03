/**
 * Keys — shows how KeyPressMsg describes each key press: its string form,
 * printable text, and modifiers. Press esc or ctrl+c to quit.
 *
 * Run:  bun examples/keys.ts
 */

import { type Msg, type Cmd, type Model, Program, KeyMod, KeyPressMsg, Quit } from '../src/index.js';

const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const blue = (s: string) => `\x1b[38;2;137;180;250m${s}\x1b[39m`;
const faint = (s: string) => `\x1b[2m${s}\x1b[22m`;

function mods(mod: KeyMod): string {
  const names: string[] = [];
  if (mod & KeyMod.Ctrl) names.push('Ctrl');
  if (mod & KeyMod.Alt) names.push('Alt');
  if (mod & KeyMod.Shift) names.push('Shift');
  return names.join('+') || '-';
}

class Keys implements Model {
  constructor(readonly rows: string[] = []) {}

  init(): Cmd {
    return null;
  }

  update(msg: Msg): [Model, Cmd] {
    if (!(msg instanceof KeyPressMsg)) return [this, null];
    const key = msg.toString();
    if (key === 'esc' || key === 'ctrl+c') return [this, Quit];
    const text = msg.text ? JSON.stringify(msg.text) : '-';
    const row = `${blue(key.padEnd(16))}${text.padEnd(8)}${mods(msg.mod)}`;
    return [new Keys([...this.rows, row].slice(-8)), null];
  }

  view(): string {
    const header = bold('msg.toString()'.padEnd(16) + 'text'.padEnd(8) + 'mod');
    const body = this.rows.length ? this.rows.join('\n') : faint('press some keys…');
    return `${header}\n${body}\n\n${faint('esc to quit')}\n`;
  }
}

await new Program(new Keys()).run();
