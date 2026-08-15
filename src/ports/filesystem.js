/**
 * Boundary for workspace-scoped filesystem operations. Implementations own
 * host APIs; callers operate only through WorkspaceSession and ScaffoldPlan.
 */
export class FilesystemPort {
  async applyPlanAtomically() {
    throw new Error('FilesystemPort.applyPlanAtomically must be implemented');
  }
}
