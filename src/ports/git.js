/**
 * Boundary for structured history from the workspace's Git repository.
 */
export class GitPort {
  async inspectRepository() {
    throw new Error('GitPort.inspectRepository must be implemented');
  }

  async readConventionalCommits() {
    throw new Error('GitPort.readConventionalCommits must be implemented');
  }
}
