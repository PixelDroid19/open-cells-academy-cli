/**
 * Boundary for workspace-confined text documents with atomic publication.
 */
export class TextDocumentsPort {
  async read() {
    throw new Error('TextDocumentsPort.read must be implemented');
  }

  async readVersioned() {
    throw new Error('TextDocumentsPort.readVersioned must be implemented');
  }

  async writeAtomically() {
    throw new Error('TextDocumentsPort.writeAtomically must be implemented');
  }
}
