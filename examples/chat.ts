/**
 * Chat — a streaming coding-agent UI built with @oakoliver/bubbletea,
 * @oakoliver/bubbles, @oakoliver/glamour and @oakoliver/lipgloss. A scripted
 * assistant (no network, no API key) runs fake tools and streams Markdown
 * answers token by token, and the transcript is rendered the way OpenCode's
 * Bubble Tea TUI did it:
 *
 *   - every part (a prompt, a tool call, an answer) is rendered once, and the
 *     string is cached under a hash of everything that changes its output:
 *     id, text, width, tool-details flag and theme;
 *   - the part that is still streaming is never cached;
 *   - a burst of tokens is coalesced into one render per 16 ms tick;
 *   - the viewport follows the tail only while you are at the bottom; scroll
 *     up and new output arrives below without moving your view.
 *
 * Watch the header while an answer streams: "cache N hits" climbs on every
 * flush, because each flush finds all the finished parts in the cache.
 *
 * Usage:
 *   bun examples/chat.ts
 *
 * Ask about "why is my render slow", "a failing test" or "resizing", or say
 * "hello" for the key list. Anything else gets a default answer.
 *
 * Keys: enter send · alt+enter (or shift+enter, ctrl+j) new line ·
 *       tab / ctrl+o show or hide tool output · pgup/pgdn, alt+↑/↓ and the
 *       mouse wheel scroll · ctrl+end jump to the latest · ctrl+t theme ·
 *       esc or ctrl+c quit
 */
import { createHash } from 'node:crypto';
import {
  NewProgram, View, Quit, Batch, Tick, WindowSizeMsg, KeyPressMsg, InterruptMsg, MouseMode,
} from '../src/index.ts';
import type { Cmd, Msg, Program } from '../src/index.ts';
import {
  newStyle, thickBorder, joinVertical, place, Left, Center, stringWidth, stripAnsi, truncate, blend1D, colorToRGB, fgColor,
} from '@oakoliver/lipgloss';
import {
  newViewport, newTextarea, textareaDefaultDarkStyles, newSpinner, withSpinner, withSpinnerStyle, Dot,
  newHelp, newBinding, withKeys, withHelp,
} from '@oakoliver/bubbles';
import { TermRenderer, getDefaultStyle, withStyles, withWordWrap } from '@oakoliver/glamour';
import type { StyleConfig } from '@oakoliver/glamour';

// ── palette (Catppuccin Mocha) ─────────────────────────────────────────────
const C = {
  mauve: '#CBA6F7', pink: '#F5C2E7', blue: '#89B4FA', teal: '#94E2D5', green: '#A6E3A1',
  yellow: '#F9E2AF', peach: '#FAB387', red: '#F38BA8', text: '#CDD6F4', sub: '#A6ADC8',
  dim: '#6C7086', faint: '#45475A', base: '#11111B',
};

/** A theme is part of every cache key: changing it re-renders every part once. */
interface Theme { name: string; markdown: string; accent: string }
const THEMES: Theme[] = [
  { name: 'mocha', markdown: 'dark', accent: C.mauve },
  { name: 'dracula', markdown: 'dracula', accent: '#FF79C6' },
  { name: 'tokyo-night', markdown: 'tokyo-night', accent: '#7AA2F7' },
];

const MODEL = 'aurora-4.2';
const MIN_WIDTH = 60;
const MIN_HEIGHT = 16;
const FLUSH_MS = 16;

// ── the data: a transcript is a flat list of parts ─────────────────────────
interface TextPart { kind: 'text'; id: string; role: 'user' | 'assistant'; text: string; done: boolean }
interface ToolPart {
  kind: 'tool'; id: string; name: string; arg: string; done: boolean;
  ok: boolean; ms: number; summary: string; output: string[];
}
type Part = TextPart | ToolPart;

/** The fake agent server pushes these into the program with program.send(). */
class PartMsg { constructor(readonly part: Part) {} }
class FlushMsg {}
class TurnDoneMsg {}

// ── the scripted assistant ─────────────────────────────────────────────────
interface ToolScript { name: string; arg: string; ms: number; ok?: boolean; summary: string; output: string[] }
interface Script { match: RegExp; tools: ToolScript[]; answer: string }

