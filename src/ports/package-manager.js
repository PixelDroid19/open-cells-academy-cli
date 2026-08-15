/**
 * Boundary for installing a workspace with the public npm registry only.
 */
export class PackageManagerPort {
  async install() {
    throw new Error('PackageManagerPort.install must be implemented');
  }
}
