/**
 * Boundary for per-workspace mutation locks.
 */
export class WorkspaceLockPort {
  async acquire() {
    throw new Error('WorkspaceLockPort.acquire must be implemented');
  }
}
