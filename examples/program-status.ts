/**
 * Program Status — reports what the program is doing to the terminal with the
 * Program Status Protocol (OSC 7501), as upstream's examples/program-status.
 * Left and right step through the states; while "working", the report carries
 * a progress percentage. Terminals without the protocol ignore the reports, and
 * never answer the support query. Press q to quit.
 *
 * Run:  bun examples/program-status.ts
 */

import {
  type Msg,
  type Cmd,
  type Model,
  Program,
  KeyPressMsg,
  NewView,
  ProgramState,
  ProgramStatusKind,
  ProgramStatusSupportMsg,
  Quit,
  Batch,
  RequestProgramStatusSupport,
  Tick,
  type View,
} from '../src/index.js';

class TickMsg {}

const tick: Cmd = Tick(200, () => new TickMsg());

const states = [
  ProgramState.Idle,
  ProgramState.Working,
  ProgramState.Blocked,
  ProgramState.Done,
  ProgramState.Error,
];

const messages: Record<string, string> = {
  [ProgramState.Idle]: 'Waiting for instructions',
  [ProgramState.Working]: 'Building the project',
  [ProgramState.Blocked]: 'Deploy to production?',
  [ProgramState.Done]: 'Build finished',
  [ProgramState.Error]: 'Build failed',
};

class StatusModel implements Model {
  constructor(
    readonly state = 0,
    readonly progress = 0,
    readonly supported = false,
  ) {}

  init(): Cmd {
    return Batch(RequestProgramStatusSupport, tick);
  }

  update(msg: Msg): [Model, Cmd] {
    if (msg instanceof ProgramStatusSupportMsg) {
      return [new StatusModel(this.state, this.progress, true), null];
    }
    if (msg instanceof TickMsg) {
      const progress = states[this.state] === ProgramState.Working ? (this.progress + 5) % 105 : this.progress;
      return [new StatusModel(this.state, progress, this.supported), tick];
    }
    if (msg instanceof KeyPressMsg) {
      switch (msg.toString()) {
        case 'q':
        case 'ctrl+c':
          return [this, Quit];
        case 'right':
        case 'l':
        case 'space':
          return [new StatusModel((this.state + 1) % states.length, 0, this.supported), null];
        case 'left':
        case 'h':
          return [new StatusModel((this.state + states.length - 1) % states.length, 0, this.supported), null];
      }
    }
    return [this, null];
  }

  view(): View {
    const state = states[this.state]!;
    const support = this.supported ? 'supported' : 'no reply yet (unsupported, or behind tmux)';
    const v = NewView(
      `Program Status Protocol (OSC 7501): ${support}\n\nState: ${state}\nMessage: ${messages[state]}\n\n` +
        'Press left/right to change state, q to quit.\n',
    );
    v.programStatus = {
      state,
      app: 'program-status-example',
      kind: ProgramStatusKind.Permission,
      progress: this.progress,
      hasProgress: state === ProgramState.Working,
      message: messages[state],
    };
    return v;
  }
}

await new Program(new StatusModel()).run();
