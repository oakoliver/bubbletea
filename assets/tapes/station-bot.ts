/**
 * A second SSH user for the station recording: connects as bob with a
 * terminal and stays connected, so the GIF shows two people at once. Bob's
 * pointer is moved by the server's --demo script for the user bob (see
 * examples/station/demo.ts); this script only holds his session open.
 *
 *   BOT_DELAY=5000 bun assets/tapes/station-bot.ts
 */
import ssh2 from 'ssh2';
import { generateEd25519 } from '@oakoliver/wish';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(Number(process.env.BOT_DELAY ?? 5000));

const client = new ssh2.Client();
await new Promise<void>((resolve, reject) => {
  client.on('ready', () =>
    client.shell({ term: 'xterm-256color', cols: 120, rows: 34 }, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', () => {}); // read and drop what bob's screen shows
      resolve();
    }),
  );
  client.on('error', reject);
  client.connect({ host: '127.0.0.1', port: Number(process.env.PORT ?? 2323), username: 'bob', privateKey: generateEd25519().private, hostVerifier: () => true });
});
await sleep(Number(process.env.BOT_STAY ?? 40_000));
client.end();
process.exit(0);
