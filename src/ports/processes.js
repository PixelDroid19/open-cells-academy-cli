/**
 * Boundary for spawning a bounded, directly addressed child process.
 */
export class ProcessPort {
  async run() {
    throw new Error('ProcessPort.run must be implemented');
  }
}
