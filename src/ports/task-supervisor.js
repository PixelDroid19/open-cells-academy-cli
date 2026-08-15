/**
 * Port defining the contract for process supervision in a TUI session.
 */
export class TaskSupervisorPort {
  async startTask() {
    throw new Error('TaskSupervisorPort.startTask must be implemented');
  }

  async cancelTask() {
    throw new Error('TaskSupervisorPort.cancelTask must be implemented');
  }

  async restartTask() {
    throw new Error('TaskSupervisorPort.restartTask must be implemented');
  }

  async stopAll() {
    throw new Error('TaskSupervisorPort.stopAll must be implemented');
  }

  getTask() {
    throw new Error('TaskSupervisorPort.getTask must be implemented');
  }

  getAllTasks() {
    throw new Error('TaskSupervisorPort.getAllTasks must be implemented');
  }
}