const SCRIPTS: Script[] = [
  {
    match: /test|bug|fail|flaky|race|dirty|broken/i,
    tools: [
      {
        name: 'grep', arg: '"dirty" src', ms: 520, summary: '3 matches in 2 files',
        output: [
          'src/flush.ts:12:  let dirty = false;',
          'src/flush.ts:29:    dirty = false;',
          'src/flush.ts:31:    await render();',
          'src/chat.ts:77:  if (dirty) schedule();',
        ],
      },
      {
        name: 'read_file', arg: 'src/flush.ts', ms: 380, summary: '41 lines · 1.2 KB',
        output: [
          '26  async function flush() {',
          '27    running = true;',
          '28    await render();',
          '29    dirty = false;',
          '30    running = false;',
          '31  }',
        ],
      },
      {
        name: 'bun test', arg: 'flush', ms: 980, ok: false, summary: '12 pass · 1 fail',
        output: [
          '✓ flush > renders once per tick           [0.4ms]',
          '✓ flush > coalesces a burst of updates    [0.2ms]',
          '✗ flush > keeps an update that lands mid-render',
          '    expected render count 2, received 1',
          '✓ viewport > follows the tail             [0.3ms]',
          ' 12 pass',
          ' 1 fail',
        ],
      },
    ],
    answer: `The failing test points at \`flush()\`: it clears \`dirty\` **after** the render finished, so an update that lands while the render is running is thrown away.

\`\`\`diff
 async function flush() {
-  await render();
-  dirty = false;
+  dirty = false;
+  await render();
+  if (dirty) schedule();
 }
\`\`\`

Clearing the flag first means:

- an update during the render sets \`dirty\` again;
- when the render ends, exactly one more flush is scheduled;
- a burst of fifty updates still costs at most two renders.

| run | before | after |
|-----|--------|-------|
| flush tests | 12 pass, 1 fail | 13 pass |
| lost updates | 1 per burst | 0 |
`,
  },
  {
    match: /resiz|width|wrap|narrow|columns|terminal/i,
    tools: [
      {
        name: 'read_file', arg: 'src/layout.ts', ms: 450, summary: '58 lines · 1.7 KB',
        output: [
          '14  export function onResize(width: number, height: number) {',
          '15    cache.clear();            // the key contains the width',
          '16    viewport.setWidth(width);',
          '17    viewport.setHeight(height - CHROME);',
          '18    refresh();',
          '19  }',
        ],
      },
    ],
    answer: `Width changes the output of every part, so it has to be part of the cache key:

1. Markdown wraps at \`width - 2\`, so a new width re-wraps every answer.
2. Tool boxes and prompt bars are drawn to the full width.
3. The old width's strings are dead weight, so the cache is cleared too.

\`\`\`ts
if (msg instanceof WindowSizeMsg) {
  if (msg.width !== width) cache.clear();
  viewport.setWidth(msg.width);
  refresh();
}
\`\`\`

| terminal | wraps at | parts re-rendered |
|----------|----------|-------------------|
| 100 cols | 98 | all, once |
| 72 cols | 70 | all, once |
| same width | n/a | none |

Try it: drag the window edge and watch \`cache hits\` start climbing again after one flush.
`,
  },
  {
    match: /cache|render|stream|markdown|glamour|viewport|scroll|slow|fast|perf/i,
    tools: [
      {
        name: 'read_file', arg: 'src/renderer.ts', ms: 420, summary: '312 lines · 9.4 KB',
        output: [
          '86  export function render(parts: Part[], width: number) {',
          "87    return parts.map((p) => markdown(p.text, width)).join('\\n\\n');",
          '88  }',
          '89',
          '90  // called from update() for every token that arrives',
          '91  viewport.setContent(render(parts, width));',
        ],
      },
      {
        name: 'grep', arg: '"markdown(" src', ms: 560, summary: '4 matches in 3 files',
        output: [
          'src/renderer.ts:61:export function markdown(text: string, width: number) {',
          'src/renderer.ts:87:  return parts.map((p) => markdown(p.text, width)).join("\\n\\n");',
          'src/chat.ts:142:    const body = markdown(msg.text, this.width);',
          'src/preview.ts:27:  markdown(readme, 80)',
        ],
      },
    ],
    answer: `The slowdown is in \`render()\`: it runs the Markdown renderer over **every** part on **every** token, so one frame costs more as the conversation grows.

Three changes fix it:

1. Render each finished part once and keep the string.
2. Key the cache on everything that changes the output.
3. Coalesce a burst of tokens into one render per tick.

\`\`\`ts
const key = sha1([part.id, part.text, width, expanded, theme].join('\\0'));
const out = cache.get(key) ?? render(part, width);
\`\`\`

| part | cached | cost per flush |
|------|--------|----------------|
| finished | yes | one map lookup |
| streaming | no | one render |
| running tool | no | one box |

Watch \`cache hits\` in the header: it climbs on every flush while this answer streams.
`,
  },
  {
    match: /^\s*(hi|hello|hey|help|yo)\b|what can you|who are you|how do you work|keys/i,
    tools: [],
    answer: `Hi! I am a **scripted** agent: every answer is canned Markdown that I stream to you token by token. There is no network and no API key.

Ask me about:

- *why a streaming render is slow*
- *a failing test*
- *resizing the terminal*

\`\`\`sh
bun examples/chat.ts
\`\`\`

| key | what it does |
|-----|--------------|
| \`enter\` | send the prompt |
| \`alt+enter\` | new line |
| \`tab\` | show or hide tool output |
| \`pgup\` \`pgdn\` | scroll the transcript |
| \`ctrl+t\` | switch theme |
| \`esc\` | quit |
`,
  },
];

