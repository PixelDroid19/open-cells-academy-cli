import { ANSI_SEQUENCES } from './ansi-screen.js';

const TITLE_TEXT = 'ACADEMY CELLS';

const SHIMMER_COLORS = Object.freeze([
  ANSI_SEQUENCES.cyan,
  ANSI_SEQUENCES.bold + ANSI_SEQUENCES.cyan,
  ANSI_SEQUENCES.bold + ANSI_SEQUENCES.white,
  ANSI_SEQUENCES.bold + ANSI_SEQUENCES.blue,
  ANSI_SEQUENCES.blue,
  ANSI_SEQUENCES.magenta
]);

/**
 * Low-overhead discrete title animator for the TUI header.
 */
export class TitleAnimator {
  #enabled;
  #frame;
  #isSuspended;
  #lastActivity;
  #idleTimeoutMs;

  constructor({
    enabled = true,
    idleTimeoutMs = 30000,
    env = process.env
  } = {}) {
    const noColor = Boolean(env.NO_COLOR && env.NO_COLOR !== '0');
    const dumbTerm = env.TERM === 'dumb';
    this.#enabled = enabled && !noColor && !dumbTerm;
    this.#frame = 0;
    this.#isSuspended = false;
    this.#lastActivity = Date.now();
    this.#idleTimeoutMs = idleTimeoutMs;
  }

  get isSuspended() {
    return this.#isSuspended;
  }

  get isEnabled() {
    return this.#enabled;
  }

  touch() {
    this.#lastActivity = Date.now();
    this.#isSuspended = false;
  }

  suspend() {
    this.#isSuspended = true;
  }

  tick() {
    if (!this.#enabled || this.#isSuspended) {
      return false;
    }
    if (Date.now() - this.#lastActivity > this.#idleTimeoutMs) {
      this.#isSuspended = true;
      return false;
    }
    this.#frame = (this.#frame + 1) % (TITLE_TEXT.length + SHIMMER_COLORS.length);
    return true;
  }

  render() {
    if (!this.#enabled) {
      return TITLE_TEXT;
    }

    let rendered = '';
    for (let i = 0; i < TITLE_TEXT.length; i++) {
      const char = TITLE_TEXT[i];
      const cycleLength = TITLE_TEXT.length + SHIMMER_COLORS.length;
      const offset = (this.#frame - i + SHIMMER_COLORS.length + cycleLength) % cycleLength;
      const color = offset < SHIMMER_COLORS.length ? SHIMMER_COLORS[offset] : ANSI_SEQUENCES.cyan;
      rendered += `${color}${char}${ANSI_SEQUENCES.reset}`;
    }
    return rendered;
  }
}
