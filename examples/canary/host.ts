/**
 * host — runs a program in a pseudo-terminal and shows its Program Status
 * Protocol (OSC 7501) reports in a status line under it, the way a terminal
 * that supports the protocol shows them in a tab or a sidebar.
 *
 * It does what such a terminal does, and nothing more:
 *
 * - it answers the support query (OSC 7501 ; ?) so the program knows its
 *   reports are read;
 * - it consumes every OSC 7501 sequence instead of passing it on, decodes it
 *   (the title and message are base64) and keeps one record per id;
 * - it draws the root record on the last row, which the program never sees:
 *   its pseudo-terminal is one row shorter than this one.
 *
 * Bun only: it uses the `terminal` option of Bun.spawn (tested with Bun 1.4.4).
 *
 *   bun examples/canary/host.ts                      runs the canary (main.ts) under the host
 *   bun examples/canary/host.ts --faulty             flags it doesn't know go to main.ts
 *   bun examples/canary/host.ts --log reports.jsonl  also writes every report, decoded, to a file
 *   bun examples/canary/host.ts --cmd bun examples/program-status.ts   any other program
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OscFilter, parseReport, type StatusRecord, statusLine } from './protocol.ts';

// The part of Bun's API used here, typed so the example needs no @types/bun.
interface PseudoTerminal {
  write(data: string | Uint8Array): number;
  resize(cols: number, rows: number): void;
  close(): void;
}
interface BunSpawn {
  spawn(
    cmd: string[],
    opts: { env: NodeJS.ProcessEnv; terminal: { cols: number; rows: number; data(t: PseudoTerminal, d: Uint8Array): void } },
  ): { terminal: PseudoTerminal; exited: Promise<number> };
}

async function main(): Promise<void> {
  const Bun = (globalThis as { Bun?: BunSpawn }).Bun;
  if (!Bun) {
    console.error('host.ts needs Bun: it runs the program in a pseudo-terminal with Bun.spawn');
    process.exit(2);
  }
  const argv = process.argv.slice(2);
  let log: string | null = null;
  let cmd: string[] | null = null;
  const passed: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--log') log = argv[++i] ?? null;
    else if (argv[i] === '--cmd') {
      cmd = argv.slice(i + 1);
      break;
    } else if (argv[i] !== '--') passed.push(argv[i]!); // the rest is for main.ts
  }
  cmd ??= [process.execPath, join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), ...passed];
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('host needs a terminal');
    process.exit(2);
  }
  if (log) writeFileSync(log, '');

  const records = new Map<string, StatusRecord>();
  let reports = 0;
  const size = () => [process.stdout.columns, process.stdout.rows] as const;
  const [cols, rows] = size();

  const drawStatus = () => {
    const [c, r] = size();
    // Save the cursor, draw on the last row, restore: the program never knows.
    process.stdout.write(`\x1b7\x1b[${r};1H${statusLine(records.get(''), reports, c)}\x1b8`);
  };

  const decoder = new TextDecoder();
  // Called with each OSC 7501 payload; the program's other output goes to the screen.
  const filter = new OscFilter((payload) => {
    if (payload.startsWith('?')) {
      proc.terminal.write('\x1b]7501;?\x1b\\'); // the support reply
      return;
    }
    const rec = parseReport(payload);
    if (!rec) return;
    reports++;
    if (log) appendFileSync(log, `${JSON.stringify(rec)}\n`);
    if (rec.state === 'clear') {
      for (const id of [...records.keys()]) if (rec.id === '' || id === rec.id || id.startsWith(`${rec.id}/`)) records.delete(id);
    } else records.set(rec.id, rec);
  });

  const proc = Bun.spawn(cmd, {
    env: process.env,
    terminal: {
      cols,
      rows: rows - 1,
      data(_term, data) {
        const out = filter.write(decoder.decode(data, { stream: true }));
        if (out) process.stdout.write(out);
        if (filter.ground) drawStatus();
      },
    },
  });

  process.stdin.setRawMode(true);
  process.stdin.on('data', (d) => proc.terminal.write(d));
  process.stdout.on('resize', () => {
    const [c, r] = size();
    proc.terminal.resize(c, r - 1);
    drawStatus();
  });
  drawStatus();

  const code = await proc.exited;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  // Clear the status row and leave the last record in the scrollback.
  process.stdout.write(`\x1b7\x1b[${size()[1]};1H\x1b[2K\x1b8`);
  const last = records.get('');
  if (last) process.stdout.write(`${statusLine(last, reports, size()[0])}\n`);
  proc.terminal.close();
  process.exit(code);
}

await main();