const DEFAULT_SCRIPT: Script = {
  match: /./,
  tools: [
    {
      name: 'list_dir', arg: '.', ms: 300, summary: '9 entries',
      output: ['src/', 'tests/', 'examples/', 'assets/', 'package.json', 'README.md', 'tsconfig.json'],
    },
    {
      name: 'read_file', arg: 'README.md', ms: 400, summary: '214 lines · 7.1 KB',
      output: ['1  # bubbletea', '2', '3  Elm Architecture TUI framework for TypeScript.', '4', '5  ## Install'],
    },
  ],
  answer: `I only have a few canned answers, so I can't really help with that one. Here is what I *can* show you:

- how a **streaming render** stays cheap
- why a **test fails** after a refactor
- what happens on **resize**

\`\`\`sh
# any of these will do
why is my streaming render slow?
fix the failing flush test
what happens when I resize?
\`\`\`

| topic | tools it runs |
|-------|---------------|
| render | read_file, grep |
| test | grep, read_file, bun test |
| resize | read_file |
`,
};

const WELCOME = `**oak-code** is a scripted coding agent: no network, no API key. It runs fake tools and streams canned Markdown, so you can watch the render path work.

Try asking:

- *why is my streaming render slow?*
- *fix the failing flush test*
- *what happens when I resize?*

\`tab\` shows tool output, \`pgup\` scrolls, \`esc\` quits.`;

// ── plumbing shared by the model and the fake agent ────────────────────────
let program: Program | null = null;
let stopped = false;
const send = (m: Msg) => { if (!stopped) program?.send(m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Timing jitter comes from a seeded generator, so a recording looks the same every run.
let seed = 0x9e3779b9;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Streams `text` in small, uneven chunks with uneven delays, like tokens from a model. */
async function streamText(id: string, text: string): Promise<void> {
  let sent = '';
  let i = 0;
  while (i < text.length && !stopped) {
    const size = 3 + Math.floor(rand() * 7);
    const chunk = text.slice(i, i + size);
    i += size;
    sent += chunk;
    send(new PartMsg({ kind: 'text', id, role: 'assistant', text: sent, done: false }));
    await sleep(12 + rand() * 28 + (chunk.includes('\n') ? 60 : 0));
  }
  send(new PartMsg({ kind: 'text', id, role: 'assistant', text: sent, done: true }));
}

async function runTurn(n: number, prompt: string): Promise<void> {
  const script = SCRIPTS.find((s) => s.match.test(prompt)) ?? DEFAULT_SCRIPT;
  await sleep(450);
  for (const [k, t] of script.tools.entries()) {
    const base = { kind: 'tool' as const, id: `t${n}.${k}`, name: t.name, arg: t.arg };
    send(new PartMsg({ ...base, done: false, ok: true, ms: 0, summary: '', output: [] }));
    const t0 = performance.now();
    await sleep(t.ms * (0.85 + rand() * 0.3));
    send(new PartMsg({ ...base, done: true, ok: t.ok ?? true, ms: performance.now() - t0, summary: t.summary, output: t.output }));
    await sleep(120);
  }
  if (script.tools.length) await sleep(250);
  await streamText(`a${n}`, script.answer);
  send(new TurnDoneMsg());
}

// ── rendering one part ─────────────────────────────────────────────────────
const st = () => newStyle();
const padRight = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const fmt = (n: number) => n.toLocaleString('en-US');
const clip = (s: string, w: number) => (stringWidth(s) > w ? truncate(s, Math.max(0, w - 1)) + '…' : s);
const sha1 = (...parts: unknown[]) => createHash('sha1').update(parts.join('\0')).digest('hex');

function gradientText(s: string, ...stops: string[]): string {
  const chars = [...s];
  const cols = blend1D(Math.max(2, chars.length), ...stops);
  return chars.map((ch, i) => {
    const c = colorToRGB(cols[i]!)!;
    return ch === ' ' ? ' ' : fgColor(c.r, c.g, c.b) + '\x1b[1m' + ch + '\x1b[0m';
  }).join('');
}

/**
 * Glamour pads every line to the wrap width, wraps every word in its own
 * "set colour ... reset" pair and adds blank lines around the document. Drop the
 * padding and the blank lines, and merge neighbouring runs of the same style, so
 * a frame carries a fraction of the escape codes.
 */
function trimMarkdown(s: string): string {
  const lines = s.split('\n').map((l) => {
    l = l.replace(/(?:\x1b\[[0-9;]*m {1}\x1b\[m| )+$/, '');
    for (let prev = ''; prev !== l; ) {
      prev = l;
      l = l.replace(/(\x1b\[[0-9;]+m)([^\x1b]*)\x1b\[m\1/g, '$1$2');
    }
    return l;
  });
  const blank = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, '').trim() === '';
  while (lines.length && blank(lines[0]!)) lines.shift();
  while (lines.length && blank(lines.at(-1)!)) lines.pop();
  return lines.join('\n');
}

/** Makes a half-written answer valid Markdown (closes a code fence, bold or code span) and adds the typing cursor. */
function healStreaming(md: string): string {
  let s = md;
  const lastLine = s.slice(s.lastIndexOf('\n') + 1);
  const fences = (s.match(/^ {0,3}```/gm) ?? []).length;
  if (fences % 2 === 0) {
    if ((lastLine.match(/\*\*/g) ?? []).length % 2 === 1) s += '**';
    if ((lastLine.match(/`/g) ?? []).length % 2 === 1) s += '`';
  }
  if (!lastLine.trimStart().startsWith('|') && !lastLine.trimStart().startsWith('```')) s += ' ▍';
  if (fences % 2 === 1) s += '\n```';
  return s;
}

/** Glamour's stock style for the theme; the mocha theme is retinted to match the rest of the UI. */
const styleCache = new Map<string, StyleConfig>();
function markdownStyle(theme: Theme): StyleConfig {
  let s = styleCache.get(theme.name);
  if (s) return s;
  s = structuredClone(getDefaultStyle(theme.markdown));
  if (theme.name === 'mocha') {
    s.document = { ...s.document, color: C.text };
    s.heading = { ...s.heading, color: C.blue };
    s.h1 = { prefix: '', suffix: '', color: C.mauve, bold: true };
    s.code = { ...s.code, color: C.peach, background_color: '#313244' };
    s.link_text = { ...s.link_text, color: C.teal };
  }
  styleCache.set(theme.name, s);
  return s;
}

function renderMarkdown(text: string, width: number, theme: Theme): string {
  const md = new TermRenderer(withStyles(markdownStyle(theme)), withWordWrap(width - 2));
  return trimMarkdown(md.render(text));
}

function renderUser(part: TextPart, width: number, theme: Theme): string {
  return st().border(thickBorder(), false, false, false, true).borderForeground(theme.accent)
    .paddingLeft(1).foreground(C.text).width(width - 2).render(part.text);
}

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`);

function colorOutput(line: string): string {
  if (line.startsWith('✓')) return st().foreground(C.green).render(line);
  if (line.startsWith('✗')) return st().foreground(C.red).render(line);
  if (/^\s*\d+ pass/.test(line)) return st().foreground(C.green).render(line);
  if (/^\s*\d+ fail/.test(line)) return st().foreground(C.red).render(line);
  return st().foreground(C.sub).render(line);
}

/** A rounded box with a title set into the top border; a tool call is one of these. */
function renderTool(part: ToolPart, width: number, expanded: boolean, spinner: string): string {
  const boxW = width - 4; // 2 columns of margin on each side, like the Markdown
  const color = !part.done ? C.yellow : part.ok ? C.green : C.red;
  const icon = !part.done ? stripAnsi(spinner).trim() : part.ok ? '✓' : '✗';
  const left = st().foreground(color).bold(true).render(icon) + ' ' + st().bold(true).foreground(C.text).render(part.name) +
    ' ' + st().foreground(C.sub).render(clip(part.arg, Math.max(8, boxW - 24)));
  const right = part.done ? st().foreground(C.dim).render(fmtMs(part.ms)) : st().foreground(C.dim).render('running');
  const b = st().foreground(color);
  const fill = Math.max(1, boxW - 2 - 1 - stringWidth(left) - 1 - stringWidth(right) - 2 - 2);
  const top = b.render('╭─') + ' ' + left + ' ' + b.render('─'.repeat(fill)) + ' ' + right + ' ' + b.render('─╮');

  const inner = boxW - 4;
  const body: string[] = [];
  if (!part.done) {
    body.push(st().foreground(C.dim).render('waiting for the result…'));
  } else {
    const hint = expanded ? '' : st().foreground(C.faint).render('  tab to expand');
    body.push(st().foreground(C.dim).render(expanded ? '▾ ' : '▸ ') + st().foreground(C.text).render(part.summary) + hint);
    if (expanded) for (const l of part.output) body.push(colorOutput(clip(l, inner)));
  }
  const rows = body.map((l) => b.render('│') + ' ' + padRight(truncate(l, inner), inner) + ' ' + b.render('│'));
  const bottom = b.render('╰' + '─'.repeat(boxW - 2) + '╯');
  return [top, ...rows, bottom].map((l) => '  ' + l).join('\n');
}

// ── key bindings ───────────────────────────────────────────────────────────
const bind = (keys: string[], key: string, desc: string) => newBinding(withKeys(...keys), withHelp(key, desc));
const helpBindings = [
  bind(['enter'], 'enter', 'send'),
  bind(['alt+enter'], 'alt+enter', 'newline'),
  bind(['tab', 'ctrl+o'], 'tab', 'tool output'),
  bind(['pgup', 'pgdown'], 'pgup/pgdn', 'scroll'),
  bind(['ctrl+t'], 'ctrl+t', 'theme'),
  bind(['esc', 'ctrl+c'], 'esc', 'quit'),
];

// ── the model ──────────────────────────────────────────────────────────────
class Chat {
  parts: Part[] = [{ kind: 'text', id: 'welcome', role: 'assistant', text: WELCOME, done: true }];
  cache = new Map<string, string>();
  vp = newViewport();
  ta = newTextarea();
  spin = newSpinner(withSpinner(Dot), withSpinnerStyle(st().foreground(C.yellow)));
  help = newHelp();

  width = 0;
  height = 0;
  themeIx = 0;
  expanded = false; // show tool output
  tail = true; // follow new output while the reader is at the bottom
  busy = false;
  flushPending = false;
  turn = 0;
  tokensIn = 0;
  tokensOut = 0;

  // counters, printed when the program quits
  events = 0;
  renders = 0;
  cacheHits = 0;

  constructor() {
    const base = textareaDefaultDarkStyles();
    const text = { ...base.focused, base: st(), text: st().foreground(C.text), cursorLine: st(),
      prompt: st().foreground(C.mauve).bold(true), placeholder: st().foreground(C.dim), endOfBuffer: st().foreground(C.faint) };
    this.help.styles.shortKey = st().foreground(C.sub);
    this.help.styles.shortDesc = st().foreground(C.dim);
    this.help.styles.shortSeparator = st().foreground(C.faint);
    this.help.styles.ellipsis = st().foreground(C.faint);
    this.ta.setStyles({ focused: text, blurred: text, cursor: { ...base.cursor, color: C.mauve, blink: false } });
    this.ta.showLineNumbers = false;
    this.ta.placeholder = 'Ask the agent…  (enter sends, alt+enter adds a line)';
    this.ta.setPromptFunc(2, ({ lineNumber }) => (lineNumber === 0 ? '❯ ' : '  '));
    this.ta.keyMap.insertNewline = bind(['alt+enter', 'shift+enter', 'ctrl+j'], 'alt+enter', 'new line');
    this.ta.dynamicHeight = true; // grows with the text, up to maxHeight rows
    this.ta.minHeight = 1;
    this.ta.maxHeight = 5;
    this.ta.charLimit = 0;
    this.ta.setHeight(1);
    this.ta.focus();
  }

  get theme(): Theme { return THEMES[this.themeIx]!; }
  get tooSmall(): boolean { return this.width < MIN_WIDTH || this.height < MIN_HEIGHT; }
  get composerH(): number { return this.ta.height() + 2; }
  get toolRunning(): boolean { return this.parts.some((p) => p.kind === 'tool' && !p.done); }

  init(): Cmd { return null; }

  /** Sizes the viewport and the prompt for the terminal; the transcript must be re-wrapped after it. */
  layout(): void {
    this.ta.setWidth(Math.max(10, this.width - 4));
    this.vp.setWidth(this.width);
    this.vp.setHeight(Math.max(1, this.height - 3 - this.composerH)); // header, rule and help take a row each
    this.help.setWidth(this.width - 2);
  }

  /** Replaces a part with the same id, or appends a new one. Rendering is somebody else's job. */
  upsert(part: Part): void {
    const i = this.parts.findIndex((p) => p.id === part.id);
    if (i === -1) this.parts.push(part);
    else this.parts[i] = part;
  }

  /** Coalesce bursts of events into one re-render per tick. */
  schedule(): Cmd {
    if (this.flushPending) return null;
    this.flushPending = true;
    return Tick(FLUSH_MS, () => new FlushMsg());
  }

  update(msg: Msg): [Chat, Cmd] {
    if (msg instanceof WindowSizeMsg) {
      const widthChanged = msg.width !== this.width;
      this.width = msg.width;
      this.height = msg.height;
      if (widthChanged) this.cache.clear(); // the key contains the width; the old strings are dead weight
      this.layout();
      this.refresh();
      return [this, null];
    }

    if (msg instanceof PartMsg) {
      this.events++;
      const old = this.parts.find((p) => p.id === msg.part.id);
      const p = msg.part;
      if (p.kind === 'text') this.tokensOut += Math.ceil((p.text.length - (old?.kind === 'text' ? old.text.length : 0)) / 4);
      else if (p.done) this.tokensIn += Math.ceil(p.output.join('\n').length / 4);
      this.upsert(p);
      return [this, this.schedule()];
    }

    if (msg instanceof FlushMsg) {
      this.flushPending = false;
      this.refresh();
      return [this, null];
    }

    if (msg instanceof TurnDoneMsg) {
      this.busy = false;
      return [this, null];
    }

    if (msg instanceof InterruptMsg) return this.quit();
    if (msg instanceof KeyPressMsg) return this.onKey(msg);

    if (msg?._tag === 'MouseWheelMsg') {
      this.vp.update(msg);
      this.tail = this.vp.atBottom();
      return [this, null];
    }
    if (typeof msg?._tag === 'string' && msg._tag.startsWith('Mouse')) return [this, null];

    // The spinner returns a command only for its own tick; keep it alive while the agent works.
    const [, spinCmd] = this.spin.update(msg);
    if (spinCmd) {
      if (!this.busy) return [this, null];
      return [this, Batch(spinCmd, this.toolRunning ? this.schedule() : null)];
    }

    const [, c] = this.ta.update(msg);
    return [this, c];
  }

  quit(): [Chat, Cmd] {
    stopped = true;
    return [this, Quit];
  }

  onKey(msg: KeyPressMsg): [Chat, Cmd] {
    switch (msg.toString()) {
      case 'ctrl+c':
      case 'esc':
        return this.quit();
      case 'tab':
      case 'ctrl+o':
        this.expanded = !this.expanded;
        this.refresh();
        return [this, null];
      case 'ctrl+t':
        this.themeIx = (this.themeIx + 1) % THEMES.length;
        this.cache.clear();
        this.refresh();
        return [this, null];
      case 'pgup': this.vp.pageUp(); break;
      case 'pgdown': this.vp.pageDown(); break;
      case 'alt+up': this.vp.scrollUp(1); break;
      case 'alt+down': this.vp.scrollDown(1); break;
      case 'ctrl+end': this.vp.gotoBottom(); break;
      case 'enter':
        return [this, this.submit()];
      default: {
        const before = this.composerH;
        const [, c] = this.ta.update(msg);
        if (this.composerH !== before) { this.layout(); this.refresh(); }
        return [this, c];
      }
    }
    // a scroll key: remember whether the reader is at the bottom
    this.tail = this.vp.atBottom();
    return [this, null];
  }

  submit(): Cmd {
    const text = this.ta.value().trim();
    if (!text || this.busy) return null;
    this.turn++;
    this.parts = this.parts.filter((p) => p.id !== 'welcome'); // the splash goes away with the first prompt
    this.busy = true;
    this.tail = true; // sending a prompt jumps back to the bottom
    this.tokensIn += Math.ceil(text.length / 4);
    this.ta.reset();
    this.layout();
    this.upsert({ kind: 'text', id: `u${this.turn}`, role: 'user', text, done: true });
    void runTurn(this.turn, text);
    return Batch(() => this.spin.tick(), this.schedule());
  }

  // ── rendering ────────────────────────────────────────────────────────────

  /**
   * One part as a string. A finished part is rendered once and cached under a
   * hash of everything that changes its output; the part that is still
   * streaming is rendered on every flush and never stored.
   */
  block(part: Part, width: number): string {
    const theme = this.theme;
    const draw = () => {
      this.renders++;
      if (part.kind === 'tool') return renderTool(part, width, this.expanded, this.spin.view());
      if (part.role === 'user') return renderUser(part, width, theme);
      return renderMarkdown(part.done ? part.text : healStreaming(part.text), width, theme);
    };
    if (!part.done) return draw();

    // Tool details only change tool boxes, so only they put the flag in their key.
    const key = part.kind === 'tool'
      ? sha1(part.id, part.name, part.arg, part.ok, part.ms, part.summary, part.output.join('\n'), width, this.expanded, theme.name)
      : sha1(part.id, part.text, width, theme.name);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cacheHits++;
      return hit;
    }
    const out = draw();
    this.cache.set(key, out);
    return out;
  }

  refresh(): void {
    if (this.width === 0 || this.tooSmall) return;
    const width = this.vp.width();
    let content = '';
    let prev: Part | null = null;
    for (const part of this.parts) {
      const block = this.block(part, width);
      if (prev) content += prev.kind === 'tool' && part.kind === 'tool' ? '\n' : '\n\n';
      content += block;
      prev = part;
    }
    content += '\n'; // a blank row between the last line and the prompt
    // Follow the tail only if the reader was at the bottom; otherwise keep the offset.
    const y = this.vp.yOffset();
    this.vp.setContent(content);
    if (this.tail) this.vp.gotoBottom();
    else this.vp.setYOffset(y);
    this.tail = this.vp.atBottom();
  }

  // ── view ─────────────────────────────────────────────────────────────────

  header(): string {
    const dim = st().foreground(C.dim);
    const sub = st().foreground(C.sub);
    const brand = gradientText('▌ oak-code', C.mauve, C.pink, C.blue);
    const model = dim.render('  ') + sub.render(MODEL) + dim.render(' · ') + st().foreground(this.theme.accent).render(this.theme.name);
    const pill = this.tail
      ? st().bold(true).foreground(C.base).background(C.green).render(' following ')
      : st().bold(true).foreground(C.base).background(C.peach).render(' scrolled  ');
    const cache = sub.render('cache ') + st().foreground(C.teal).bold(true).render(fmt(this.cacheHits)) + sub.render(' hits');
    const tokens = sub.render(`↑${fmt(this.tokensIn)} ↓${fmt(this.tokensOut)} tok`) + dim.render(' · ');
    // Drop the less important pieces as the terminal gets narrower.
    const options: [string, string][] = [
      [brand + model, tokens + cache + '  ' + pill],
      [brand + model, cache + '  ' + pill],
      [brand, cache + '  ' + pill],
      [brand, pill],
    ];
    const [left, right] = options.find(([l, r]) => stringWidth(l) + stringWidth(r) < this.width) ?? options.at(-1)!;
    return truncate(left + ' '.repeat(Math.max(1, this.width - stringWidth(left) - stringWidth(right) - 1)) + right, this.width);
  }

  /** A thin rule under the header; when the reader has scrolled up it says how much is waiting below. */
  rule(): string {
    const below = Math.max(0, this.vp.totalLineCount() - this.vp.yOffset() - this.vp.height());
    if (this.tail || below === 0) return st().foreground(C.faint).render('─'.repeat(this.width));
    const label = ` ↓ ${below} more ${below === 1 ? 'line' : 'lines'} · ctrl+end `;
    return st().foreground(C.faint).render('─'.repeat(Math.max(0, this.width - stringWidth(label) - 2))) +
      st().foreground(C.peach).render(label) + st().foreground(C.faint).render('──');
  }

  composer(): string {
    const w = this.width;
    const color = this.busy ? C.dim : C.mauve;
    const b = st().foreground(color);
    const status = !this.busy ? st().foreground(C.sub).render('prompt')
      : st().foreground(C.yellow).render(stripAnsi(this.spin.view()).trim() + ' ' + this.statusText());
    const t = ' ' + status + ' ';
    const lines = this.ta.view().split('\n').map((l) => padRight(l, w - 4));
    const top = b.render('╭─') + t + b.render('─'.repeat(Math.max(0, w - 3 - stringWidth(t) - 1))) + b.render('─╮');
    const rows = lines.map((l) => b.render('│') + ' ' + l + ' ' + b.render('│'));
    return [top, ...rows, b.render('╰' + '─'.repeat(w - 2) + '╯')].join('\n');
  }

  statusText(): string {
    const running = this.parts.find((p): p is ToolPart => p.kind === 'tool' && !p.done);
    if (running) return `running ${running.name}`;
    const last = this.parts.at(-1);
    return last?.kind === 'text' && last.role === 'assistant' && !last.done ? 'writing' : 'thinking';
  }

  view(): View {
    let content: string;
    if (this.width === 0) content = '';
    else if (this.tooSmall) {
      content = place(this.width, this.height, Center, Center,
        st().foreground(C.peach).bold(true).render('Terminal too small') + '\n' +
        st().foreground(C.sub).render(`${this.width}×${this.height}, need at least ${MIN_WIDTH}×${MIN_HEIGHT}`) + '\n' +
        st().foreground(C.dim).render('esc quits'));
    } else {
      content = joinVertical(Left, this.header(), this.rule(), this.vp.view().replace(/ +$/gm, ''), this.composer(), truncate(' ' + this.help.shortHelpView(helpBindings), this.width));
    }
    const v = new View(content);
    v.altScreen = true;
    v.mouseMode = MouseMode.CellMotion;
    return v;
  }
}

program = NewProgram(new Chat());
const chat = (await program.run()) as Chat;
stopped = true;
console.log(`events: ${chat.events}, renders: ${chat.renders}, cache hits: ${chat.cacheHits}, rendered lines: ${chat.vp.totalLineCount()}`);
process.exit(0);
